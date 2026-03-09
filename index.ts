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
    const ws = api.runtime?.workspace || 'C:\Users\Paolozky\.openclaw\workspace';
    const dbDir = join(ws, 'memory'); if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true }); const db = new Database(join(dbDir, 'lobstermind-memory.db'));
    db.exec('CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, content TEXT, type TEXT, confidence REAL, tags TEXT, embedding TEXT, created_at TEXT, updated_at TEXT)');
    console.log('[lobstermind] Ready');
    
    const embed = (t: string) => { const h = createHash('sha256').update(t).digest('hex'); const v: number[] = []; for (let i = 0; i < 384; i += 4) v.push((parseInt(h.slice(i%64,(i%64)+4),16)/0xFFFFFFFF)*2-1); return v; };
    const save = (c: string, t = 'MANUAL', conf = 0.9, tags?: string) => { const id = createHash('sha256').update(c).digest('hex').slice(0,16); const now = new Date().toISOString(); db.prepare('INSERT OR REPLACE INTO memories (id,content,type,confidence,tags,embedding,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,c,t,conf,tags||null,JSON.stringify(embed(c)),now,now); console.log('[lobstermind] Saved:', c.slice(0,40)); return id; };
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
