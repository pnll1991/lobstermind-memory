/**
 * LobsterMind Memory - Fixed OpenClaw Plugin
 */
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';

export default {
  id: 'lobstermind-memory',
  name: 'LobsterMind Memory',
  description: 'Long-term community memory plugin',
  kind: 'memory',
  configSchema: { 
    type: 'object', 
    properties: { 
      enabled: { type: 'boolean', default: true } 
    } 
  },
  register(api: any) {
    console.log('[lobstermind] Loading...');
    const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
    const openclawDir = join(homeDir, '.openclaw');
    const dbDir = join(openclawDir, 'memory');
    const backupDir = join(openclawDir, 'memory', 'backups');
    const obsidianDir = join(openclawDir, 'workspace', 'obsidian-vault', 'LobsterMind');
    [dbDir, backupDir, obsidianDir].forEach(d => { if (!existsSync(d)) mkdirSync(d, { recursive: true }); });
    const db = new Database(join(dbDir, 'lobstermind-memory.db'));
    
    // Initialize database schema with all tables
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
      CREATE TABLE IF NOT EXISTS memory_clusters (
        cluster_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        centroid_embedding TEXT,
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
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories(tags);
      CREATE INDEX IF NOT EXISTS idx_relations_from ON memory_relations(from_id);
      CREATE INDEX IF NOT EXISTS idx_relations_to ON memory_relations(to_id);
      CREATE INDEX IF NOT EXISTS idx_relations_type ON memory_relations(relation_type);
      CREATE INDEX IF NOT EXISTS idx_cluster_members_memory ON cluster_members(memory_id);
      CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster ON cluster_members(cluster_id);
    `);
    
    // Initialize automatic capture statistics
    let autoCaptureStats = {
      totalProcessed: 0,
      totalCaptured: 0,
      lastCaptureTime: null,
      falsePositives: 0,      // Captured content that shouldn't have been
      falseNegatives: 0,      // Missed content that should have been captured
      truePositives: 0,       // Correctly captured content
      trueNegatives: 0        // Correctly ignored content
    };

    // Simple conversation context tracker to enable temporal awareness
    const conversationContext = {
      recentInputs: [] as string[],
      timestamps: [] as Date[],
      maxContextSize: 5, // Track last 5 inputs
      
      // Add a user input to context with timestamp
      addInput: function(input: string) {
        this.recentInputs.push(input);
        this.timestamps.push(new Date());
        
        // Keep only recent context
        if (this.recentInputs.length > this.maxContextSize) {
          this.recentInputs.shift();
          this.timestamps.shift();
        }
        
        console.log('[lobstermind:context] Added input to context, now tracking:', this.recentInputs.length, 'inputs');
      },
      
      // Get recent context from a certain time window (in minutes)
      getRecentContext(minutes: number = 5): string[] {
        const now = new Date();
        const cutoffTime = new Date(now.getTime() - (minutes * 60 * 1000));
        
        // Filter inputs that occurred within the specified timeframe
        const recent: string[] = [];
        for (let i = 0; i < this.timestamps.length; i++) {
          if (this.timestamps[i] > cutoffTime) {
            recent.push(this.recentInputs[i]);
          }
        }
        
        console.log('[lobstermind:context] Retrieved', recent.length, 'inputs from the last', minutes, 'minutes');
        return recent;
      },
      
      // Determine if current input is related to topics discussed recently
      hasTopicOverlap(input: string): boolean {
        const recentInputs = this.getRecentContext(5); // Last 5 minutes
        const inputLower = input.toLowerCase();
        
        for (const recent of recentInputs) {
          const recentLower = recent.toLowerCase();
          
          // Check if there are overlapping words or themes
          const inputWords = inputLower.split(/\s+/);
          for (const word of inputWords) {
            if (word.length > 3 && recentLower.includes(word) && 
                !word.match(/\b(soy|I|me|mi|he|have|was|were|the|and|that|have|for|are|but|not|had|has|with|you|this|from|they|she|will|his|can|would|could|should|all|her|were|there|been|who|did|their|time|will|into|has|more)\b/i)) {
              console.log('[lobstermind:context] Topic overlap detected with word:', word);
              return true;
            }
          }
        }
        
        return false;
      }
    };

    // Cache for computed embeddings to improve performance
    const embeddingCache = new Map<string, number[]>();
    
    // Size-limited cache (evict oldest entries when reaching limit)
    const MAX_CACHE_SIZE = 1000;
    
    const embed = (t: string) => {
      // Check if embedding is in cache first to avoid recalculation
      if (embeddingCache.has(t)) {
        return embeddingCache.get(t)!;
      }
      
      const h = createHash('sha256').update(t).digest('hex');
      const v: number[] = [];
      
      for (let i = 0; i < 384; i += 4) {
        v.push((parseInt(h.slice(i % 64, (i % 64) + 4), 16) / 0xFFFFFFFF) * 2 - 1);
      }
      
      // Add to cache
      if (embeddingCache.size >= MAX_CACHE_SIZE) {
        // Remove oldest cached item (first inserted since Map preserves insertion order)
        const firstKey = embeddingCache.keys().next().value;
        if (firstKey) embeddingCache.delete(firstKey);
      }
      
      embeddingCache.set(t, v);
      return v;
    };
    
    // Clear embedding cache for memory management
    const clearCache = () => {
      embeddingCache.clear();
      console.log('[lobstermind] Embedding cache cleared');
    };
    
    // Preload cache with embeddings from DB to avoid recalculation on startup
    const preloadEmbeddings = () => {
      try {
        console.log('[lobstermind] Preloading embeddings into cache...');
        const memories = db.prepare('SELECT content, embedding FROM memories LIMIT 500').all() as any[]; // Limit to avoid overwhelming
        
        memories.forEach(row => {
          try {
            const content = row.content;
            if (!embeddingCache.has(content)) {
              const embedding = JSON.parse(row.embedding);
              if (!embeddingCache.has(content)) {
                embeddingCache.set(content, embedding);
              }
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
    
    // Initialize cache at startup
    setTimeout(preloadEmbeddings, 1000); // Do it after other initialization
    
    function calculateCosineSimilarity(a: number[], b: number[]): number {
      if (a.length !== b.length || a.length === 0) return 0;
      
      const dotProduct = a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
      const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
      const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
      
      return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
    }
    
    // Security validation helper function for sensitive data
    const isSensitiveData = (content: string): boolean => {
      const sensitivePatterns = [
        // Credit card numbers (basic pattern)
        /\b(?:\d{4}[-\s]?){3}\d{4}\b/,
        /\b(?:\d{4}[-\s]?){2}\d{4}[-\s]?\d{4}\b/,
        
        // Email addresses (common format)
        /\b[\w.-]+@[\w.-]+\.\w{2,}\b/,
        
        // Phone numbers (various formats)
        /\b\d{10}\b/, // 10 digits
        /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // (xxx) xxx-xxxx or x.x.x.x or x-x-x-x
        /\+\d{1,3}[-.\s]?\d{3,14}\b/, // International format
        
        // Passwords and credentials
        /password[:\s]+['"][^'"]+['"]\b/i,
        /clave[:\s]+['"][^'"]+['"]\b/i,
        /credential[:\s]+['"][^'"]+['"]\b/i,
        /apikey[:\s]+['"][^'"]+['"]\b/i,
        /token[:\s]+['"][^'"]+['"]\b/i,
        /secret[:\s]+['"][^'"]+['"]\b/i,
        /auth[:\s]+['"][^'"]+['"]\b/i,
        /api[_-]?(?:key|token|secret)[:\s]+['"][^'"]+['"]\b/i,
        
        // Government IDs
        /\b\d{9}\b/, // SSN or similar
        /\d{3}-\d{2}-\d{4}/, // SSN format
        /\b[A-Z]{1,2}\d{6,8}\b/i, // Generic ID format
        
        // Bank account numbers and routing numbers
        /\b\d{8,12}\b/, // Basic bank account pattern
        /\d{3}[-\s]?\d{4}[-\s]?\d{4}\s?\d{1,2}\b/, // Routing + account
        
        // IP addresses
        /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
        
        // Bitcoin/etherium wallet addresses
        /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/, // Bitcoin
        /\b0x[a-fA-F0-9]{40}\b/, // Ethereum
        
        // Keywords that might indicate sensitive content
        /\bpwd\b|\bpass\b/i,
        /contraseña|clave|usuario|username/i
      ];

      for (const pattern of sensitivePatterns) {
        if (pattern.test(content)) {
          console.log('[lobstermind] 🚨 Blocked sensitive data from storage');
          return true;
        }
      }

      return false;
    };

    const save = (c: string, t = 'MANUAL', conf = 0.9, tags?: string) => {
      // Security check: do not save sensitive data
      if (isSensitiveData(c)) {
        console.log('[lobstermind] ❌ Save blocked: sensitive data detected');
        return null; // Don't save anything
      }
      
      const id = createHash('sha256').update(c).digest('hex').slice(0,16);
      const now = new Date().toISOString();
      const embedding = embed(c);
      
      db.prepare('INSERT OR REPLACE INTO memories (id,content,type,confidence,tags,embedding,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,c,t,conf,tags||null,JSON.stringify(embedding),now,now);

      console.log('[lobstermind] Raw save called with params:', { content: c.substring(0, 50), type: t, confidence: conf });

      // Create relations to similar existing memories
      linkMemories(c, id).catch(console.error); // Fire and forget - don't block save operation
      
      // Assign to a cluster
      assignToCluster(id, c, embedding).catch(console.error); // Fire and forget - don't block save operation
      
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
        const nativePath = join(openclawDir, 'workspace', 'MEMORY.md');
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
    
    // Memory relations: Find and create relationships between memories automatically
    async function linkMemories(content: string, newMemoryId: string) {
      try {
        // Calculate similarity to existing memories in last 50 entries
        const existing = db.prepare('SELECT id, content, embedding FROM memories ORDER BY created_at DESC LIMIT 50').all() as any[];
        const newEmbedding = embed(content);  // Use cached embedding function
        
        console.log(`[lobstermind] Checking relations for "${content.substring(0, 40)}"... Found ${existing.length} existing memories`);
        
        // Batch prepare statement for better performance
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO memory_relations (from_id, to_id, relation_type, weight, created_at) 
          VALUES (?, ?, ?, ?, ?)
        `);
        
        // Transaction for better performance
        const transaction = db.transaction(() => {
          for (const memory of existing) {
            if (memory.id === newMemoryId) continue;
            
            // Use our cached embeddings
            const memEmbedding = JSON.parse(memory.embedding || '[]');
            const similarity = calculateCosineSimilarity(newEmbedding, memEmbedding) || 0;
            
            if (similarity >= 0.6) {  // Link if 60% similar
              // Use batch prepared statement
              stmt.run(newMemoryId, memory.id, 'related_to', similarity, new Date().toISOString());
              stmt.run(memory.id, newMemoryId, 'related_by', similarity * 0.7, new Date().toISOString());
              
              console.log(`[lobstermind] Linked: "${content.substring(0,40)}" ↔ "${memory.content.substring(0,40)}" (similarity: ${similarity.toFixed(2)})`);
            }
          }
        });
        
        transaction();
        
        console.log(`[lobstermind] Completed relation check, processed ${existing.length} memories`);
      } catch (err: any) {
        console.error('[lobstermind] Relations error:', err.message);
      }
    }
    
    // Cluster management functions
    const assignToCluster = async (memoryId: string, content: string, embedding: number[]): Promise<void> => {
      try {
        // Convert embedding to JSON string
        const embeddingJson = JSON.stringify(embedding);
        
        // Get all existing clusters
        const clusters = db.prepare(`
          SELECT cluster_id, name, centroid_embedding 
          FROM memory_clusters
        `).all() as any[];
        
        let bestClusterId: string | null = null;
        let highestSimilarity = 0.3; // Minimum threshold for assignment
        
        // Calculate similarity with each cluster centroid
        for (const cluster of clusters) {
          if (!cluster.centroid_embedding) continue;
          
          const centroid = JSON.parse(cluster.centroid_embedding);
          const similarity = calculateCosineSimilarity(embedding, centroid);
          
          if (similarity > highestSimilarity) {
            highestSimilarity = similarity;
            bestClusterId = cluster.cluster_id;
          }
        }
        
        // If no cluster is a good match, create a new cluster
        if (!bestClusterId) {
          console.log(`[lobstermind:clusters] Need to create new cluster for memory: ${content.substring(0, 50)}...`);
          
          // Generate a thematic name for the cluster based on the content
          const thematicName = generateClusterName(content);
          const newClusterId = createHash('sha256').update(`${content}-${Date.now()}`).digest('hex').slice(0, 16);
          
          // Save the new cluster
          db.prepare(`
            INSERT INTO memory_clusters (cluster_id, name, description, centroid_embedding, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(newClusterId, thematicName, `Cluster for memories related to: ${thematicName}`, embeddingJson, new Date().toISOString(), new Date().toISOString());
          
          console.log(`[lobstermind:clusters] Created new cluster: ${thematicName} (${newClusterId})`);
          
          bestClusterId = newClusterId;
        }
        
        // Assign the memory to the best fitting cluster
        if (bestClusterId) {
          db.prepare(`
            INSERT OR REPLACE INTO cluster_members (cluster_id, memory_id, similarity_score, assigned_at) 
            VALUES (?, ?, ?, ?)
          `).run(bestClusterId, memoryId, highestSimilarity, new Date().toISOString());
          
          // Update cluster centroid to include this memory
          updateClusterCentroid(bestClusterId);
          
          console.log(`[lobstermind:clusters] Assigned memory to cluster ${bestClusterId} with similarity ${highestSimilarity.toFixed(3)}`);
        }
      } catch (error) {
        console.error('[lobstermind:clusters] Error assigning to cluster:', error);
      }
    };
    
    // Generate descriptive name for a cluster based on top memories
    const generateClusterName = (initialContent: string): string => {
      let topic = "General";
      
      // Try to infer topic from the initial content
      const lowerContent = initialContent.toLowerCase();
      
      // Generic topic detection (no hardcoded personal references)
      if (lowerContent.includes('work') || lowerContent.includes('trabajo') || lowerContent.includes('job') || lowerContent.includes('career') || lowerContent.includes('company') || lowerContent.includes('empresa') || lowerContent.includes('office')) {
        topic = "Work & Career";
      }
      else if (lowerContent.includes('live') || lowerContent.includes('vivo') || lowerContent.includes('home') || lowerContent.includes('casa') || lowerContent.includes('city') || lowerContent.includes('ciudad') || lowerContent.includes('neighborhood')) {
        topic = "Location & Home";
      }
      else if (lowerContent.includes('family') || lowerContent.includes('familia') || lowerContent.includes('parents') || lowerContent.includes('padre') || lowerContent.includes('madre') || lowerContent.includes('mother') || lowerContent.includes('father') || lowerContent.includes('sibling')) {
        topic = "Family";
      }
      else if (lowerContent.includes('like') || lowerContent.includes('gusta') || lowerContent.includes('love') || lowerContent.includes('prefer') || lowerContent.includes('dislike') || lowerContent.includes('no me gusta') || lowerContent.includes('prefiero') || lowerContent.includes('enjoy')) {
        topic = "Preferences";
      }
      else if (lowerContent.includes('study') || lowerContent.includes('learn') || lowerContent.includes('education') || lowerContent.includes('estudio') || lowerContent.includes('university') || lowerContent.includes('escuela') || lowerContent.includes('school') || lowerContent.includes('course')) {
        topic = "Education";
      }
      else if (lowerContent.includes('habits') || lowerContent.includes('rutinas') || lowerContent.includes('daily') || lowerContent.includes('every day') || lowerContent.includes('todos los días') || lowerContent.includes('routine')) {
        topic = "Daily Habits";
      }
      else if (lowerContent.includes('hobby') || lowerContent.includes('hobbies') || lowerContent.includes('interest') || lowerContent.includes('interés') || lowerContent.includes('pasatiempo') || lowerContent.includes('sports') || lowerContent.includes('music')) {
        topic = "Hobbies & Interests";
      }
      else if (lowerContent.includes('health') || lowerContent.includes('salud') || lowerContent.includes('exercise') || lowerContent.includes('ejercicio') || lowerContent.includes('gym') || lowerContent.includes('diet') || lowerContent.includes('fitness')) {
        topic = "Health & Fitness";
      }
      else if (lowerContent.includes('travel') || lowerContent.includes('viaje') || lowerContent.includes('trip') || lowerContent.includes('vacation') || lowerContent.includes('vacaciones') || lowerContent.includes('trip')) {
        topic = "Travel";
      }
      else if (lowerContent.includes('friend') || lowerContent.includes('amigo') || lowerContent.includes('amiga') || lowerContent.includes('relationship') || lowerContent.includes('relación')) {
        topic = "Relationships";
      }
      
      return topic;
    };
    
    // Update cluster centroid to reflect the average of member embeddings
    const updateClusterCentroid = (clusterId: string): void => {
      try {
        // Get all members of the cluster
        const members = db.prepare(`
          SELECT m.embedding 
          FROM cluster_members cm
          JOIN memories m ON cm.memory_id = m.id
          WHERE cm.cluster_id = ?
        `).all(clusterId) as any[];
        
        if (members.length === 0) return;
        
        // Calculate average embedding (centroid)
        const embeddingArrays = members.map(member => JSON.parse(member.embedding));
        const dimensionCount = embeddingArrays[0].length;
        const centroid = new Array(dimensionCount).fill(0);
        
        // Sum all embeddings
        for (const embedding of embeddingArrays) {
          for (let i = 0; i < dimensionCount; i++) {
            centroid[i] += embedding[i];
          }
        }
        
        // Average the values
        for (let i = 0; i < dimensionCount; i++) {
          centroid[i] /= embeddingArrays.length;
        }
        
        // Save the centroid back to the cluster table
        db.prepare(`
          UPDATE memory_clusters 
          SET centroid_embedding = ?, updated_at = ?
          WHERE cluster_id = ?
        `).run(JSON.stringify(centroid), new Date().toISOString(), clusterId);
        
      } catch (error) {
        console.error('[lobstermind:clusters] Error updating cluster centroid:', error);
      }
    };
    
    // Recalculate clusters periodically or when needed to ensure coherence
    function recalculateAllClusters() {
      try {
        console.log('[lobstermind:clusters] Recalculating all clusters...');
        
        // Delete all existing cluster memberships (not clusters themselves, as we want to keep descriptions)
        db.prepare('DELETE FROM cluster_members').run();
        
        // Get all memories
        const memories = db.prepare('SELECT id, content, embedding FROM memories').all() as any[];
        
        console.log(`[lobstermind:clusters] Assigning ${memories.length} memories to clusters...`);
        
        // Reassign each memory to a cluster
        for (const mem of memories) {
          try {
            const embedding = JSON.parse(mem.embedding);
            assignToCluster(mem.id, mem.content, embedding);
          } catch (e) {
            console.error('[lobstermind:clusters] Error assigning memory to cluster:', e);
          }
        }
        
        console.log('[lobstermind:clusters] ✓ Cluster recalculation complete');
        return true;
      } catch (error) {
        console.error('[lobstermind:clusters] Error recalculating clusters:', error);
        return false;
      }
    }
    
    // Helper function to get cluster by id or name
    function getClosestCluster(query: string): any {
      // First check by cluster_id
      let cluster = db.prepare('SELECT * FROM memory_clusters WHERE cluster_id = ?').get(query) as any;
      if (cluster) return cluster;
      
      // Then check by name (partial match)
      cluster = db.prepare('SELECT * FROM memory_clusters WHERE name LIKE ?').get(`%${query}%`) as any;
      return cluster;
    }
    
    // Cache for search queries
    const searchCache = new Map<string, { data: any[], timestamp: number }>();
    const MAX_SEARCH_RESULTS_CACHE = 100;
    const SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    
    // Optimized search function with caching
    function search(q: string, k: number = 8) { 
      // Check if similar query exists in cache
      const cacheKey = `${q.substring(0, 100)}_${k}`;
      const cachedResult = searchCache.get(cacheKey);
      if (cachedResult && Date.now() - (cachedResult.timestamp || 0) < SEARCH_CACHE_TTL) {
        console.log(`[search] Using cached result for query "${q.substring(0, 50)}..."`);
        return cachedResult.data;
      }
  
      const qe = embed(q); 
      const allMemories = db.prepare('SELECT * FROM memories').all() as any[];
      console.log(`[search] Searching in ${allMemories.length} memories for query: "${q.substring(0, 50)}..."`);
      
      // Filter first to reduce unnecessary computations
      const scoredRaw = allMemories.map(m => ({
        m,
        emb: JSON.parse(m.embedding || '[]')
      }));
      
      const scoredWithSimilarities = scoredRaw.map(item => ({
        ...item.m,
        score: calculateCosineSimilarity(qe, item.emb) || 0  // Use the same similarity function from elsewhere
      }));
      
      const results = scoredWithSimilarities
        .filter((m: any) => m.score >= 0.3) 
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, k);
      
      console.log(`[search] Retrieved ${results.length} memories with scores >= 0.3:`, results.map((r: any) => `${r.type}:${r.score.toFixed(3)}`));

      // Add to cache
      if (searchCache.size >= MAX_SEARCH_RESULTS_CACHE) {
        // Remove oldest cached item
        const firstKey = searchCache.keys().next().value;
        if (firstKey) searchCache.delete(firstKey);
      }
      
      // Store with timestamp
      searchCache.set(cacheKey, {
        data: results,
        timestamp: Date.now()
      });
      
      return results; 
    };
    
    // Advanced automatic capture system - detecting user input automatically
    // This function applies anti-noise filtering and smart identification
    const processUserInputForMemory = (content: string) => {
      autoCaptureStats.totalProcessed++;
      
      // Add to conversation context for future reference
      conversationContext.addInput(content);
      
      console.log(`[lobstermind:auto-capture] Processing user input: "${content.substring(0, 150)}..."`);
      
      // Use contextual information to improve capture logic
      const hasContextualRelevance = conversationContext.hasTopicOverlap(content);
      
      // Filter out noise: questions, greetings, very short messages, commands
      const trimmedContent = content.trim();
      if (trimmedContent.length < 10) {
        autoCaptureStats.trueNegatives++;
        console.log('[lobstermind:auto-capture] ✂️ Skipped: too short (<10 chars)');
        return false;
      }
      
      // Skip questions
      if (trimmedContent.endsWith('?') || /[¿?]/.test(trimmedContent)) {
        autoCaptureStats.trueNegatives++;
        console.log('[lobstermind:auto-capture] ❓ Skipped: appears to be a question');
        return false;
      }
      
      // Skip command-like statements (starting with specific command words)
      if (/^(please|could you|can you|tell me|show me|help me|give|list|show)/i.test(trimmedContent)) {
        autoCaptureStats.trueNegatives++;
        console.log('[lobstermind:auto-capture] ⚙️ Skipped: appears to be a command');
        return false;
      }
      
      // Skip greetings and pleasantries (but be more restrictive than before)
      if (/^($|hi|hello|hola|hey|good morning|buenos días|gracias|thanks|thank you|please|i see|ok|okay|sure|umm|ah|oh)$/i.test(trimmedContent.toLowerCase().replace(/[.,!?]/g, ''))) {
        autoCaptureStats.trueNegatives++;
        console.log('[lobstermind:auto-capture] 💬 Skipped: appears to be a greeting or pleasantries');
        return false;
      }
      
      // Contextual enhancement: if there's topic overlap with recent conversation
      // and the content is meaningful, increase likelihood of capture
      const isMeaningfulWithContext = trimmedContent.length > 15 && hasContextualRelevance;
      
      // Check if the content includes meaningful personal information
      // Look for indicators of personal info in Spanish/English
      const personalInfoPatterns = [
        /soy |I am |I'm |me llamo |my name is |I go by |I use |I prefer |adore |prefiero |I work |trabajo |I live |vivo |I studied |I studied at /i,
        /mi nombre es |I am from |soy de |from |I support |soy fan |fan de |I'm a supporter |I am a fan |afición a |pasión por |me apasiona |interés en /i,
        /I decided |decidí |elegí |mi rutina es |hábitos diarios |always eat |almuerzo /i
      ];
      
      let hasPersonalInfo = false;
      for (const pattern of personalInfoPatterns) {
        if (pattern.test(trimmedContent)) {
          hasPersonalInfo = true;
          break;
        }
      }
      
      if (!hasPersonalInfo) {
        // Additional check for valuable statements that don't match obvious patterns
        const contentLower = trimmedContent.toLowerCase();
        const valuableIdentifiers = ['soy de', 'trabajo en', 'me llamo', 'mi nombre', 'mi hobby', 'soy fan', 'soy hincha', 'I am from', 'I work at', 'mi profesión', 'mi trabajo', 'mi posición', 'I live in', 'vivo en'];
        hasPersonalInfo = valuableIdentifiers.some(identifier => contentLower.includes(identifier.toLowerCase()));
      }
      
      // Consider both personal info detection and contextual relevance
      const shouldCheckClassification = hasPersonalInfo || isMeaningfulWithContext;
      
      if (shouldCheckClassification) {
        console.log('[lobstermind:auto-capture] 🎯 Identified potential personal info or contextual relevance, checking with classifier...');
        
        // Use the improved classifier
        const classified = classifyMemoryContent(content);
        if (classified.shouldSave) {
          console.log(`[lobstermind:auto-capture] ✅ Auto-captured [${classified.type}] (confidence: ${classified.confidence.toFixed(2)}, contextual: ${isMeaningfulWithContext}): ${classified.content.substring(0, 80)}...`);
          save(classified.content, classified.type, classified.confidence);
          autoCaptureStats.totalCaptured++;
          autoCaptureStats.truePositives++;
          autoCaptureStats.lastCaptureTime = new Date().toISOString();
          return true;
        } else {
          // This might have been a legitimate piece of info, but classifier rejected it - potential misclassification
          autoCaptureStats.falseNegatives++;
          console.log('[lobstermind:auto-capture] ❌ Classifier decided not to save (potential false negative)');
          return false;
        }
      } else {
        autoCaptureStats.trueNegatives++;  // Correctly ignored non-personal information
        console.log('[lobstermind:auto-capture] ℹ️ Skipped: no personal info detected and no contextual relevance');
        return false;
      }
    };
    
    // Define memory content classifier with enhanced logging
    function classifyMemoryContent(rawContent: string): { content: string, type: string, confidence: number, shouldSave: boolean } {
      // Remove special tags and normalize
      const cleanContent = rawContent.replace(/<[\/]?memory_note[^>]*>/g, '').trim();
      
      console.log(`[classifier] Analyzing: "${cleanContent.substring(0, 100)}..."`);
      
      // Extra validation to make sure we are not saving sensitive data that slipped past the initial filters
      if (isSensitiveData(cleanContent)) {
        console.log(`[classifier] 🚨 BLOCKED: Sensitive data detected in content "${cleanContent.substring(0, 50)}..."`);
        return {
          content: cleanContent,
          type: 'SENSITIVE_BLOCKED',
          confidence: 1.0,
          shouldSave: false
        };
      }
      
      // Extract important phrases for classification instead of strict regex
      const lowerContent = cleanContent.toLowerCase();
      const normalizedContent = lowerContent.replace(/\b(the|a|an|un|una|el|la|los|las|en|con|de|del|de\s+la|to|with|my|his|her|me|him|her|i|you|we|they)\b/gi, ' ').trim();
      
      console.log(`[classifier] Normalized: "${normalizedContent.substring(0, 100)}..."`);
      
      // Multi-lang patterns for detection 
      const patterns: { regex: RegExp, type: string, confidence: number, desc: string }[] = [
        // PREFERENCES (likes/dislikes in multiple languages)
        { 
          regex: /(like|love|adore|prefer|enjoy|gusta|amo|adoro|prefiero|me gusta la|me encanta|detesto|odio|no gusto|no me gusta|nunca)/i, 
          type: 'PREFERENCE', 
          confidence: 0.95,
          desc: 'preferences'
        },
        // PERSONAL FACTS (identity in multiple languages)
        { 
          regex: /\b(I\s+am|I'm|soy|yo\s+soy|mi\s+nombre\s+es|llamo|trabajo\s+en|works\s+at|work\s+for|job|posición|cargo|profesión|posicion|position|empleo|vivo\s+en|live\s+in|habito|resido|estudio|study|learning|learn|aprendiendo|fan\s+of|supporter|soy\s+de|cumpleaños|birthday|nací|nacio|born|cumple|mi\s+lugar\s+de\s+nacimiento|birthplace|edad|age|hobbies|activities|activity|pasatiempos|intereses)/i, 
          type: 'USER_FACT', 
          confidence: 0.90,
          desc: 'personal facts'
        },
        // CONTACT INFO (should NOT be saved due to privacy)
        { 
          regex: /(@|phone|teléfono|móvil|celular|email|correo|dirección|address|tel\s*:|fax\s*:|contact\s*:)/i, 
          type: 'CONTACT_INFO', 
          confidence: 0.99,
          desc: 'contact info (sensitive)'
        },
        // DECISIONS/TIMELINE (choices in multiple languages)
        { 
          regex: /\b(decidí|decid|elegí|elig|tomé|took|chose|opté|opt|picked|select|choice|decision|since|desde|durante|por\s+más\s+de|for\s+more\s+than|I started|comencé|empezar|tiempo\s+que\s+llev|llev|llevo\s+)/i, 
          type: 'DECISION', 
          confidence: 0.90,
          desc: 'decisions'
        },
        // HABITS/ROUTINES (patterns that suggest regular activities)
        { 
          regex: /\b(todos\s+los\s+días|every\s+day|daily|habitualmente|siempre|usualmente|regular|constantemente|routinely|normally|generally|me\s+llevo\s+mi|always\s+have|usually\s+takes|normalmente\s+hago|generalmente\s+tomo|siempre\s+que|cada\s+vez\s+que)/i, 
          type: 'HABIT', 
          confidence: 0.85,
          desc: 'habits and routines'
        },
        // EDUCATION/STUDIES
        { 
          regex: /\b(studied|\s+studying|\s+learned\b|education|school|university|college|graduated|formation|estudié|estudio|aprendí|formación|escuela|universidad|instituto|carrera|cursando|matriculado|cursada|aulas|clases)/i, 
          type: 'EDUCATION', 
          confidence: 0.85,
          desc: 'education'
        },
        // WORK/HISTORY
        { 
          regex: /\b(empresa|company|trabajo\s+anterior|experiencia|\s+worked\s+at|colleague|coworker|boss|manager|jefe|compañero|project|cliente|cliente|sales|ventas|marketing|ingenier|developer|engineer|position|rol|función|cargo|departamento|department|team)/i, 
          type: 'WORK_HISTORY', 
          confidence: 0.85,
          desc: 'work history'
        },
        // TECH/WORK DETAILS
        { 
          regex: /\b(used|working|developing|building|coded|programming|coded\s+with|writing\s+in|create|created|built|made|desarrollando|trabajando|usé|utiliz|programe|programé|uso|creando|construyendo|react|javascript|typescript|python|java|node|express|angular|vue|backend|frontend|fullstack|web\s+development|mobile\s+development|api|rest|graphql|database|sql|mongo|firebase|docker|kubernetes|aws|azure|cloud|machine\s+learning|ai|artificial\s+intelligence|mlops|devops)/i, 
          type: 'TECH_SKILL', 
          confidence: 0.80,
          desc: 'technical skills and details'
        },
        // RELATIONSHIPS/FRIENDSHIP INFO
        { 
          regex: /\b(mi\s+papá|mi\s+mamá|padre|madre|hermano|hermana|cónyuge|esposo|esposa|novio|novia|pareja|relación|friend|amigo|amiga|amigos|amiguitos|compañeros|mates|familia|fam|son|daughter|wife|husband|boyfriend|girlfriend|children|kids)/i, 
          type: 'RELATIONSHIP', 
          confidence: 0.80,
          desc: 'relationships'
        },
        // IMPORTANT NUMBERS/PIN CODES (should NOT be saved)
        { 
          regex: /\bpin\s*:|clave\s+:|code\s*:|password\s*:|contraseña\s+:|123456|0000|1111|2222|3333|4444|5555|6666|7777|8888|9999|\d{4}\s+\d{4}\s+\d{4}\s+\d{4}|\d{16}\b/i, 
          type: 'SECURITY_PIN', 
          confidence: 0.99,
          desc: 'security codes (sensitive)'
        },
      ];
      
      // Scan for pattern matches
      for (const { regex, type, confidence, desc } of patterns) {
        if (regex.test(normalizedContent)) {
          // Block sensitive info patterns
          if (type === 'CONTACT_INFO' || type === 'SECURITY_PIN') {
            console.log(`[classifier] 🚨 BLOCKED ${desc} -> Type: ${type}, Confidence: ${confidence}`);
            return {
              content: cleanContent,
              type: type,
              confidence: confidence,
              shouldSave: false
            };
          }
          
          console.log(`[classifier] MATCHED ${desc} pattern -> Type: ${type}, Confidence: ${confidence}`);
          return {
            content: cleanContent,
            type: type,
            confidence: confidence,
            shouldSave: true
          };
        }
      }
      
      // More specific identity patterns including those in your example
      if (cleanContent.length >= 20 && !cleanContent.includes('?') && 
          (lowerContent.includes('i ') || lowerContent.includes('i\'') || lowerContent.includes(' mi ') || 
           lowerContent.includes(' soy ') || lowerContent.includes(' trabajo ') || lowerContent.includes(' vivo ') ||
           lowerContent.includes(' me llamo ') || lowerContent.includes(' mi hobby ') || lowerContent.includes(' pasatiempos '))) {
        console.log(`[classifier] GENERAL IDENTITY statement detected -> Type: USER_FACT, Confidence: 0.75`);
        return {
          content: cleanContent,
          type: 'USER_FACT',
          confidence: 0.75,  // Medium-high confidence for identity statements
          shouldSave: true
        };
      }
      
      // Additional identity pattern fallback (generic, no hardcoded references)
      if (cleanContent.length >= 20 && !cleanContent.includes('?') && 
          (lowerContent.includes('team') || lowerContent.includes('equipo') || lowerContent.includes('club') || lowerContent.includes('sport') || lowerContent.includes('deporte'))) {
        console.log(`[classifier] SPORTS/TEAM identity detected -> Type: USER_FACT, Confidence: 0.85`);
        return {
          content: cleanContent,
          type: 'USER_FACT',
          confidence: 0.85,
          shouldSave: true
        };
      }
      
      // Don't save if not meaningful
      console.log(`[classifier] ❌ No meaningful pattern matched for: "${cleanContent.substring(0, 50)}..."`);
      return {
        content: cleanContent,
        type: 'IGNORE',
        confidence: 0.0,
        shouldSave: false
      };
    } 

    // Enhanced hook registration for memory detection - Adapting to OpenClaw's system
    if (api.hooks?.onMessageCreate || api.hooks?.afterMessage) {
      // Use proper OpenClaw hook if available - with preference for afterMessage for final processed content
      const messageHook = api.hooks?.afterMessage || api.hooks?.onMessageCreate;
      const hookName = api.hooks?.afterMessage ? 'afterMessage' : 'onMessageCreate';
      
      messageHook((message: any, ctx: any) => {
        console.log(`[lobstermind] ${hookName} hook triggered. Content: ${typeof message?.content === 'string' ? message.content.substring(0, 100) : 'non-string content'}`);
        
        if (message?.role === 'user' && message?.content) {
          const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
          
          // Check for Gigabrain memory note protocol in user messages
          if (content.includes('<memory_note>') && content.includes('</memory_note>')) {
            console.log('[lobstermind] Detected Gigabrain memory_note protocol');
            extractMemoryFromNoteTags(content).forEach(memory => {
              save(memory.content, memory.type, memory.confidence);
            });
          }
          
          // Process for automatic capture using the new system
          processUserInputForMemory(content);
        }
      });
    } else if (api.hooks?.conversationParticipantInput) {
      // Hook specifically for participant input (as suggested in your request)
      api.hooks.conversationParticipantInput((input: string | any, context: any) => {
        console.log(`[lobstermind] conversationParticipantInput hook triggered. Input: ${typeof input === 'string' ? input.substring(0, 100) : 'non-string input'}`);
        
        const content = typeof input === 'string' ? input : (input?.content || JSON.stringify(input || ''));
        if (content && typeof content === 'string') {
          // Check for Gigabrain memory note protocol
          if (content.includes('<memory_note>') && content.includes('</memory_note>')) {
            console.log('[lobstermind] Detected Gigabrain memory_note in participant input');
            extractMemoryFromNoteTags(content).forEach(memory => {
              save(memory.content, memory.type, memory.confidence);
            });
          } 
          else {
            // Process for automatic capture
            processUserInputForMemory(content);
          }
        }
      });
    } else if (api.on) {
      // Use OpenClaw's typed lifecycle hooks via api.on()
      console.log('[lobstermind] Registering lifecycle hooks via api.on()');
      
      // Hook into before_prompt_build to capture user messages
      api.on('before_prompt_build', (event: any, ctx: any) => {
        try {
          const messages = ctx?.messages || event?.messages || [];
          
          // Check BOTH user and assistant messages for memory_note tags
          messages.forEach((msg: any) => {
            const content = typeof msg.content === 'string' 
              ? msg.content 
              : JSON.stringify(msg.content);
            
            // Check for Gigabrain memory note protocol in any message
            if (content.includes('<memory_note>') && content.includes('</memory_note>')) {
              console.log(`[lobstermind] Detected Gigabrain memory_note in ${msg.role} message`);
              extractMemoryFromNoteTags(content).forEach(memory => {
                save(memory.content, memory.type, memory.confidence);
              });
            }
          });
          
          // Process last user message for auto-capture
          const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop();
          if (lastUserMessage?.content) {
            const content = typeof lastUserMessage.content === 'string' 
              ? lastUserMessage.content 
              : JSON.stringify(lastUserMessage.content);
            
            if (!content.includes('<memory_note>')) {
              processUserInputForMemory(content);
            }
          }
        } catch (err: any) {
          console.error('[lobstermind] Error in before_prompt_build hook:', err.message);
        }
        
        // Return empty modifications - we just want to observe
        return {};
      }, { priority: 10 });
      
      console.log('[lobstermind] Registered lifecycle hook: before_prompt_build');
    } else {
      console.log('[lobstermind] No hook registration method available - memory capture disabled');
    }
    
    // Helper function to handle various content sources
    function processContentForMemory(content: string) {
      if (content && typeof content === 'string') {
        // Check for Gigabrain memory note protocol
        if (content.includes('<memory_note>') && content.includes('</memory_note>')) {
          console.log('[lobstermind] Detected Gigabrain memory_note protocol in event');
          extractMemoryFromNoteTags(content).forEach(memory => {
            save(memory.content, memory.type, memory.confidence);
          });
        } else {
          // Process for automatic capture
          processUserInputForMemory(content);
        }
      }
    }
    
    // Helper function to extract memories from Gigabrain-style <memory_note> tags
    function extractMemoryFromNoteTags(content: string): Array<{content: string, type: string, confidence: number}> {
      const results: Array<{content: string, type: string, confidence: number}> = [];
      
      // First, try to extract text from JSON format [{type:"text", text:"..."}]
      let textContent = content;
      try {
        // Handle OpenClaw message format: [{type:"text", text:"..."}]
        if (content.startsWith('[') || content.startsWith('[{')) {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            textContent = parsed.map((item: any) => item.text || item.content || '').join(' ');
          } else if (parsed.text) {
            textContent = parsed.text;
          }
        }
      } catch (e) {
        // If parsing fails, use content as-is
        console.log('[lobstermind] Content is not JSON, using as-is');
      }
      
      // Now search for memory_note tags in the extracted text
      const notePattern = /<memory_note(?:\s+type=["']([A-Z_]+)["'])?(?:\s+confidence=["'](\d*\.?\d+)["'])?\s*>(.*?)<\/memory_note>/gis;
      let match;
      while ((match = notePattern.exec(textContent)) !== null) {
        const type = match[1] || 'USER_FACT';
        const confidenceStr = match[2] || '0.9';
        const extractedContent = match[3]?.trim() || '';
        
        if (extractedContent) {
          results.push({
            content: extractedContent,
            type: type,
            confidence: parseFloat(confidenceStr) || 0.9
          });
        }
      }
      
      console.log(`[lobstermind] Extracted ${results.length} memories from <memory_note> tags`);
      if (results.length > 0) {
        console.log('[lobstermind] Extracted memories:', results);
      }
      return results;
    }
    
    // Add recall functionality with hooks that might be better supported by OpenClaw
    if (typeof api.hooks?.onPromptPrepare === 'function') {
      api.hooks.onPromptPrepare((ctx: any) => {
        recallAndInjectMemories(ctx);
      });
    } else if (typeof api.hooks?.beforeRequest === 'function') {
      api.hooks.beforeRequest((ctx: any) => {
        recallAndInjectMemories(ctx);
      });
    } else if (typeof api.hooks?.enhancePrompt === 'function') {
      api.hooks.enhancePrompt((ctx: any) => {
        recallAndInjectMemories(ctx);
      });
    } else {
      // For recall, try to use only established OpenClaw hooks instead of generic event names
      // Use proper api.hooks patterns
      if (typeof api.hooks?.beforeResponse === 'function') {
        api.hooks.beforeResponse((ctx: any) => {
          console.log('[lobstermind] Recall trigger: beforeResponse');
          recallAndInjectMemories(ctx);
        });
        console.log('[lobstermind] Registered recall hook for beforeResponse');
      } else if (typeof api.hooks?.beforePrompt === 'function') {
        api.hooks.beforePrompt((ctx: any) => {
          console.log('[lobstermind] Recall trigger: beforePrompt');
          recallAndInjectMemories(ctx);
        });
        console.log('[lobstermind] Registered recall hook for beforePrompt');
      }
    }

    // Central recall function that handles memory injection
    function recallAndInjectMemories(ctx: any) {
      try {
        console.log('[lobstermind] 🧠 Starting recall process');
        
        // Find the most recent user message to use as query
        let messages = [];
        
        if (ctx?.messages) {
          messages = ctx.messages;
        } else if (ctx?.request?.messages) {
          messages = ctx.request.messages;
        } else if (ctx?.conversation?.messages) {
          messages = ctx.conversation.messages;
        } else if (ctx?.state?.messages) {
          messages = ctx.state.messages;
        }
        
        if (!messages || messages.length === 0) {
          console.log('[lobstermind] No messages found for recall');
          return;
        }
        
        // Get relevant user messages (last few user messages as queries)
        const userMessages = messages.filter((m: any) => m?.role === 'user' && m?.content).slice(-3);
        
        if (userMessages.length > 0) {
          // Use the most recent user message as the primary query
          const lastUserMessage = userMessages[userMessages.length - 1];
          const userQuery = typeof lastUserMessage.content === 'string' 
            ? lastUserMessage.content 
            : JSON.stringify(lastUserMessage.content || '');
            
          if (userQuery.length < 5) {
            console.log('[lobstermind] Query too short for recall');
            return;
          }
          
          console.log(`[lobstermind] 🔎 Recalling memories for query: "${userQuery.substring(0, 100)}"`);
          
          // Find relevant memories
          const relevantMemories = search(userQuery, 5);
          
          if (relevantMemories.length > 0) {
            console.log(`[lobstermind] 🧠 Found ${relevantMemories.length} relevant memories`);
            
            // Construct memory note
            const memoryNote = `\n<memory_note>\n### MEMORY NOTE (${new Date().toISOString()}):\n${relevantMemories.map((mem: any, idx: number) => `${idx + 1}. [${mem.type}] ${mem.content} (confidence: ${Number(mem.score).toFixed(3)})`).join('\n')}\n</memory_note>`;
            
            // Try various methods to inject the memory in different contexts
            if (ctx?.prepends) {
              ctx.prepends.push({ role: 'system', content: memoryNote });
              console.log('[lobstermind] Added memory to ctx.prepends');
            } else if (ctx?.injects) {
              ctx.injects.push({ type: 'memory', content: memoryNote });
              console.log('[lobstermind] Added memory to ctx.injects');
            } else if (ctx?.augments) {
              ctx.augments.push({ role: 'system', content: memoryNote });
              console.log('[lobstermind] Added memory to ctx.augments');
            } else if (messages && Array.isArray(messages)) {
              messages.unshift({ role: 'system', content: memoryNote });
              console.log('[lobstermind] Added memory to beginning of messages array');
            } else {
              console.log('[lobstermind] Could not inject memory - no suitable target found');
            }
            
            console.log('[lobstermind] ✅ Memory recall completed');
          } else {
            console.log('[lobstermind] 🌀 No relevant memories found for recall');
          }
        } else {
          console.log('[lobstermind] No user messages found for recall trigger');
        }
      } catch (error) {
        console.error('[lobstermind] Error in recall function:', error instanceof Error ? error.message : String(error));
      }
    }
    
    // Register CLI commands 
    if (api.registerCli) {
      api.registerCli(
        ({program}: any) => {
          const c = program.command('memories').description('LobsterMind CLI');
          c.command('list').option('--limit <n>','Max','20').action((o:any)=>{const r=db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?').all(parseInt(o.limit)||20);console.log('Memories:',r.length);r.forEach((m:any,i:number)=>console.log((i+1)+'. ['+m.type+'] '+m.content));});
          c.command('add <content>').action((s:string)=>{try{console.log('ID:',save(s));}catch(e:any){console.error('Error:',e.message);}});
          c.command('search <query>').action(async(q:string)=>{const r=search(q);console.log('Found:',r.length);r.forEach((m:any,i:number)=>console.log((i+1)+'. '+m.content+' ('+m.score.toFixed(2)+')'));});
          c.command('stats').action(()=>{const t=db.prepare('SELECT COUNT(*) as c FROM memories').get()as any;console.log('Total:',t.c);});
          c.command('backup').action(()=>{const d=join(openclawDir,'memory','backups');if(!existsSync(d))mkdirSync(d,{recursive:true});const p=join(d,'backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');writeFileSync(p,JSON.stringify(db.prepare('SELECT * FROM memories').all(),null,2));console.log('Backup:',p);});
          // Add command for auto-capture stats
          c.command('autostats').action(()=>{console.log('Auto-capture Statistics:'); console.log('Total processed:', autoCaptureStats.totalProcessed); console.log('Total captured:', autoCaptureStats.totalCaptured); console.log('Success rate:', autoCaptureStats.totalProcessed > 0 ? (autoCaptureStats.totalCaptured/autoCaptureStats.totalProcessed*100).toFixed(1)+'%' : 'N/A'); console.log('Last capture:', autoCaptureStats.lastCaptureTime || 'Never'); console.log('True Positives:', autoCaptureStats.truePositives); console.log('True Negatives:', autoCaptureStats.trueNegatives); console.log('False Positives:', autoCaptureStats.falsePositives); console.log('False Negatives:', autoCaptureStats.falseNegatives); const precision = (autoCaptureStats.truePositives > 0) ? (autoCaptureStats.truePositives / (autoCaptureStats.truePositives + autoCaptureStats.falsePositives)).toFixed(3) : 'N/A'; const recall = (autoCaptureStats.truePositives > 0) ? (autoCaptureStats.truePositives / (autoCaptureStats.truePositives + autoCaptureStats.falseNegatives)).toFixed(3) : 'N/A'; console.log('Precision:', precision); console.log('Recall:', recall); console.log('Context window size:', conversationContext.recentInputs.length); console.log('Context awareness active:', conversationContext.timestamps.length > 0);});
          // Add command to view clusters
          c.command('clusters').option('--min-size <n>', 'Minimum cluster size', '1').action((o: any) => {
            const minSize = parseInt(o.minSize) || 1;
            const clusters = db.prepare(`SELECT c.*, COUNT(cm.memory_id) as member_count FROM memory_clusters c LEFT JOIN cluster_members cm ON c.cluster_id = cm.cluster_id GROUP BY c.cluster_id HAVING member_count >= ?`).all(minSize) as any[];
            
            console.log(`Clusters (minimum size: ${minSize}): ${clusters.length}`);
            clusters.forEach((cluster: any, i: number) => {
              console.log(`${i+1}. ${cluster.name} (${cluster.member_count} memories)`);
              console.log(`   Description: ${cluster.description}`);
              
              // Show sample memories from the cluster
              const sampleMemories = db.prepare(`
                SELECT m.content, m.type, cm.similarity_score 
                FROM cluster_members cm 
                JOIN memories m ON cm.memory_id = m.id 
                WHERE cm.cluster_id = ? 
                ORDER BY cm.similarity_score DESC 
                LIMIT 3
              `).all(cluster.cluster_id) as any[];
              
              sampleMemories.forEach(mem => {
                console.log(`   • [${mem.type}] ${mem.content.substring(0, 100)}... (sim: ${mem.similarity_score.toFixed(2)})`);
              });
            });
          });
          // Add command to show memories by cluster
          c.command('cluster <cluster-id>').action((clusterId: string) => {
            const cluster = db.prepare('SELECT * FROM memory_clusters WHERE cluster_id = ?').get(clusterId) as any;
            if (!cluster) {
              console.log('Cluster not found');
              return;
            }
            
            console.log(`Cluster: ${cluster.name}`);
            console.log(`Description: ${cluster.description}`);
            
            const members = db.prepare(`
              SELECT m.*, cm.similarity_score 
              FROM cluster_members cm 
              JOIN memories m ON cm.memory_id = m.id 
              WHERE cm.cluster_id = ? 
              ORDER BY cm.similarity_score DESC
            `).all(clusterId) as any[];
            
            console.log(`Members (${members.length}):`);
            members.forEach((member: any, i: number) => {
              console.log(`${i+1}. [${member.type}] ${member.content} (sim: ${member.similarity_score.toFixed(2)})`);
            });
          });
        },
        {commands: ['memories']}
      );
      console.log('[lobstermind] CLI ready');
    }
    
    return {name:'lobstermind-memory',version:'1.0.0'};
  }
};