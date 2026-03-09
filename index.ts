/**
 * LobsterMind Memory - OpenClaw Plugin
 * SQLite storage, semantic search, Obsidian sync
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';

export default {
  id: 'lobstermind-memory',
  name: 'LobsterMind Memory',
  description: 'Long-term memory with SQLite + embeddings',
  kind: 'memory',
  configSchema: { type: 'object', additionalProperties: false, properties: { enabled: { type: 'boolean', default: true } } },
  register(api: any) {
    console.log('[lobstermind] Loading...');
    
    const ws = api.runtime?.workspace || process.env.OPENCLAW_WORKSPACE || 'C:\Users\Paolozky\.openclaw\workspace';
    const dbDir = join(ws, 'memory');
    const dbPath = join(dbDir, 'lobstermind-memory.db');
    
    [dbDir, join(ws, 'memory', 'backups'), join(ws, 'obsidian-vault', 'LobsterMind')].forEach(d => {
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
    });
    
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY, content TEXT NOT NULL, type TEXT NOT NULL,
      confidence REAL NOT NULL, tags TEXT, embedding TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_type ON memories(type);`);
    
    console.log('[lobstermind] Database ready');
    
    const embed = (t: string) => {
      const h = createHash('sha256').update(t).digest('hex');
      const v: number[] = [];
      for (let i = 0; i < 384; i += 4) v.push((parseInt(h.slice(i % 64, (i % 64) + 4), 16) / 0xFFFFFFFF) * 2 - 1);
      return v;
    };
    
    const similarity = (a: number[], b: number[]) => {
      const dot = a.reduce((s, ai, i) => s + ai * b[i], 0);
      const na = Math.sqrt(a.reduce((s, ai) => s + ai * ai, 0));
      const nb = Math.sqrt(b.reduce((s, bi) => s + bi * bi, 0));
      return na && nb ? dot / (na * nb) : 0;
    };
    
    const save = (content: string, type = 'MANUAL', conf = 0.9, tags?: string) => {
      const id = createHash('sha256').update(content).digest('hex').slice(0, 16);
      const now = new Date().toISOString();
      db.prepare('INSERT OR REPLACE INTO memories (id, content, type, confidence, tags, embedding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, content, type, conf, tags || null, JSON.stringify(embed(content)), now, now);
      
      // Obsidian sync
      try {
        const obs = join(ws, 'obsidian-vault', 'LobsterMind', 'Memories.md');
        const date = now.split('T')[0];
        const entry = `- [${type}] ${content} (${conf.toFixed(2)})\n`;
        if (!existsSync(obs)) writeFileSync(obs, `# Memories\n\n## [[${date}]]\n\n${entry}\n`);
        else { const e = readFileSync(obs, 'utf-8'); if (!e.includes(entry.trim())) appendFileSync(obs, entry); }
      } catch (e: any) { console.error('[lobstermind] Obsidian error:', e.message); }
      
      // MEMORY.md sync
      try {
        const md = join(ws, 'MEMORY.md');
        const date = now.split('T')[0];
        const tagsStr = tags ? ` #[${tags.split(',').join('][')}]` : '';
        const entry = `- [${type}] ${content}${tagsStr} (${conf.toFixed(2)})\n`;
        if (!existsSync(md)) writeFileSync(md, `# Memories\n\n## ${date}\n\n${entry}\n`);
        else { const e = readFileSync(md, 'utf-8'); if (!e.includes(`## ${date}`)) appendFileSync(md, `\n## ${date}\n${entry}`); else if (!e.includes(entry.trim())) appendFileSync(md, entry); }
      } catch (e: any) { console.error('[lobstermind] MEMORY.md error:', e.message); }
      
      console.log(`[lobstermind] Saved [${type}]: ${content.slice(0, 40)}...`);
      return id;
    };
    
    const search = (q: string, k = 8, min = 0.3) => {
      const qe = embed(q);
      return (db.prepare('SELECT * FROM memories').all() as any[])
        .map(m => ({ ...m, score: similarity(qe, JSON.parse(m.embedding || '[]')) }))
        .filter(m => m.score >= min).sort((a, b) => b.score - a.score).slice(0, k);
    };
    
    // CLI
    if (api.registerCli) {
      console.log('[lobstermind] Registering CLI...');
      api.registerCli(({ program }: any) => {
        const cmd = program.command('memories').description('LobsterMind Memory CLI');
        
        cmd.command('list').option('--limit <n>', 'Max', '20').option('--tag <tag>', 'Filter')
          .action((o: any) => {
            let q = 'SELECT * FROM memories WHERE 1=1', p: any[] = [];
            if (o.tag) { q += ' AND tags LIKE ?'; p.push(`%${o.tag}%`); }
            q += ' ORDER BY created_at DESC LIMIT ?'; p.push(parseInt(o.limit) || 20);
            const r = db.prepare(q).all(...p) as any[];
            if (!r.length) { console.log('No memories'); return; }
            console.log(`Memories (${r.length}):\n`);
            r.forEach((m, i) => console.log(`${i + 1}. [${m.type}] ${m.content} | ID: ${m.id}`));
          });
        
        cmd.command('add <content>').option('--tags <tags>', 'Tags')
          .action((c: string, o: any) => {
            try { const id = save(c, 'MANUAL', 0.9, o.tags); console.log(`✓ Saved: ${id}`); }
            catch (e: any) { console.error('✗ Error:', e.message); }
          });
        
        cmd.command('search <query>').option('--limit <n>', 'Max', '10')
          .action(async (q: string, o: any) => {
            const r = search(q, parseInt(o.limit) || 10, 0.3);
            if (!r.length) { console.log('No matches'); return; }
            console.log(`Found ${r.length}:\n`);
            r.forEach((m, i) => console.log(`${i + 1}. [${m.type}] ${m.content} (score: ${m.score.toFixed(2)})`));
          });
        
        cmd.command('stats').action(() => {
          const t = db.prepare('SELECT COUNT(*) as c FROM memories').get() as any;
          const by = db.prepare('SELECT type, COUNT(*) as c FROM memories GROUP BY type').all() as any[];
          console.log(`📊 Total: ${t.c}\n`); by.forEach(r => console.log(`  ${r.type}: ${r.c}`));
        });
        
        cmd.command('export [file]').action((f?: string) => {
          const path = f || `backup-${new Date().toISOString().split('T')[0]}.json`;
          const m = db.prepare('SELECT * FROM memories ORDER BY created_at DESC').all();
          writeFileSync(join(process.cwd(), path), JSON.stringify(m, null, 2));
          console.log(`✓ Exported ${m.length} to ${path}`);
        });
        
        cmd.command('import <file>').option('--skip-dupes', 'Skip dups')
          .action((f: string, o: any) => {
            const d = JSON.parse(readFileSync(f, 'utf-8'));
            let imp = 0, skp = 0;
            (Array.isArray(d) ? d : [d]).forEach((m: any) => {
              if (o.skipDupes && db.prepare('SELECT 1 FROM memories WHERE id = ?').get(m.id)) { skp++; return; }
              db.prepare('INSERT OR REPLACE INTO memories (id, content, type, confidence, tags, embedding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .run(m.id, m.content, m.type || 'IMPORTED', m.confidence || 0.7, m.tags || null, m.embedding || '[]', m.created_at, m.updated_at);
              imp++;
            });
            console.log(`✓ ${imp} imported, ${skp} skipped`);
          });
        
        cmd.command('backup').action(() => {
          const dir = join(ws, 'memory', 'backups'); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          const p = join(dir, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
          const m = db.prepare('SELECT * FROM memories ORDER BY created_at DESC').all();
          writeFileSync(p, JSON.stringify(m, null, 2));
          console.log(`✓ Backup: ${p} (${m.length} memories)`);
        });
        
        cmd.command('restore <file>').action((f: string) => {
          const d = JSON.parse(readFileSync(f, 'utf-8'));
          let c = 0;
          (Array.isArray(d) ? d : [d]).forEach((m: any) => {
            db.prepare('INSERT OR REPLACE INTO memories (id, content, type, confidence, tags, embed
