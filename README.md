# 🦞 LobsterMind Memory v2.0

Plugin de memoria de largo plazo para OpenClaw con **embeddings configurables**, búsqueda semántica, clustering automático y sync a Obsidian.

---

## ✨ Características

- 🔌 **Multi-provider de embeddings**: Gemini (API), Ollama (local), Transformers.js (local), SHA256 (fallback)
- 🧠 **Búsqueda semántica real**: Cosine similarity sobre embeddings de alta dimensión
- 🗂️ **Clustering automático**: Agrupa memorias por tema con nombres temáticos
- 🔗 **Relaciones bidireccionales**: Conecta memorias similares automáticamente
- 📓 **Sync dual**: Obsidian + MEMORY.md nativo
- 🛡️ **Filtro de sensibles**: Bloquea emails, tarjetas, passwords, etc.
- 🤖 **Auto-capture**: Detecta y guarda información personal automáticamente
- 📊 **CLI completo**: Comandos para gestionar memorias, clusters, backups
- ⚡ **Caching inteligente**: Embedding cache + search cache con TTL

---

## 🚀 Instalación

### 1. Clonar el plugin

```bash
git clone https://github.com/pnll1991/lobstermind-memory.git
cd lobstermind-memory
npm install
```

### 2. Elegir Provider de Embeddings

El plugin soporta **4 providers**. Elegí uno según tus necesidades:

| Provider | Tipo | Dimensiones | Velocidad | Costo | Requiere |
|----------|------|-------------|-----------|-------|----------|
| **Gemini** | API | 3072 | ⚡⚡⚡ Rápido | Gratis (rate limits) | API Key |
| **Ollama** | Local | 768-1024 | ⚡⚡ Medio | Gratis | Ollama instalado |
| **Transformers.js** | Local | 384 | ⚡ Lento (1ra vez) | Gratis | Descarga modelo (única) |
| **SHA256** | Fallback | 384 | ⚡⚡⚡⚡ Instant | Gratis | Nada |

---

## ⚙️ Configuración

### Opción A: Gemini (RECOMENDADO)

**Ventajas:** Embeddings de alta calidad (3072 dims), rápido, gratis hasta cierto límite.

```json
{
  "embeddingProvider": "gemini",
  "geminiApiKey": "TU_API_KEY_AQUI",
  "geminiModel": "gemini-embedding-2-preview"
}
```

**Obtener API Key:** https://aistudio.google.com/app/apikey

---

### Opción B: Ollama (100% Local)

**Ventajas:** Privacidad total, sin dependencias externas, rápido después de la 1ra vez.

**Requisitos:**
1. Instalar Ollama: https://ollama.ai
2. Descargar modelo de embeddings:
   ```bash
   ollama pull nomic-embed-text
   ```

**Configuración:**
```json
{
  "embeddingProvider": "ollama",
  "ollamaUrl": "http://localhost:11434",
  "ollamaModel": "nomic-embed-text"
}
```

**Modelos recomendados:**
- `nomic-embed-text` (768 dims, rápido)
- `mxbai-embed-large` (1024 dims, mejor calidad)
- `all-minilm` (384 dims, ligero)

---

### Opción C: Transformers.js (100% Local, sin dependencias)

**Ventajas:** No requiere servicios externos ni instalaciones adicionales.

**Configuración:**
```json
{
  "embeddingProvider": "transformers",
  "transformersModel": "Xenova/all-MiniLM-L6-v2"
}
```

**Nota:** La primera vez descarga el modelo (~80MB). Luego es offline.

