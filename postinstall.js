#!/usr/bin/env node

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

console.log('\n🦞 LobsterMind Memory - Post Install Setup\n');

const workspaceRoot = process.env.OPENCLAW_WORKSPACE || join(process.env.HOME || process.env.USERPROFILE, '.openclaw', 'workspace');

console.log(`Workspace: ${workspaceRoot}\n`);

const dirs = [
  ['Memory database', join(workspaceRoot, 'memory')],
  ['Backups', join(workspaceRoot, 'memory', 'backups')],
  ['Cloud sync', join(workspaceRoot, 'memory', 'cloud-sync')],
  ['Obsidian vault', join(workspaceRoot, 'obsidian-vault', 'LobsterMind')]
];

for (const [name, dir] of dirs) {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`✓ Created: ${name}`);
    } else {
      console.log(`✓ Exists: ${name}`);
    }
  } catch (err) {
    console.log(`✗ Failed: ${name} - ${err.message}`);
  }
}

const memoryMdPath = join(workspaceRoot, 'MEMORY.md');
if (!existsSync(memoryMdPath)) {
  try {
    writeFileSync(memoryMdPath, '# Memories\n\nAuto-created by LobsterMind Memory plugin\n\n', 'utf-8');
    console.log('✓ Created: MEMORY.md');
  } catch (err) {
    console.log(`✗ Failed: MEMORY.md - ${err.message}`);
  }
} else {
  console.log('✓ Exists: MEMORY.md');
}

const obsidianMdPath = join(workspaceRoot, 'obsidian-vault', 'LobsterMind', 'Memories.md');
if (!existsSync(obsidianMdPath)) {
  try {
    writeFileSync(obsidianMdPath, '# Memories\n\nAuto-created by LobsterMind Memory plugin\n\n', 'utf-8');
    console.log('✓ Created: Obsidian/Memories.md');
  } catch (err) {
    console.log(`✗ Failed: Obsidian/Memories.md - ${err.message}`);
  }
} else {
  console.log('✓ Exists: Obsidian/Memories.md');
}

console.log('\n✅ Setup complete!\n');
console.log('Next steps:');
console.log('1. Restart OpenClaw: openclaw gateway restart');
console.log('2. Add your first memory: openclaw memories add "I prefer TypeScript"');
console.log('3. (Optional) Setup Google Drive backup: openclaw memories setup-cloud\n');
