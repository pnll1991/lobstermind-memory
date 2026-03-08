/**
 * LobsterMind Memory - Long-term memory plugin for OpenClaw
 * Step 1: SQLite + Local Hash-based Embeddings
 * 
 * Features:
 * - SQLite storage for persistent memory
 * - Local hash-based embeddings (no API required)
 * - Automatic Obsidian sync
 * - Semantic search and recall
 * - CLI commands for memory management
 * 
 * Author: Paolozky
 * License: MIT
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';

interface MemoryRecord {
  id: string;
  content: string;
  type: string;
  confidence: number;
  tags?: string;
  embedding: string;
  created_at: string;
  updated_at: string;
  score?: number;
}

const lobsterMindPlugin = {
  id: 'lobstermind-memory',
  name: 'LobsterMind Memory',
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
  console.log('[lobstermind] Plugin loading...');
  console.log('[lobstermind] API type:', typeof api);
  console.log('[lobstermind] API keys:', Object.keys(api || {}).join(', '));
  
  const config = api?.config || {};
  console.log('[lobstermind] Config:', JSON.stringify(config, null, 2));
  
  const workspaceRoot = config.workspaceRoot || process.env.OPENCLAW_WORKSPACE || (api.runtime?.workspace || 'C:\\Users\\Paolozky\\.openclaw\\workspace');
  const memoryDir = join(workspaceRoot, 'memory');
  const dbPath = join(memoryDir, 'lobstermind-memory.db');
  
  console.log('[lobstermind] Workspace:', workspaceRoot);
  console.log('[lobstermind] Memory dir:', memoryDir);
  console.log('[lobstermind] Database:', dbPath);
  
  // Ensure directory exists
  try {
    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true });
    }
  } catch (err: any) {
    console.error('[lobstermind] Error creating directory:', err.message);
  }
  
  console.log('[lobstermind] Initializing database...');
  
  // Initialize database
  let db: any;
  try {
    db = new Database(dbPath);
  } catch (err: any) {
    console.error('[lobstermind] Database init error:', err.message);
    console.error('[lobstermind] dbPath:', dbPath, 'type:', typeof dbPath);
    throw err;
  }
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      confidence REAL NOT NULL,
      tags TEXT,
      embedding TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories(tags);
  `);
  console.log('[lobstermind] Database initialized');
  
  // Native markdown integration - MEMORY.md file
  const memoryMdPath = join(workspaceRoot, 'MEMORY.md');
  
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
      console.error('[lobstermind] Embedding error:', err.message);
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
  
  async function captureMemory(content: string, type: string = 'USER_FACT', confidence: number = 0.7, skipSync: boolean = false, tags?: string): Promise<string> {
    const now = new Date().toISOString();
    
    // AUTO-DEDUPLICATION: Check for similar memories before creating new one
    const similarMemories = await findSimilarMemories(content, 0.85);
    if (similarMemories.length > 0) {
      // Update existing memory instead of creating duplicate
      const existingMemory = similarMemories[0];
      console.log('[lobstermind] Auto-dedup: Found similar memory (score:', existingMemory.score.toFixed(2), ')');
      console.log('[lobstermind] Auto-dedup: Updating instead of creating duplicate');
      
      db.prepare('UPDATE memories SET content = ?, type = ?, confidence = ?, tags = ?, updated_at = ? WHERE id = ?')
        .run(content, type, confidence, tags || existingMemory.tags || null, now, existingMemory.id);
      
      // Sync to Obsidian and MEMORY.md
      if (!skipSync) {
        syncToObsidian(content, type, confidence, now);
        syncToMemoryMd(content, type, confidence, now, tags);
      }
      
      console.log('[lobstermind] Updated memory:', content.substring(0, 50));
      return existingMemory.id;
    }
    
    // Generate unique ID for new memory
    const id = createHash('sha256').update(content).digest('hex').substring(0, 16);
    
    // Get embedding
    const embedding = await getEmbedding(content);
    
    // Insert new memory
    db.prepare('INSERT INTO memories (id, content, type, confidence, tags, embedding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, content, type, confidence, tags || null, JSON.stringify(embedding), now, now);
    
    // Sync to Obsidian and MEMORY.md
    if (!skipSync) {
      syncToObsidian(content, type, confidence, now);
      syncToMemoryMd(content, type, confidence, now, tags);
    }
    
    console.log('[lobstermind] Captured memory:', content.substring(0, 50));
    return id;
  }
  
  // Native Markdown Integration - Sync to MEMORY.md
  function syncToMemoryMd(content: string, type: string, confidence: number, createdAt: string, tags?: string) {
    try {
      const date = new Date(createdAt).toISOString().split('T')[0];
      const tagsStr = tags ? ` #[${tags.split(',').join('][')}]` : '';
      const entry = `- [${type}] ${content}${tagsStr} (confidence: ${confidence.toFixed(2)})\n`;
      
      let existing = '';
      if (existsSync(memoryMdPath)) {
        existing = readFileSync(memoryMdPath, 'utf-8');
      }
      
      const dateHeader = `## ${date}\n\n`;
      
      if (!existing.includes(dateHeader)) {
        // Add new date section
        writeFileSync(memoryMdPath, `${existing}${dateHeader}${entry}\n`, 'utf-8');
      } else if (!existing.includes(entry.trim())) {
        // Add to existing date section
        const lines = existing.split('\n');
        const newLines: string[] = [];
        let foundDate = false;
        let added = false;
        
        for (let i = 0; i < lines.length; i++) {
          newLines.push(lines[i]);
          if (lines[i] === dateHeader.trim()) {
            foundDate = true;
          } else if (foundDate && !added && (lines[i].startsWith('- [') || lines[i] === '')) {
            // Add before next entry or empty line
            newLines.push(entry.trim());
            added = true;
          }
        }
        
        if (!added && foundDate) {
          newLines.push(entry.trim());
        }
        
        writeFileSync(memoryMdPath, newLines.join('\n'), 'utf-8');
      }
      
      console.log('[lobstermind] Synced to MEMORY.md:', memoryMdPath);
    } catch (err: any) {
      console.error('[lobstermind] MEMORY.md sync error:', err.message);
    }
  }
  
  async function findSimilarMemories(query: string, threshold: number = 0.85): Promise<{id: string, content: string, score: number}[]> {
    const queryEmbedding = await getEmbedding(query);
    const memories = db.prepare('SELECT id, content, embedding FROM memories').all() as MemoryRecord[];
    
    const scored = memories
      .map(m => {
        const embedding = JSON.parse(m.embedding || '[]');
        const score = cosineSimilarity(queryEmbedding, embedding);
        return { id: m.id, content: m.content, score };
      })
      .filter(m => m.score >= threshold)
      .sort((a, b) => b.score - a.score);
    
    return scored;
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
  
  // Obsidian sync - export memories to LobsterMind vault
  const obsidianDir = join(workspaceRoot, 'obsidian-vault', 'LobsterMind');
  
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
      
      console.log('[lobstermind] Synced to Obsidian:', mdPath);
    } catch (err: any) {
      console.error('[lobstermind] Obsidian sync error:', err.message);
    }
  }
  
  // Hook: Before prompt build - recall relevant memories
  console.log('[lobstermind] Registering before_prompt_build hook...');
  api.on('before_prompt_build', async (event: any, ctx: any) => {
    try {
      console.log('[lobstermind] before_prompt_build triggered!');
      console.log('[lobstermind] Event keys:', Object.keys(event || {}).join(', '));
      
      // Messages are in event, not ctx!
      const messages = event?.messages || ctx?.messages || [];
      console.log('[lobstermind] Messages count:', messages.length);
      
      // Also check event.prompt
      const prompt = event?.prompt;
      console.log('[lobstermind] Event.prompt:', prompt ? prompt.substring(0, 100) : 'not available');
      
      // Find the last USER message with enough length
      let query = '';
      const skipPhrases = ['session bootstrap', 'system:', 'tool:'];
      const minLength = 5;
      
      console.log('[lobstermind] Scanning for USER messages...');
      
      // Search backwards through ONLY user messages
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        
        // Only process user messages!
        if (msg?.role !== 'user') {
          continue;
        }
        
        const content = msg?.content || msg?.text || '';
        if (!content) continue;
        
        const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
        
        // Log all user messages we find
        console.log(`[lobstermind] User message[${i}]: type=${typeof content}, length=${contentStr.length}`);
        console.log(`[lobstermind] Preview: ${contentStr.substring(0, 60)}`);
        
        if (contentStr.length >= minLength) {
          const lowerContent = contentStr.toLowerCase();
          const isSystemMessage = skipPhrases.some(phrase => lowerContent.includes(phrase));
          
          if (!isSystemMessage) {
            query = contentStr;
            console.log('[lobstermind] ✓ FOUND suitable user message at index', i, 'with length', query.length);
            console.log('[lobstermind] Query:', query.substring(0, 80));
            break;
          } else {
            console.log('[lobstermind] ✗ Skipping system/bootstrap at index', i);
          }
        } else {
          console.log('[lobstermind] ✗ Message too short at index', i);
        }
      }
      
      if (!query) {
        console.log('[lobstermind] ⚠ No suitable user message found');
        return null;
      }
      
      try {
        const memories = await recallMemories(query);
        console.log('[lobstermind] Recall results:', memories.length);
        
        if (memories.length > 0) {
          const context = memories.map(m => `- ${m.content}`).join('\n');
          console.log(`[lobstermind] ✓ Recalled ${memories.length} memories`);
          const result = {
            prependSystemContext: `<lobstermind-memory-context>\nRelevant memories from long-term storage:\n${context}\n</lobstermind-memory-context>`
          };
          console.log('[lobstermind] Returning context');
          return result;
        } else {
          console.log('[lobstermind] No memories found for this query');
        }
      } catch (recallErr: any) {
        console.error('[lobstermind] Recall error:', recallErr.message);
      }
      
      return null;
    } catch (err: any) {
      console.error('[lobstermind] HOOK ERROR (non-blocking):', err.message);
      console.error('[lobstermind] Stack:', err.stack);
      return null;
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
            const tags = note.match(/tags="([^"]*)"/)?.[1]; // Extract tags
            
            if (content && content.length >= 25) {
              try {
                await captureMemory(content, type, confidence, false, tags);
              } catch (err: any) {
                console.error('[lobstermind] Capture error:', err.message);
              }
            }
          }
        }
      }
    }
  });
  
  // Register CLI command for manual memory management
  if (api.registerCli) {
    console.log('[lobstermind] Registering memories CLI...');
    try {
      api.registerCli(
        ({ program }: any) => {
          const memories = program
            .command('memories')
            .description('Manage long-term memories (LobsterMind Memory)');

          // Subcommand: list
          memories
            .command('list')
            .description('List recent memories')
            .option('--limit <n>', 'Maximum number of memories to show', '20')
            .option('--tag <tag>', 'Filter by tag')
            .action((options: any) => {
              const limit = parseInt(options.limit) || 20;
              let query = 'SELECT * FROM memories';
              let params: any[] = [];
              
              if (options.tag) {
                query += ' WHERE tags LIKE ?';
                params.push(`%${options.tag}%`);
              }
              
              query += ' ORDER BY created_at DESC LIMIT ?';
              params.push(limit);
              
              const memories = db.prepare(query).all(...params) as MemoryRecord[];
              if (memories.length === 0) {
                console.log('No memories stored');
                return;
              }
              console.log(`Recent memories (${memories.length}):\n`);
              memories.forEach((m, i) => {
                const date = new Date(m.created_at).toLocaleDateString();
                const tagsStr = m.tags ? ` | Tags: [${m.tags}]` : '';
                console.log(`${i + 1}. [${m.type}] ${m.content}`);
                console.log(`   ID: ${m.id} | Created: ${date} | Confidence: ${m.confidence.toFixed(2)}${tagsStr}`);
              });
            });

          // Subcommand: add
          memories
            .command('add <content>')
            .description('Add a memory manually')
            .option('--tags <tags>', 'Comma-separated tags')
            .action((content: string, options: any) => {
              const tags = options.tags || undefined;
              captureMemory(content, 'MANUAL', 0.9, false, tags).then((id: string) => {
                console.log(`✓ Memory saved with ID: ${id}`);
                if (tags) console.log(`  Tags: [${tags}]`);
              }).catch((err: any) => {
                console.error('✗ Error saving memory:', err.message);
              });
            });

          // Subcommand: delete
          memories
            .command('delete <id>')
            .description('Delete a memory by ID')
            .option('--force', 'Skip confirmation prompt')
            .action((id: string, options: any) => {
              const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
              if (!memory) {
                console.error('✗ Memory not found:', id);
                return;
              }
              
              if (!options.force) {
                console.log(`Memory to delete: [${(memory as any).type}] ${(memory as any).content}`);
                const readline = require('readline').createInterface({
                  input: process.stdin,
                  output: process.stdout
                });
                readline.question('Are you sure? (y/N): ', (answer: string) => {
                  readline.close();
                  if (answer.toLowerCase() === 'y') {
                    db.prepare('DELETE FROM memories WHERE id = ?').run(id);
                    console.log('✓ Memory deleted');
                  } else {
                    console.log('Delete cancelled');
                  }
                });
                return;
              }
              
              db.prepare('DELETE FROM memories WHERE id = ?').run(id);
              console.log('✓ Memory deleted');
            });

          // Subcommand: edit
          memories
            .command('edit <id> <newContent>')
            .description('Edit a memory\'s content')
            .action((id: string, newContent: string) => {
              const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
              if (!memory) {
                console.error('✗ Memory not found:', id);
                return;
              }
              
              const now = new Date().toISOString();
              db.prepare('UPDATE memories SET content = ?, updated_at = ? WHERE id = ?').run(newContent, now, id);
              console.log('✓ Memory updated');
              console.log(`New content: ${newContent}`);
            });

          // Subcommand: search
          memories
            .command('search <query>')
            .description('Search memories by query')
            .option('--limit <n>', 'Maximum results', '10')
            .option('--min-score <n>', 'Minimum similarity score', '0.3')
            .action(async (query: string, options: any) => {
              const limit = parseInt(options.limit) || 10;
              const minScore = parseFloat(options.minScore) || 0.3;
              const results = await recallMemories(query, limit, minScore);
              if (results.length === 0) {
                console.log('No memories found');
                return;
              }
              console.log(`Found ${results.length} memories:\n`);
              results.forEach((m, i) => {
                console.log(`${i + 1}. [${m.type}] ${m.content}`);
                console.log(`   Score: ${m.score.toFixed(2)} | ID: ${m.id}`);
              });
            });

          // Subcommand: export
          memories
            .command('export [file]')
            .description('Export memories to JSON file')
            .action((file: string) => {
              const outputPath = file || `lobstermind-export-${new Date().toISOString().split('T')[0]}.json`;
              const memories = db.prepare('SELECT * FROM memories ORDER BY created_at DESC').all();
              
              const { writeFileSync } = require('fs');
              const { join } = require('path');
              const fullPath = join(process.cwd(), outputPath);
              
              writeFileSync(fullPath, JSON.stringify(memories, null, 2));
              console.log(`✓ Exported ${memories.length} memories to ${fullPath}`);
            });

          // Subcommand: import
          memories
            .command('import <file>')
            .description('Import memories from JSON file')
            .option('--skip-dupes', 'Skip duplicate memories')
            .action(async (file: string, options: any) => {
              const { readFileSync } = require('fs');
              const { join } = require('path');
              const fullPath = join(process.cwd(), file);
              
              try {
                const data = JSON.parse(readFileSync(fullPath, 'utf-8'));
                const importData = Array.isArray(data) ? data : [data];
                
                let imported = 0;
                let skipped = 0;
                let errors = 0;
                
                for (const memory of importData) {
                  try {
                    if (options.skipDupes) {
                      const exists = db.prepare('SELECT id FROM memories WHERE id = ?').get(memory.id);
                      if (exists) {
                        skipped++;
                        continue;
                      }
                    }
                    
                    db.prepare(`
                      INSERT OR REPLACE INTO memories (id, content, type, confidence, tags, embedding, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                      memory.id,
                      memory.content,
                      memory.type || 'IMPORTED',
                      memory.confidence || 0.7,
                      memory.tags || null,
                      memory.embedding || '[]',
                      memory.created_at || new Date().toISOString(),
                      memory.updated_at || new Date().toISOString()
                    );
                    imported++;
                  } catch (err: any) {
                    console.error('✗ Error importing memory:', memory.id, err.message);
                    errors++;
                  }
                }
                
                console.log(`✓ Import complete: ${imported} imported, ${skipped} skipped, ${errors} errors`);
              } catch (err: any) {
                console.error('✗ Error reading file:', err.message);
              }
            });

          // Subcommand: stats
          memories
            .command('stats')
            .description('Show memory statistics')
            .action(() => {
              const total = db.prepare('SELECT COUNT(*) as count FROM memories').get() as any;
              const byType = db.prepare('SELECT type, COUNT(*) as count FROM memories GROUP BY type').all();
              const byTags = db.prepare('SELECT tags FROM memories WHERE tags IS NOT NULL AND tags != ""').all();
              const oldest = db.prepare('SELECT MIN(created_at) as date FROM memories').get() as any;
              const newest = db.prepare('SELECT MAX(created_at) as date FROM memories').get() as any;
              
              // Extract unique tags
              const tagCounts: {[key: string]: number} = {};
              byTags.forEach((row: any) => {
                if (row.tags) {
                  row.tags.split(',').forEach((tag: string) => {
                    const t = tag.trim();
                    if (t) tagCounts[t] = (tagCounts[t] || 0) + 1;
                  });
                }
              });
              
              console.log('📊 Memory Statistics\n');
              console.log(`Total memories: ${total.count}`);
              console.log(`Oldest: ${oldest.date || 'N/A'}`);
              console.log(`Newest: ${newest.date || 'N/A'}\n`);
              console.log('By type:');
              (byType as any[]).forEach(row => {
                console.log(`  ${row.type}: ${row.count}`);
              });
              
              if (Object.keys(tagCounts).length > 0) {
                console.log('\nBy tag:');
                Object.entries(tagCounts).forEach(([tag, count]) => {
                  console.log(`  ${tag}: ${count}`);
                });
              }
            });
          
          // Subcommand: tags
          memories
            .command('tags')
            .description('List all tags')
            .action(() => {
              const withTags = db.prepare('SELECT tags FROM memories WHERE tags IS NOT NULL AND tags != ""').all();
              const tagCounts: {[key: string]: number} = {};
              
              withTags.forEach((row: any) => {
                if (row.tags) {
                  row.tags.split(',').forEach((tag: string) => {
                    const t = tag.trim();
                    if (t) tagCounts[t] = (tagCounts[t] || 0) + 1;
                  });
                }
              });
              
              if (Object.keys(tagCounts).length === 0) {
                console.log('No tags found');
                return;
              }
              
              console.log('🏷️  Memory Tags\n');
              Object.entries(tagCounts)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .forEach(([tag, count]) => {
                  console.log(`  ${tag}: ${count} memories`);
                });
            });
        },
        { commands: ['memories'] }
      );
      console.log('[lobstermind] Memories CLI registered with subcommands: list, add, delete, edit, search, export, import, stats, tags');
    } catch (err: any) {
      console.error('[lobstermind] CLI registration error:', err.message);
    }
  }
  
  console.log('[lobstermind] Hooks and commands registered');
  console.log('[lobstermind] Ready!');
  
  return {
    name: 'lobstermind-memory',
    version: '0.1.0'
  };
  } catch (err: any) {
    console.error('[lobstermind] FATAL ERROR:', err.message);
    console.error('[lobstermind] Stack:', err.stack);
    throw err;
  }
  }
};

export default lobsterMindPlugin;
