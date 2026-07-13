#!/usr/bin/env node
/**
 * setup.mjs
 * Ensure .claude/settings.local.json has all the allow entries needed for
 * develop-react-native-feature to run hands-off. Safe to run multiple times
 * (idempotent). Run from the project root.
 *
 * Defaults to a DRY RUN: prints the entries it would add and writes nothing,
 * exiting non-zero when a delta exists so a skill update can never widen the
 * allow list silently. Re-run with --write to apply:
 *   node .claude/skills/develop-react-native-feature/scripts/setup.mjs            # preview the delta
 *   node .claude/skills/develop-react-native-feature/scripts/setup.mjs --write    # apply it
 *
 * --grant-edits (opt-in, off by default): also grant the structured file-edit
 * tools (Edit/Write/MultiEdit) so a hands-off run does not stop on the per-edit
 * permission prompt. Scoped to the project's JS/TS source and test directories
 * that exist — ios/ and android/ are deliberately excluded (native edits are
 * rare in RN feature work and should prompt), as are root config, .github/,
 * .claude/, and docs:
 *   node .claude/skills/develop-react-native-feature/scripts/setup.mjs --grant-edits           # preview
 *   node .claude/skills/develop-react-native-feature/scripts/setup.mjs --grant-edits --write   # apply
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
 *   - adb uninstall, adb root, adb shell rm, adb shell settings put (the demo
 *     clock pin runs inside device.mjs only) — emulators are looked at, never
 *     administered
 *   - emulator -wipe-data; avdmanager create/delete — AVDs are the user's
 *   - broad npx: expo/react-native CLI invocations route through the helper
 *     scripts (metro.mjs, device.mjs, gates.mjs), whose subprocesses are not
 *     re-checked, so no standing `npx expo` / `npx react-native` grant exists
 *   - anything keystore / signing / provisioning; eas / store submission
 *   - gh pr merge — Phase 7 is a human gate
 *
 * Portable: the toolchain grants are DERIVED from the project (its package.json
 * scripts, lockfile, configs, and native dirs), never hard-coded to one app.
 * The skill-infra and git grants are ecosystem-generic. So this is safe to
 * ship via a skills repo and run unchanged in any React Native project.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SETTINGS_PATH = '.claude/settings.local.json';

// --- Detect the install channel ---
// npx skills installs this skill at
// <project>/.claude/skills/develop-react-native-feature/; the react-native-dev
// plugin runs these scripts from the plugin cache via its drnf-* bin wrappers.
// The channel decides which command forms the grants must match, so derive it
// from where this script actually lives.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const NPX_SCRIPT_DIR = resolve('.claude/skills/develop-react-native-feature/scripts');
const isPluginChannel = SCRIPT_DIR !== NPX_SCRIPT_DIR;

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// --- Detect the project so the grants fit whatever app is in use ---
const pkg = readJSON('package.json');
const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
const scripts = pkg?.scripts ?? {};
const hasExpo = Boolean(deps.expo);
const hasAndroidGradlew = existsSync('android/gradlew');
const isDarwin = process.platform === 'darwin';
const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || null;
const adbAvailable = Boolean(sdkRoot)
  || spawnSync(process.platform === 'win32' ? 'where' : 'which', ['adb'], { encoding: 'utf8' }).status === 0;
const androidRelevant = hasAndroidGradlew || adbAvailable || hasExpo;

// Narrow package-script grants, only for gate-shaped scripts package.json
// actually defines (the Makefile-target analog). Never a bare `Bash(npm run *)`
// — a scripts block can hold deploy/publish entries too.
const pm = existsSync('pnpm-lock.yaml') ? 'pnpm'
  : existsSync('yarn.lock') ? 'yarn'
    : (existsSync('bun.lockb') || existsSync('bun.lock')) ? 'bun'
      : 'npm';
const SCRIPT_GRANT_PREFIXES = ['test', 'lint', 'typecheck', 'type-check', 'format'];
const PM_RUN_GRANTS = SCRIPT_GRANT_PREFIXES
  .filter((p) => Object.keys(scripts).some((s) => s === p || s.startsWith(`${p}:`)))
  .map((p) => (pm === 'yarn' ? `Bash(yarn ${p}*)` : `Bash(${pm} run ${p}*)`));

// --grant-edits (opt-in, off by default): auto-approve the structured file-edit
// tools so a hands-off run does not stop on the per-edit permission prompt.
// Deliberately scoped to the project's JS/TS source/test directories that exist
// (NOT ios/, android/, root config, .github/, .claude/, or docs — those still
// prompt), and DERIVED from the layout rather than hard-coded, so it stays
// portable. It is narrower than accept-edits mode (which auto-approves EVERY
// path) but, unlike that per-session mode, it persists across sessions — hence
// opt-in only.
const grantEdits = process.argv.slice(2).includes('--grant-edits');
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit'];
const SOURCE_DIRS = ['src', 'app', 'components', 'screens', 'features', 'navigation', 'hooks', '__tests__', 'e2e'];
const EDIT_GRANTS = grantEdits
  ? SOURCE_DIRS.filter((d) => existsSync(d)).flatMap((d) => EDIT_TOOLS.map((tool) => `${tool}(${d}/**)`))
  : [];

// The skill's own helper scripts (the gate runner, Phase 0 scripts, the Metro
// and device run-target helpers, and the critique convergence check). The
// command form is channel-dependent: node + project path under npx skills, the
// plugin's drnf-* bin wrappers under the react-native-dev plugin — the wrapper
// names are stable across machines, unlike the plugin cache path.
const SCRIPT_NAMES = ['setup', 'discover', 'gates', 'metro', 'device', 'critique-plan', 'cache-check', 'cache-write'];
const SCRIPT_GRANTS = SCRIPT_NAMES.map((n) =>
  isPluginChannel
    ? `Bash(drnf-${n}*)`
    : `Bash(node .claude/skills/develop-react-native-feature/scripts/${n}.mjs*)`,
);

const REQUIRED = [
  // Full-suite gate runs (typecheck / lint / test) go through the gate runner,
  // which orchestrates them in Node and logs each to the cache dir.
  // Subprocesses it spawns are not re-checked against the allow list, so that
  // single entry (in SCRIPT_GRANTS) also covers commands pinned in gates.json —
  // and the same collapse is why metro.mjs / device.mjs need no standing
  // `npx expo` / `npx react-native` / gradle grants for what they run inside.
  ...SCRIPT_GRANTS,
  // Single-target iteration while building (Phase 2/5): one test file, one
  // lint target, a quick typecheck.
  'Bash(npx tsc --noEmit*)',
  'Bash(npx jest*)',
  'Bash(npx eslint*)',
  ...PM_RUN_GRANTS,
  // iOS half (macOS only). xcodebuild's verbs are arguments, not the first
  // token, so this is one prefix grant; the actions the workflow uses are
  // build/-list — archive/upload never appear in the skill and the release
  // phase stays human.
  ...(isDarwin
    ? [
        'Bash(xcodebuild*)',
        'Bash(xcode-select -p*)',
        'Bash(plutil -convert json*)',
        // simctl, subcommand-scoped: lifecycle + capture only. The destructive
        // subcommands (erase, delete, create, clone, privacy, keychain, spawn)
        // are deliberately absent — see the never-granted list in the header.
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
      ]
    : []),
  // Android half, only when the project/machine makes it relevant. adb is
  // subcommand-scoped to the install/launch/screenshot lifecycle; uninstall,
  // root, shell rm, and settings put are deliberately absent. Emulator BOOT is
  // not granted — it needs a detached spawn, which only device.mjs does.
  ...(androidRelevant
    ? [
        'Bash(adb devices*)',
        'Bash(adb install*)',
        'Bash(adb reverse*)',
        'Bash(adb wait-for-device*)',
        'Bash(adb shell getprop*)',
        'Bash(adb shell am start*)',
        'Bash(adb shell monkey*)',
        'Bash(adb shell cmd uimode*)',
        'Bash(adb exec-out screencap*)',
        'Bash(adb emu kill*)',
        'Bash(emulator -list-avds*)',
        ...(hasAndroidGradlew ? ['Bash(android/gradlew*)'] : []),
      ]
    : []),
  // Installing the REQUIRED subset of official Expo skills (Phase 0) — scoped
  // to the expo/skills source, never a bare `npx skills`.
  ...(hasExpo ? ['Bash(npx skills add expo/skills*)'] : []),
  // Spec / fixture directory creation. `mkdir -p` is create-only, never destructive.
  'Bash(mkdir -p *)',
  // The commit flow measures subject lengths with `printf '%s' … | wc -m` on
  // every commit (each pipe segment is permission-checked separately). Both
  // are read-only stdout utilities.
  'Bash(printf:*)',
  'Bash(wc:*)',
  // Node scripts written to the project cache dir (avoids node -e inline blocks)
  'Bash(node .cache/develop-react-native-feature/*)',
  // Deleting the skill's own temp files. Scoped to the gitignored cache dir, so
  // a bare `rm` elsewhere still prompts.
  'Bash(rm -f .cache/develop-react-native-feature/*)',
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
  // invocation like `/develop-react-native-feature Workout history` needs
  // `Skill(develop-react-native-feature:*)`, while a bare `/update-readme` needs
  // `Skill(update-readme)`.
  { path: '.claude/skills/develop-react-native-feature', entry: 'Skill(develop-react-native-feature)' },
  { path: '.claude/skills/develop-react-native-feature', entry: 'Skill(develop-react-native-feature:*)' },
  { path: '.claude/skills/commit-message',               entry: 'Skill(commit-message)' },
  { path: '.claude/skills/commit-message',               entry: 'Skill(commit-message:*)' },
  { path: '.claude/skills/create-pr',                    entry: 'Skill(create-pr)' },
  { path: '.claude/skills/create-pr',                    entry: 'Skill(create-pr:*)' },
  { path: '.claude/skills/update-readme',                entry: 'Skill(update-readme)' },
  { path: '.claude/skills/update-readme',                entry: 'Skill(update-readme:*)' },
  // commit/PR creation only via the sentinel forms the guard hooks demand; the
  // skills set the sentinel, so this trusts the skill, not arbitrary commits.
  { path: '.claude/skills/commit-message',               entry: 'Bash(CLAUDE_COMMIT_VIA_SKILL=1 git commit:*)' },
  { path: '.claude/skills/create-pr',                    entry: 'Bash(CLAUDE_PR_VIA_SKILL=1 gh pr create:*)' },
  // create-pr also READS pr state — `gh pr list` (existing-PR check) and
  // `gh pr view` (post-create verify). Merge/close stay ungranted: Phase 7 is human.
  { path: '.claude/skills/create-pr',                    entry: 'Bash(gh pr view:*)' },
  { path: '.claude/skills/create-pr',                    entry: 'Bash(gh pr list:*)' },
];

// Installed Expo skills (the Phase 0 required subset lands in .claude/skills):
// token each one that is actually present, both bare and :* forms.
const EXPO_SKILL_TOKENS = existsSync('.claude/skills')
  ? (() => {
      try {
        return readdirSync('.claude/skills')
          .filter((d) => (d.startsWith('expo-') || d.startsWith('eas-')) && existsSync(join('.claude/skills', d, 'SKILL.md')))
          .flatMap((d) => [`Skill(${d})`, `Skill(${d}:*)`]);
      } catch { return []; }
    })()
  : [];

// Plugin-channel skill tokens — react-native-dev's OWN skills only. They are
// namespaced (/react-native-dev:develop-react-native-feature) and never appear
// under .claude/skills, so the filesystem detection above cannot see them; but
// react-native-dev is running this very script, so its tokens are always valid.
// Other plugins own their grants: the git-workflow plugin ships its own
// gwf-setup with the same dry-run/--write contract — this script never writes
// another plugin's entries.
const PLUGIN_SKILL_TOKENS = isPluginChannel
  ? [
      'Skill(react-native-dev:develop-react-native-feature)',
      'Skill(react-native-dev:develop-react-native-feature:*)',
      'Skill(react-native-dev:update-readme)',
      'Skill(react-native-dev:update-readme:*)',
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

// Everything this setup manages, in order: REQUIRED always, plus each
// CONDITIONAL entry whose skill is actually present. De-dupe while preserving
// order (a Set keeps insertion order).
const initialAllow = new Set(settings.permissions.allow);
const candidates = [...REQUIRED, ...EDIT_GRANTS, ...EXPO_SKILL_TOKENS, ...PLUGIN_SKILL_TOKENS];
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
