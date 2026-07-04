#!/usr/bin/env node
/**
 * setup.mjs (git-workflow)
 * Ensure .claude/settings.local.json has the allow entries the git-workflow
 * plugin's skills need for hands-off runs: the namespaced skill tokens, the
 * sentinel-prefixed commit/PR forms its guard hooks demand, and the read-only
 * gh commands create-pr uses. Idempotent; safe to re-run every session.
 *
 * Same contract as web-dev's dwf-setup: defaults to a DRY RUN that prints the
 * delta and exits non-zero when grants would change, so a plugin update can
 * never widen permissions silently. Re-run with --write to apply:
 *   gwf-setup            # preview the delta
 *   gwf-setup --write    # apply it
 *
 * Personal, not shared: grants go in the gitignored .local file, never the
 * committed settings.json. Each developer opts in per checkout.
 *
 * This script manages ONLY git-workflow's entries. Other plugins own their
 * own grants (web-dev ships dwf-setup); nothing here is conditional on them.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const SETTINGS_PATH = '.claude/settings.local.json';

const ENTRIES = [
  // Skill-invocation tokens, bare and argument-carrying (`:*`) forms. The
  // token is `Skill(...)` SINGULAR; plugin skills are namespaced.
  'Skill(git-workflow:commit-message)',
  'Skill(git-workflow:commit-message:*)',
  'Skill(git-workflow:create-pr)',
  'Skill(git-workflow:create-pr:*)',
  // Commit/PR creation only via the sentinel forms the plugin's guard hooks
  // demand; the skills set the sentinel after their confirmation step, so
  // this trusts the skill flow, not arbitrary commits.
  'Bash(CLAUDE_COMMIT_VIA_SKILL=1 git commit:*)',
  'Bash(CLAUDE_PR_VIA_SKILL=1 gh pr create:*)',
  // create-pr also READS pr state — `gh pr list` (existing-PR check) and
  // `gh pr view` (post-create verify). Merge/close stay ungranted.
  'Bash(gh pr view:*)',
  'Bash(gh pr list:*)',
];

let settings = {};
if (existsSync(SETTINGS_PATH)) {
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    console.error(`[gwf-setup] ERROR: ${SETTINGS_PATH} contains invalid JSON — aborting to avoid data loss.`);
    console.error('[gwf-setup] Fix the file manually, then re-run.');
    process.exit(1);
  }
}
if (!settings.permissions) settings.permissions = {};
if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

const applyMode = process.argv.slice(2).includes('--write');
const present = new Set(settings.permissions.allow);
const toAdd = ENTRIES.filter((entry) => !present.has(entry));

if (toAdd.length === 0) {
  console.log('[gwf-setup] All required allow entries already present — nothing to do.');
  process.exit(0);
}

if (!applyMode) {
  console.log('[gwf-setup] DRY RUN — no changes written.');
  console.log(
    `[gwf-setup] ${toAdd.length} new ${toAdd.length === 1 ? 'entry' : 'entries'} would be added to ${SETTINGS_PATH}:`,
  );
  toAdd.forEach((entry) => console.log(`  + ${entry}`));
  console.log('[gwf-setup] Review the list above, then re-run with --write to apply.');
  process.exit(1);
}

for (const entry of toAdd) settings.permissions.allow.push(entry);
// A plugin-channel project may have no .claude/ directory yet — nothing else
// creates it before this script runs.
mkdirSync('.claude', { recursive: true });
writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
console.log(`[gwf-setup] Added ${toAdd.length} allow ${toAdd.length === 1 ? 'entry' : 'entries'} to ${SETTINGS_PATH}:`);
toAdd.forEach((entry) => console.log(`  + ${entry}`));
process.exit(0);
