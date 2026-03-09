# LobsterMind Memory - Test Guide

## Implemented Features Overview

This document covers all features currently implemented in the LobsterMind Memory plugin and how to test them effectively.

## Feature Categories & Tests

### 1. Security & Privacy Protection

**Features:**
- Automatic detection and blocking of sensitive data (emails, credit cards, passwords, phone numbers, etc.)
- Validation on content insertion to prevent storage of sensitive information
- Blocking of various sensitive data patterns

**Test Commands:**
```bash
# These should be blocked from storage:
openclaw memories add "My email is test@example.com"
openclaw memories add "Card number: 4532-1234-5678-9012"
openclaw memories add "My phone is 555-123-4567"
openclaw memories add "Password: secret123"
```

### 2. Smart Classification System

**Features:**
- Automatic classification of memory types (USER_FACT, PREFERENCE, DECISION, HABIT, etc.)
- Multi-language support for detecting personal infos
- Context-aware categorization

**Test Commands:**
```bash
openclaw memories add "I work as a software engineer at Google"
openclaw memories add "I love playing piano on weekends" 
openclaw memories add "Soy de Boca y vivo en Argentina"
openclaw memories list
openclaw memories clusters
```

### 3. Automatic Capture System

**Features:**
- Anti-noise filtering (removes questions, greetings, commands)
- Contextual awareness for smarter detection
- Statistical tracking (True positives/negatives, False positives/negatives)

**Test Commands:**
```bash
# Send these as normal conversation inputs - they should be auto-captured:
# "I've been working on this project for several months"
# "Me llamo Mario y soy desarrollador"

# These should be filtered:
# "How do I use this tool?" 
# "Hello"
# "Please tell me"

# Then check stats:
openclaw memories autostats
```

### 4. Clustering System

**Features:**
- Automatic grouping of related memories into themed clusters
- Dynamic cluster naming based on content
- Relationship maintenance between clusters and individual memories

**Test Commands:**
```bash
# Add related items to form clusters
openclaw memories add "I work as a developer at a tech company"
openclaw memories add "My job involves writing JavaScript code daily"
openclaw memories add "I love my career in technology"

openclaw memories add "The weather in Seattle is rainy in winter"
openclaw memories add "I enjoy winter walks in the rain"

openclaw memories clusters
openclaw memories cluster [cluster-id]
```

### 5. Performance Optimizations

**Features:**
- Embedding calculation caching to avoid redundant calculations
- Search result caching for faster subsequent queries
- Efficient database transactions and batch operations
- Memory usage management

**Test Commands:**
```bash
# Test performance with repeated searches should be faster on repeats:
time openclaw memories search "work"
time openclaw memories search "work"  # Should be faster due to caching

openclaw memories autostats  # Check that caching stats appear
```

### 6. Integration & Storage

**Features:**
- SQLite integration with optimized tables and indexes
- Automatic synchronization to Obsidian vault (Memories.md)
- Native MEMORY.md file sync support
- Backup functionality
- CLI interface with multiple commands

**Test Commands:**
```bash
# Full cycle test
openclaw memories add "Test memory"
openclaw memories list --limit 1
openclaw memories search "test"
openclaw memories backup
openclaw memories stats

# Verify files are created outside the DB
# Check [workspace]/memory/Memories.md exists
# Check backup files are generated in [workspace]/memory/backups/
```

## Expected Test Results

After running the above commands, verify:

1. **No sensitive data** appears in stored memories
2. **Classification works** - memories show appropriate types like [PREFERENCE] or [USER_FACT]
3. **Clusters form logically** around similar topics
4. **Statistics are meaningful** (precision, recall metrics make sense)
5. **Performance is acceptable** (caching reduces response times)
6. **All integration points work** (Obsidian, native files, backup)

## Troubleshooting

### Common Issues:
- TypeErrors with embeddings: May need plugin rebuild to JS
- Missing CLI commands: Check plugin is loaded correctly in OpenClaw
- Stats not updating: May need more test data to show metrics clearly
- Clusters not forming: Add more related content to build groups

### Logs to Monitor:
- Console output from `[lobstermind:*]` logging prefixes
- Database files at `[workspace]/memory/`
- Generated markdown files ([workspace]/memory/Memories.md, [workspace]/MEMORY.md)

## Complete Test Scenario

To run through a complete flow:
1. Add multiple related memories about work/career
2. Add multiple memories about hobbies/preferences  
3. Add a few sensitive data items (these should be blocked)
4. Run auto-capture with conversation-like inputs
5. Generate backups
6. Verify cluster formation
7. Run all CLI commands and check they return data appropriately