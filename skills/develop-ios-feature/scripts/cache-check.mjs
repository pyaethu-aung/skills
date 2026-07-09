#!/usr/bin/env node
/**
 * cache-check.mjs
 * Print the cached Phase 0 baseline for this project, or "NO CACHE".
 * Run from the project root.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const cwd = process.cwd();
const key = `${basename(cwd)}-${createHash('sha1').update(cwd).digest('hex').slice(0, 8)}`;
const cacheFile = `.cache/develop-ios-feature/${key}.md`;

if (existsSync(cacheFile)) {
  process.stdout.write(readFileSync(cacheFile, 'utf8'));
} else {
  console.log(`NO CACHE (expected at ${cacheFile})`);
}
