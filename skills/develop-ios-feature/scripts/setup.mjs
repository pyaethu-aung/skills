#!/usr/bin/env node
/**
 * setup.mjs
 * Ensure .claude/settings.local.json has all the allow entries needed for
 * develop-ios-feature to run hands-off. Safe to run multiple times (idempotent).
 * Run from the project root.
 *
 * Defaults to a DRY RUN: prints the entries it would add and writes nothing,
 * exiting non-zero when a delta exists so a skill update can never widen the
 * allow list silently. Re-run with --write to apply:
 *   node .claude/skills/develop-ios-feature/scripts/setup.mjs            # preview the delta
 *   node .claude/skills/develop-ios-feature/scripts/setup.mjs --write    # apply it
 *
 * --grant-edits (opt-in, off by default): also grant the structured file-edit
 * tools (Edit/Write/MultiEdit) so a hands-off run does not stop on the per-edit
 * permission prompt. Scoped to the project's Swift source/test directories that
 * exist (root config, .github/, .claude/, and docs still prompt) — narrower
 * than accept-edits mode, which auto-approves every path:
 *   node .claude/skills/develop-ios-feature/scripts/setup.mjs --grant-edits           # preview
 *   node .claude/skills/develop-ios-feature/scripts/setup.mjs --grant-edits --write   # apply
 *
 * Personal, not shared: auto-approve grants are a per-developer trust decision,
 * so they go in the gitignored .local file (where Claude Code itself writes
 * "always allow" approvals) — never the committed settings.json. Each developer
 * runs this once in their own checkout to opt in. Project-wide enforcement
 * (the commit/PR guard hooks) stays in the shared settings.json.
 *
 * Deliberately NEVER granted (each prompts if the workflow ever needs it):
 *   - git push, git rm, git reset, bare rm — destructive or outward-facing
 *   - xcrun simctl erase|delete|create|clone|privacy|keychain|spawn — the
 *     workflow only boots/installs/launches/screenshots/shuts down; it never
 *     resets or reshapes simulators
 *   - xcrun devicectl device reboot / uninstall / wipe, devicectl manage
 *     (pairing) — physical hardware is looked at, never administered
 *   - agvtool — version bumps edit the file via the normal edit flow
 *
 * Portable: the toolchain grants are DERIVED from the project (its lint config
 * and Makefile targets), never hard-coded to one app. The skill-infra and git
 * grants are ecosystem-generic. So this is safe to ship via a skills repo and
 * run unchanged in any iOS project.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SETTINGS_PATH = '.claude/settings.local.json';

// --- Detect the install channel ---
// npx skills installs this skill at <project>/.claude/skills/develop-ios-feature/;
// the ios-dev plugin runs these scripts from the plugin cache via its dif-* bin
// wrappers. The channel decides which command forms the grants must match, so
// derive it from where this script actually lives.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const NPX_SCRIPT_DIR = resolve('.claude/skills/develop-ios-feature/scripts');
const isPluginChannel = SCRIPT_DIR !== NPX_SCRIPT_DIR;

function readText(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

// --- Detect the project so the grants fit whatever app is in use ---
const hasSwiftlint = ['.swiftlint.yml', '.swiftlint.yaml'].some((p) => existsSync(p));
const hasSwiftformat = existsSync('.swiftformat');

// Narrow make grants, only for gate-shaped targets the Makefile actually defines.
// Never Bash(make *): a Makefile can hold deploy/destroy targets too.
const makefile = readText('Makefile');
const makeTargets = new Set(
  [...makefile.matchAll(/^([A-Za-z0-9][A-Za-z0-9_./-]*)\s*:/gm)].map((m) => m[1]),
);
const MAKE_GRANT_PREFIXES = ['test', 'lint', 'build'];
const MAKE_GRANTS = MAKE_GRANT_PREFIXES
  .filter((p) => [...makeTargets].some((t) => t === p || t.startsWith(`${p}-`) || t.startsWith(`${p}:`)))
  .map((p) => `Bash(make ${p}*)`);

const TOOLCHAIN = [
  ...(hasSwiftlint ? ['Bash(swiftlint*)'] : []),
  ...(hasSwiftformat ? ['Bash(swiftformat --lint*)'] : []),
  ...MAKE_GRANTS,
];

// --grant-edits (opt-in, off by default): auto-approve the structured file-edit
// tools so a hands-off run does not stop on the per-edit permission prompt.
// Deliberately scoped to the project's Swift source/test directories that exist
// (NOT root config, .github/, .claude/, or docs — those still prompt), and
// DERIVED from the layout rather than hard-coded, so it stays portable. It is
// narrower than accept-edits mode (which auto-approves EVERY path) but, unlike
// that per-session mode, it persists across sessions — hence opt-in only.
const grantEdits = process.argv.slice(2).includes('--grant-edits');
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit'];
const rootEntries = (() => { try { return readdirSync('.'); } catch { return []; } })();
const xcodeprojs = rootEntries.filter((e) => e.endsWith('.xcodeproj'));
// SPM layout dirs plus the app/test folders named after the Xcode project.
const appBase = xcodeprojs[0]?.replace(/\.xcodeproj$/, '');
const SOURCE_DIRS = [
  'Sources', 'Tests',
  ...(appBase ? [appBase, `${appBase}Tests`, `${appBase}UITests`] : []),
];
// Projects without Xcode 16 filesystem-synchronized groups must register every
// new file in project.pbxproj, so that one file joins the edit grant.
const syncedGroups = xcodeprojs.some((p) => readText(`${p}/project.pbxproj`).includes('PBXFileSystemSynchronizedRootGroup'));
const PBXPROJ_GRANTS = (grantEdits && xcodeprojs.length && !syncedGroups)
  ? xcodeprojs.flatMap((p) => EDIT_TOOLS.map((tool) => `${tool}(${p}/project.pbxproj)`))
  : [];
const EDIT_GRANTS = grantEdits
  ? [
      ...[...new Set(SOURCE_DIRS)].filter((d) => existsSync(d)).flatMap((d) => EDIT_TOOLS.map((tool) => `${tool}(${d}/**)`)),
      ...PBXPROJ_GRANTS,
    ]
  : [];

// The skill's own helper scripts (the gate runner, Phase 0 scripts, the app
// run-target helper, and the critique convergence check). The command form is
// channel-dependent: node + project path under npx skills, the plugin's dif-*
// bin wrappers under the ios-dev plugin — the wrapper names are stable across
// machines, unlike the plugin cache path.
const SCRIPT_NAMES = ['setup', 'discover', 'gates', 'device', 'critique-plan', 'cache-check', 'cache-write'];
const SCRIPT_GRANTS = SCRIPT_NAMES.map((n) =>
  isPluginChannel
    ? `Bash(dif-${n}*)`
    : `Bash(node .claude/skills/develop-ios-feature/scripts/${n}.mjs*)`,
);

const REQUIRED = [
  // Full-suite gate runs (build / lint / test / UI) go through the gate runner,
  // which orchestrates them in Node and logs each to the cache dir.
  // Subprocesses it spawns are not re-checked against the allow list, so that
  // single entry (in SCRIPT_GRANTS) also covers commands pinned in gates.json.
  ...SCRIPT_GRANTS,
  // Single-target iteration while building (Phase 2/5). xcodebuild's verbs are
  // arguments, not the first token, so this is one prefix grant; the actions the
  // workflow uses are build/test/-list — archive/upload never appear in the
  // skill and the release phase stays human.
  'Bash(xcodebuild*)',
  'Bash(xcode-select -p*)',
  'Bash(swift build*)',
  'Bash(swift test*)',
  'Bash(swift package describe*)',
  'Bash(swift package dump-package*)',
  'Bash(swift --version*)',
  // simctl, subcommand-scoped: lifecycle + capture only. The destructive
  // subcommands (erase, delete, create, clone, privacy, keychain, spawn) are
  // deliberately absent — see the never-granted list in the header.
  'Bash(xcrun simctl list*)',
  'Bash(xcrun simctl boot*)',
  'Bash(xcrun simctl bootstatus*)',
  'Bash(xcrun simctl shutdown*)',
  'Bash(xcrun simctl install*)',
  'Bash(xcrun simctl launch*)',
  'Bash(xcrun simctl terminate*)',
  'Bash(xcrun simctl io*)',
  'Bash(xcrun simctl ui*)',
  'Bash(xcrun simctl status_bar*)',
  'Bash(xcrun simctl get_app_container*)',
  // devicectl, subcommand-scoped: the physical critique target. Reboot,
  // uninstall, wipe, and pairing management are deliberately absent.
  'Bash(xcrun devicectl list*)',
  'Bash(xcrun devicectl device info*)',
  'Bash(xcrun devicectl device install*)',
  'Bash(xcrun devicectl device process launch*)',
  'Bash(xcrun devicectl device process terminate*)',
  'Bash(xcrun devicectl device screenshot*)',
  // Reading test/coverage results out of .xcresult bundles, and app Info.plists.
  'Bash(xcrun xcresulttool*)',
  'Bash(xcrun xccov*)',
  'Bash(plutil -convert json*)',
  // Spec / fixture directory creation. `mkdir -p` is create-only, never destructive.
  'Bash(mkdir -p *)',
  // Node scripts written to the project cache dir (avoids node -e inline blocks)
  'Bash(node .cache/develop-ios-feature/*)',
  // Deleting the skill's own temp files. Scoped to the gitignored cache dir, so
  // a bare `rm` elsewhere still prompts.
  'Bash(rm -f .cache/develop-ios-feature/*)',
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
  // git rm is deliberately NOT granted: tracked-file deletion is occasional
  // enough that a one-off prompt beats a standing destructive grant (plain
  // `rm` stays ungranted too, so every delete path prompts).
  // Unstaging so each logical change commits atomically (stage a subset, commit,
  // repeat). `--staged` is part of the match, so the destructive forms (`git
  // reset --hard`, working-tree `git restore`) still prompt.
  'Bash(git restore --staged:*)',
  'Bash(git switch:*)',
  'Bash(git checkout -b:*)',
  // git push is deliberately NOT granted here: /create-pr pre-approves it via
  // its own allowed-tools while it runs (the recommended path in every mode),
  // and the direct no-create-pr fallback should prompt once — an auto-approved
  // outward push is only safe in projects whose pre-push hook blocks the
  // default branch, which cannot be assumed.
];

// Added only when the corresponding skill is present
const CONDITIONAL = [
  // Skill-invocation tokens. The Claude Code token is `Skill(...)` SINGULAR — the
  // plural `Skills(...)` never matches (verified against the tokens Claude Code
  // itself writes to settings.local.json on approval). Grant BOTH the bare form
  // and the `:*` form: a slash command carries its arguments in the token, so an
  // invocation like `/develop-ios-feature Workout history` needs
  // `Skill(develop-ios-feature:*)`, while a bare `/update-readme` needs
  // `Skill(update-readme)`.
  { path: '.claude/skills/develop-ios-feature', entry: 'Skill(develop-ios-feature)' },
  { path: '.claude/skills/develop-ios-feature', entry: 'Skill(develop-ios-feature:*)' },
  { path: '.claude/skills/commit-message',      entry: 'Skill(commit-message)' },
  { path: '.claude/skills/commit-message',      entry: 'Skill(commit-message:*)' },
  { path: '.claude/skills/create-pr',           entry: 'Skill(create-pr)' },
  { path: '.claude/skills/create-pr',           entry: 'Skill(create-pr:*)' },
  { path: '.claude/skills/update-readme',       entry: 'Skill(update-readme)' },
  { path: '.claude/skills/update-readme',       entry: 'Skill(update-readme:*)' },
  // commit/PR creation only via the sentinel forms the guard hooks demand; the
  // skills set the sentinel, so this trusts the skill, not arbitrary commits.
  { path: '.claude/skills/commit-message',      entry: 'Bash(CLAUDE_COMMIT_VIA_SKILL=1 git commit:*)' },
  { path: '.claude/skills/create-pr',           entry: 'Bash(CLAUDE_PR_VIA_SKILL=1 gh pr create:*)' },
  // create-pr also READS pr state — `gh pr list` (existing-PR check) and
  // `gh pr view` (post-create verify). Merge/close stay ungranted: Phase 7 is human.
  { path: '.claude/skills/create-pr',           entry: 'Bash(gh pr view:*)' },
  { path: '.claude/skills/create-pr',           entry: 'Bash(gh pr list:*)' },
];

// Plugin-channel skill tokens — ios-dev's OWN skills only. They are namespaced
// (/ios-dev:develop-ios-feature) and never appear under .claude/skills, so the
// filesystem detection above cannot see them; but ios-dev is running this very
// script, so its tokens are always valid. Other plugins own their grants: the
// git-workflow plugin ships its own gwf-setup with the same dry-run/--write
// contract — this script never writes another plugin's entries.
const PLUGIN_SKILL_TOKENS = isPluginChannel
  ? [
      'Skill(ios-dev:develop-ios-feature)',
      'Skill(ios-dev:develop-ios-feature:*)',
      'Skill(ios-dev:update-readme)',
      'Skill(ios-dev:update-readme:*)',
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
// each CONDITIONAL entry whose skill is actually present. De-dupe while
// preserving order (a Set keeps insertion order).
const initialAllow = new Set(settings.permissions.allow);
const candidates = [...REQUIRED, ...TOOLCHAIN, ...EDIT_GRANTS, ...PLUGIN_SKILL_TOKENS];
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
// A plugin-channel project may have no .claude/ directory yet — nothing else
// creates it before this script runs.
mkdirSync('.claude', { recursive: true });
writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
console.log(`[setup] Added ${toAdd.length} allow ${toAdd.length === 1 ? 'entry' : 'entries'} to ${SETTINGS_PATH}:`);
toAdd.forEach((entry) => console.log(`  + ${entry}`));
process.exit(0);
