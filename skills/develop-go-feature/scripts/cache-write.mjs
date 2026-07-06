#!/usr/bin/env node
/**
 * cache-write.mjs
 * Write Phase 0 findings to the project cache.
 * Also ensures .cache/develop-go-feature/ exists and is gitignored.
 * Run from the project root.
 *
 * Usage (preferred — no shell pipeline needed):
 *   node cache-write.mjs <findings-file>
 *
 * Usage (stdin fallback):
 *   cat findings.md | node cache-write.mjs
 */
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { basename } from 'node:path';

const cwd = process.cwd();
const key = `${basename(cwd)}-${createHash('sha1').update(cwd).digest('hex').slice(0, 8)}`;
const CACHE_DIR = '.cache/develop-go-feature';
const GITIGNORE_ENTRY = '.cache/develop-go-feature/';

mkdirSync(CACHE_DIR, { recursive: true });

// Auto-update .gitignore
if (existsSync('.gitignore')) {
  const lines = readFileSync('.gitignore', 'utf8').split('\n').map(l => l.trim());
  if (!lines.includes(GITIGNORE_ENTRY)) {
    appendFileSync('.gitignore', `\n${GITIGNORE_ENTRY}\n`);
    console.error(`[cache-write] Added ${GITIGNORE_ENTRY} to .gitignore`);
  }
} else {
  writeFileSync('.gitignore', `${GITIGNORE_ENTRY}\n`);
  console.error(`[cache-write] Created .gitignore with ${GITIGNORE_ENTRY}`);
}

// Read from file path arg or stdin
const cacheFile = `${CACHE_DIR}/${key}.md`;
const filePath = process.argv[2];

if (filePath) {
  const content = readFileSync(filePath, 'utf8');
  writeFileSync(cacheFile, content);
  console.log(`[cache-write] Saved to ${cacheFile}`);
} else {
  let content = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { content += chunk; });
  process.stdin.on('end', () => {
    writeFileSync(cacheFile, content);
    console.log(`[cache-write] Saved to ${cacheFile}`);
  });
}
