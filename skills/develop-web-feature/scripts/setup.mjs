#!/usr/bin/env node
/**
 * setup.mjs
 * Ensure .claude/settings.local.json has all the allow entries needed for
 * develop-web-feature to run hands-off. Safe to run multiple times (idempotent).
 * Run from the project root.
 *
 * Defaults to a DRY RUN: prints the entries it would add and writes nothing,
 * exiting non-zero when a delta exists so a skill update can never widen the
 * allow list silently. Re-run with --write to apply:
 *   node .claude/skills/develop-web-feature/scripts/setup.mjs            # preview the delta
 *   node .claude/skills/develop-web-feature/scripts/setup.mjs --write    # apply it
 *
 * --grant-edits (opt-in, off by default): also grant the structured file-edit
 * tools (Edit/Write/MultiEdit) so a hands-off run does not stop on the per-edit
 * permission prompt. Scoped to the project's source/test directories that exist
 * (config, package.json, .github/, .claude/, and docs still prompt) — narrower
 * than accept-edits mode, which auto-approves every path:
 *   node .claude/skills/develop-web-feature/scripts/setup.mjs --grant-edits           # preview
 *   node .claude/skills/develop-web-feature/scripts/setup.mjs --grant-edits --write   # apply
 *
 * Personal, not shared: auto-approve grants are a per-developer trust decision,
 * so they go in the gitignored .local file (where Claude Code itself writes
 * "always allow" approvals) — never the committed settings.json. Each developer
 * runs this once in their own checkout to opt in. Project-wide enforcement
 * (the commit/PR guard hooks) stays in the shared settings.json.
 *
 * Portable: the toolchain grants are DERIVED from the project (its package
 * manager and dependencies), never hard-coded to one stack. The skill-infra and
 * git grants are ecosystem-generic. So this is safe to ship via a skills repo
 * and run unchanged in any web project.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SETTINGS_PATH = '.claude/settings.local.json';

// --- Detect the install channel ---
// npx skills installs this skill at <project>/.claude/skills/develop-web-feature/;
// the web-dev plugin runs these scripts from the plugin cache via its dwf-* bin
// wrappers. The channel decides which command forms the grants must match, so
// derive it from where this script actually lives.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const NPX_SCRIPT_DIR = resolve('.claude/skills/develop-web-feature/scripts');
const isPluginChannel = SCRIPT_DIR !== NPX_SCRIPT_DIR;

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// --- Detect the project so the grants fit whatever stack is in use ---
const pkg = readJSON('package.json') ?? {};
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const hasDep = (name) => Boolean(deps[name]);

// Package manager from the lockfile present (npm is the fallback).
const pm = existsSync('pnpm-lock.yaml') ? 'pnpm'
  : existsSync('yarn.lock') ? 'yarn'
  : (existsSync('bun.lockb') || existsSync('bun.lock')) ? 'bun'
  : 'npm';

// Direct tool invocations the agent reaches for during Phase 3/5 single-file
// iteration — granted only for the tools this project actually depends on. npx
// is the runner because it ships with Node and works under every package manager.
const TOOLCHAIN_MAP = [
  { dep: '@playwright/test', entry: 'Bash(npx playwright*)' },
  { dep: 'playwright',       entry: 'Bash(npx playwright*)' },
  { dep: 'vitest',           entry: 'Bash(npx vitest*)' },
  { dep: 'jest',             entry: 'Bash(npx jest*)' },
  { dep: 'mocha',            entry: 'Bash(npx mocha*)' },
  { dep: 'typescript',       entry: 'Bash(npx tsc*)' },
  { dep: 'eslint',           entry: 'Bash(npx eslint*)' },
];
const TOOLCHAIN = [...new Set(TOOLCHAIN_MAP.filter((t) => hasDep(t.dep)).map((t) => t.entry))];

// Browser-driver policy: the Playwright MCP server and the e2e CLI serve
// different roles and coexist — the CLI (`npx playwright`) runs the spec suite,
// while the MCP server drives the LIVE browser interactively during the critique
// phase (navigate, snapshot, screenshot, click). So the MCP browser tools are
// granted whenever a Playwright server is declared in .mcp.json, regardless of
// whether the CLI is also a dependency. Scoped to the inspect/drive tools the
// critique uses; the code-execution tools (browser_evaluate,
// browser_run_code_unsafe) are deliberately excluded (least privilege).
const mcpServers = readJSON('.mcp.json')?.mcpServers ?? {};
// The MCP tool token is `mcp__<serverName>__<tool>`, where serverName is the key
// in .mcp.json — so derive the prefix from the matched server rather than
// assuming it is literally "playwright".
const playwrightServerName = Object.entries(mcpServers).find(
  ([name, def]) =>
    /playwright/i.test(name) || (Array.isArray(def?.args) && def.args.some((a) => /@playwright\/mcp/i.test(String(a)))),
)?.[0];
const MCP_BROWSER_TOOLS = [
  'browser_navigate',
  'browser_navigate_back',
  'browser_snapshot',
  'browser_take_screenshot',
  'browser_click',
  'browser_type',
  'browser_hover',
  'browser_select_option',
  'browser_press_key',
  'browser_wait_for',
  'browser_resize',
  'browser_console_messages',
  'browser_network_requests',
  'browser_tabs',
  'browser_handle_dialog',
  'browser_close',
];
const MCP_PLAYWRIGHT = playwrightServerName
  ? MCP_BROWSER_TOOLS.map((t) => `mcp__${playwrightServerName}__${t}`)
  : [];

// --grant-edits (opt-in, off by default): auto-approve the structured file-edit
// tools so a hands-off run does not stop on the per-edit permission prompt.
// Deliberately scoped to the project's source/test directories that exist (NOT
// root config, package.json, .github/, .claude/, or docs — those still prompt),
// and DERIVED from the layout rather than hard-coded, so it stays portable. It is
// narrower than accept-edits mode (which auto-approves EVERY path) but, unlike
// that per-session mode, it persists across sessions — hence opt-in only.
const grantEdits = process.argv.slice(2).includes('--grant-edits');
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit'];
const SOURCE_DIRS = ['src', 'app', 'lib', 'packages', 'e2e', 'tests', 'test', 'cypress'];
const EDIT_GRANTS = grantEdits
  ? SOURCE_DIRS.filter((d) => existsSync(d)).flatMap((d) => EDIT_TOOLS.map((tool) => `${tool}(${d}/**)`))
  : [];

// The skill's own helper scripts (the gate runner, Phase 0 scripts, the
// dev-server lifecycle helper, and critique-plan for the hands-off fix loop).
// The command form is channel-dependent: node + project path under npx skills,
// the plugin's dwf-* bin wrappers under the web-dev plugin — the wrapper names
// are stable across machines, unlike the plugin cache path.
const SCRIPT_NAMES = ['setup', 'discover', 'gates', 'dev-server', 'critique-plan', 'cache-check', 'cache-write'];
const SCRIPT_GRANTS = SCRIPT_NAMES.map((n) =>
  isPluginChannel
    ? `Bash(dwf-${n}*)`
    : `Bash(node .claude/skills/develop-web-feature/scripts/${n}.mjs*)`,
);

const REQUIRED = [
  // Full-suite gate runs (test / lint / build / e2e) go through the gate runner,
  // which orchestrates them in Node and logs each to the cache dir. That single
  // entry (in SCRIPT_GRANTS) replaces the broad `<pm> run *` grant and the
  // `echo` status-marker grant, and removes the `$?` / `>` / `&&`
  // permission-prompt class (those live inside the script now, where the
  // permission heuristics never apply).
  ...SCRIPT_GRANTS,
  // The skill's one hard dependency, installed via npx (available under any PM).
  'Bash(npx impeccable*)',
  // Spec / fixture directory creation. `mkdir -p` is create-only, never destructive.
  'Bash(mkdir -p *)',
  // Node scripts written to the project cache dir (avoids node -e inline blocks)
  'Bash(node .cache/develop-web-feature/*)',
  // Deleting the skill's own temp files (critique body, screenshots). Scoped to
  // the gitignored cache dir, so a bare `rm` elsewhere still prompts.
  'Bash(rm -f .cache/develop-web-feature/*)',
  // Git: read-only inspection, staging, and branch creation. Commit and PR
  // creation stay gated behind the /commit-message and /create-pr skills (their
  // sentinel-prefixed forms are added conditionally below); these cover
  // everything the workflow does directly outside those skills.
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git branch:*)',
  'Bash(git rev-parse:*)',
  'Bash(git add:*)',
  // Removing tracked files (e.g. deleting a locale/module). `git rm` both deletes
  // and stages; plain `rm` stays ungranted so destructive deletes still prompt.
  'Bash(git rm:*)',
  // Unstaging so each logical change commits atomically (stage a subset, commit,
  // repeat). Covers `--hard` too, but the workflow commits incrementally.
  'Bash(git reset:*)',
  'Bash(git switch:*)',
  'Bash(git checkout -b:*)',
  // The one outward git action; the pre-push hook still blocks pushes to the default branch.
  'Bash(git push:*)',
];

// Added only when the corresponding skill or tool is present
const CONDITIONAL = [
  // Skill-invocation tokens. The Claude Code token is `Skill(...)` SINGULAR — the
  // plural `Skills(...)` never matches (verified against the tokens Claude Code
  // itself writes to settings.local.json on approval). Grant BOTH the bare form
  // and the `:*` form: a slash command carries its arguments in the token, so an
  // invocation like `/impeccable craft <x>` needs `Skill(impeccable:*)`, while a
  // bare `/update-readme` needs `Skill(update-readme)`.
  { path: '.claude/skills/develop-web-feature', entry: 'Skill(develop-web-feature)' },
  { path: '.claude/skills/develop-web-feature', entry: 'Skill(develop-web-feature:*)' },
  { path: '.claude/skills/commit-message',      entry: 'Skill(commit-message)' },
  { path: '.claude/skills/commit-message',      entry: 'Skill(commit-message:*)' },
  { path: '.claude/skills/create-pr',           entry: 'Skill(create-pr)' },
  { path: '.claude/skills/create-pr',           entry: 'Skill(create-pr:*)' },
  { path: '.claude/skills/impeccable',          entry: 'Skill(impeccable)' },
  { path: '.claude/skills/impeccable',          entry: 'Skill(impeccable:*)' },
  { path: '.claude/skills/update-readme',       entry: 'Skill(update-readme)' },
  { path: '.claude/skills/update-readme',       entry: 'Skill(update-readme:*)' },
  // /impeccable runs several scripts from its own dir (detect, live-server,
  // critique-storage, context, load-context, trend, …); one wildcard covers them.
  { path: '.claude/skills/impeccable',          entry: 'Bash(node .claude/skills/impeccable/scripts/*)' },
  // critique-storage is also invoked with an env-var prefix (IMPECCABLE_CRITIQUE_META=...),
  // which shifts the command prefix so the node-path entry alone does not match.
  { path: '.claude/skills/impeccable',          entry: 'Bash(IMPECCABLE_CRITIQUE_META=*)' },
  // commit/PR creation only via the sentinel forms the guard hooks demand; the
  // skills set the sentinel, so this trusts the skill, not arbitrary commits.
  { path: '.claude/skills/commit-message',      entry: 'Bash(CLAUDE_COMMIT_VIA_SKILL=1 git commit:*)' },
  { path: '.claude/skills/create-pr',           entry: 'Bash(CLAUDE_PR_VIA_SKILL=1 gh pr create:*)' },
  // create-pr also READS pr state — `gh pr list` (existing-PR check) and
  // `gh pr view` (post-create verify). Merge/close stay ungranted: Phase 7 is human.
  { path: '.claude/skills/create-pr',           entry: 'Bash(gh pr view:*)' },
  { path: '.claude/skills/create-pr',           entry: 'Bash(gh pr list:*)' },
];

// Plugin-channel skill tokens. Plugin-installed skills are namespaced
// (/web-dev:develop-web-feature) and never appear under .claude/skills, so the
// filesystem detection above cannot see them. When this script itself runs from
// the plugin cache, grant the namespaced forms for the skills the two plugins
// bundle, plus the sentinel/read entries their guard hooks and verify steps
// need. Entries for a plugin that is not installed are inert.
const PLUGIN_SKILL_TOKENS = isPluginChannel
  ? [
      'Skill(web-dev:develop-web-feature)',
      'Skill(web-dev:develop-web-feature:*)',
      'Skill(web-dev:update-readme)',
      'Skill(web-dev:update-readme:*)',
      'Skill(git-workflow:commit-message)',
      'Skill(git-workflow:commit-message:*)',
      'Skill(git-workflow:create-pr)',
      'Skill(git-workflow:create-pr:*)',
      'Bash(CLAUDE_COMMIT_VIA_SKILL=1 git commit:*)',
      'Bash(CLAUDE_PR_VIA_SKILL=1 gh pr create:*)',
      'Bash(gh pr view:*)',
      'Bash(gh pr list:*)',
    ]
  : [];

let settings = {};
if (existsSync(SETTINGS_PATH)) {
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (err) {
    console.error(`[setup] ERROR: ${SETTINGS_PATH} contains invalid JSON — aborting to avoid data loss.`);
    console.error(`[setup] Fix the file manually, then re-run setup.`);
    process.exit(1);
  }
}
if (!settings.permissions) settings.permissions = {};
if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

// Dry run by default; --write applies the delta.
const applyMode = process.argv.slice(2).includes('--write');

// Everything this setup manages, in order: REQUIRED + TOOLCHAIN always, plus
// each CONDITIONAL entry whose skill/tool is actually present. De-dupe while
// preserving order (a Set keeps insertion order).
const initialAllow = new Set(settings.permissions.allow);
const candidates = [...REQUIRED, ...TOOLCHAIN, ...MCP_PLAYWRIGHT, ...EDIT_GRANTS, ...PLUGIN_SKILL_TOKENS];
for (const { path, entry } of CONDITIONAL) {
  if (existsSync(path)) candidates.push(entry);
}
const managed = [...new Set(candidates)];
const toAdd = managed.filter((entry) => !initialAllow.has(entry));
const alreadyPresent = managed.length - toAdd.length;

// Nothing to change: identical in either mode, so a steady-state re-run on every
// session stays quiet and exits 0 (the common case).
if (toAdd.length === 0) {
  console.log('[setup] All required allow entries already present — nothing to do.');
  process.exit(0);
}

// A delta exists. Dry run (default): list ONLY the new entries, write nothing,
// and exit non-zero so the caller can detect that grants want to expand. This is
// the moment a skill update's new grants become visible before they land.
if (!applyMode) {
  console.log('[setup] DRY RUN — no changes written.');
  console.log(
    `[setup] ${toAdd.length} new ${toAdd.length === 1 ? 'entry' : 'entries'} would be added to ${SETTINGS_PATH}` +
      (alreadyPresent ? ` (${alreadyPresent} already present):` : ':'),
  );
  toAdd.forEach((entry) => console.log(`  + ${entry}`));
  console.log('[setup] Review the list above, then re-run with --write to apply.');
  process.exit(1);
}

// --write: apply the delta.
for (const entry of toAdd) settings.permissions.allow.push(entry);
writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
console.log(`[setup] Added ${toAdd.length} allow ${toAdd.length === 1 ? 'entry' : 'entries'} to ${SETTINGS_PATH}:`);
toAdd.forEach((entry) => console.log(`  + ${entry}`));
process.exit(0);
