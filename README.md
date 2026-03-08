# LobsterMind Memory

Long-term memory plugin for OpenClaw. SQLite-based storage with semantic search, automatic deduplication, and cloud backup support.

**Author:** Paolozky  
**Version:** 1.0.0  
**License:** MIT  
**Requires:** OpenClaw 2026.3.7+, Node.js 22+

---

## Installation

### Windows (PowerShell)

```powershell
git clone https://github.com/pnll1991/lobstermind-memory.git "$env:USERPROFILE\.openclaw\extensions\lobstermind-memory"
cd "$env:USERPROFILE\.openclaw\extensions\lobstermind-memory"
npm install
openclaw gateway restart
```

### macOS / Linux

```bash
git clone https://github.com/pnll1991/lobstermind-memory.git ~/.openclaw/extensions/lobstermind-memory
cd ~/.openclaw/extensions/lobstermind-memory
npm install
openclaw gateway restart
```

### Verify

```powershell
openclaw memories list
openclaw memories --help
```

---

## Overview

LobsterMind Memory is a long-term memory plugin for OpenClaw focused on simplicity and reliability. It uses SQLite for storage, hash-based embeddings for semantic search, and supports cloud backup to Google Drive, Dropbox, and OneDrive.

### Design Philosophy

**LobsterMind is for you if:**
- You want something that works immediately
- You prefer simple CLI over complex UIs
- You don't want external dependencies (Python, Ollama)
- You value reliability over feature completeness

**Other plugins like Gigabrain are for you if:**
- You want comprehensive feature sets
- You need entity tracking and relationship graphs
- You want web consoles and dashboards
- You don't mind complex setup and configuration

Both approaches are valid. Choose based on your needs.

---

## Features

### Core

- **SQLite Storage**: Local, fast, reliable database
- **Semantic Search**: Hash-based embeddings (no API required)
- **Natural Language Queries**: Automatic date/tag/type detection
- **Auto-Deduplication**: 85% similarity threshold
- **Fuzzy Search**: Tolerates typos and variations
- **Memory Tags**: Organize and filter memories
- **Date Range Filters**: Query by time periods

### Backup

- **Local Backup**: Automatic backup on startup
- **Cloud Backup**: Google Drive, Dropbox, OneDrive via rclone
- **Export/Import**: JSON backup files
- **Memory Expiration**: Auto-archive or delete old memories

### Integration

- **Obsidian Sync**: Automatic export to `obsidian-vault/LobsterMind/Memories.md`
- **Native Markdown**: Sync to `workspace/MEMORY.md`
- **CLI Commands**: 15 commands for management

---

## Comparison: LobsterMind vs Gigabrain

Both plugins solve long-term memory for OpenClaw. They take different approaches.

### Architecture

| Aspect | LobsterMind | Gigabrain |
|--------|-------------|-----------|
| Language | TypeScript/Node.js | TypeScript + Python |
| Dependencies | better-sqlite3 | better-sqlite3 + Ollama + FastAPI |
| Lines of Code | ~1,400 | ~2,000+ |
| Database | SQLite | SQLite + multiple stores |

### Installation

| Aspect | LobsterMind | Gigabrain |
|--------|-------------|-----------|
| Steps | Clone, npm install, restart | Wizard, multiple configs, setup |
| Time | ~1 minute | ~30 minutes |
| External | None | Python, Ollama (4GB+ model) |

### Configuration

| Aspect | LobsterMind | Gigabrain |
|--------|-------------|-----------|
| Default Config | Zero (works immediately) | 50+ options |
| Required Setup | None | Wizard, vault paths, models |
| Optional Features | Expiration, backup interval | Many advanced options |

### Features

| Feature | LobsterMind | Gigabrain |
|---------|-------------|-----------|
| Semantic Search | ✅ Hash-based | ✅ Ollama embeddings |
| Natural Language | ✅ Full parsing | ⚠️ Limited |
| Cloud Backup | ✅ GDrive/Dropbox/OneDrive | ❌ Local only |
| Auto-Deduplication | ✅ 85% threshold | ⚠️ Manual |
| Fuzzy Search | ✅ Yes | ⚠️ Partial |
| Memory Tags | ✅ Yes | ⚠️ Complex |
| Web Console | ❌ No | ✅ Yes |
| Entity Tracking | ❌ No | ✅ Yes |
| Audit Pipelines | ❌ No | ✅ Yes |
| Relationship Graph | ❌ No | ✅ Yes |
| Review Queues | ❌ No | ✅ Yes |

### Output Structure

**LobsterMind Obsidian:**
```
obsidian-vault/LobsterMind/
└── Memories.md
```

**Gigabrain Obsidian:**
```
obsidian-vault/Gigabrain/
├── 00 Home/
├── 10 Native/
├── 20 Nodes/
├── 30 Views/
├── 40 Reports/
└── Inbox/
```