**Modelos disponibles:**
- `Xenova/all-MiniLM-L6-v2` (384 dims, balanceado)
- `Xenova/all-MiniLM-L12-v2` (384 dims, mejor calidad)
- `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (multilenguaje)

---

### Opción D: SHA256 (SOLO TESTING)

**⚠️ NO SEMÁNTICO** - Solo para debugging. "perro" y "canino" tendrán vectores distintos.

```json
{
  "embeddingProvider": "sha256"
}
```

---

## 📖 Configuración Completa

```json
{
  "enabled": true,
  
  // Provider de embeddings
  "embeddingProvider": "gemini",
  "geminiApiKey": "TU_API_KEY",
  "geminiModel": "gemini-embedding-2-preview",
  
  // Ollama (si usás ollama)
  "ollamaUrl": "http://localhost:11434",
  "ollamaModel": "nomic-embed-text",
  
  // Transformers.js (si usás transformers)
  "transformersModel": "Xenova/all-MiniLM-L6-v2",
  
  // Búsqueda
  "searchThreshold": 0.3,
  "searchLimit": 8,
  
  // Clustering
  "clusterThreshold": 0.6,
  
  // Auto-capture
  "autoCaptureEnabled": true,
  
  // Sync
  "obsidianSyncEnabled": true,
  "nativeSyncEnabled": true
}
```

---

## 📚 Comandos CLI

```bash
# Listar memorias
openclaw memories list --limit 20

# Buscar semánticamente
openclaw memories search "trabajo en tecnología"

# Agregar memoria manual
openclaw memories add "Trabajo como desarrollador fullstack"

# Ver estadísticas
openclaw memories stats

# Ver stats de embeddings
openclaw memories embeddings

# Ver clusters
openclaw memories clusters --min-size 2

# Backup
openclaw memories backup

# Clear cache
openclaw memories clear-cache

# Ver provider actual
openclaw memories provider
```

---

## 🧠 Auto-Capture

El plugin detecta automáticamente información personal como:

- ✅ **Preferencias**: "Me gusta Boca", "Amo el asado"
- ✅ **Datos personales**: "Soy de Buenos Aires", "Trabajo en Google"
- ✅ **Hábitos**: "Todos los días voy al gimnasio"
- ✅ **Educación**: "Estudié Ingeniería en MIT"
- ✅ **Trabajo**: "Trabajo como desarrollador React"
- ✅ **Relaciones**: "Mi hermano vive en España"

**Bloquea automáticamente:**
- 🚫 Emails
- 🚫 Teléfonos
- 🚫 Tarjetas de crédito
- 🚫 Passwords/tokens
- 🚫 Direcciones IP
- 🚫 Wallets de cripto

---

## 📓 Obsidian Sync (MEJORADO v2.1)

Las memorias se sincronizan a:
```
workspace/obsidian-vault/LobsterMind/Memories.md
```

### ✨ Mejoras

- 🔒 **File locking** → Evita race conditions cuando se guardan múltiples memorias
- 🔐 **Hash único** → Cada memoria tiene un hash SHA256 para deduplicación exacta
- 📋 **Frontmatter YAML** → Metadata para Obsidian (tags, total, fechas)
- 🔄 **Sync bidireccional** → Importá cambios desde Obsidian a la DB
- 📅 **Organización por fecha** → Agrupa automáticamente por día

### Formato del Archivo

```markdown
---
title: Memories
created: 2026-03-18T15:00:00.000Z
modified: 2026-03-18T18:30:00.000Z
plugin: LobsterMind Memory
total_memories: 42
---

# Memories

Auto-created by LobsterMind Memory plugin

## [[2026-03-18]]

- [USER_FACT] Soy de Buenos Aires (confidence: 0.90) <!-- a3f2b8c1 -->
- [PREFERENCE] Me gusta Boca (confidence: 0.95) <!-- 7d4e9f2a -->

## [[2026-03-17]]

- [WORK_HISTORY] Trabajo como desarrollador fullstack (confidence: 0.85) <!-- 1c8b5e3d -->
```

### Comandos de Obsidian

```bash
# Ver estado del sync
openclaw memories obsidian-status

# Importar cambios desde Obsidian (bidireccional)
openclaw memories sync-obsidian
```

### Sync Bidireccional

Si editás manualmente el archivo `Memories.md` en Obsidian:

1. Editá el archivo en Obsidian (agregá, modificá o eliminá memorias)
2. Ejecutá `openclaw memories sync-obsidian`
3. Los cambios se importarán a la DB SQLite

**Nota:** Las memorias importadas deben tener el formato:
```
- [TIPO] Contenido (confidence: 0.XX) <!-- hash -->
```

---

## 🔧 Troubleshooting

### Gemini API no funciona
```
Error: Gemini API key no configurada
```
**Solución:** Seteá `geminiApiKey` en config o `GEMINI_API_KEY` como env var.

### Ollama no responde
```
Error: Ollama error (ECONNREFUSED)
```
**Solución:** 
1. Verificá que Ollama esté corriendo: `ollama list`
2. Checkeá la URL: `http://localhost:11434`
3. Probá: `curl http://localhost:11434/api/tags`

