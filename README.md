  _          _         _              __  __ _           _ 
 | |    ___ | |__  ___| |_ ___ _ __  |  \/  (_)_ __   __| |
 | |   / _ \| '_ \/ __| __/ _ \ '__| | |\/| | | '_ \ / _` |
 | |__| (_) | |_) \__ \ ||  __/ |    | |  | | | | | | (_| |
 |_____\___/|_.__/|___/\__\___|_|    |_|  |_|_|_| |_|\__,_|
                                                                                                                  

> Long-term memory plugin for OpenClaw. SQLite, semantic search, cloud backup.

---

## What It's For

**Remember things across sessions:**
- Your AI assistant remembers your preferences, facts, and decisions
- Search memories with natural language ("what did I say yesterday?")
- Never repeat the same information twice

**Use cases:**
- **Personal Assistant**: "Remember I'm vegetarian" → AI remembers for restaurant suggestions
- **Developer**: "I prefer TypeScript" → AI suggests TS for new projects
- **Notes**: "Remember I have a meeting on Friday" → AI reminds you
- **Preferences**: "I like dark mode" → AI configures UI accordingly
- **Facts**: "I live in Buenos Aires" → AI adjusts timezone/suggestions
- **Decisions**: "I chose AWS over GCP" → AI remembers for future architecture discussions

**Auto-capture from chat:**
Just say "Remember..." and it's saved automatically with the right type.

---

## Install

**Windows (PowerShell)**
```powershell
git clone https://github.com/pnll1991/lobstermind-memory.git "$env:USERPROFILE\.openclaw\extensions\lobstermind-memory"
cd "$env:USERPROFILE\.openclaw\extensions\lobstermind-memory"
npm install
# ✅ Auto-creates: database, backups, Obsidian vault, MEMORY.md
openclaw gateway restart
```

**macOS / Linux**
```bash
git clone https://github.com/pnll1991/lobstermind-memory.git ~/.openclaw/extensions/lobstermind-memory
cd ~/.openclaw/extensions/lobstermind-memory
npm install
# ✅ Auto-creates: database, backups, Obsidian vault, MEMORY.md
openclaw gateway restart
```

**That's it. Everything is automatic.**

---

## What It Does

```bash
$ openclaw memories add "I prefer TypeScript"
✓ Memory saved [PREFERENCE]

$ openclaw memories search "what language do I use"
✓ Found 1 memory: I prefer TypeScript

$ openclaw memories backup --to gdrive
✓ Uploaded to Google Drive
```

- **Natural Language**: "Remember I'm from Argentina" → auto-detects type
- **Semantic Search**: Find memories by meaning, not keywords
- **Cloud Backup**: Google Drive, Dropbox, OneDrive
- **Auto-Dedup**: Never creates duplicates
- **Zero Config**: Works immediately

---

## LobsterMind vs Gigabrain

Both solve long-term memory for OpenClaw. Different approaches.

| Feature | LobsterMind | Gigabrain |
|---------|-------------|-----------|
| Install Time | 1 min | 30 min |
| Dependencies | Node.js only | Python + Ollama + Node.js |
| Configuration | Zero | 50+ options |
| Lines of Code | 1,400 | 2,000+ |
| Cloud Backup | ✅ GDrive/Dropbox/OneDrive | ❌ Local only |
| Natural Language | ✅ Full support | ⚠️ Limited |
| Web Console | ❌ CLI only | ✅ Web UI |
| Entity Tracking | ❌ No | ✅ Yes |

### Choose LobsterMind if:
- You want **simple installation** (1 command)
- You prefer **zero configuration**
- You want **cloud backup** support
- You prefer **CLI over web UI**

### Choose Gigabrain if:
- You want **comprehensive features**
- You need **entity/person tracking**
- You want **web console and dashboards**
- You don't mind **complex setup**

Both are valid. Choose based on your needs.

---

## Usage

```bash
# Add memory
openclaw memories add "I prefer TypeScript" --tags "coding"

# Search (natural language)
openclaw memories search "what language do I use"
openclaw memories search "what did I say yesterday"

# List with filters
openclaw memories list --tag "coding"
openclaw memories list --from 2026-03-01

# Backup
openclaw memories backup --to gdrive

# Stats
openclaw memories stats
openclaw memories tags
```

---

## Natural Language Capture

Say in chat:

| You Say | Auto-Detected As |
|---------|------------------|
| "Remember I'm from Argentina" | `[USER_FACT]` |
| "I prefer TypeScript" | `[PREFERENCE]` |
| "I decided to use Node.js" | `[DECISION]` |
| "My project is about AI" | `[PROJECT]` |

Auto-detects type from content. No manual tags needed.

---

## Requirements

- OpenClaw 2026.3.7+
- Node.js 22+

---

## License

MIT

---

_Built with SQLite and common sense._
