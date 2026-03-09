# LobsterMind Memory

Long-term memory plugin for OpenClaw with SQLite storage, semantic search, automatic clustering, and Obsidian sync.

## Features

- **Automatic Memory Capture**: Detects and saves personal facts, preferences, decisions, and habits from conversations
- **Semantic Search**: 384-dimensional embeddings with cosine similarity for intelligent recall
- **Thematic Clustering**: Automatically groups related memories into topics
- **Memory Relations**: Builds connections between similar memories (60%+ similarity)
- **Dual Sync**: Writes to both native `MEMORY.md` and Obsidian vault
- **Security**: Blocks sensitive data (emails, phones, passwords, credit cards, etc.)
- **Performance**: LRU embedding cache + TTL search cache
- **CLI Commands**: Manage memories directly from terminal

## Installation

```bash
# Navigate to OpenClaw plugins directory
cd ~/.openclaw/extensions

# Clone or copy the plugin
git clone https://github.com/pnll1991/lobstermind-memory.git

# Install dependencies
cd lobstermind-memory
npm install

# Build TypeScript
npm run build
```

## Configuration

Add to your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "lobstermind-memory": {
        "path": "~/.openclaw/extensions/lobstermind-memory",
        "config": {
          "enabled": true
        }
      }
    }
  }
}
```

Then restart the gateway:

```bash
openclaw gateway restart
```

## Usage

### Automatic Capture

The plugin automatically captures memories when you share personal information:

```
User: Soy de Argentina
→ Saved: [USER_FACT] Soy de Argentina (confidence: 0.95)

User: Me gusta el café
→ Saved: [PREFERENCE] Me gusta el café (confidence: 0.95)

User: Decidí cambiar de trabajo
→ Saved: [DECISION] Decidí cambiar de trabajo (confidence: 0.90)
```

### Manual Capture

Use the CLI to add memories manually:

```bash
openclaw memories add "Tu memoria aquí"
```

### Search

```bash
openclaw memories search "trabajo"
```

### List Memories

```bash
openclaw memories list --limit 20
```

### View Clusters

```bash
openclaw memories clusters
openclaw memories cluster <cluster-id>
```

### Statistics

```bash
openclaw memories stats
openclaw memories autostats
```

### Backup

```bash
openclaw memories backup
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `memories list [--limit n]` | List recent memories |
| `memories add <content>` | Add a memory manually |
| `memories search <query>` | Semantic search |
| `memories stats` | Show total count |
| `memories autostats` | Auto-capture statistics |
| `memories clusters [--min-size n]` | View memory clusters |
| `memories cluster <id>` | View cluster members |
| `memories backup` | Export to JSON |

## Memory Types

- `USER_FACT`: Personal facts (origin, identity, etc.)
- `PREFERENCE`: Likes, dislikes, preferences
- `DECISION`: Choices and commitments
- `HABIT`: Routines and regular activities
- `EDUCATION`: Studies and learning
- `WORK_HISTORY`: Job and career info
- `TECH_SKILL`: Technical abilities
- `RELATIONSHIP`: Family, friends, connections

## Security

The plugin **blocks** storage of:

- Email addresses
- Phone numbers
- Credit card numbers
- Passwords and credentials
- Government IDs
- Bank account numbers
- IP addresses
- Crypto wallet addresses

## File Structure

```
lobstermind-memory/
├── index.ts                 # Main plugin code
├── package.json             # Dependencies & metadata
├── tsconfig.json            # TypeScript config
├── openclaw.plugin.json     # Plugin schema
├── README.md                # This file
├── LICENSE                  # MIT License
└── .gitignore               # Ignore rules
```

## Data Storage

- **Database**: `~/.openclaw/memory/lobstermind-memory.db`
- **Native Sync**: `~/.openclaw/workspace/MEMORY.md`
- **Obsidian**: `~/.openclaw/workspace/obsidian-vault/LobsterMind/Memories.md`
- **Backups**: `~/.openclaw/memory/backups/`

## Requirements

- Node.js >= 22.0.0
- OpenClaw >= 2026.3.7
- TypeScript (for building)

## License

MIT - See LICENSE file

## Contributing

Contributions welcome! Please read the code and open issues for bugs or feature requests.

---

Built for the OpenClaw community 🦞🧠
