/**
 * Paolo Memory - Step 1: SQLite + DashScope Embeddings
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

interface MemoryRecord {
  id: string;
  content: string;
  type: string;
  confidence: number;
  embedding: string;
  created_at: string;
}

const paoloMemoryPlugin = {
  id: 'paolo-memory-v2',
  name: 'Paolo Memory',
  description: 'SQLite + DashScope embeddings long-term memory',
  kind: 'memory',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        default: true
      }
    }
  },
  register(api: any) {
  try {
  console.log('[paolo-memory] Plugin loading...');
  console.log('[paolo-memory] API type:', typeof api);
  console.log('[paolo-memory] API keys:', Object.keys(api || {}).join(', '));
  
  const config = api?.config || {};
  console.log('[paolo-memory] Config:', JSON.stringify(config, null, 2));
  
  const workspaceRoot = config.workspaceRoot || process.env.OPENCLAW_WORKSPACE || 'C:\\Users\\Paolozky\\.openclaw\\workspace';
  const memoryDir = join(workspaceRoot, 'memory');
  const dbPath = join(memoryDir, 'paolo-memory.db');
  
  console.log('[paolo-memory] Workspace:', workspaceRoot);
  console.log('[paolo-memory] Memory dir:', memoryDir);
  console.log('[paolo-memory] Database:', dbPath);
  
  // Ensure directory exists
  try {
    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true });
    }
  } catch (err: any) {
    console.error('[paolo-memory] Error creating directory:', err.message);
  }
  
  console.log('[paolo-memory] Initializing database...');
  
  // Initialize database
  let db: any;
  try {
    db = new Database(dbPath);
  } catch (err: any) {
    console.error('[paolo-memory] Database init error:', err.message);
    console.error('[paolo-memory] dbPath:', dbPath, 'type:', typeof dbPath);
    throw err;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'USER_FACT',
      confidence REAL DEFAULT 0.7,
      embedding TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
  `);
  console.log('[paolo-memory] Database initialized');
  
  // DashScope API for embeddings
  const DASHSCOPE_API_KEY = 'sk-sp-e350f88f031b4bd4aca34eabe8f78218';
  const DASHSCOPE_EMBEDDING_URL = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';
  
  async function getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await fetch(DASHSCOPE_EMBEDDING_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'text-embedding-v3',
          input: { texts: [text] }
        })
      });
      
      if (!response.ok) {
        throw new Error(`DashScope API error: ${response.status}`);
      }
      
      const data = await response.json();
      return data.output?.embeddings?.[0]?.embedding || [];
    } catch (err: any) {
      console.error('[paolo-memory] Embedding API error:', err.message);
      // Fallback to hash-based embedding
      return hashEmbedding(text);
    }
  }
  
  function hashEmbedding(text: string): number[] {
    const hash = createHash('sha256').update(text).digest('hex');
    const embedding = new Array(1536).fill(0);
    for (let i = 0; i < 192; i++) {
      embedding[i] = (parseInt(hash.substring(i * 2, i * 2 + 2), 16) / 255) * 2 - 1;
    }
    return embedding;
  }
  
  function cosineSimilarity(a: number[], b: number[]): number {
    const dot = a.reduce((sum, ai, i) => sum + ai * (b[i] || 0), 0);
    const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return normA && normB ? dot / (normA * normB) : 0;
  }
  
  async function captureMemory(content: string, type: string = 'USER_FACT', confidence: number = 0.7, skipSync: boolean = false): Promise<string> {
    const id = createHash('sha256').update(content).digest('hex').substring(0, 16);
    const now = new Date().toISOString();
    
    // Check for existing
    const existing = db.prepare('SELECT id FROM memories WHERE id = ?').get(id);
    if (existing) {
      db.prepare('UPDATE memories SET content = ?, type = ?, confidence = ?, updated_at = ? WHERE id = ?')
        .run(content, type, confidence, now, id);
      console.log('[paolo-memory] Updated memory:', content.substring(0, 50));
      return id;
    }
    
    // Get embedding
    const embedding = await getEmbedding(content);
    
    // Insert
    db.prepare('INSERT INTO memories (id, content, type, confidence, embedding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, content, type, confidence, JSON.stringify(embedding), now, now);
    
    // Sync to Obsidian
    if (!skipSync) {
      syncToObsidian(content, type, confidence, now);
    }
    
    console.log('[paolo-memory] Captured memory:', content.substring(0, 50));
    return id;
  }
  
  async function recallMemories(query: string, topK: number = 8, minScore: number = 0.45): Promise<MemoryRecord[]> {
    const queryEmbedding = await getEmbedding(query);
    const memories = db.prepare('SELECT * FROM memories').all() as MemoryRecord[];
    
    const scored = memories.map(m => {
      const embedding = JSON.parse(m.embedding || '[]');
      const score = cosineSimilarity(queryEmbedding, embedding);
      return { ...m, score };
    }).filter(m => m.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    
    return scored;
  }
  
  // Obsidian sync
  const obsidianDir = join(workspaceRoot, 'obsidian-vault', 'Gigabrain');
  
  function syncToObsidian(content: string, type: string, confidence: number, createdAt: string) {
    try {
      if (!existsSync(obsidianDir)) {
        mkdirSync(obsidianDir, { recursive: true });
      }
      
      const date = new Date(createdAt || Date.now()).toISOString().split('T')[0];
      const mdPath = join(obsidianDir, 'Memories.md');
      
      const entry = `- [${type}] ${content} (confidence: ${confidence.toFixed(2)})\n`;
      const dateHeader = `## [[${date}]]\n\n`;
      
      if (!existsSync(mdPath)) {
        writeFileSync(mdPath, `# Memories\n\n${dateHeader}${entry}\n`, 'utf-8');
      } else {
        const existing = readFileSync(mdPath, 'utf-8');
        if (!existing.includes(dateHeader)) {
          appendFileSync(mdPath, `\n${dateHeader}${entry}`, 'utf-8');
        } else {
          appendFileSync(mdPath, entry, 'utf-8');
        }
      }
      
      console.log('[paolo-memory] Synced to Obsidian:', mdPath);
    } catch (err: any) {
      console.error('[paolo-memory] Obsidian sync error:', err.message);
    }
  }
  
  // Hook: Before prompt build - recall relevant memories
  console.log('[paolo-memory] Registering before_prompt_build hook...');
  api.on('before_prompt_build', async (event: any, ctx: any) => {
    console.log('[paolo-memory] before_prompt_build triggered!');
    
    // Messages are in event, not ctx!
    const messages = event?.messages || ctx?.messages || [];
    console.log('[paolo-memory] Messages count:', messages.length);
    
    // Find the last user message with enough length (skip short commands/reactions)
    let query = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'user' && msg.content && msg.content.length >= 10) {
        query = msg.content;
        console.log('[paolo-memory] Found user message at index', i, 'with length', query.length);
        break;
      }
    }
    
    if (!query) {
      console.log('[paolo-memory] Skipping recall - no suitable user message found');
      return;
    }
    
    console.log('[paolo-memory] Query:', query.substring(0, 50));
    
    try {
      const memories = await recallMemories(query);
      console.log('[paolo-memory] Recall results:', memories.length);
      
      if (memories.length > 0) {
        const context = memories.map(m => `- ${m.content}`).join('\n');
        console.log(`[paolo-memory] Recalled ${memories.length} memories`);
        return {
          prependSystemContext: `<paolo-memory-context>\nRelevant memories from long-term storage:\n${context}\n</paolo-memory-context>`
        };
      } else {
        console.log('[paolo-memory] No memories found for this query');
      }
    } catch (err: any) {
      console.error('[paolo-memory] Recall error:', err.message);
      console.error('[paolo-memory] Stack:', err.stack);
    }
  });
  
  // Hook: After agent turn - capture memories from assistant response
  api.on('before_model_resolve', async (event: any, ctx: any) => {
    // Check for memory_note tags in recent messages
    const messages = ctx?.messages || [];
    for (const msg of messages.slice(-5)) {
      if (msg.role === 'assistant' && msg.content) {
        const memoryNoteMatch = msg.content.match(/<memory_note[^>]*>(.*?)<\/memory_note>/gs);
        if (memoryNoteMatch) {
          for (const note of memoryNoteMatch) {
            const contentMatch = note.match(/>(.*?)</s);
            const content = contentMatch?.[1];
            if (!content) continue;
            const type = note.match(/type="([^"]*)"/)?.[1] || 'USER_FACT';
            const confidence = parseFloat(note.match(/confidence="([^"]*)"/)?.[1] || '0.7');
            
            if (content && content.length >= 25) {
              try {
                await captureMemory(content, type, confidence);
              } catch (err: any) {
                console.error('[paolo-memory] Capture error:', err.message);
              }
            }
          }
        }
      }
    }
  });
  
  // Register CLI command for manual memory management
  if (api.registerCli) {
    console.log('[paolo-memory] Registering memories CLI...');
    try {
      api.registerCli(
        ({ program }: any) => {
          program
            .command('memories')
            .description('Manage long-term memories (Paolo Memory)')
            .option('--list', 'List recent memories')
            .option('--add <content>', 'Add a memory manually')
            .option('--search <query>', 'Search memories by query')
            .action(async (options: any) => {
              if (options.list) {
                const memories = db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT 20').all() as MemoryRecord[];
                if (memories.length === 0) {
                  console.log('No memories stored');
                  return;
                }
                console.log(`Recent memories (${memories.length}):\n`);
                memories.forEach((m, i) => console.log(`${i + 1}. [${m.type}] ${m.content}`));
              } else if (options.add) {
                const id = await captureMemory(options.add, 'MANUAL', 0.9, false);
                console.log(`Memory saved with ID: ${id}`);
              } else if (options.search) {
                const memories = await recallMemories(options.search, 10, 0.3);
                if (memories.length === 0) {
                  console.log('No memories found');
                  return;
                }
                console.log(`Found ${memories.length} memories:\n`);
                memories.forEach((m, i) => console.log(`${i + 1}. [${m.type}] ${m.content} (score: ${m.score.toFixed(2)})`));
              } else {
                console.log('Usage: openclaw memories --list|--add <content>|--search <query>');
              }
            });
        },
        { commands: ['memories'] }
      );
      console.log('[paolo-memory] Memories CLI registered with options: --list, --add, --search');
    } catch (err: any) {
      console.error('[paolo-memory] CLI registration error:', err.message);
    }
  }
  
  console.log('[paolo-memory] Hooks and commands registered');
  console.log('[paolo-memory] Ready!');
  
  return {
    name: 'paolo-memory',
    version: '0.1.0'
  };
  } catch (err: any) {
    console.error('[paolo-memory] FATAL ERROR:', err.message);
    console.error('[paolo-memory] Stack:', err.stack);
    throw err;
  }
  }
};

export default paoloMemoryPlugin;