### CLI Comparison

**LobsterMind (15 commands):**
```powershell
openclaw memories list
openclaw memories add "content" --tags "coding"
openclaw memories search "yesterday"
openclaw memories backup --to gdrive
openclaw memories stats
openclaw memories cleanup --days 90
```

**Gigabrain (20+ commands):**
```powershell
node scripts/gigabrainctl.js nightly --config ...
node scripts/gigabrainctl.js vault build --skip-reports
node scripts/gigabrainctl.js audit --mode apply
```

---

## When to Choose Each

### Choose LobsterMind if:

- You want **simple installation** (1 minute)
- You prefer **zero configuration**
- You don't want **external dependencies** (Python, Ollama)
- You value **cloud backup** (GDrive/Dropbox/OneDrive)
- You want **natural language search**
- You prefer **CLI over web UI**
- You want **automatic deduplication**

### Choose Gigabrain if:

- You want **comprehensive features**
- You need **entity/person tracking**
- You want **web console and dashboards**
- You need **audit pipelines**
- You want **relationship graphs**
- You don't mind **complex setup**
- You want **review queues**

---

## Usage

### Basic Commands

```powershell
# Add
openclaw memories add "El usuario prefiere TypeScript"
openclaw memories add "Prefiero Node.js" --tags "coding,stack"

# List
openclaw memories list
openclaw memories list --tag "coding"
openclaw memories list --from 2026-03-01 --to 2026-03-08

# Search
openclaw memories search "TypeScript"
openclaw memories search "qué dije ayer"
openclaw memories search "typescrip" --fuzzy

# Edit/Delete
openclaw memories edit <id> "New content"
openclaw memories delete <id>

# Stats
openclaw memories stats
openclaw memories tags
```

### Backup

```powershell
# Local
openclaw memories backup
openclaw memories list-backups --local
openclaw memories export
openclaw memories import backup.json

# Cloud (requires rclone)
openclaw memories setup-cloud
openclaw memories backup --to gdrive
openclaw memories list-backups --from gdrive
openclaw memories restore backup.json --from gdrive
```

### Maintenance

```powershell
# Cleanup old memories
openclaw memories cleanup --days 90 --dry-run
openclaw memories cleanup --days 90 --action archive
```

---

## Configuration

Edit `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "slots": { "memory": "lobstermind-memory" },
    "entries": {
      "lobstermind-memory": {
        "enabled": true,
        "config": {
          "expiration": {
            "enabled": false,
            "days": 90,
            "action": "archive"
          },
          "backup": {
            "autoBackup": true,
            "interval": 24
          }
        }
      }
    }
  }
}
```

---

## Cloud Backup Setup

### 1. Install rclone

**Windows:** `choco install rclone`  
**macOS:** `brew install rclone`  
**Linux:** `sudo apt install rclone`

### 2. Configure

```powershell
rclone config
```

Follow prompts for `gdrive`, `dropbox`, or `onedrive`.

### 3. Use

```powershell
openclaw memories backup --to gdrive
openclaw memories list-backups --from gdrive
openclaw memories restore backup.json --from gdrive
```

---

## Technical Details

**Database:** `~/.openclaw/workspace/memory/lobstermind-memory.db`  
**Backups:** `~/.openclaw/workspace/memory/backups/`  
**Obsidian:** `~/.openclaw/workspace/obsidian-vault/LobsterMind/Memories.md`  
**Native Markdown:** `~/.openclaw/workspace/MEMORY.md`

### Architecture

- SQLite storage with hash-based embeddings
- Cosine similarity for semantic search
- 85% auto-deduplication threshold
- Natural language date/tag/type parsing
- Works offline, no API keys required

---

## Troubleshooting

### Plugin Not Loading

```powershell
openclaw doctor
ls ~/.openclaw/extensions/lobstermind-memory
```

### Database Errors

```powershell
openclaw memories backup
rm ~/.openclaw/workspace/memory/lobstermind-memory.db
openclaw gateway restart
```

### Cloud Backup Issues

```powershell
rclone --version
rclone config
rclone ls gdrive:
```

---

## Support

- **Issues:** https://github.com/pnll1991/lobstermind-memory/issues
- **Discussions:** https://github.com/pnll1991/lobstermind-memory/discussions
- **Discord:** https://discord.gg/clawd

---

## License

MIT License

---

## Acknowledgments

**Gigabrain** (https://github.com/legendaryvibecoder/gigabrain) pioneered long-term memory for OpenClaw and inspired this project. Both plugins aim to solve the same problem with different approaches.

**LobsterMind** prioritizes simplicity, zero configuration, and cloud backup.  
**Gigabrain** prioritizes comprehensive features, entity tracking, and advanced workflows.

Both are valid choices depending on your needs.

---

**Built with SQLite and common sense.**
