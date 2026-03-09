/**
 * LobsterMind Memory - OpenClaw Plugin
 */
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';

export default {
  id: 'lobstermind-memory',
  name: 'LobsterMind Memory',
  description: 'Long-term memory',
  kind: 'memory',
  configSchema: { type: 'object', properties: { enabled: { type: 'boolean', default: true } } },
  register(api: any) {
    console.log('[lobstermind] Loading...');
    const ws = api.runtime?.workspace || 'C:\\Users\\Paolozky\\.openclaw\\workspace';
    const dbDir = join(ws, 'memory');
    const backupDir = join(ws, 'memory', 'backups');
    const obsidianDir = join(ws, 'obsidian-vault', 'LobsterMind');
    [dbDir, backupDir, obsidianDir].forEach(d => { if (!existsSync(d)) mkdirSync(d, { recursive: true }); });
    const db = new Database(join(dbDir, 'lobstermind-memory.db'));
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
      CREATE TABLE IF NOT EXISTS memory_relations (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        weight REAL NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id, relation_type),
        FOREIGN KEY (from_id) REFERENCES memories(id),
        FOREIGN KEY (to_id) REFERENCES memories(id)
      );
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories(tags);
      CREATE INDEX IF NOT EXISTS idx_relations_from ON memory_relations(from_id);
      CREATE INDEX IF NOT EXISTS idx_relations_to ON memory_relations(to_id);
      CREATE INDEX IF NOT EXISTS idx_relations_type ON memory_relations(relation_type);
    `);
    console.log('[lobstermind] Database ready');
    
    const embed = (t: string) => { const h = createHash('sha256').update(t).digest('hex'); const v: number[] = []; for (let i = 0; i < 384; i += 4) v.push((parseInt(h.slice(i%64,(i%64)+4),16)/0xFFFFFFFF)*2-1); return v; };
    
    const save = (c: string, t = 'MANUAL', conf = 0.9, tags?: string) => {
      const id = createHash('sha256').update(c).digest('hex').slice(0,16);
      const now = new Date().toISOString();
      db.prepare('INSERT OR REPLACE INTO memories (id,content,type,confidence,tags,embedding,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,c,t,conf,tags||null,JSON.stringify(embed(c)),now,now);
      
      // Obsidian sync
      try {
        const date = now.split('T')[0];
        const obs = join(obsidianDir, 'Memories.md');
        const entry = '- [' + t + '] ' + c + ' (confidence: ' + conf.toFixed(2) + ')\n';
        if (!existsSync(obs)) {
          writeFileSync(obs, `# Memories\n\nAuto-created by LobsterMind Memory plugin\n\n## [[${date}]]\n\n${entry}\n`, 'utf-8');
        } else {
          const e = readFileSync(obs, 'utf-8'); 
          if (!e.includes(entry.trim())) appendFileSync(obs, entry, 'utf-8');  
        }
        console.log('[lobstermind] ✅ Synced to Obsidian');
      } catch (err: any) { console.error('[lobstermind] ❌ Obsidian sync error:', err.message); }
      
      // Native MEMORY.md sync
      try {
        const nativePath = join(ws, 'MEMORY.md');
        const nativeEntry = '- [' + t + '] ' + c + ' (confidence: ' + conf.toFixed(2) + ')\n';
        let content = '';
        if (existsSync(nativePath)) {
          content = readFileSync(nativePath, 'utf-8');
        } else {
          writeFileSync(nativePath, '# Memories\n\nAuto-created by LobsterMind Memory plugin\n\n', 'utf-8');
          content = '';
        }
        if (!content.includes(nativeEntry.trim())) {
          appendFileSync(nativePath, nativeEntry, 'utf-8');
          console.log('[lobstermind] ✅ Synced to MEMORY.md');
        }
      } catch (err: any) { console.error('[lobstermind] ❌ MEMORY.md sync error:', err.message); }
      
      console.log('[lobstermind] Saved [' + t + ']:', c.slice(0, 40));
      return id;
    };
    
    // Auto-detect memories from natural language in user messages (multi-language)
    if (api.on) {
      api.on('after_response', (event: any, ctx: any) => {
        const messages = ctx?.messages || event?.messages || [];
        
        // Process recent user messages for memory capture
        const userMessages = messages.filter((m: any) => m?.role === 'user').slice(-5);
        
        for (const msg of userMessages) {
          if (msg.content) {
            const content = typeof msg.content === 'string' 
              ? msg.content 
              : JSON.stringify(msg.content || '');
            
            // Multi-language classifier (Spanish + English + Portuguese)
            const classified = classifyMemoryContent(content);
            
            if (classified.shouldSave && classified.content.length >= 15) {
              console.log(`[lobstermind] Auto-detected [${classified.type}] (confidence: ${classified.confidence.toFixed(2)}): ${classified.content.substring(0, 80)}...`);
              save(classified.content, classified.type, classified.confidence);
            }
          }
        }
      });
    }
    
    // Memory content classifier - handles multiple languages by semantic meaning
    function classifyMemoryContent(rawContent: string): { content: string, type: string, confidence: number, shouldSave: boolean } {
      // Remove special tags and normalize
      const cleanContent = rawContent.replace(/<[\/]?memory_note[^>]*>/g, '').trim();
      
      // Multi-lang patterns for detection without relying on specific grammar patterns
      const patterns = [
        // PREFERENCES (likes/dislikes in multiple languages)
        { regex: /(like|love|adore|prefer|enjoy|gusta|amo|adoro|prefiero|mencenta|odio|detesto|nogusta)/i, type: 'PREFERENCE', confidence: 0.95 },
        
        // FACTS (identity in multiple languages)
        { regex: /\b(I\s+am|I'm|soy|yo\s+soy|trabajo|work|desarrollo|develop|vivo\s+en|live\s+in|estudio|study)/i, type: 'USER_FACT', confidence: 0.85 },
        
        // DECISIONS (choices in multiple languages)
        { regex: /\b(decid|eleg|opt|chos|select|pick|take)\s+(by|for|with|on)\b/i, type: 'DECISION', confidence: 0.90 },
        
        // TECH PREDICATES (technical preferences commonly expressed)
        { regex: /\b(used|working|developing|building|coded|programming|coded\s+with|writing\s+in|chose|selected|picked)\s+([^.,!?]+)/i, type: 'USER_FACT', confidence: 0.80 },
      ];
      
      // Scan for pattern matches
      for (const { regex, type, confidence } of patterns) {
        if (regex.test(cleanContent.replace(/\b(the|a|an|un|una|el|la|los|las|en|con|de|del|de\s+la|to|with|my|his|her)\b/g, ' ').toLowerCase())) {
          return {
            content: cleanContent,
            type: type,
            confidence: confidence,
            shouldSave: true
          };
        }
      }
      
      // General rule: statements longer than 25 chars without questions are user facts
      if (cleanContent.length >= 25 && !cleanContent.includes('?')) {
        return {
          content: cleanContent,
          type: 'USER_FACT',
          confidence: 0.70,  // Lower confidence for generic detection
          shouldSave: true
        };
      }
      
      // Don't save if not meaningful
      return {
        content: cleanContent,
        type: 'IGNORE',
        confidence: 0.0,
        shouldSave: false
      };
    } 
    
    const search = (q: string, k = 8) => { const qe = embed(q); return (db.prepare('SELECT * FROM memories').all() as any[]).map(m => ({...m, score: ((a:number[],b:number[])=>{const d=a.reduce((s,ai,i)=>s+ai*b[i],0),na=Math.sqrt(a.reduce((s,ai)=>s+ai*ai,0)),nb=Math.sqrt(b.reduce((s,bi)=>s+bi*bi,0));return na&&nb?d/(na*nb):0;})(qe,JSON.parse(m.embedding||'[]'))})).filter(m=>m.score>=0.3).sort((a,b)=>b.score-a.score).slice(0,k); };
    
    if (api.registerCli) {
      api.registerCli(({program}:any)=>{
        const c = program.command('memories').description('LobsterMind CLI');
        c.command('list').option('--limit <n>','Max','20').action((o:any)=>{const r=db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?').all(parseInt(o.limit)||20);console.log('Memories:',r.length);r.forEach((m:any,i:number)=>console.log((i+1)+'. ['+m.type+'] '+m.content));});
        c.command('add <content>').action((s:string)=>{try{console.log('ID:',save(s));}catch(e:any){console.error('Error:',e.message);}});
        c.command('search <query>').action(async(q:string)=>{const r=search(q);console.log('Found:',r.length);r.forEach((m:any,i:number)=>console.log((i+1)+'. '+m.content+' ('+m.score.toFixed(2)+')'));});
        c.command('stats').action(()=>{const t=db.prepare('SELECT COUNT(*) as c FROM memories').get()as any;console.log('Total:',t.c);});
        c.command('backup').action(()=>{const d=join(ws,'memory','backups');if(!existsSync(d))mkdirSync(d,{recursive:true});const p=join(d,'backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');writeFileSync(p,JSON.stringify(db.prepare('SELECT * FROM memories').all(),null,2));console.log('Backup:',p);});
      },{commands:['memories']});
      console.log('[lobstermind] CLI ready');
    }
    return {name:'lobstermind-memory',version:'1.0.0'};
  }
};

