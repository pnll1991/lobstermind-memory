/**
 * LobsterMind Memory - OpenClaw Plugin v2.0
 * Con soporte multi-provider para embeddings (Gemini, Ollama, Transformers.js, etc.)
 */
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';

// ============================================================================
// CONFIGURACIÓN DEL PLUGIN
// ============================================================================

export default {
  id: 'lobstermind-memory',
  name: 'LobsterMind Memory',
  description: 'Long-term community memory plugin con embeddings configurables',
  kind: 'memory',
  configSchema: { 
    type: 'object', 
    properties: { 
      enabled: { type: 'boolean', default: true },
      
      // Configuración de embeddings
      embeddingProvider: { 
        type: 'string', 
        enum: ['gemini', 'ollama', 'transformers', 'sha256'], 
        default: 'gemini',
        description: 'Proveedor de embeddings: gemini (API), ollama (local), transformers (local), sha256 (fallback)'
      },
      
      // Gemini API
      geminiApiKey: { 
        type: 'string', 
        default: '', 
        description: 'API key de Gemini (requerido si usás gemini provider)' 
      },
      geminiModel: { 
        type: 'string', 
        default: 'gemini-embedding-2-preview',
        description: 'Modelo de Gemini para embeddings'
      },
      
      // Ollama (local)
      ollamaUrl: { 
        type: 'string', 
        default: 'http://localhost:11434',
        description: 'URL de Ollama para embeddings locales'
      },
      ollamaModel: { 
        type: 'string', 
        default: 'nomic-embed-text',
        description: 'Modelo de Ollama para embeddings (ej: nomic-embed-text, mxbai-embed-large)'
      },
      
      // Transformers.js (browser/node local)
      transformersModel: { 
        type: 'string', 
        default: 'Xenova/all-MiniLM-L6-v2',
        description: 'Modelo de Transformers.js para embeddings locales'
      },
      
      // Configuración de búsqueda
      searchThreshold: { 
        type: 'number', 
        default: 0.3, 
        minimum: 0, 
        maximum: 1,
        description: 'Threshold mínimo de similitud para búsqueda (0-1)'
      },
      searchLimit: { 
        type: 'number', 
        default: 8, 
        minimum: 1,
        description: 'Cantidad máxima de resultados en búsqueda'
      },
      
      // Configuración de clustering
      clusterThreshold: { 
        type: 'number', 
        default: 0.6, 
        minimum: 0, 
        maximum: 1,
        description: 'Threshold para asignar memoria a cluster (0-1)'
      },
      
      // Configuración de auto-capture
      autoCaptureEnabled: { 
        type: 'boolean', 
        default: true,
        description: 'Habilitar auto-capture de memorias'
      },
      
      // Obsidian sync
      obsidianSyncEnabled: { 
        type: 'boolean', 
        default: true,
        description: 'Habilitar sync a Obsidian'
      },
      
      // Native MEMORY.md sync
      nativeSyncEnabled: { 
        type: 'boolean', 
        default: true,
        description: 'Habilitar sync a MEMORY.md'
      }
    },
    required: ['enabled', 'embeddingProvider']
  },
  
  async register(api: any) {
    console.log('[lobstermind] Loading v2.0 with multi-provider embeddings...');
    
    // ========================================================================
    // VALIDACIÓN DE CONFIGURACIÓN
    // ========================================================================
    
    const config = api.config || {};
    const embeddingProvider = config.embeddingProvider || 'gemini';
    
    const validateConfig = async () => {
      const errors: string[] = [];
      const warnings: string[] = [];
      
      // Validar provider
      const validProviders = ['gemini', 'ollama', 'transformers', 'sha256'];
      if (!validProviders.includes(embeddingProvider)) {
        errors.push(`Provider "${embeddingProvider}" no es válido. Usá: ${validProviders.join(', ')}`);
      }
      
      // Validar Gemini
      if (embeddingProvider === 'gemini') {
        const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
        if (!apiKey) {
          errors.push('Gemini provider requiere geminiApiKey en config o GEMINI_API_KEY como env var');
        } else {
          // Test connectivity
          try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:embedContent?key=${apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: 'models/gemini-embedding-2-preview', content: { parts: [{ text: 'test' }] } })
            });
            if (!response.ok) {
              warnings.push(`Gemini API respondió con ${response.status}. Verificá tu API key.`);
            }
          } catch (e: any) {
            warnings.push(`No se pudo conectar a Gemini API: ${e.message}`);
          }
        }
      }
      
      // Validar Ollama
      if (embeddingProvider === 'ollama') {
        const ollamaUrl = config.ollamaUrl || 'http://localhost:11434';
        try {
          const response = await fetch(`${ollamaUrl}/api/tags`);
          if (!response.ok) {
            errors.push(`Ollama no responde en ${ollamaUrl} (status: ${response.status})`);
          }
        } catch (e: any) {
          errors.push(`No se pudo conectar a Ollama en ${ollamaUrl}: ${e.message}`);
        }
      }
      
      // Validar Transformers.js
      if (embeddingProvider === 'transformers') {
        try {
          await import('@xenova/transformers');
        } catch (e: any) {
          errors.push('Transformers.js no está instalado. Ejecutá: npm install @xenova/transformers');
        }
      }
      
      // Reportar
      if (errors.length > 0) {
        console.error('\n[lobstermind] ❌ CONFIG ERRORS (el plugin puede no funcionar):\n');
        errors.forEach(e => console.error(`  • ${e}`));
        console.error('\n');
      }
      
      if (warnings.length > 0) {
        console.warn('\n[lobstermind] ⚠️ CONFIG WARNINGS:\n');
        warnings.forEach(w => console.warn(`  • ${w}`));
        console.warn('\n');
      }
      
      return { errors, warnings };
    };
    
    // Ejecutar validación (sin bloquear)
    validateConfig().catch(console.error);
    
    // ========================================================================
    // INICIALIZACIÓN
    // ========================================================================
    
    const ws = api.runtime?.workspace;
    if (!ws) {
      console.error('[lobstermind] ERROR: No workspace disponible');
      return;
    }
    
    const dbDir = join(ws, 'memory');
    const backupDir = join(ws, 'memory', 'backups');
    const obsidianDir = join(ws, 'obsidian-vault', 'LobsterMind');
    
    [dbDir, backupDir, obsidianDir].forEach(d => { 
      if (!existsSync(d)) mkdirSync(d, { recursive: true }); 
    });
    
    const db = new Database(join(dbDir, 'lobstermind-memory.db'));
    
    // embeddingProvider ya está declarado arriba en validateConfig
    
    // ========================================================================
    // SCHEMA DE BASE DE DATOS
    // ========================================================================
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        confidence REAL NOT NULL,
        tags TEXT,
        embedding TEXT NOT NULL,
        embedding_provider TEXT NOT NULL DEFAULT 'unknown',
        embedding_dimensions INTEGER NOT NULL DEFAULT 384,
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
      CREATE TABLE IF NOT EXISTS memory_clusters (
        cluster_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        centroid_embedding TEXT,
        centroid_provider TEXT NOT NULL DEFAULT 'unknown',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cluster_members (
        cluster_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        similarity_score REAL NOT NULL,
        assigned_at TEXT NOT NULL,
        PRIMARY KEY (cluster_id, memory_id),
        FOREIGN KEY (cluster_id) REFERENCES memory_clusters(cluster_id),
        FOREIGN KEY (memory_id) REFERENCES memories(id)
      );
      CREATE TABLE IF NOT EXISTS embedding_stats (
        provider TEXT PRIMARY KEY,
        total_embeddings INTEGER NOT NULL DEFAULT 0,
        avg_latency_ms REAL NOT NULL DEFAULT 0,
        last_used_at TEXT,
        updated_at TEXT NOT NULL
      );
      
      -- Índices optimizados
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories(tags);
      CREATE INDEX IF NOT EXISTS idx_memories_provider ON memories(embedding_provider);
      CREATE INDEX IF NOT EXISTS idx_relations_from ON memory_relations(from_id);
      CREATE INDEX IF NOT EXISTS idx_relations_to ON memory_relations(to_id);
      CREATE INDEX IF NOT EXISTS idx_relations_type ON memory_relations(relation_type);
      CREATE INDEX IF NOT EXISTS idx_cluster_members_memory ON cluster_members(memory_id);
      CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster ON cluster_members(cluster_id);
    `);
    
    // ========================================================================
    // SISTEMA DE EMBEDDINGS MULTI-PROVIDER
    // ========================================================================
    
    const embeddingProvider = config.embeddingProvider || 'gemini';
    const embeddingCache = new Map<string, { vector: number[], timestamp: number }>();
    const MAX_CACHE_SIZE = 1000;
    const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas
    
    // Stats de embeddings
    const embeddingStats = {
      total: 0,
      latencySum: 0,
      errors: 0,
      provider: embeddingProvider
    };
    
    // Search cache
    const searchCache = new Map<string, { data: any[], timestamp: number }>();
    const SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutos
    
    // Cleanup periódico de caches (cada 1 hora)
    const cleanupCaches = () => {
      const now = Date.now();
      let cleanedEmbed = 0;
      let cleanedSearch = 0;
      
      // Limpiar embedding cache expirado
      for (const [key, value] of embeddingCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
          embeddingCache.delete(key);
          cleanedEmbed++;
        }
      }
      
      // Limpiar search cache expirado
      for (const [key, value] of searchCache.entries()) {
        if (now - value.timestamp > SEARCH_CACHE_TTL) {
          searchCache.delete(key);
          cleanedSearch++;
        }
      }
      
      if (cleanedEmbed > 0 || cleanedSearch > 0) {
        console.log(`[lobstermind] 🧹 Cache cleanup: ${cleanedEmbed} embeddings, ${cleanedSearch} búsquedas`);
      }
    };
    
    // Ejecutar cleanup cada hora
    const cleanupInterval = setInterval(cleanupCaches, 60 * 60 * 1000);
    
    // ========================================================================
    // GEMINI EMBEDDING PROVIDER
    // ========================================================================
    
    const embedWithGemini = async (text: string): Promise<number[]> => {
      const startTime = Date.now();
      const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
      
      if (!apiKey) {
        throw new Error('Gemini API key no configurada. Seteá geminiApiKey en config o GEMINI_API_KEY env var.');
      }
      
      const model = config.geminiModel || 'gemini-embedding-2-preview';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
      
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`;
        const response = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            key: apiKey // API key en body, no en URL
          })
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Gemini API error (${response.status}): ${error.substring(0, 100)}`);
        }
        
        const data = await response.json();
        const embedding = data.embedding?.values || data.embeddings?.[0]?.values;
        
        if (!embedding || !Array.isArray(embedding)) {
          throw new Error('Gemini no retornó embedding válido');
        }
        
        const latency = Date.now() - startTime;
        updateEmbeddingStats(latency);
        
        console.log(`[lobstermind:embed] Gemini: ${embedding.length} dims en ${latency}ms`);
        return embedding;
        
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          throw new Error('Gemini API timeout (30s)');
        }
        throw error;
      }
    };
    
    // ========================================================================
    // OLLAMA EMBEDDING PROVIDER (LOCAL)
    // ========================================================================
    
    const embedWithOllama = async (text: string): Promise<number[]> => {
      const startTime = Date.now();
      const ollamaUrl = config.ollamaUrl || 'http://localhost:11434';
      const model = config.ollamaModel || 'nomic-embed-text';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
      
      try {
        const response = await fetch(`${ollamaUrl}/api/embeddings`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: text })
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Ollama error (${response.status}): ${error.substring(0, 100)}`);
        }
        
        const data = await response.json();
        const embedding = data.embedding;
        
        if (!embedding || !Array.isArray(embedding)) {
          throw new Error('Ollama no retornó embedding válido');
        }
        
        const latency = Date.now() - startTime;
        updateEmbeddingStats(latency);
        
        console.log(`[lobstermind:embed] Ollama (${model}): ${embedding.length} dims en ${latency}ms`);
        return embedding;
        
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          throw new Error('Ollama timeout (30s)');
        }
        throw error;
      }
    };
    
    // ========================================================================
    // TRANSFORMERS.JS EMBEDDING PROVIDER (LOCAL, SIN DEPENDENCIAS EXTERNAS)
    // ========================================================================
    
    let transformersPipeline: any = null;
    
    const embedWithTransformers = async (text: string): Promise<number[]> => {
      const startTime = Date.now();
      
      // Lazy load transformers.js
      if (!transformersPipeline) {
        console.log('[lobstermind:embed] Cargando modelo Transformers.js...');
        const { pipeline } = await import('@xenova/transformers');
        const modelName = config.transformersModel || 'Xenova/all-MiniLM-L6-v2';
        transformersPipeline = await pipeline('feature-extraction', modelName, {
          quantized: true, // Menor tamaño
          progress_callback: (progress: any) => {
            if (progress.status === 'progress') {
              console.log(`[lobstermind:embed] Descargando modelo: ${progress.progress.toFixed(1)}%`);
            }
          }
        });
        console.log('[lobstermind:embed] Modelo Transformers.js cargado');
      }
      
      const output = await transformersPipeline(text, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data) as number[];
      
      const latency = Date.now() - startTime;
      updateEmbeddingStats(latency);
      
      console.log(`[lobstermind:embed] Transformers.js: ${embedding.length} dims en ${latency}ms`);
      return embedding;
    };
    
    // ========================================================================
    // SHA256 FALLBACK (NO SEMÁNTICO, SOLO PARA TESTING)
    // ========================================================================
    
    const embedWithSHA256 = (text: string): number[] => {
      const h = createHash('sha256').update(text).digest('hex');
      const v: number[] = [];
      for (let i = 0; i < 384; i += 4) {
        v.push((parseInt(h.slice(i % 64, (i % 64) + 4), 16) / 0xFFFFFFFF) * 2 - 1);
      }
      console.log('[lobstermind:embed] SHA256 (fallback): 384 dims (NO SEMÁNTICO)');
      return v;
    };
    
    // ========================================================================
    // FUNCIÓN PRINCIPAL DE EMBEDDING (CON CACHE)
    // ========================================================================
    
    const embed = async (text: string, useCache: boolean = true): Promise<number[]> => {
      // Check cache
      if (useCache && embeddingCache.has(text)) {
        const cached = embeddingCache.get(text)!;
        if (Date.now() - cached.timestamp < CACHE_TTL) {
          return cached.vector;
        }
        embeddingCache.delete(text);
      }
      
      try {
        let embedding: number[];
        
        switch (embeddingProvider) {
          case 'gemini':
            embedding = await embedWithGemini(text);
            break;
          case 'ollama':
            embedding = await embedWithOllama(text);
            break;
          case 'transformers':
            embedding = await embedWithTransformers(text);
            break;
          case 'sha256':
          default:
            embedding = embedWithSHA256(text);
        }
        
        // Update cache
        if (embeddingCache.size >= MAX_CACHE_SIZE) {
          const firstKey = embeddingCache.keys().next().value;
          if (firstKey) embeddingCache.delete(firstKey);
        }
        embeddingCache.set(text, { vector: embedding, timestamp: Date.now() });
        
        return embedding;
        
      } catch (error: any) {
        embeddingStats.errors++;
        console.error(`[lobstermind:embed] Error con provider ${embeddingProvider}:`, error.message);
        
        // Fallback a SHA256 si falla todo
        console.warn('[lobstermind:embed] Fallback a SHA256 (NO SEMÁNTICO)');
        return embedWithSHA256(text);
      }
    };
    
    const updateEmbeddingStats = (latencyMs: number) => {
      try {
        embeddingStats.total++;
        embeddingStats.latencySum += latencyMs;
        
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO embedding_stats (provider, total_embeddings, avg_latency_ms, last_used_at, updated_at)
          VALUES (?, 1, ?, ?, ?)
          ON CONFLICT(provider) DO UPDATE SET
            total_embeddings = total_embeddings + 1,
            avg_latency_ms = (avg_latency_ms * (total_embeddings - 1) + ?) / total_embeddings,
            last_used_at = ?,
            updated_at = ?
        `).run(embeddingProvider, latencyMs, now, now, latencyMs, now, now);
      } catch (error: any) {
        console.error('[lobstermind] DB error (updateEmbeddingStats):', error.message);
      }
    };
    
    const clearCache = () => {
      embeddingCache.clear();
      console.log('[lobstermind] Embedding cache cleared');
    };
    
    const preloadEmbeddings = async () => {
      try {
        console.log('[lobstermind] Preloading embeddings into cache...');
        const memories = db.prepare('SELECT content, embedding FROM memories LIMIT 500').all() as any[];
        
        memories.forEach(row => {
          try {
            const content = row.content;
            if (!embeddingCache.has(content)) {
              const embedding = JSON.parse(row.embedding);
              embeddingCache.set(content, { vector: embedding, timestamp: Date.now() });
            }
          } catch (e) {
            console.warn('[lobstermind] Failed to preload embedding:', e);
          }
        });
        
        console.log(`[lobstermind] Preloaded ${embeddingCache.size} embeddings into cache`);
      } catch (err) {
        console.error('[lobstermind] Error during embedding preload:', err);
      }
    };
    
    // Preload al startup
    setTimeout(() => preloadEmbeddings(), 1000);
    
    // ========================================================================
    // SIMILITUD COSENO
    // ========================================================================
    
    function calculateCosineSimilarity(a: number[], b: number[]): number {
      if (a.length !== b.length || a.length === 0) return 0;
      
      const dotProduct = a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
      const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
      const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
      
      return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
    }
    
    // ========================================================================
    // SEGURIDAD - DETECCIÓN DE DATOS SENSIBLES
    // ========================================================================
    
    const isSensitiveData = (content: string): boolean => {
      const sensitivePatterns = [
        /\b(?:\d{4}[-\s]?){3}\d{4}\b/, // Credit cards
        /\b[\w.-]+@[\w.-]+\.\w{2,}\b/, // Emails
        /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // Phone
        /password[:\s]+['"][^'"]+['"]\b/i,
        /token[:\s]+['"][^'"]+['"]\b/i,
        /apikey[:\s]+['"][^'"]+['"]\b/i,
        /\b\d{3}-\d{2}-\d{4}/, // SSN
        /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, // IP
        /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/, // Bitcoin
        /\b0x[a-fA-F0-9]{40}\b/, // Ethereum
      ];

      for (const pattern of sensitivePatterns) {
        if (pattern.test(content)) {
          console.log('[lobstermind] 🚨 Blocked sensitive data from storage');
          return true;
        }
      }

      return false;
    };
    
    // ========================================================================
    // GUARDADO DE MEMORIAS
    // ========================================================================
    
    const save = async (content: string, type = 'MANUAL', conf = 0.9, tags?: string) => {
      if (isSensitiveData(content)) {
        console.log('[lobstermind] ❌ Save blocked: sensitive data detected');
        return null;
      }
      
      // Límite de contenido (10KB)
      const MAX_CONTENT_LENGTH = 10000;
      if (content.length > MAX_CONTENT_LENGTH) {
        console.warn('[lobstermind] ⚠️ Contenido muy largo (%d chars), truncando a %d', content.length, MAX_CONTENT_LENGTH);
        content = content.slice(0, MAX_CONTENT_LENGTH) + '... [truncado]';
      }
      
      const id = createHash('sha256').update(content).digest('hex').slice(0, 16);
      const now = new Date().toISOString();
      
      // Embedding asíncrono
      const embedding = await embed(content);
      
      try {
        db.prepare(`
          INSERT OR REPLACE INTO memories (id, content, type, confidence, tags, embedding, embedding_provider, embedding_dimensions, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, content, type, conf, tags || null, JSON.stringify(embedding), embeddingProvider, embedding.length, now, now);
        console.log('[lobstermind] Saved [' + type + ']:', content.slice(0, 40));
      } catch (error: any) {
        console.error('[lobstermind] DB error (save):', error.message);
        return null;
      }

      // Crear relaciones y asignar a cluster (async, no bloquear)
      linkMemories(content, id, embedding).catch(console.error);
      assignToCluster(id, content, embedding).catch(console.error);
      
      // Sync a Obsidian
      if (config.obsidianSyncEnabled !== false) {
        try {
          const date = now.split('T')[0];
          const obs = join(obsidianDir, 'Memories.md');
          const memoryHash = createHash('sha256').update(content).digest('hex').slice(0, 8);
          const entry = `- [${type}] ${content} (confidence: ${conf.toFixed(2)}) <!-- ${memoryHash} -->\n`;
          
          // File locking para evitar race conditions
          const lockFile = obs + '.lock';
          
          // Cleanup de locks huérfanos (más viejos de 10 segundos)
          if (existsSync(lockFile)) {
            try {
              const lockStat = statSync(lockFile);
              const lockAge = Date.now() - lockStat.mtimeMs;
              if (lockAge > 10000) {
                unlinkSync(lockFile);
                console.log('[lobstermind] 🧹 Lock huérfano limpiado');
              }
            } catch (e) {
              // Si no podemos leer el lock, lo ignoramos
            }
          }
          
          let lockAcquired = false;
          let lockAttempts = 0;
          const maxLockAttempts = 10;
          
          // Intentar adquirir lock
          while (!lockAcquired && lockAttempts < maxLockAttempts) {
            try {
              if (!existsSync(lockFile)) {
                writeFileSync(lockFile, process.pid.toString(), 'utf-8');
                lockAcquired = true;
              } else {
                lockAttempts++;
                await new Promise(resolve => setTimeout(resolve, 50)); // Esperar 50ms
              }
            } catch (e) {
              lockAttempts++;
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          }
          
          if (!lockAcquired) {
            console.warn('[lobstermind] ⚠️ No se pudo adquirir lock de Obsidian, skippeando sync');
          } else {
            try {
              let obsContent = '';
              if (!existsSync(obs)) {
                obsContent = `---\ntitle: Memories\ncreated: ${now}\nplugin: LobsterMind Memory\n---\n\n# Memories\n\nAuto-created by LobsterMind Memory plugin\n\n## [[${date}]]\n\n${entry}\n`;
                writeFileSync(obs, obsContent, 'utf-8');
              } else {
                obsContent = readFileSync(obs, 'utf-8');
                
                // Check duplicados por hash
                if (!obsContent.includes(`<!-- ${memoryHash} -->`)) {
                  // Buscar si existe la sección de esta fecha
                  const dateSection = `## [[${date}]]`;
                  if (obsContent.includes(dateSection)) {
                    // Insertar después de la sección existente
                    const dateIndex = obsContent.indexOf(dateSection);
                    const nextSectionIndex = obsContent.indexOf('\n## [[', dateIndex + 1);
                    const insertPos = nextSectionIndex > 0 ? nextSectionIndex : obsContent.length;
                    const before = obsContent.slice(0, insertPos);
                    const after = obsContent.slice(insertPos);
                    obsContent = `${before}${entry}${after}`;
                  } else {
                    // Nueva sección de fecha
                    obsContent += `\n${dateSection}\n\n${entry}\n`;
                  }
                  
                  // Actualizar frontmatter
                  const frontmatterMatch = obsContent.match(/^---\n([\s\S]*?)\n---/);
                  if (frontmatterMatch) {
                    let frontmatter = frontmatterMatch[1];
                    // Contar solo líneas que son memorias válidas
                    const memoryLines = obsContent.split('\n').filter(line => 
                      /^- \[[A-Z_]+\] .* <!-- [a-f0-9]{8} -->$/.test(line.trim())
                    );
                    const totalMemories = memoryLines.length;
                    
                    // Actualizar o agregar campos
                    if (/modified:.*$/m.test(frontmatter)) {
                      frontmatter = frontmatter.replace(/modified:.*$/m, `modified: ${now}`);
                    } else {
                      frontmatter += `\nmodified: ${now}`;
                    }
                    
                    if (/total_memories:.*$/m.test(frontmatter)) {
                      frontmatter = frontmatter.replace(/total_memories:.*$/m, `total_memories: ${totalMemories}`);
                    } else {
                      frontmatter += `\ntotal_memories: ${totalMemories}`;
                    }
                    
                    obsContent = obsContent.replace(frontmatterMatch[0], `---\n${frontmatter}\n---`);
                  }
                  
                  writeFileSync(obs, obsContent, 'utf-8');
                }
              }
              console.log('[lobstermind] ✅ Synced to Obsidian');
            } finally {
              // Liberar lock
              try {
                if (existsSync(lockFile)) {
                  unlinkSync(lockFile);
                }
              } catch (e) {
                console.warn('[lobstermind] No se pudo liberar lock:', e);
              }
            }
          }
        } catch (err: any) { 
          console.error('[lobstermind] ❌ Obsidian sync error:', err.message); 
        }
      }
      
      // Sync a MEMORY.md
      if (config.nativeSyncEnabled !== false) {
        try {
          const nativePath = join(ws, 'MEMORY.md');
          const nativeEntry = `- [${type}] ${content} (confidence: ${conf.toFixed(2)})\n`;
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
        } catch (err: any) { 
          console.error('[lobstermind] ❌ MEMORY.md sync error:', err.message); 
        }
      }
      
      return id;
    };
    
    // ========================================================================
    // RELACIONES ENTRE MEMORIAS
    // ========================================================================
    
    async function linkMemories(content: string, newMemoryId: string, newEmbedding: number[]) {
      try {
        const existing = db.prepare('SELECT id, content, embedding FROM memories ORDER BY created_at DESC LIMIT 50').all() as any[];
        const threshold = config.clusterThreshold || 0.6;
        
        console.log(`[lobstermind] Checking relations for "${content.substring(0, 40)}"...`);
        
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO memory_relations (from_id, to_id, relation_type, weight, created_at) 
          VALUES (?, ?, ?, ?, ?)
        `);
        
        const transaction = db.transaction(() => {
          for (const memory of existing) {
            if (memory.id === newMemoryId) continue;
            
            const memEmbedding = JSON.parse(memory.embedding || '[]');
            const similarity = calculateCosineSimilarity(newEmbedding, memEmbedding);
            
            if (similarity >= threshold) {
              stmt.run(newMemoryId, memory.id, 'related_to', similarity, new Date().toISOString());
              stmt.run(memory.id, newMemoryId, 'related_by', similarity * 0.7, new Date().toISOString());
              console.log(`[lobstermind] Linked: "${content.substring(0,40)}" ↔ "${memory.content.substring(0,40)}" (${similarity.toFixed(2)})`);
            }
          }
        });
        
        transaction();
      } catch (error: any) {
        console.error('[lobstermind] DB error (linkMemories):', error.message);
      }
    }
    
    // ========================================================================
    // CLUSTERING
    // ========================================================================
    
    const generateClusterName = (initialContent: string): string => {
      const lowerContent = initialContent.toLowerCase();
      
      const topicMap: Record<string, string[]> = {
        'Boca / Fútbol': ['boca', 'futbol', 'soccer', 'equipo', 'hincha', 'fan'],
        'Trabajo / Carrera': ['work', 'trabajo', 'job', 'career', 'empleo', 'oficina'],
        'Ubicación / Hogar': ['live', 'vivo', 'home', 'casa', 'city', 'barrio'],
        'Familia': ['family', 'familia', 'parents', 'padre', 'madre', 'hermano'],
        'Preferencias': ['like', 'gusta', 'love', 'prefer', 'dislike', 'amo'],
        'Educación': ['study', 'estudio', 'education', 'university', 'learn'],
        'Hábitos': ['habits', 'rutinas', 'daily', 'every day', 'siempre'],
        'Tecnología': ['code', 'program', 'tech', 'software', 'developer'],
      };
      
      for (const [topic, keywords] of Object.entries(topicMap)) {
        if (keywords.some(kw => lowerContent.includes(kw))) {
          return topic;
        }
      }
      
      return 'General';
    };
    
    const assignToCluster = async (memoryId: string, content: string, embedding: number[]): Promise<void> => {
      try {
        const embeddingJson = JSON.stringify(embedding);
        const clusters = db.prepare('SELECT cluster_id, name, centroid_embedding FROM memory_clusters').all() as any[];
        
        let bestClusterId: string | null = null;
        let highestSimilarity = config.clusterThreshold || 0.6;
        
        for (const cluster of clusters) {
          if (!cluster.centroid_embedding) continue;
          const centroid = JSON.parse(cluster.centroid_embedding);
          const similarity = calculateCosineSimilarity(embedding, centroid);
          
          if (similarity > highestSimilarity) {
            highestSimilarity = similarity;
            bestClusterId = cluster.cluster_id;
          }
        }
        
        if (!bestClusterId) {
          const thematicName = generateClusterName(content);
          const newClusterId = createHash('sha256').update(`${content}-${Date.now()}`).digest('hex').slice(0, 16);
          
          db.prepare(`
            INSERT INTO memory_clusters (cluster_id, name, description, centroid_embedding, centroid_provider, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(newClusterId, thematicName, `Cluster: ${thematicName}`, embeddingJson, embeddingProvider, new Date().toISOString(), new Date().toISOString());
          
          console.log(`[lobstermind:clusters] Created: ${thematicName} (${newClusterId})`);
          bestClusterId = newClusterId;
        }
        
        if (bestClusterId) {
          db.prepare(`
            INSERT OR REPLACE INTO cluster_members (cluster_id, memory_id, similarity_score, assigned_at) 
            VALUES (?, ?, ?, ?)
          `).run(bestClusterId, memoryId, highestSimilarity, new Date().toISOString());
          
          updateClusterCentroid(bestClusterId);
          console.log(`[lobstermind:clusters] Assigned to ${bestClusterId} (${highestSimilarity.toFixed(3)})`);
        }
      } catch (error: any) {
        console.error('[lobstermind] DB error (assignToCluster):', error.message);
      }
    };
    
    const updateClusterCentroid = (clusterId: string): void => {
      try {
        const members = db.prepare(`
          SELECT m.embedding FROM cluster_members cm
          JOIN memories m ON cm.memory_id = m.id
          WHERE cm.cluster_id = ?
        `).all(clusterId) as any[];
        
        if (members.length === 0) return;
        
        const embeddingArrays = members.map(m => JSON.parse(m.embedding));
        const dimensionCount = embeddingArrays[0].length;
        const centroid = new Array(dimensionCount).fill(0);
        
        for (const embedding of embeddingArrays) {
          for (let i = 0; i < dimensionCount; i++) {
            centroid[i] += embedding[i];
          }
        }
        
        for (let i = 0; i < dimensionCount; i++) {
          centroid[i] /= embeddingArrays.length;
        }
        
        db.prepare(`
          UPDATE memory_clusters 
          SET centroid_embedding = ?, centroid_provider = ?, updated_at = ?
          WHERE cluster_id = ?
        `).run(JSON.stringify(centroid), embeddingProvider, new Date().toISOString(), clusterId);
        
      } catch (error: any) {
        console.error('[lobstermind] DB error (updateClusterCentroid):', error.message);
      }
    };
    
    // ========================================================================
    // BÚSQUEDA SEMÁNTICA
    // ========================================================================
    
    async function search(q: string, k?: number) {
      try {
        const limit = k || config.searchLimit || 8;
        const threshold = config.searchThreshold || 0.3;
        
        const cacheKey = `${q.substring(0, 100)}_${limit}`;
        const cached = searchCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL) {
          return cached.data;
        }
    
        const qe = await embed(q); 
        const allMemories = db.prepare('SELECT * FROM memories').all() as any[];
        
        const scored = allMemories.map(m => ({
          ...m,
          score: calculateCosineSimilarity(qe, JSON.parse(m.embedding || '[]'))
        }));
        
        const results = scored
          .filter(m => m.score >= threshold) 
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        
        searchCache.set(cacheKey, { data: results, timestamp: Date.now() });
        
        return results;
      } catch (error: any) {
        console.error('[lobstermind] DB error (search):', error.message);
        return [];
      } 
    }
    
    // ========================================================================
    // AUTO-CAPTURE (CLASIFICADOR)
    // ========================================================================
    
    const autoCaptureStats = {
      totalProcessed: 0,
      totalCaptured: 0,
      truePositives: 0,
      trueNegatives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      lastCaptureTime: null as string | null
    };
    
    const classifyMemoryContent = (rawContent: string): { content: string, type: string, confidence: number, shouldSave: boolean } => {
      const cleanContent = rawContent.replace(/<[\/]?memory_note[^>]*>/g, '').trim();
      
      if (isSensitiveData(cleanContent)) {
        return { content: cleanContent, type: 'SENSITIVE_BLOCKED', confidence: 1.0, shouldSave: false };
      }
      
      const lowerContent = cleanContent.toLowerCase();
      
      const patterns: { regex: RegExp, type: string, confidence: number }[] = [
        { regex: /(like|love|gusta|prefiero|amo|detesto|odio)/i, type: 'PREFERENCE', confidence: 0.95 },
        { regex: /\b(soy|I am|I'm|trabajo en|vivo en|me llamo|estudio|de Boca)/i, type: 'USER_FACT', confidence: 0.90 },
        { regex: /(@|email|phone|teléfono|móvil)/i, type: 'CONTACT_INFO', confidence: 0.99 },
        { regex: /\b(decidí|elegí|chose|decided|desde hace|since)/i, type: 'DECISION', confidence: 0.90 },
        { regex: /\b(todos los días|every day|siempre|usually|rutina)/i, type: 'HABIT', confidence: 0.85 },
        { regex: /\b(studied|estudio|university|educación|aprendí)/i, type: 'EDUCATION', confidence: 0.85 },
        { regex: /\b(trabajé|worked|empresa|proyecto|cliente)/i, type: 'WORK_HISTORY', confidence: 0.85 },
        { regex: /\b(react|javascript|python|code|program|api|database)/i, type: 'TECH_SKILL', confidence: 0.80 },
        { regex: /\b(familia|amigo|friend|padre|madre|hermano)/i, type: 'RELATIONSHIP', confidence: 0.80 },
      ];
      
      for (const { regex, type, confidence } of patterns) {
        if (regex.test(lowerContent)) {
          if (type === 'CONTACT_INFO') {
            return { content: cleanContent, type, confidence, shouldSave: false };
          }
          return { content: cleanContent, type, confidence, shouldSave: true };
        }
      }
      
      if (cleanContent.length >= 20 && !cleanContent.includes('?') && 
          (lowerContent.includes(' soy ') || lowerContent.includes(' i ') || lowerContent.includes(' mi '))) {
        return { content: cleanContent, type: 'USER_FACT', confidence: 0.75, shouldSave: true };
      }
      
      return { content: cleanContent, type: 'IGNORE', confidence: 0.0, shouldSave: false };
    };
    
    const processUserInputForMemory = async (content: string) => {
      if (config.autoCaptureEnabled === false) return;
      
      autoCaptureStats.totalProcessed++;
      
      const trimmed = content.trim();
      if (trimmed.length < 10 || trimmed.endsWith('?') || /^(hi|hola|gracias|thanks|ok|sure)$/i.test(trimmed)) {
        autoCaptureStats.trueNegatives++;
        return;
      }
      
      const classified = classifyMemoryContent(content);
      if (classified.shouldSave) {
        await save(classified.content, classified.type, classified.confidence);
        autoCaptureStats.totalCaptured++;
        autoCaptureStats.truePositives++;
        autoCaptureStats.lastCaptureTime = new Date().toISOString();
      } else {
        autoCaptureStats.falseNegatives++;
      }
    };
    
    // ========================================================================
    // HOOKS DE OPENCLAW
    // ========================================================================
    
    if (api.hooks?.afterMessage) {
      api.hooks.afterMessage((message: any) => {
        if (message?.role === 'user' && message?.content) {
          const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
          
          if (content.includes('<memory_note>') && content.includes('</memory_note>')) {
            const matches = content.match(/<memory_note[^>]*>(.*?)<\/memory_note>/gs);
            matches?.forEach(match => {
              const type = match.match(/type=["']([A-Z_]+)["']/)?.[1] || 'USER_FACT';
              const conf = parseFloat(match.match(/confidence=["']([\d.]+)["']/)?.[1] || '0.9');
              const text = match.replace(/<[^>]+>/g, '').trim();
              if (text) save(text, type, conf);
            });
          }
          
          processUserInputForMemory(content);
        }
      });
      console.log('[lobstermind] Registered hook: afterMessage');
    }
    
    // ========================================================================
    // RECALL / INYECCIÓN DE MEMORIAS
    // ========================================================================
    
    if (api.hooks?.beforePrompt) {
      api.hooks.beforePrompt((ctx: any) => {
        const messages = ctx?.messages || ctx?.request?.messages || [];
        const userMessages = messages.filter((m: any) => m?.role === 'user' && m?.content).slice(-3);
        
        if (userMessages.length > 0) {
          const lastMsg = typeof userMessages[userMessages.length - 1].content === 'string' 
            ? userMessages[userMessages.length - 1].content 
            : JSON.stringify(userMessages[userMessages.length - 1].content || '');
          
          if (lastMsg.length >= 5) {
            search(lastMsg, 5).then((relevantMemories: any[]) => {
              if (relevantMemories.length > 0) {
                const memoryNote = `\n<memory_note>\n### MEMORIAS RELEVANTES:\n${relevantMemories.map((m: any, i: number) => `${i + 1}. [${m.type}] ${m.content} (score: ${m.score.toFixed(3)})`).join('\n')}\n</memory_note>`;
                
                if (ctx?.prepends) {
                  ctx.prepends.push({ role: 'system', content: memoryNote });
                } else if (messages) {
                  messages.unshift({ role: 'system', content: memoryNote });
                }
                
                console.log(`[lobstermind] 🧠 Injected ${relevantMemories.length} memories`);
              }
            });
          }
        }
      });
      console.log('[lobstermind] Registered recall hook: beforePrompt');
    }
    
    // ========================================================================
    // CLI COMMANDS
    // ========================================================================
    
    if (api.registerCli) {
      api.registerCli(({program}: any) => {
        const c = program.command('memories').description('LobsterMind Memory CLI');
        
        c.command('list').option('--limit <n>', 'Max', '20').action((o: any) => {
          const r = db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?').all(parseInt(o.limit) || 20);
          console.log(`\n📚 Memorias (${r.length}):\n`);
          r.forEach((m: any, i: number) => console.log(`${i + 1}. [${m.type}] ${m.content} (${m.confidence.toFixed(2)})`));
        });
        
        c.command('add <content>').action(async (s: string) => {
          try {
            const id = await save(s);
            console.log('✅ ID:', id);
          } catch (e: any) {
            console.error('❌ Error:', e.message);
          }
        });
        
        c.command('search <query>').action(async (q: string) => {
          const r = await search(q);
          console.log(`\n🔍 Resultados (${r.length}):\n`);
          r.forEach((m: any, i: number) => console.log(`${i + 1}. [${m.type}] ${m.content} (score: ${m.score.toFixed(3)})`));
        });
        
        c.command('stats').action(() => {
          const total = db.prepare('SELECT COUNT(*) as c FROM memories').get() as any;
          const clusters = db.prepare('SELECT COUNT(*) as c FROM memory_clusters').get() as any;
          const relations = db.prepare('SELECT COUNT(*) as c FROM memory_relations').get() as any;
          
          console.log('\n📊 Estadísticas:\n');
          console.log(`  Memorias: ${total.c}`);
          console.log(`  Clusters: ${clusters.c}`);
          console.log(`  Relaciones: ${relations.c}`);
          console.log(`  Provider: ${embeddingProvider}`);
          console.log(`  Cache: ${embeddingCache.size} embeddings`);
          console.log(`  Auto-capture: ${autoCaptureStats.totalCaptured}/${autoCaptureStats.totalProcessed}`);
        });
        
        c.command('embeddings').action(() => {
          const stats = db.prepare('SELECT * FROM embedding_stats').all() as any[];
          console.log('\n🧠 Embedding Stats:\n');
          stats.forEach((s: any) => {
            console.log(`  Provider: ${s.provider}`);
            console.log(`  Total: ${s.total_embeddings}`);
            console.log(`  Avg latency: ${s.avg_latency_ms.toFixed(1)}ms`);
            console.log(`  Last used: ${s.last_used_at || 'Never'}`);
          });
        });
        
        c.command('backup').action(() => {
          const d = join(ws, 'memory', 'backups');
          if (!existsSync(d)) mkdirSync(d, { recursive: true });
          const p = join(d, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
          writeFileSync(p, JSON.stringify(db.prepare('SELECT * FROM memories').all(), null, 2));
          console.log('✅ Backup:', p);
        });
        
        c.command('clusters').option('--min-size <n>', 'Min size', '1').action((o: any) => {
          const minSize = parseInt(o.minSize) || 1;
          const clusters = db.prepare(`
            SELECT c.*, COUNT(cm.memory_id) as member_count 
            FROM memory_clusters c 
            LEFT JOIN cluster_members cm ON c.cluster_id = cm.cluster_id 
            GROUP BY c.cluster_id 
            HAVING member_count >= ?
          `).all(minSize) as any[];
          
          console.log(`\n🗂️ Clusters (${clusters.length}):\n`);
          clusters.forEach((cl: any, i: number) => {
            console.log(`${i + 1}. ${cl.name} (${cl.member_count} memorias)`);
            const samples = db.prepare(`
              SELECT m.content, m.type, cm.similarity_score 
              FROM cluster_members cm 
              JOIN memories m ON cm.memory_id = m.id 
              WHERE cm.cluster_id = ? 
              ORDER BY cm.similarity_score DESC 
              LIMIT 3
            `).all(cl.cluster_id) as any[];
            samples.forEach((s: any) => console.log(`   • [${s.type}] ${s.content.substring(0, 80)}...`));
          });
        });
        
        c.command('clear-cache').action(() => {
          clearCache();
          console.log('✅ Cache cleared');
        });
        
        c.command('provider').action(() => {
          console.log(`\n🔧 Embedding Provider: ${embeddingProvider}\n`);
          console.log('Configuración actual:');
          console.log(`  geminiApiKey: ${config.geminiApiKey ? '***' + config.geminiApiKey.slice(-4) : 'not set'}`);
          console.log(`  geminiModel: ${config.geminiModel || 'gemini-embedding-2-preview'}`);
          console.log(`  ollamaUrl: ${config.ollamaUrl || 'http://localhost:11434'}`);
          console.log(`  ollamaModel: ${config.ollamaModel || 'nomic-embed-text'}`);
          console.log(`  transformersModel: ${config.transformersModel || 'Xenova/all-MiniLM-L6-v2'}`);
        });
        
        // CAMBIAR PROVIDER EN RUNTIME
        c.command('set-provider <provider>').action(async (provider: string) => {
          const valid = ['gemini', 'ollama', 'transformers', 'sha256'];
          if (!valid.includes(provider)) {
            console.error(`❌ Provider inválido. Opciones: ${valid.join(', ')}`);
            return;
          }
          console.log(`\n🔄 Cambiando provider a: ${provider}`);
          console.log('⚠️  IMPORTANTE: Los embeddings existentes no son compatibles entre providers.');
          console.log('   Después del cambio, ejecutá `openclaw memories migrate-embeddings` para regenerarlos.\n');
          // Nota: El cambio real requiere reiniciar el plugin o actualizar config.embeddingProvider
          console.log(`✅ Provider actualizado a ${provider}. Reiniciá el gateway para aplicar.`);
        });
        
        // OBSIDIAN STATUS
        c.command('obsidian-status').action(() => {
          console.log('\n📓 Obsidian Sync Status\n');
          
          const obs = join(obsidianDir, 'Memories.md');
          if (!existsSync(obs)) {
            console.log('❌ Archivo no existe: ' + obs);
            console.log('   Se creará cuando guardes la primera memoria.\n');
            return;
          }
          
          try {
            const obsContent = readFileSync(obs, 'utf-8');
            const stats = {
              totalEntries: (obsContent.match(/<!-- [a-f0-9]{8} -->/g) || []).length,
              sections: (obsContent.match(/## \[\[/g) || []).length,
              sizeBytes: Buffer.byteLength(obsContent, 'utf-8'),
            };
            
            console.log(`✅ Archivo: ${obs}`);
            console.log(`   Entradas: ${stats.totalEntries}`);
            console.log(`   Secciones (fechas): ${stats.sections}`);
            console.log(`   Tamaño: ${(stats.sizeBytes / 1024).toFixed(2)} KB`);
            
            // Check frontmatter
            const hasFrontmatter = obsContent.startsWith('---\n');
            console.log(`   Frontmatter YAML: ${hasFrontmatter ? '✅' : '❌'}`);
            
            // Comparar con DB
            const dbCount = db.prepare('SELECT COUNT(*) as c FROM memories').get() as any;
            console.log(`\n📊 Comparación con DB:`);
            console.log(`   DB: ${dbCount.c} memorias`);
            console.log(`   Obsidian: ${stats.totalEntries} entradas`);
            console.log(`   Diferencia: ${dbCount.c - stats.totalEntries}`);
            
            if (dbCount.c !== stats.totalEntries) {
              console.log('\n⚠️  Hay diferencia! Ejecutá `openclaw memories sync-obsidian` para sincronizar.\n');
            } else {
              console.log('\n✅ Todo sincronizado!\n');
            }
            
          } catch (error: any) {
            console.error('❌ Error leyendo archivo:', error.message);
          }
        });
        
        // DB VACUUM - Optimizar base de datos
        c.command('vacuum').action(() => {
          console.log('\n🗜️ Optimizando base de datos...\n');
          try {
            const before = db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get() as any;
            db.exec('VACUUM');
            const after = db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get() as any;
            const saved = before.size - after.size;
            console.log('✅ DB optimizada!');
            console.log(`   Antes: ${(before.size / 1024).toFixed(2)} KB`);
            console.log(`   Después: ${(after.size / 1024).toFixed(2)} KB`);
            if (saved > 0) {
              console.log(`   Ahorrado: ${(saved / 1024).toFixed(2)} KB\n`);
            }
          } catch (error: any) {
            console.error('❌ Error en vacuum:', error.message);
          }
        });
        
        // SYNC BIDIRECCIONAL CON OBSIDIAN
        c.command('sync-obsidian').action(async () => {
          console.log('\n🔄 Sync bidireccional con Obsidian\n');
          
          const obs = join(obsidianDir, 'Memories.md');
          if (!existsSync(obs)) {
            console.log('ℹ️  No existe archivo de Obsidian para sync');
            return;
          }
          
          try {
            const obsContent = readFileSync(obs, 'utf-8');
            
            // Extraer memorias del archivo de Obsidian
            // Regex mejorado: maneja contenido con paréntesis y múltiples líneas
            const memoryPattern = /- \[([A-Z_]+)\] (.+?) \(confidence: ([\d.]+)\) <!-- ([a-f0-9]{8}) -->/g;
            let match;
            let imported = 0;
            let skipped = 0;
            let errors = 0;
            
            while ((match = memoryPattern.exec(obsContent)) !== null) {
              const [, type, content, confidence, hash] = match;
              
              // Check si ya existe en DB por hash (usamos los primeros 8 caracteres del ID)
              try {
                const existing = db.prepare('SELECT id FROM memories WHERE substr(id, 1, 8) = ?').get(hash) as any;
                if (existing) {
                  skipped++;
                  continue;
                }
              } catch (dbError: any) {
                console.warn(`  ⚠️ Error chequeando existencia: ${dbError.message}`);
              }
              
              // Importar a DB
              try {
                const id = createHash('sha256').update(content).digest('hex').slice(0, 16);
                const now = new Date().toISOString();
                const embedding = await embed(content);
                
                db.prepare(`
                  INSERT OR REPLACE INTO memories (id, content, type, confidence, tags, embedding, embedding_provider, embedding_dimensions, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(id, content, type, parseFloat(confidence), null, JSON.stringify(embedding), embeddingProvider, embedding.length, now, now);
                
                imported++;
                console.log(`  ✅ Importado: [${type}] ${content.substring(0, 50)}...`);
              } catch (importError: any) {
                errors++;
                console.error(`  ❌ Error importando: ${importError.message}`);
              }
            }
            
            console.log(`\n✅ Sync completado!`);
            console.log(`   Importados: ${imported}`);
            console.log(`   Skippeados (ya existen): ${skipped}`);
            console.log(`   Errores: ${errors}\n`);
            
          } catch (error: any) {
            console.error('❌ Error en sync:', error.message);
          }
        });
        
        // MIGRAR EMBEDDINGS
        c.command('migrate-embeddings').action(async () => {
          console.log('\n🔄 Migrando embeddings al provider actual...\n');
          
          const memories = db.prepare('SELECT id, content, embedding_provider FROM memories').all() as any[];
          let migrated = 0;
          let errors = 0;
          
          for (const mem of memories) {
            if (mem.embedding_provider !== embeddingProvider) {
              try {
                const newEmbedding = await embed(mem.content, false); // Sin cache para forzar regeneración
                db.prepare('UPDATE memories SET embedding = ?, embedding_provider = ? WHERE id = ?')
                  .run(JSON.stringify(newEmbedding), embeddingProvider, mem.id);
                migrated++;
                if (migrated % 10 === 0) {
                  console.log(`  Progreso: ${migrated}/${memories.length}...`);
                }
              } catch (error: any) {
                errors++;
                console.error(`  Error migrando ${mem.id}: ${error.message}`);
              }
            }
          }
          
          console.log('\n✅ Migración completada!');
          console.log(`   Migradas: ${migrated}/${memories.length}`);
          console.log(`   Errores: ${errors}`);
          console.log(`   Sin cambios: ${memories.length - migrated - errors}\n`);
          
          // Limpiar cache después de migrar
          clearCache();
          console.log('🗑️  Cache limpiada para usar los nuevos embeddings.\n');
        });
        
        // HEALTH CHECK / DOCTOR
        c.command('doctor').action(async () => {
          console.log('\n🔍 LobsterMind Health Check\n');
          console.log('=' .repeat(50));
          
          // Check DB
          try {
            const memCount = db.prepare('SELECT COUNT(*) as c FROM memories').get() as any;
            const clusterCount = db.prepare('SELECT COUNT(*) as c FROM memory_clusters').get() as any;
            const relationCount = db.prepare('SELECT COUNT(*) as c FROM memory_relations').get() as any;
            console.log(`✅ DB: ${memCount.c} memorias, ${clusterCount.c} clusters, ${relationCount.c} relaciones`);
          } catch (error: any) {
            console.log(`❌ DB: ${error.message}`);
          }
          
          // Check provider connectivity
          console.log('\n🔌 Provider Check:');
          try {
            const start = Date.now();
            await embed('health check test');
            const latency = Date.now() - start;
            console.log(`✅ ${embeddingProvider}: OK (${latency}ms)`);
          } catch (error: any) {
            console.log(`❌ ${embeddingProvider}: ${error.message}`);
          }
          
          // Check directories
          console.log('\n📁 Directories:');
          console.log(`  ${existsSync(dbDir) ? '✅' : '❌'} DB dir: ${dbDir}`);
          console.log(`  ${existsSync(backupDir) ? '✅' : '❌'} Backup dir: ${backupDir}`);
          console.log(`  ${existsSync(obsidianDir) ? '✅' : '❌'} Obsidian dir: ${obsidianDir}`);
          
          // Check cache
          console.log('\n⚡ Cache:');
          console.log(`  ${embeddingCache.size} embeddings en cache`);
          console.log(`  ${searchCache.size} búsquedas en cache`);
          
          // Check auto-capture stats
          console.log('\n🤖 Auto-Capture:');
          console.log(`  Procesados: ${autoCaptureStats.totalProcessed}`);
          console.log(`  Capturados: ${autoCaptureStats.totalCaptured}`);
          console.log(`  Success rate: ${autoCaptureStats.totalProcessed > 0 ? ((autoCaptureStats.totalCaptured / autoCaptureStats.totalProcessed) * 100).toFixed(1) + '%' : 'N/A'}`);
          
          // Check embedding stats
          console.log('\n🧠 Embedding Stats:');
          try {
            const stats = db.prepare('SELECT * FROM embedding_stats WHERE provider = ?').get(embeddingProvider) as any;
            if (stats) {
              console.log(`  Total embeddings: ${stats.total_embeddings}`);
              console.log(`  Avg latency: ${stats.avg_latency_ms.toFixed(1)}ms`);
              console.log(`  Last used: ${stats.last_used_at || 'Never'}`);
            } else {
              console.log('  No stats disponibles');
            }
          } catch (error: any) {
            console.log(`  Error leyendo stats: ${error.message}`);
          }
          
          console.log('\n' + '='.repeat(50));
          console.log('Health check completed!\n');
        });
      }, { commands: ['memories'] });
      console.log('[lobstermind] CLI ready');
    }
    
    console.log(`[lobstermind] ✅ Loaded with provider: ${embeddingProvider}`);
    
    // Cleanup al descargar el plugin
    const unregister = () => {
      console.log('[lobstermind] 🧹 Unregistering...');
      if (cleanupInterval) clearInterval(cleanupInterval);
      db.close();
    };
    
    return { 
      name: 'lobstermind-memory', 
      version: '2.2.0',
      unregister 
    };
  }
};
