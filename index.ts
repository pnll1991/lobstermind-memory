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
  description: 'SQLite + local embeddings long-term memory',
  kind: 'memory',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        default: true
      },
      expiration: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', default: false },
          days: { type: 'number', default: 90 },
          action: { type: 'string', enum: ['archive', 'delete'], default: 'archive' }
        }
      },
      backup: {
        type: 'object',
        properties: {
          autoBackup: { type: 'boolean', default: true },
          interval: { type: 'number', default: 24 } // hours
        }
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
  
  // Ensure directories exist (auto-setup on first load)
  const dirsToCreate = [
    memoryDir,
    join(workspaceRoot, 'memory', 'backups'),
    join(workspaceRoot, 'memory', 'cloud-sync'),
    join(workspaceRoot, 'obsidian-vault', 'LobsterMind')
  ];
  
  for (const dir of dirsToCreate) {
    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        console.log('[lobstermind] Created directory:', dir);
      }
    } catch (err: any) {
      console.error('[lobstermind] Error creating directory:', dir, err.message);
    }
  }
  
  // Create native MEMORY.md if not exists
  const memoryMdPath = join(workspaceRoot, 'MEMORY.md');
  if (!existsSync(memoryMdPath)) {
    try {
      writeFileSync(memoryMdPath, '# Memories\n\nAuto-created by LobsterMind Memory plugin\n\n', 'utf-8');
      console.log('[lobstermind] Created MEMORY.md:', memoryMdPath);
    } catch (err: any) {
      console.error('[lobstermind] Error creating MEMORY.md:', err.message);
    }
  }
  
  // Create Obsidian Memories.md if not exists
  const obsidianMdPath = join(workspaceRoot, 'obsidian-vault', 'LobsterMind', 'Memories.md');
  if (!existsSync(obsidianMdPath)) {
    try {
      writeFileSync(obsidianMdPath, '# Memories\n\nAuto-created by LobsterMind Memory plugin\n\n', 'utf-8');
      console.log('[lobstermind] Created Obsidian Memories.md:', obsidianMdPath);
    } catch (err: any) {
      console.error('[lobstermind] Error creating Obsidian Memories.md:', err.message);
    }
  }
  
  console.log('[lobstermind] Initializing database...');
  
  // Initialize database (WITHOUT tags index first)
  let db: any;
  try {
    db = new Database(dbPath);
  } catch (err: any) {
    console.error('[lobstermind] Database init error:', err.message);
    console.error('[lobstermind] dbPath:', dbPath, 'type:', typeof dbPath);
    throw err;
  }
  
  // Create tables without tags first (backward compatible)
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
    CREATE TABLE IF NOT EXISTS archived_memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      confidence REAL NOT NULL,
      embedding TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
  `);
  
  // Migration: Add tags column if it doesn't exist
  try {
    db.exec('ALTER TABLE memories ADD COLUMN tags TEXT;');
    console.log('[lobstermind] Migration: Added tags column to memories table');
  } catch (err: any) {
    if (!err.message.includes('duplicate column')) {
      console.error('[lobstermind] Migration warning (memories):', err.message);
    }
  }
  
  try {
    db.exec('ALTER TABLE archived_memories ADD COLUMN tags TEXT;');
    console.log('[lobstermind] Migration: Added tags column to archived_memories table');
  } catch (err: any) {
    if (!err.message.includes('duplicate column')) {
      console.error('[lobstermind] Migration warning (archived):', err.message);
    }
  }
  
  // Create tags index after column exists
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories(tags);');
  } catch (err: any) {
    console.error('[lobstermind] Warning creating tags index:', err.message);
  }
  
  console.log('[lobstermind] Database initialized');
  
  // Native markdown integration - MEMORY.md file (already created in setup)
  // memoryMdPath is already declared above
  
  // Auto-cleanup on initialization (Memory Expiration feature)
  const pluginConfig = api.pluginConfig || {};
  const expirationConfig = pluginConfig.expiration || { enabled: false, days: 90, action: 'archive' };
  
  if (expirationConfig.enabled) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - expirationConfig.days);
    const cutoffStr = cutoffDate.toISOString();
    
    const oldMemories = db.prepare('SELECT id, content, created_at FROM memories WHERE created_at < ?').all(cutoffStr) as any[];
    
    if (oldMemories.length > 0) {
      console.log(`[lobstermind] Expiration: Found ${oldMemories.length} memories older than ${expirationConfig.days} days`);
      
      if (expirationConfig.action === 'archive') {
        // Move to archive table
        const archiveStmt = db.prepare('INSERT OR REPLACE INTO archived_memories SELECT *, ? as archived_at FROM memories WHERE id = ?');
        const deleteStmt = db.prepare('DELETE FROM memories WHERE id = ?');
        
        oldMemories.forEach(m => {
          archiveStmt.run(new Date().toISOString(), m.id);
          deleteStmt.run(m.id);
        });
        
        console.log(`[lobstermind] Expiration: Archived ${oldMemories.length} memories`);
      } else {
        // Delete
        const deleteStmt = db.prepare('DELETE FROM memories WHERE created_at < ?');
        deleteStmt.run(cutoffStr);
        console.log(`[lobstermind] Expiration: Deleted ${oldMemories.length} memories`);
      }
    }
  }
  
  // Auto-backup on initialization
  const backupConfig = pluginConfig.backup || { autoBackup: true, interval: 24 };
  
  if (backupConfig.autoBackup) {
    const backupDir = join(workspaceRoot, 'memory', 'backups');
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }
    
    // Check if backup needed based on interval
    const latestBackup = db.prepare("SELECT created_at FROM memories ORDER BY created_at DESC LIMIT 1").get() as any;
    if (latestBackup) {
      const lastBackupTime = new Date(latestBackup.created_at).getTime();
      const now = Date.now();
      const hoursSinceBackup = (now - lastBackupTime) / (1000 * 60 * 60);
      
      if (hoursSinceBackup >= backupConfig.interval) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = join(backupDir, `auto-backup-${timestamp}.json`);
        const memories = db.prepare('SELECT * FROM memories ORDER BY created_at DESC').all();
        writeFileSync(backupPath, JSON.stringify(memories, null, 2));
        console.log(`[lobstermind] Auto-backup: Created ${backupPath} (${memories.length} memories)`);
      }
    }
  }
  
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
  
  // Hook: Capture memories from user messages with natural language
  // Detects patterns like "recordá que...", "guarda que...", "anotá que..."
  api.on('before_prompt_build', async (event: any, ctx: any) => {
    const messages = event?.messages || ctx?.messages || [];
    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage?.role !== 'user' || !lastMessage.content) {
      return null;
    }
    
    const content = typeof lastMessage.content === 'string' 
      ? lastMessage.content 
      : lastMessage.content.map((p: any) => p.text || '').join(' ');
    
    // Detect memory capture patterns in Spanish
    const memoryPatterns = [
      { pattern: /\b(record[aá]|guard[aá]|anot[aá]|memoriz[aá])\s+(que|esto)\s+(.*)/i, type: 'AUTO_DETECT' },
      { pattern: /\bquiero\s+(que\s+)?record(és|es)\s+(que\s+)?(.*)/i, type: 'AUTO_DETECT' },
      { pattern: /\bes\s+importante\s+(que\s+)?(.*)/i, type: 'PREFERENCE' },
      { pattern: /\bprefer(o|ís|es)\s+(.*)/i, type: 'PREFERENCE' },
      { pattern: /\bme\s+gusta\s+(.*)/i, type: 'PREFERENCE' },
      { pattern: /\btrabaj(o|ás|o)\s+(en|con)\s+(.*)/i, type: 'USER_FACT' },
      { pattern: /\bsoy\s+(de|del|la)\s+(.*)/i, type: 'USER_FACT' },
      { pattern: /\btengo\s+(un|una|unos|unas)\s+(.*)/i, type: 'USER_FACT' },
      { pattern: /\bvivo\s+(en|cerca|lejos)\s+(.*)/i, type: 'USER_FACT' },
      { pattern: /\bdecid(o|ís|e)\s+(.*)/i, type: 'DECISION' },
      { pattern: /\bmi\s+(proyecto|app|sistema|startup)\s+(es|se llama|trata de)\s+(.*)/i, type: 'PROJECT' },
    ];
    
    for (const { pattern, type } of memoryPatterns) {
      const match = content.match(pattern);
      if (match) {
        // Extract the actual content to remember
        let memoryContent = content;
        if (match[3]) {
          memoryContent = match[3].trim();
        } else if (match[2]) {
          memoryContent = match[2].trim();
        } else if (match[1]) {
          memoryContent = match[0].trim();
        }
        
        // Auto-detect type based on content keywords if type is AUTO_DETECT
        let detectedType = type;
        if (type === 'AUTO_DETECT') {
          detectedType = detectMemoryType(memoryContent);
        }
        
        // Only capture if content is long enough
        if (memoryContent.length >= 15) {
          console.log(`[lobstermind] Auto-capture from user message: "${memoryContent.substring(0, 50)}..."`);
          console.log(`[lobstermind] Detected type: ${detectedType}`);
          
          try {
            await captureMemory(memoryContent, detectedType, 0.8, false);
          } catch (err: any) {
            console.error('[lobstermind] Auto-capture error:', err.message);
          }
        }
        
        break; // Only match one pattern
      }
    }
    
    return null;
  });
  
  // Auto-detect memory type based on content keywords
  function detectMemoryType(content: string): string {
    const lower = content.toLowerCase();
    
    // Preference indicators
    if (/\bprefer(o|ís|e)\b/.test(lower) || 
        /\bme\s+gusta\b/.test(lower) || 
        /\bmi\s+favorit(o|a)\b/.test(lower) ||
        /\bodio\b/.test(lower) ||
        /\bdetesto\b/.test(lower)) {
      return 'PREFERENCE';
    }
    
    // User fact indicators
    if (/\bsoy\b/.test(lower) ||
        /\btengo\b/.test(lower) ||
        /\btrabaj(o|ás|o)\b/.test(lower) ||
        /\bstudio\b/.test(lower) ||
        /\bvivo\b/.test(lower) ||
        /\btengo\s+\d+\s+a[ñn]os\b/.test(lower) ||
        /\bmi\s+(nombre|nombre\s+es)\b/.test(lower)) {
      return 'USER_FACT';
    }
    
    // Decision indicators
    if (/\bdecid(o|ís|e)\b/.test(lower) ||
        /\beleg(o|ís|e)\b/.test(lower) ||
        /\bopt(e|é|o)\b/.test(lower) ||
        /\bme\s+quedo\s+con\b/.test(lower)) {
      return 'DECISION';
    }
    
    // Project indicators
    if (/\bmi\s+proyecto\b/.test(lower) ||
        /\bmi\s+app\b/.test(lower) ||
        /\bmi\s+startup\b/.test(lower) ||
        /\bmi\s+empresa\b/.test(lower) ||
        /\bestoy\s+(creando|desarrollando|haciendo)\b/.test(lower)) {
      return 'PROJECT';
    }
    
    // Episode indicators
    if (/\bhoy\b/.test(lower) ||
        /\bayer\b/.test(lower) ||
        /\bla\s+semana\s+(pasada|que\s+viene)\b/.test(lower) ||
        /\b(el|este)\s+(año|mes)\b/.test(lower)) {
      return 'EPISODE';
    }
    
    // Default to USER_FACT
    return 'USER_FACT';
  }
  
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
            .option('--from <date>', 'Show memories from this date (YYYY-MM-DD)')
            .option('--to <date>', 'Show memories until this date (YYYY-MM-DD)')
            .action((options: any) => {
              const limit = parseInt(options.limit) || 20;
              let query = 'SELECT * FROM memories WHERE 1=1';
              let params: any[] = [];
              
              if (options.tag) {
                query += ' AND tags LIKE ?';
                params.push(`%${options.tag}%`);
              }
              
              if (options.from) {
                query += ' AND created_at >= ?';
                params.push(`${options.from}T00:00:00.000Z`);
              }
              
              if (options.to) {
                query += ' AND created_at <= ?';
                params.push(`${options.to}T23:59:59.999Z`);
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
            .description('Search memories by query (supports natural language)')
            .option('--limit <n>', 'Maximum results', '10')
            .option('--min-score <n>', 'Minimum similarity score', '0.3')
            .option('--fuzzy', 'Enable fuzzy matching for typos')
            .option('--nl', 'Enable natural language parsing (auto-detects dates, tags)')
            .action(async (query: string, options: any) => {
              const limit = parseInt(options.limit) || 10;
              const minScore = parseFloat(options.minScore) || 0.3;
              
              // Parse natural language query if --nl flag or auto-detect
              const nlParsed = options.nl || containsNaturalLanguage(query);
              
              if (nlParsed) {
                const parsed = parseNaturalLanguageQuery(query);
                console.log(`[lobstermind] NL Query detected:`);
                console.log(`  Search: "${parsed.searchQuery}"`);
                if (parsed.dateFrom) console.log(`  From: ${parsed.dateFrom}`);
                if (parsed.dateTo) console.log(`  To: ${parsed.dateTo}`);
                if (parsed.tags) console.log(`  Tags: ${parsed.tags}`);
                if (parsed.type) console.log(`  Type: ${parsed.type}`);
                
                // Execute search with parsed filters
                await executeFilteredSearch(parsed, limit, minScore, options.fuzzy);
              } else if (options.fuzzy) {
                // Fuzzy search: search for variations and substrings
                const variations = generateQueryVariations(query);
                let results: any[] = [];
                for (const variation of variations) {
                  const memories = await recallMemories(variation, limit, minScore * 0.9);
                  results = results.concat(memories);
                }
                // Deduplicate by ID
                const seen = new Set();
                results = results.filter(m => {
                  if (seen.has(m.id)) return false;
                  seen.add(m.id);
                  return true;
                });
                // Re-sort by score
                results.sort((a, b) => b.score - a.score);
                
                if (results.length === 0) {
                  console.log('No memories found');
                  return;
                }
                console.log(`Found ${results.length} memories:\n`);
                results.forEach((m, i) => {
                  console.log(`${i + 1}. [${m.type}] ${m.content}`);
                  console.log(`   Score: ${m.score.toFixed(2)} | ID: ${m.id}`);
                });
              } else {
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
              }
            });
          
          // Execute search with parsed natural language filters
          async function executeFilteredSearch(parsed: any, limit: number, minScore: number, fuzzy: boolean) {
            let query = 'SELECT * FROM memories WHERE 1=1';
            let params: any[] = [];
            
            // Date filters
            if (parsed.dateFrom) {
              query += ' AND created_at >= ?';
              params.push(parsed.dateFrom);
            }
            if (parsed.dateTo) {
              query += ' AND created_at <= ?';
              params.push(parsed.dateTo);
            }
            
            // Tag filter
            if (parsed.tags) {
              query += ' AND tags LIKE ?';
              params.push(`%${parsed.tags}%`);
            }
            
            // Type filter
            if (parsed.type) {
              query += ' AND type = ?';
              params.push(parsed.type);
            }
            
            query += ' ORDER BY created_at DESC LIMIT ?';
            params.push(limit * 2); // Get more for filtering
            
            const memories = db.prepare(query).all(...params) as MemoryRecord[];
            
            // Filter by search query if exists
            let results = memories;
            if (parsed.searchQuery) {
              if (fuzzy) {
                const variations = generateQueryVariations(parsed.searchQuery);
                results = memories.filter(m => {
                  const lowerContent = m.content.toLowerCase();
                  return variations.some(v => lowerContent.includes(v.toLowerCase()));
                });
              } else {
                results = memories.filter(m => 
                  m.content.toLowerCase().includes(parsed.searchQuery.toLowerCase())
                );
              }
            }
            
            results = results.slice(0, limit);
            
            if (results.length === 0) {
              console.log('No memories found');
              return;
            }
            console.log(`Found ${results.length} memories:\n`);
            results.forEach((m, i) => {
              console.log(`${i + 1}. [${m.type}] ${m.content}`);
              const date = new Date(m.created_at).toLocaleDateString();
              const tagsStr = m.tags ? ` | Tags: [${m.tags}]` : '';
              console.log(`   Created: ${date}${tagsStr} | ID: ${m.id}`);
            });
          }
          
          // Detect if query contains natural language patterns
          function containsNaturalLanguage(query: string): boolean {
            const nlPatterns = [
              /\b(ayer|today|yesterday|hoy)\b/i,
              /\b(semana|week)\b/i,
              /\b(mes|month)\b/i,
              /\b(año|year)\b/i,
              /\b(último|last|pasado|past)\b/i,
              /\b(próximo|next|siguiente)\b/i,
              /\b(desde|from|since)\b/i,
              /\b(hasta|until|to)\b/i,
              /\b(donde|where|qué|what|cuándo|when|cómo|how)\b/i,
              /\b(mi|my|el|la|los|las|the)\b/i,
            ];
            
            return nlPatterns.some(pattern => pattern.test(query));
          }
          
          // Parse natural language query into structured filters
          function parseNaturalLanguageQuery(query: string) {
            const result: any = {
              searchQuery: query,
              dateFrom: null,
              dateTo: null,
              tags: null,
              type: null
            };
            
            let processedQuery = query;
            
            // Date patterns
            const today = new Date();
            
            // "ayer" / "yesterday"
            if (/\b(ayer|yesterday)\b/i.test(processedQuery)) {
              const yesterday = new Date(today);
              yesterday.setDate(yesterday.getDate() - 1);
              result.dateFrom = yesterday.toISOString().split('T')[0] + 'T00:00:00.000Z';
              result.dateTo = yesterday.toISOString().split('T')[0] + 'T23:59:59.999Z';
              processedQuery = processedQuery.replace(/\b(ayer|yesterday)\b/gi, '');
            }
            
            // "hoy" / "today"
            if (/\b(hoy|today)\b/i.test(processedQuery)) {
              result.dateFrom = today.toISOString().split('T')[0] + 'T00:00:00.000Z';
              result.dateTo = today.toISOString().split('T')[0] + 'T23:59:59.999Z';
              processedQuery = processedQuery.replace(/\b(hoy|today)\b/gi, '');
            }
            
            // "esta semana" / "this week"
            if (/\b(esta\s*semana|this\s*week)\b/i.test(processedQuery)) {
              const startOfWeek = new Date(today);
              startOfWeek.setDate(today.getDate() - today.getDay());
              result.dateFrom = startOfWeek.toISOString().split('T')[0] + 'T00:00:00.000Z';
              processedQuery = processedQuery.replace(/\b(esta\s*semana|this\s*week)\b/gi, '');
            }
            
            // "la semana pasada" / "last week"
            if (/\b(la\s*semana\s*(pasada|antepasada)|last\s*week)\b/i.test(processedQuery)) {
              const lastWeek = new Date(today);
              lastWeek.setDate(today.getDate() - 7);
              result.dateFrom = lastWeek.toISOString().split('T')[0] + 'T00:00:00.000Z';
              processedQuery = processedQuery.replace(/\b(la\s*semana\s*(pasada|antepasada)|last\s*week)\b/gi, '');
            }
            
            // "este mes" / "this month"
            if (/\b(este\s*mes|this\s*month)\b/i.test(processedQuery)) {
              result.dateFrom = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0] + 'T00:00:00.000Z';
              processedQuery = processedQuery.replace(/\b(este\s*mes|this\s*month)\b/gi, '');
            }
            
            // "el mes pasado" / "last month"
            if (/\b(el\s*mes\s*(pasado|antepasado)|last\s*month)\b/i.test(processedQuery)) {
              const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
              result.dateFrom = lastMonth.toISOString().split('T')[0] + 'T00:00:00.000Z';
              processedQuery = processedQuery.replace(/\b(el\s*mes\s*(pasado|antepasado)|last\s*month)\b/gi, '');
            }
            
            // "últimos N días" / "last N days"
            const lastDaysMatch = processedQuery.match(/\b(últimos?|last)\s*(\d+)\s*(días?|days)\b/i);
            if (lastDaysMatch) {
              const days = parseInt(lastDaysMatch[2]);
              const fromDate = new Date(today);
              fromDate.setDate(fromDate.getDate() - days);
              result.dateFrom = fromDate.toISOString().split('T')[0] + 'T00:00:00.000Z';
              processedQuery = processedQuery.replace(lastDaysMatch[0], '');
            }
            
            // Type patterns: "preferencias", "facts", "decisiones"
            const typePatterns: {[key: string]: string} = {
              'preferencias': 'PREFERENCE',
              'preferences': 'PREFERENCE',
              'hechos': 'USER_FACT',
              'facts': 'USER_FACT',
              'decisiones': 'DECISION',
              'decisions': 'DECISION',
              'proyectos': 'PROJECT',
              'projects': 'PROJECT'
            };
            
            for (const [pattern, type] of Object.entries(typePatterns)) {
              if (new RegExp(`\\b${pattern}\\b`, 'i').test(processedQuery)) {
                result.type = type;
                processedQuery = processedQuery.replace(new RegExp(`\\b${pattern}\\b`, 'gi'), '');
                break;
              }
            }
            
            // Tag patterns: "tag:xyz" or "#xyz"
            const tagMatch = processedQuery.match(/(?:tag:|#)(\w+)/i);
            if (tagMatch) {
              result.tags = tagMatch[1];
              processedQuery = processedQuery.replace(tagMatch[0], '');
            }
            
            // Clean up search query
            result.searchQuery = processedQuery
              .replace(/\b(dime|decime|tell|show|what|qué|cuál|donde|dónde|mi|my|el|la|los|las|the|about|sobre)\b/gi, '')
              .trim();
            
            return result;
          }

          // Subcommand: export
          memories
            .command('export [file]')
            .description('Export memories to JSON file')
            .option('--backup', 'Create backup with timestamp in backup folder')
            .action((file: string, options: any) => {
              const { writeFileSync, mkdirSync } = require('fs');
              const { join } = require('path');
              
              let outputPath: string;
              if (options.backup) {
                // Auto backup to backup folder
                const backupDir = join(workspaceRoot, 'memory', 'backups');
                if (!existsSync(backupDir)) {
                  mkdirSync(backupDir, { recursive: true });
                }
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                outputPath = join(backupDir, `backup-${timestamp}.json`);
              } else {
                outputPath = file || `lobstermind-export-${new Date().toISOString().split('T')[0]}.json`;
                outputPath = join(process.cwd(), outputPath);
              }
              
              const memories = db.prepare('SELECT * FROM memories ORDER BY created_at DESC').all();
              writeFileSync(outputPath, JSON.stringify(memories, null, 2));
              console.log(`✓ Exported ${memories.length} memories to ${outputPath}`);
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
          
          // Subcommand: backup
          memories
            .command('backup [destination]')
            .description('Create automatic backup (local or cloud)')
            .option('--to <provider>', 'Backup destination: local, gdrive, dropbox, onedrive', 'local')
            .option('--remote-path <path>', 'Remote path for cloud backup', '/OpenClaw/LobsterMind')
            .action((destination: string, options: any) => {
              const { writeFileSync, mkdirSync, existsSync } = require('fs');
              const { join } = require('path');
              const { exec } = require('child_process');
              
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const backupName = `backup-${timestamp}.json`;
              const memories = db.prepare('SELECT * FROM memories ORDER BY created_at DESC').all();
              
              // Create local backup first
              const localBackupDir = join(workspaceRoot, 'memory', 'backups');
              if (!existsSync(localBackupDir)) {
                mkdirSync(localBackupDir, { recursive: true });
              }
              const localBackupPath = join(localBackupDir, backupName);
              writeFileSync(localBackupPath, JSON.stringify(memories, null, 2));
              console.log(`✓ Local backup created: ${localBackupPath}`);
              console.log(`  Total memories: ${memories.length}`);
              
              // Upload to cloud if requested
              const provider = destination === '--to' ? options.to : destination;
              
              if (provider && provider !== 'local') {
                const remotePath = options.remotePath || '/OpenClaw/LobsterMind';
                console.log(`\n📤 Uploading to ${provider}...`);
                console.log(`  Remote path: ${remotePath}`);
                
                // Ensure remote directory exists
                mkdirSync(join(workspaceRoot, 'memory', 'cloud-sync'), { recursive: true });
                const rcloneConfigPath = join(workspaceRoot, 'memory', 'cloud-sync', 'rclone.conf');
                
                // Check if rclone is installed
                exec('rclone --version', (err: any) => {
                  if (err) {
                    console.error('\n❌ rclone not found!');
                    console.error('\n📦 Install rclone:');
                    console.error('   Windows: choco install rclone');
                    console.error('   macOS:   brew install rclone');
                    console.error('   Linux:   sudo apt install rclone');
                    console.error('\n🔧 Then configure:');
                    console.error('   rclone config');
                    return;
                  }
                  
                  // Upload using rclone
                  const rcloneRemote = provider === 'gdrive' ? 'gdrive' : 
                                      provider === 'dropbox' ? 'dropbox' : 
                                      provider === 'onedrive' ? 'onedrive' : provider;
                  
                  const command = `rclone copy "${localBackupPath}" "${rcloneRemote}:${remotePath}" --progress`;
                  
                  exec(command, (err: any, stdout: string, stderr: string) => {
                    if (err) {
                      console.error(`\n❌ Upload failed: ${err.message}`);
                      console.error('Make sure you configured rclone: rclone config');
                      return;
                    }
                    
                    console.log(`\n✓ Backup uploaded to ${provider}:`);
                    console.log(`  ${remotePath}/${backupName}`);
                    console.log(`  ${memories.length} memories (${(memories.length * 0.5).toFixed(1)} KB)`);
                  });
                });
              } else {
                console.log(`\n💡 Tip: Use --to gdrive to backup to Google Drive`);
                console.log('   Install rclone: choco install rclone (Windows) or brew install rclone (macOS)');
              }
            });
          
          // Subcommand: cleanup (Memory Expiration manual trigger)
          memories
            .command('cleanup')
            .description('Archive or delete old memories')
            .option('--days <n>', 'Days threshold', '90')
            .option('--action <action>', 'archive or delete', 'archive')
            .option('--dry-run', 'Show what would be cleaned without doing it')
            .action((options: any) => {
              const days = parseInt(options.days) || 90;
              const action = options.action || 'archive';
              const cutoffDate = new Date();
              cutoffDate.setDate(cutoffDate.getDate() - days);
              const cutoffStr = cutoffDate.toISOString();
              
              const oldMemories = db.prepare('SELECT id, content, type, created_at FROM memories WHERE created_at < ?').all(cutoffStr) as any[];
              
              if (oldMemories.length === 0) {
                console.log(`✓ No memories older than ${days} days found`);
                return;
              }
              
              console.log(`📅 Found ${oldMemories.length} memories older than ${days} days:\n`);
              
              if (options.dryRun) {
                oldMemories.forEach((m, i) => {
                  console.log(`${i + 1}. [${m.type}] ${m.content.substring(0, 60)}...`);
                  console.log(`   Created: ${new Date(m.created_at).toLocaleDateString()}`);
                });
                console.log(`\n⚠️  Dry run - no changes made`);
                console.log(`Run without --dry-run to ${action} these memories`);
              } else {
                if (action === 'archive') {
                  const archiveStmt = db.prepare('INSERT OR REPLACE INTO archived_memories SELECT *, ? as archived_at FROM memories WHERE id = ?');
                  const deleteStmt = db.prepare('DELETE FROM memories WHERE id = ?');
                  
                  oldMemories.forEach(m => {
                    archiveStmt.run(new Date().toISOString(), m.id);
                    deleteStmt.run(m.id);
                  });
                  
                  console.log(`✓ Archived ${oldMemories.length} memories to archived_memories table`);
                } else {
                  const deleteStmt = db.prepare('DELETE FROM memories WHERE created_at < ?');
                  deleteStmt.run(cutoffStr);
                  console.log(`✓ Deleted ${oldMemories.length} memories permanently`);
                }
              }
            });
          
          // Subcommand: restore
          memories
            .command('restore <file>')
            .description('Restore memories from backup file')
            .option('--from <provider>', 'Restore from cloud: gdrive, dropbox, onedrive')
            .option('--merge', 'Merge with existing memories (default)')
            .option('--replace', 'Delete all existing and replace with backup')
            .action(async (file: string, options: any) => {
              const { readFileSync } = require('fs');
              const { join } = require('path');
              const { exec } = require('child_process');
              
              let fullPath: string;
              
              // Download from cloud if requested
              if (options.from && options.from !== 'local') {
                const provider = options.from;
                const rcloneRemote = provider === 'gdrive' ? 'gdrive' : 
                                    provider === 'dropbox' ? 'dropbox' : 
                                    provider === 'onedrive' ? 'onedrive' : provider;
                
                console.log(`📥 Downloading from ${provider}...`);
                
                const cloudSyncDir = join(workspaceRoot, 'memory', 'cloud-sync');
                if (!existsSync(cloudSyncDir)) {
                  mkdirSync(cloudSyncDir, { recursive: true });
                }
                
                fullPath = join(cloudSyncDir, file);
                
                // Download using rclone
                const remotePath = `/OpenClaw/LobsterMind/${file}`;
                const command = `rclone copy "${rcloneRemote}:${remotePath}" "${cloudSyncDir}" --progress`;
                
                await new Promise<void>((resolve, reject) => {
                  exec(command, (err: any) => {
                    if (err) {
                      console.error(`❌ Download failed: ${err.message}`);
                      console.error('Make sure the file exists in cloud and rclone is configured');
                      reject(err);
                    } else {
                      console.log(`✓ Downloaded: ${file}`);
                      resolve();
                    }
                  });
                });
              } else {
                fullPath = join(process.cwd(), file);
              }
              
              try {
                const data = JSON.parse(readFileSync(fullPath, 'utf-8'));
                const importData = Array.isArray(data) ? data : [data];
                
                if (options.replace) {
                  db.prepare('DELETE FROM memories').run();
                  console.log('✓ Cleared existing memories');
                }
                
                let imported = 0;
                let skipped = 0;
                
                for (const memory of importData) {
                  const exists = db.prepare('SELECT id FROM memories WHERE id = ?').get(memory.id);
                  if (exists && !options.replace) {
                    skipped++;
                    continue;
                  }
                  
                  db.prepare(`
                    INSERT OR REPLACE INTO memories (id, content, type, confidence, tags, embedding, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  `).run(
                    memory.id,
                    memory.content,
                    memory.type || 'RESTORED',
                    memory.confidence || 0.7,
                    memory.tags || null,
                    memory.embedding || '[]',
                    memory.created_at || new Date().toISOString(),
                    memory.updated_at || new Date().toISOString()
                  );
                  imported++;
                }
                
                console.log(`\n✓ Restore complete:`);
                console.log(`  Imported: ${imported}`);
                console.log(`  Skipped:  ${skipped}`);
              } catch (err: any) {
                console.error('✗ Error reading backup file:', err.message);
              }
            });
          
          // Subcommand: list-backups
          memories
            .command('list-backups')
            .description('List available backups')
            .option('--from <provider>', 'List from cloud: gdrive, dropbox, onedrive')
            .option('--local', 'List local backups (default)')
            .action((options: any) => {
              const { readdirSync } = require('fs');
              const { join } = require('path');
              const { exec } = require('child_process');
              
              if (options.from && options.from !== 'local') {
                // List from cloud
                const provider = options.from;
                const rcloneRemote = provider === 'gdrive' ? 'gdrive' : 
                                    provider === 'dropbox' ? 'dropbox' : 
                                    provider === 'onedrive' ? 'onedrive' : provider;
                
                console.log(`📋 Listing backups from ${provider}...\n`);
                
                const command = `rclone ls "${rcloneRemote}:/OpenClaw/LobsterMind" --json`;
                
                exec(command, (err: any, stdout: string) => {
                  if (err) {
                    console.error(`❌ Failed to list: ${err.message}`);
                    console.error('Make sure rclone is configured');
                    return;
                  }
                  
                  try {
                    const files = JSON.parse(stdout);
                    const backupFiles = files.filter((f: any) => f.Name.endsWith('.json'));
                    
                    if (backupFiles.length === 0) {
                      console.log('No backups found in cloud');
                      return;
                    }
                    
                    console.log(`Found ${backupFiles.length} backups:\n`);
                    backupFiles.forEach((f: any, i: number) => {
                      const size = (f.Size / 1024).toFixed(1);
                      const date = new Date(f.ModTime).toLocaleString();
                      console.log(`${i + 1}. ${f.Name}`);
                      console.log(`   Size: ${size} KB | Date: ${date}`);
                    });
                  } catch (err: any) {
                    console.error('Error parsing rclone output:', err.message);
                  }
                });
              } else {
                // List local backups
                const backupDir = join(workspaceRoot, 'memory', 'backups');
                
                if (!existsSync(backupDir)) {
                  console.log('No local backups found');
                  return;
                }
                
                const files = readdirSync(backupDir)
                  .filter(f => f.endsWith('.json'))
                  .sort()
                  .reverse();
                
                console.log(`📋 Local Backups\n`);
                
                if (files.length === 0) {
                  console.log('No backups found');
                  return;
                }
                
                files.forEach((f, i) => {
                  const stats = require('fs').statSync(join(backupDir, f));
                  const size = (stats.size / 1024).toFixed(1);
                  const date = new Date(stats.mtime).toLocaleString();
                  console.log(`${i + 1}. ${f}`);
                  console.log(`   Size: ${size} KB | Date: ${date}`);
                });
              }
            });
          
          // Subcommand: setup-cloud
          memories
            .command('setup-cloud')
            .description('Setup cloud backup (Google Drive, Dropbox, OneDrive)')
            .action(() => {
              const { exec } = require('child_process');
              
              console.log('🔧 Cloud Backup Setup\n');
              console.log('This will help you configure rclone for cloud backup.\n');
              
              // Check if rclone is installed
              exec('rclone --version', (err: any) => {
                if (err) {
                  console.error('❌ rclone not found!\n');
                  console.error('📦 Install rclone:');
                  console.error('   Windows: choco install rclone');
                  console.error('   macOS:   brew install rclone');
                  console.error('   Linux:   sudo apt install rclone\n');
                  console.error('Then run: openclaw memories setup-cloud');
                  return;
                }
                
                console.log('✓ rclone is installed\n');
                console.log('📝 Run rclone config to setup cloud providers:\n');
                console.log('   rclone config\n');
                console.log('Follow the prompts:');
                console.log('   1. n) New remote');
                console.log('   2. Name: gdrive (or dropbox, onedrive)');
                console.log('   3. Select provider from list');
                console.log('   4. Follow OAuth instructions\n');
                console.log('After setup, use:');
                console.log('   openclaw memories backup --to gdrive');
                console.log('   openclaw memories list-backups --from gdrive');
                console.log('   openclaw memories restore backup.json --from gdrive\n');
              });
            });

          // Subcommand: stats
          memories
            .command('stats')
            .description('Show memory statistics')
            .action(() => {
              const total = db.prepare('SELECT COUNT(*) as count FROM memories').get() as any;
              const byType = db.prepare('SELECT type, COUNT(*) as count FROM memories GROUP BY type').all();
              const byTags = db.prepare("SELECT tags FROM memories WHERE tags IS NOT NULL AND tags != ''").all();
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
              const withTags = db.prepare("SELECT tags FROM memories WHERE tags IS NOT NULL AND tags != ''").all();
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
      console.log('[lobstermind] Memories CLI registered with subcommands: list, add, delete, edit, search, export, import, stats, tags, backup, restore, cleanup, list-backups, setup-cloud');
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
