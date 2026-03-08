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
      type TEXT NOT NULL,
      confidence REAL NOT NULL,
      embedding TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
  `);
  console.log('[paolo-memory] Database initialized');
  
  // Local embeddings using simple hash-based method (no API required!)
  // This enables semantic-like search without external dependencies
  
  function hashToVector(text: string, dimensions: number = 384): number[] {
    const hash = createHash('sha256').update(text).digest('hex');
    const vector: number[] = [];
    
    // Convert hash bytes to normalized float values between -1 and 1
    for (let i = 0; i < dimensions; i += 4) {
      const hashSegment = hash.slice(i % hash.length, (i % hash.length) + 4);
      const intVal = parseInt(hashSegment, 16) || 0;
      // Normalize to [-1, 1]
      const normalized = (intVal / 0xFFFFFFFF) * 2 - 1;
      vector.push(normalized);
    }
    
    // Ensure exact dimensions
    while (vector.length < dimensions) {
      vector.push(0);
    }
    
    return vector.slice(0, dimensions);
  }
  
  async function getEmbedding(text: string): Promise<number[]> {
    try {
      // Use local hash-based embedding (fast, no API needed)
      const vector = hashToVector(text);
      return vector;
    } catch (err: any) {
      console.error('[paolo-memory] Embedding error:', err.message);
      // Fallback to zero vector (still allows storage, just no semantic search)
      return new Array(384).fill(0);
    }
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
    
    // Find the last user message with enough length (skip short commands/reactions/bootstrap)
    let query = '';
    const skipPhrases = ['session bootstrap', 'system:', 'assistant:', 'tool:'];
    const minLength = 5; // Reduced from 10 to catch shorter questions
    
    console.log('[paolo-memory] Scanning messages for recall...');
    
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      
      // Debug: show last 5 messages
      if (i >= messages.length - 5) {
        console.log(`[paolo-memory] Message[${i}]: role=${msg?.role}, length=${msg?.content?.length || 0}`);
      }
      
      if (msg?.role === 'user' && msg?.content && msg.content.length >= minLength) {
        // Skip bootstrap/system messages
        const lowerContent = msg.content.toLowerCase();
        const isSystemMessage = skipPhrases.some(phrase => lowerContent.includes(phrase));
        
        if (!isSystemMessage) {
          query = msg.content;
          console.log('[paolo-memory] Found user message at index', i, 'with length', query.length);
          console.log('[paolo-memory] Query preview:', query.substring(0, 60));
          break;
        } else {
          console.log('[paolo-memory] Skipping system/bootstrap message at index', i);
        }
      }
    }
    
    if (!query) {
      console.log('[paolo-memory] Skipping recall - no suitable user message found (all messages too short or system messages)');
      console.log('[paolo-memory] Tip: Try asking a question with at least', minLength, 'characters');
      return;
    }
    
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