### Transformers.js no carga
```
Error: Cannot find module '@xenova/transformers'
```
**Solución:** 
```bash
npm install @xenova/transformers
```

### Búsqueda no encuentra nada
**Posibles causas:**
1. Threshold muy alto → Bajá `searchThreshold` a 0.2
2. Embeddings SHA256 → Usá Gemini/Ollama/Transformers
3. No hay memorias → Agregá algunas con `memories add`

---

## 📊 Performance

| Provider | 1ra embedding | Cache hit | Dimensões | Calidad |
|----------|---------------|-----------|-----------|---------|
| Gemini | ~200ms | <1ms | 3072 | ⭐⭐⭐⭐⭐ |
| Ollama | ~50ms | <1ms | 768 | ⭐⭐⭐⭐ |
| Transformers | ~5s* | <1ms | 384 | ⭐⭐⭐ |
| SHA256 | <1ms | <1ms | 384 | ❌ |

*Primera vez descarga modelo

---

## 🤝 Contribuir

1. Fork el repo
2. Creá una branch (`git checkout -b feature/nueva`)
3. Commit (`git commit -m 'Add nueva feature'`)
4. Push (`git push origin feature/nueva`)
5. Abrí un PR

---

## 📝 Changelog

### v2.2.0 (2026-03-18) - Security & Performance improvements

#### 🔒 Security
- ✅ **API key en body** → Movida de URL a request body (Gemini)
- ✅ **Timeout en fetches** → 30s timeout para Gemini y Ollama
- ✅ **Límite de contenido** → Máximo 10KB por memoria (evita DB bloat)

#### ⚡ Performance
- ✅ **Cache cleanup automático** → Limpieza horaria de caches expirados (embedding + search)
- ✅ **Lock file cleanup** → Ahora usa `statSync` con `mtimeMs` (funciona correctamente!)

#### 🐛 Bugfixes
- ✅ **Frontmatter count** → Ahora cuenta solo memorias válidas (regex por línea)
- ✅ **Error messages** → Truncadas a 100 chars (evita logs gigantes)

#### 🆕 Features
- ✅ **Comando `vacuum`** → Optimiza la DB y libera espacio (`openclaw memories vacuum`)

### v2.1.2 (2026-03-18) - Bugfix Release

### v2.1.1 (2026-03-18) - Bugfix Release
- 🐛 **FIX:** Variable `embeddingProvider` duplicada (shadowing bug)
- 🐛 **FIX:** Frontmatter YAML no se actualizaba correctamente
- 🐛 **FIX:** Lock file huérfano no se limpiaba (agregado cleanup)
- 🐛 **FIX:** Regex de `sync-obsidian` no manejaba paréntesis en contenido
- 🐛 **FIX:** Error handling mejorado en sync-obsidian

### v2.1.0 (2026-03-18) - Obsidian Sync Mejorado
- ✅ File locking para evitar race conditions
- ✅ Hash SHA256 para deduplicación exacta
- ✅ Frontmatter YAML con metadata
- ✅ Sync bidireccional (Obsidian → DB)
- ✅ Organización automática por fechas
- ✅ Comando `obsidian-status` para verificar sync
- ✅ Comando `sync-obsidian` para importar cambios

### v2.0.0
- ✅ Multi-provider de embeddings (Gemini, Ollama, Transformers.js)
- ✅ Stats de embeddings por provider
- ✅ Fallback automático si falla el provider
- ✅ Configuración granular por provider
- ✅ CLI mejorado con comandos nuevos
- ✅ Error handling en todas las operaciones DB
- ✅ Validación de configuración al startup
- ✅ Health check con `doctor` command

### v1.0.0
- ✅ SQLite storage
- ✅ Búsqueda semántica
- ✅ Clustering automático
- ✅ Obsidian sync
- ✅ Auto-capture

---

## 📄 License

MIT

---

**Hecho con 🦞 por [@pnll1991](https://github.com/pnll1991)**
