---
name: develop-react-native-feature
description: "Develop and ship a React Native feature end-to-end: shape the feature, build components and screens with tests, gate on typecheck/lint/jest, critique the running app in the iOS Simulator AND the Android Emulator in light and dark, fix, open a PR, and release. Supports Expo (managed and prebuild) and bare React Native; Android degrades gracefully when no SDK is installed. Use when asked to add or build a React Native, Expo, or cross-platform mobile feature or screen."
metadata:
  version: "1.0.0"
argument-hint: "[--auto] The feature to build (e.g. 'Workout history screen with weekly chart')"
allowed-tools: Bash(node*) Bash(npx*) Bash(xcrun*) Bash(xcodebuild*) Bash(xcode-select*) Bash(adb*) Bash(emulator*) Bash(plutil*) Bash(git:*) Bash(gh:*) Bash(grep*) Bash(ls*) Bash(cat*) Read Write Edit Task
---

# Develop a React Native feature

The playbook for taking a React Native feature from idea to release. It is not
a runnable driver: the "driver" is the sequence of skill invocations and gate
commands below.

The loop, in one line: **learn → shape → build → gate → evaluate (dual-platform
critique + code audit) → fix ↻ → commit → docs → PR**, then ship: **merge →
version bump → tag + release**. The evaluate phase judges the app running in
the **iOS Simulator and the Android Emulator** — light and dark on each — and
the gate/evaluate → fix cycle repeats until no P0/P1 findings remain. A machine
without the Android SDK degrades gracefully: the critique runs iOS-only and
says so in its snapshot.

This skill is portable. The *workflow* and *disciplines* are the same in every
project; the *specifics* (Expo managed vs prebuild vs bare RN, gate commands,
navigation and state idioms) differ, so Phase 0 discovers them before any code
is written. It requires **Node and, for the iOS half, macOS with full Xcode**
(plus CocoaPods when the project checks in `ios/`); the Android half needs the
Android SDK with at least one AVD, and is optional. A concrete worked example
from one app is at the end, as illustration only: yours will differ.

## Autonomous mode (reduce human-in-the-loop)

By default the workflow pauses in several places: Phase 1 confirms the shape,
the Phase 4 critique hands its findings back, and the commit and PR skills
each confirm. When the request asks for a hands-off run (it says "autonomous"
or "hands-off", or passes `--auto`), collapse those into a single review at
the PR:

- **Skip the Phase 1 shape confirmation** when the prompt is already a
  complete spec. Phase 0's rule still holds: if the scope is genuinely
  ambiguous, ask once rather than build the wrong thing.
- **Run the full evaluate phase without pausing, and derive the work-list
  from the persisted snapshot, not from a prompt.** Phase 4 writes every
  critique to
  `.cache/develop-react-native-feature/critique/<timestamp>__<slug>.md`
  (YAML frontmatter with `p0_count` / `p1_count`, plus a `## Priority Issues`
  section). Run
  `node .claude/skills/develop-react-native-feature/scripts/critique-plan.mjs`
  (add `--slug <slug>` to target one file): it reads the latest snapshot,
  prints the P0/P1 to fix and the P2/P3 to defer, and exits non-zero while
  any P0/P1 remain — a deterministic convergence signal, like the gate
  runner. Keep looping while it exits non-zero.
- **Surface what was not fixed.** P0/P1 findings are fixed in the Phase 5
  loop; the remaining P2/P3 are deliberately not auto-fixed, but must not
  vanish in a hands-off run. List them in the PR body under a
  **Deferred (P2/P3)** heading, taken from `critique-plan.mjs`'s output, so
  they can be triaged at review. An Android-skipped note (no SDK on this
  machine) belongs there too.
- **File edits still gate on permission; handle that out-of-band.** `--auto`
  removes the skill's own confirmations, but Claude Code still prompts before
  each `Edit` / `Write`. For an unattended run, enable one of: accept-edits
  mode (shift+tab, or `--permission-mode acceptEdits`); `bypassPermissions`
  for fully unattended; or grant scoped edits up front with
  `node .claude/skills/develop-react-native-feature/scripts/setup.mjs --grant-edits --write`,
  which auto-approves `Edit` / `Write` / `MultiEdit` for the project's JS/TS
  source and test directories only — `ios/` and `android/` are deliberately
  excluded, so native edits still prompt (as do root config, `.github/`,
  `.claude/`, and docs). The scoped grant is narrower than accept-edits mode
  but persists across sessions, so it is opt-in; pick per your trust
  preference.
- **Commit and open the PR without prompting:** route through
  `/commit-message --yes` and `/create-pr --yes` (same format and skill token,
  no confirmation pause). Opening the PR is **not optional** — never stop
  before it is open.
- **Stop immediately after the PR is open.** Do not auto-merge and do not
  publish the release; PR approval, merge, and the release publish stay human
  (Phase 7). Report the PR URL and deferred findings, then stop. The user
  will resume Phase 7 manually once the PR is merged.

**Pre-flight is a hard gate — verify permissions are APPLIED before Phase 1.**
`--auto` removes the skill's own confirmations, not the harness permission
prompts; a hands-off run whose grants were never written degenerates into a
prompt storm. Before starting Phase 1 in a hands-off run:

1. `setup.mjs --write` has been applied and a re-run of the dry form
   **exits 0** (steady state — nothing left to add).
2. When the git-workflow plugin is installed, `gwf-setup --write` likewise
   re-runs clean.
3. The edit path is pre-authorized: `setup.mjs --grant-edits --write`,
   accept-edits mode, or `bypassPermissions` — otherwise every `Edit`/`Write`
   prompts mid-loop.

If any of these cannot be satisfied (e.g. the bootstrap grant for
`setup.mjs` itself is missing, so even the dry run prompts), **stop and
tell the user exactly what to do** — the one-time
`"Bash(drnf-setup*)"` / `"Bash(gwf-setup*)"` entries for
`.claude/settings.local.json` and the `--write` commands to run — rather
than proceeding into a run that prompts on every command.

Autonomous mode removes only the in-flow confirmations. The gates, the fix
loop, atomic commits, and the disciplines are unchanged.

## Phase 0: Set up

### Resolve the install channel (do this first)

This skill ships through two channels and the helper-script command form
differs. Check the skill's **base directory** (shown at invocation) once, and
apply the matching form to every script command in this skill:

- **`.claude/skills/develop-react-native-feature/`** — the `npx skills`
  install. Use the commands exactly as written throughout
  (`node .claude/skills/develop-react-native-feature/scripts/<name>.mjs`).
- **Anywhere else (the plugin cache)** — the `react-native-dev` plugin
  install. The plugin puts wrapper commands on the PATH; substitute
  `drnf-<name>` for
  `node .claude/skills/develop-react-native-feature/scripts/<name>.mjs`
  everywhere: `drnf-setup`, `drnf-discover`, `drnf-gates`, `drnf-metro`,
  `drnf-device`, `drnf-critique-plan`, `drnf-cache-check`,
  `drnf-cache-write`. Skill invocations are namespaced on this channel
  (`/react-native-dev:develop-react-native-feature`,
  `/react-native-dev:update-readme`, `/git-workflow:commit-message`, …); read
  every skill reference below accordingly.

`setup.mjs` detects the channel itself (from where it runs) and writes the
matching grant and token forms, so no permission entry needs hand-editing
when switching channels — but do not mix channels in one project: the same
skill installed twice under different names is a recipe for confusion.

Each plugin owns its own grants. On the plugin channel, `setup.mjs` manages
only react-native-dev's entries; when the **git-workflow plugin** is
installed, also run its `gwf-setup` (same dry-run / `--write` contract) to
grant the commit/PR skill tokens and the sentinel forms its guard hooks
demand. Skip it when git-workflow is not installed — never hand-write another
plugin's entries.

### Configure permissions

The setup script wires up every required allow entry in
`.claude/settings.local.json` (personal and gitignored, never the committed
`settings.json`). It is idempotent and safe to re-run on every session. **It
defaults to a dry run:** it prints the entries it would add and writes nothing,
so any new grant is visible before it lands. Re-run with `--write` to apply.

```bash
node .claude/skills/develop-react-native-feature/scripts/setup.mjs           # preview the delta
node .claude/skills/develop-react-native-feature/scripts/setup.mjs --write   # apply it
```

When the allow list is already complete the dry run reports nothing to do and
exits 0; when grants would change it lists only the *new* entries and exits
non-zero, so a skill update can never widen your permissions silently. In a
hands-off run, surface that delta and confirm before `--write` whenever it is
non-empty; the steady-state case (no delta) needs no pause. **Surface the
delta as the complete entry list, verbatim** — every `+` line the dry run
printed, never a count or paraphrase. Print it as chat text (the canonical
full view; confirmation dialogs are size-limited) and carry it in the
confirmation dialog too, noting "full list in chat above" when it may not
fit. The same rule applies to any other plugin's setup command (e.g.
`gwf-setup`).

By default it grants no file-edit permission, so edits still prompt. Pass
`--grant-edits` (off by default) to also auto-approve `Edit` / `Write` /
`MultiEdit`, scoped to the project's JS/TS source and test directories
(`ios/` and `android/` stay ungranted — native edits prompt), for unattended
runs (see Autonomous mode for the trade-off versus accept-edits mode).

This adds every allow entry a hands-off run needs, **derived from your
project** so it is not tied to any one layout: full-suite gate runs via the
gate runner (`scripts/gates.mjs`, whose one entry replaces broad script
orchestration grants), the direct `npx tsc --noEmit` / `npx jest` /
`npx eslint` forms for single-target iteration, narrow `<pm> run test*` /
`lint*` / `typecheck*` / `format*` forms only for package scripts that exist,
**subcommand-scoped** `xcrun simctl` (list/boot/install/launch/screenshot
lifecycle only, macOS) and `adb` (devices/install/reverse/launch/screenshot/
uimode only, when Android is relevant), `emulator -list-avds` (boot goes
through the device helper only — it needs a detached spawn), the Gradle
wrapper when `android/gradlew` exists, `npx skills add expo/skills` on Expo
projects (for the required-Expo-skills step below), the Phase 0 scripts, the
**Metro and device run-target helpers**, and read-only / staging /
branch-creation git. When the matching skill is installed it also adds the
skill-invocation tokens `Skill(develop-react-native-feature)`,
`Skill(commit-message)`, `Skill(create-pr)`, `Skill(update-readme)`, and the
tokens of any installed `expo-*` skills (each in both the bare and `:*`
form), the sentinel-prefixed commit / PR forms the guard hooks require, and
`gh pr view` / `gh pr list` for create-pr's existing-PR check and verify.

Deliberately **never** granted (each prompts if ever needed): `git push`,
`git rm`, `git reset`, bare `rm`; `xcrun simctl
erase|delete|create|clone|privacy|keychain|spawn`; `adb uninstall`,
`adb root`, `adb shell rm`, `adb shell settings put` (the demo-mode clock pin
runs only inside the device helper); `emulator -wipe-data` and `avdmanager`
create/delete (the workflow only boots, installs, launches, screenshots, and
shuts down — it never resets or reshapes simulators or emulators); broad
`npx expo` / `npx react-native` (those invocations route through the helper
scripts, whose subprocesses are not re-checked); anything touching keystores,
signing, or provisioning; `eas` and store submission. `gh pr merge` stays
ungranted too — Phase 7 is a human gate.

> **Token gotcha:** the Claude Code permission token is `Skill(name)` —
> **singular**. The plural `Skills(name)` silently never matches, so a setup
> that writes it leaves every skill call prompting. Grant both `Skill(name)`
> and `Skill(name:*)`: the `:*` form is what matches an invocation that
> carries arguments (e.g. `/develop-react-native-feature Workout history`).

The only entry that must exist beforehand (to approve `setup.mjs` itself) is
the one matching the install channel — for an `npx skills` install:

```json
"Bash(node .claude/skills/develop-react-native-feature/scripts/setup.mjs*)"
```

or, for the `react-native-dev` plugin install (add the second entry only when
the git-workflow plugin is installed too, so its own setup can run):

```json
"Bash(drnf-setup*)"
"Bash(gwf-setup*)"
```

Add it to `.claude/settings.local.json` once; `setup.mjs` handles everything
else. Because that grant ends in `*`, it also authorizes the `--write` form,
so the dry run is a discipline the workflow follows (preview, confirm a
non-empty delta, then `--write`), not a second approval prompt.

In a hands-off (`--auto`) run this step is a **hard gate**: after `--write`,
re-run the dry form and require exit 0 before Phase 1 — see the pre-flight
in Autonomous mode. Do not carry an unapplied grant delta into the loop.

### Ensure the toolchain

**Node and the project's package manager are the base dependency** (the
lockfile says which — never mix package managers). Then per platform:

- **iOS (macOS only):** full Xcode (not just the Command Line Tools) —
  confirm `xcode-select -p` and `xcodebuild -version` — plus at least one iOS
  Simulator runtime with an available iPhone (`xcrun simctl list`; the
  discovery script reports both). Projects with a checked-in `ios/` dir also
  need CocoaPods (`pod --version`), and `pod install` must have been run
  before the first build.
- **Android (optional):** the Android SDK (`ANDROID_HOME` /
  `ANDROID_SDK_ROOT`, or `adb` on the PATH) with at least one AVD created
  (`emulator -list-avds`). **Absent Android is not a blocker** — the device
  helper prints `NO ANDROID` and exits 3, and the critique runs iOS-only with
  a note in its snapshot. Never install SDKs or create AVDs on the user's
  behalf; say what is missing instead.

Watchman is an optional accelerator; ESLint/TypeScript/Jest are used only as
the project configures them — a config with no installed binary fails the
gate with an install hint rather than being skipped.

**`/commit-message`, `/create-pr`, and `/update-readme` are optional
companions.** They standardize commits, PRs, and README updates, but the
workflow completes without them. On the npx channel install them with
`npx skills add pyaethu-aung/skills --skill <name>`. If a companion is
absent, the phase that uses it falls back to doing the work directly with the
same conventions inlined there.

### Learn this project (do not skip)

**First, check for a cached baseline:**

```bash
node .claude/skills/develop-react-native-feature/scripts/cache-check.mjs
```

If the cache file exists, read it and trust it: skip the discovery below,
re-deriving only the entries whose source has changed. One thing is never
cached — the **green baseline**: always re-run the gates once on a clean
tree, because it is a live fact (dependency or toolchain drift), not a static
answer. If there is no cache file, proceed with full discovery.

**Run the discovery script** to get a structured overview of the flavor,
versions, new-architecture flag, navigation/state/styling idioms, inferred
gates, test and lint setup, tablet targeting, toolchain availability on both
platforms, the required-Expo-skills mapping, git hooks, enforcement config,
and which doc files are present:

```bash
node .claude/skills/develop-react-native-feature/scripts/discover.mjs
```

Use the output as a starting point. Then read `CLAUDE.md` / `AGENTS.md`,
`README`, the lint config, and any doc files the script flagged as present to
fill in the rest. Establish:

- **The flavor:** Expo managed (CNG — no native dirs; `expo run` generates
  them), Expo prebuild (expo dependency with checked-in `ios/` +
  `android/`), or bare React Native. This decides the build commands the
  device helper uses and whether generated native dirs may be committed
  (in a CNG project they must not be — respect the project's `.gitignore`).
- **The gates:** the exact commands that must pass before a PR. Run them once
  now on a clean tree so you know the green baseline — use the gate runner,
  which executes the gates, logs each to the cache dir, and prints a
  PASS/FAIL summary:
  `node .claude/skills/develop-react-native-feature/scripts/gates.mjs` (add
  `--coverage` or `--e2e` when needed). For any *other* command, run it
  plainly — no `$?`, `$(…)`, or backticks; shell expansion trips Claude
  Code's command-injection heuristic and forces a permission prompt even when
  the base command is allowed.
- **The navigation idiom:** `expo-router` (file-based routes — a new screen
  is a new route file under `app/`) or `react-navigation` (a screen mounts
  in a stack/tab/drawer navigator). Match it; do not mix idioms.
- **The state-management idiom:** whatever the project uses (React Query,
  Zustand, Redux Toolkit, plain context/hooks, …). Match it.
- **The styling idiom and design tokens:** StyleSheet with a theme module,
  NativeWind classes, Tamagui/restyle tokens — find where spacing, color,
  and typography constants live and use them; never hardcode.
- **The feature pattern:** how an existing comparable screen is structured.
  Find the newest one and copy its file layout (screen, hooks, components,
  tests). Match it; do not invent a new shape.
- **Test conventions:** jest setup, `@testing-library/react-native` usage,
  whether e2e exists (detox `.detoxrc`, `.maestro/`), and what the project
  actually runs in CI.
- **Enforcement:** are commits/PRs routed through skills or hooks? Is direct
  push to the default branch blocked? What is the branch-naming convention?
- **What is NOT a gate:** many repos carry a lint backlog that fails on files
  you never touched. Confirm which checks actually block merge so you do not
  chase noise.

If any of these is ambiguous, ask rather than guess.

### Required Expo skills (Expo projects only)

Expo publishes official skills (https://github.com/expo/skills) that teach an
agent its APIs and conventions. When the flavor is Expo, install **only the
required subset — the skills the project's detected usage needs — never the
full catalog**. The discovery report computes the mapping:

| Detected in the project | Required Expo skill |
|---|---|
| `expo-router` dependency (file-based routes) | `expo-router` |
| A data-fetching stack in use, **or** the shaped feature touches remote data (a Phase 1 fact — revisit this row after shaping) | `expo-data-fetching` |
| `@expo/ui` dependency | `expo-ui` |
| `nativewind` dependency without a Tailwind config (a setup-shaped gap) | `expo-tailwind-setup` |
| No project design system (platform-idiom styling is the default) | `expo-native-ui` |

Install each missing required skill individually:

```bash
npx skills add expo/skills --skill <name>
```

Everything else in the catalog (`eas-*`, `expo-upgrade`, `expo-brownfield`,
`expo-module`, `expo-app-clip`, `expo-dom`, `expo-web-to-native`,
`expo-dev-client`, `expo-examples`) stays out of the required set — install
one on demand, with confirmation, only when the shaped feature explicitly
calls for that domain (a native module → `expo-module`). The `eas-*` skills
are **never** auto-installed: this workflow never touches EAS or store
distribution. The all-in-one `expo@claude-plugins-official` plugin exists but
ships all the skills at once, so it is not the default here.

In interactive mode, show the required-vs-missing list and confirm before
installing. In `--auto`, install the missing required skills without pausing
when the `Bash(npx skills add expo/skills*)` grant is present; when it is
not, proceed without them and record the gap in the PR body — an Expo skill
is an accelerator, not a hard dependency of the loop. After installing,
re-run `setup.mjs` so the new skills' invocation tokens land in the allow
list. Once installed, lean on them for their domains in Phases 1–2:
navigation work consults `expo-router`, data work `expo-data-fetching`.

### Under Claude Code: delegate the discovery reading

The reading in this step (the flagged docs, the lint config, the comparable
feature's full file layout) is the largest context cost in the workflow, and
only the terse baseline survives into the cache. Under Claude Code, **do not
read those files on the main thread**: spawn a read-only discovery subagent
and let it do the reading. Invoke the Task tool with `subagent_type:
"Explore"`, a small/fast model override (e.g. `model: "haiku"` — the task is
structured extraction, not judgment) when the harness supports one, and a
prompt of this shape:

> Run `node .claude/skills/develop-react-native-feature/scripts/discover.mjs`,
> read the doc files it flags plus CLAUDE.md / AGENTS.md and the lint config,
> and locate the newest feature comparable to `<feature>`. Return only the
> terse baseline markdown for the project cache (flavor, gates, navigation /
> state / styling idioms and token locations, design-language verdict,
> required Expo skills, feature pattern, test conventions, enforcement, what
> is NOT a gate), ready for `cache-write.mjs`.

Two things stay on the main thread regardless: the green-baseline gate run
(a live fact the main agent must witness) and `setup.mjs` (permission changes
must stay visible). A subagent's tool calls still gate on permissions, so in
a hands-off run delegate only after `setup.mjs --write` has applied the
grants. Only a harness without subagents runs the discovery inline as above.

### Cache the baseline

Write what you found to the project cache so the next run skips rediscovery.
Use the **Write tool** to save the findings to a temp file, then pass the path
to `cache-write.mjs` — it creates the cache directory, updates `.gitignore`
if needed, and writes the cache file:

1. Write the findings markdown to
   `.cache/develop-react-native-feature/findings-draft.md` using the Write
   tool (not a shell command).
2. Run the cache script:
   ```bash
   node .claude/skills/develop-react-native-feature/scripts/cache-write.mjs .cache/develop-react-native-feature/findings-draft.md
   ```

Keep the content terse — a cheat sheet, not documentation. Treat an entry as
stale and re-derive it when its source moves: the gates when package.json or
the lint config changes; the feature pattern when a newer comparable feature
lands. The gate run itself is never cached — confirm green on a clean tree
every time. The "Worked example" below shows the shape of a filled-in
baseline.

### Design language (decide the posture)

**The project's own design system wins when it has one** — a theme/tokens
module, a Tamagui or restyle config, NativeWind with a Tailwind theme.
Absent that, the default is **each platform's own idiom**: Human Interface
Guidelines on iOS, Material on Android — a React Native feature should feel
native on both, not like one platform's app running on the other. Decide the
posture once here from the discovery output and record it in the cached
baseline:

1. **Project design system** — use its tokens and components exclusively;
   platform idiom shows up only where the system delegates to platform
   controls.
2. **Platform defaults** — system-feeling components on both platforms
   (switches, pickers, alerts, haptics per platform), `Platform.select` /
   platform-specific files only where the idioms genuinely diverge, and no
   hand-rolled look-alikes of either platform's controls.

Two cross-platform facts are part of the posture in either mode: **safe-area
handling** (via `react-native-safe-area-context` or the project's wrapper —
notches, status bars, home indicators on both platforms) and **dark-mode
readiness** (the theme's dark variants or `useColorScheme` — the critique
screenshots both appearances on both platforms).

The posture is a Phase 0 fact, not a per-screen choice: Phase 1 plans against
it, Phase 2 builds to it, and Phase 4 critiques against it.

## Phase 1: Shape

Shape the feature before writing code. Produce a short written spec:

1. **Screens and navigation.** The screens/components the feature adds or
   changes, and where each mounts — a new route file under `app/`
   (expo-router) or a screen registered in the right navigator
   (react-navigation): stack push, tab, or modal.
2. **State model.** Which hook/store/query owns what, following the idiom
   from Phase 0; where server state ends and UI state begins; how data flows
   in and out (services, persistence, API).
3. **All UI states, enumerated up front:** loading, empty, error, populated.
   Every state named here gets a component treatment and a test.
4. **Accessibility plan.** `accessibilityLabel` / `accessibilityRole` /
   `accessibilityValue` for non-text elements, font-scaling behavior (does
   the layout survive a large font scale?), and minimum 44pt/48dp hit
   targets.
5. **Per-platform differences, named explicitly.** What (if anything)
   diverges between iOS and Android — a date picker, a haptic, a header
   treatment — and how (`Platform.select`, `.ios.tsx`/`.android.tsx` files,
   or a library that abstracts it). Silence here means "identical on both".
6. **Design-language plan** (per the Phase 0 posture). Which tokens/
   components the feature uses; in platform-defaults mode, which platform
   controls appear and where the idioms diverge. If the feature touches
   remote data, add `expo-data-fetching` to the required Expo skills now
   (Expo projects).
7. **Out of scope.** An explicit list, the YAGNI anchor for Phase 2.

**Confirm.** Present the spec and wait for confirmation — the cheapest place
to catch a scope mismatch. In `--auto`, self-check instead: is every state
reachable and handled? Is the state ownership minimal (no store where a hook
would do)? Is the navigation idiomatic for this project? Then proceed.

## Phase 2: Build

**Branch first.** Create a feature branch off the default branch
(`<type>/<slug>`, e.g. `feat/workout-history`) before the first commit;
never commit to the default branch.

Follow the feature pattern from Phase 0 and build bottom-up so each layer is
testable when it lands:

1. **Models and services** (types, API access, persistence), with unit tests
   in the same commit.
2. **Hooks / state** (queries, stores, or context in the project's idiom),
   with tests that exercise every UI state from the Phase 1 spec.
3. **Components**, smallest first, styled with the project's tokens —
   shared spacing/color/typography constants over magic numbers, safe-area
   handling per the Phase 0 posture.
4. **The screen and navigation wiring** (the route file or navigator entry
   from the spec).
5. **A test for the happy path** — written *as you build, not after*, in the
   project's convention (`@testing-library/react-native` render test, or the
   e2e framework when that is the project's bar). A well-written test must
   fail on the code before your change and pass after.

**Build to the Phase 0 design-language posture.** Project tokens and shared
components first; in platform-defaults mode prefer the platform's own
controls and fork per platform only where the spec named a divergence —
scattered ad-hoc `Platform.OS` checks are a smell the audit flags. Keep
`ios/` and `android/` untouched unless the feature genuinely needs a native
change (a permission entry in `Info.plist` / `AndroidManifest.xml`); in a
CNG project make such changes in `app.json` plugins/config, never in
generated dirs. **Never** bump `minSdkVersion` or the iOS deployment target
to reach a newer API without asking, and never touch signing, keystores, or
bundle identifiers.

**Iterate against the running app.** Start Metro once
(`node .claude/skills/develop-react-native-feature/scripts/metro.mjs start`)
and leave it running; Fast Refresh picks up edits. Use the device helper when
you need a fresh install or a specific target (see Phase 4). Expo Go is never
the target — native modules diverge from a development build; `expo run`
builds are the rule.

**Commit as you go.** When a logical chunk is gate-green (Phase 3), commit it
through `/commit-message`, one logical change per commit, rather than
batching at the end. Treat each of the following as its own commit boundary —
do not bundle them:

- A model (or service) and its tests
- A hook/store and its tests
- A component (or tightly related component group)
- The screen and its navigation wiring
- An e2e/integration test batch for one scenario group
- A strings/i18n update
- A doc update (README, architecture docs)

If a single task touches more than two of the above categories, split it
before committing: stage one category, commit, then the next. Check the
project's `CLAUDE.md` for project-specific commit boundary guidance.

While building, iterate on one target at a time (`npx jest path/to/test`,
`npx eslint src/feature/`) and save the full suite for the gate runner.

## Phase 3: Gate

Run the gate runner —
`node .claude/skills/develop-react-native-feature/scripts/gates.mjs` (the
gates derived or pinned in Phase 0). All must pass before a PR; this is the
only bar that blocks merge. The default derivation:

- **typecheck:** the project's `typecheck` script, else `npx tsc --noEmit`
  when `tsconfig.json` exists.
- **lint:** the `lint` script, else `npx eslint .` when an ESLint config
  exists; config present but binary missing fails with an install hint.
- **test:** the `test` script (a watch-mode script gets `--watchAll=false`
  appended so the gate terminates).
- **format:** only via an explicit check-shaped script (`format:check`,
  `prettier:check`) — RN templates ship a Prettier config unenforced, so
  config presence alone is deliberately not a trigger.
- `--coverage` measures line coverage and enforces a threshold when one is
  pinned in `gates.json`.
- `--e2e` adds the `test:e2e` script when one exists.

**Native builds are deliberately not default gates** — they are slow, and the
Phase 4 device helper builds both platforms anyway, so a broken native build
still blocks the loop there. A project whose gates differ (native builds as
merge gates, a detox suite, an exact fastlane lane) pins exact commands in
`.cache/develop-react-native-feature/gates.json`, which overrides detection
entirely — the gate runner executes them without their own standing grants
(its subprocesses are not re-checked against the allow list). Never weaken a
gate to pass it: fixing the code is Phase 5's job.

## Phase 4: Evaluate

The gates prove the code typechecks and its tests pass; this phase proves the
feature looks and behaves right **on both platforms**. Two passes, like a
code review and a design review:

1. **Audit (static, code).** A structured self-review of the branch diff
   against this checklist:
   - hook correctness: exhaustive dependency arrays; no state updates after
     unmount; effects that subscribe also unsubscribe
   - re-render hygiene: no unstable inline objects/functions passed to
     memoized children or list items; context values memoized
   - lists: `FlatList`/`SectionList` (or the project's list) for anything
     unbounded — never a mapped `ScrollView`; stable `keyExtractor`
   - async: every promise path has error handling; no unhandled rejections;
     loading/error states from the spec actually wired
   - platform forks: `Platform.select` / platform files only where the spec
     named a divergence; no scattered ad-hoc `Platform.OS` checks
   - styling: project tokens over magic numbers; no hardcoded colors that
     break dark mode; safe-area insets handled per the Phase 0 posture
   - hardcoded user-facing strings vs the project's i18n convention
   - accessibility props on every interactive element
   - every UI state from the Phase 1 spec has a component treatment and a
     test
2. **Critique (drives the real app on both platforms).** Judge what actually
   renders, not what the source implies.

### Critique must drive the real app on both platforms

Run the critique against the app running on each target, using the Metro and
device helpers. **The iOS Simulator and the Android Emulator are the
targets** — Android degrades gracefully when the machine has no SDK (the
helper prints `NO ANDROID` and exits 3; critique iOS-only and say so in the
snapshot).

1. Start the bundler once (both platforms share it), then build, install,
   and launch on each target (boots the simulator/emulator when needed;
   re-running after a fix rebuilds and relaunches):
   ```bash
   node .claude/skills/develop-react-native-feature/scripts/metro.mjs start
   node .claude/skills/develop-react-native-feature/scripts/device.mjs start --platform ios
   node .claude/skills/develop-react-native-feature/scripts/device.mjs start --platform android
   ```
2. Capture the screenshot matrix into the cache dir — **light and dark on
   each platform** (four baseline shots; the helper pins the iOS status-bar
   clock to 9:41 and the Android one to 09:41 via demo mode, and forces the
   appearance per shot):
   ```bash
   node .claude/skills/develop-react-native-feature/scripts/device.mjs screenshot --platform ios     --appearance light --out .cache/develop-react-native-feature/critique/shots/01-ios-light.png
   node .claude/skills/develop-react-native-feature/scripts/device.mjs screenshot --platform ios     --appearance dark  --out .cache/develop-react-native-feature/critique/shots/02-ios-dark.png
   node .claude/skills/develop-react-native-feature/scripts/device.mjs screenshot --platform android --appearance light --out .cache/develop-react-native-feature/critique/shots/03-android-light.png
   node .claude/skills/develop-react-native-feature/scripts/device.mjs screenshot --platform android --appearance dark  --out .cache/develop-react-native-feature/critique/shots/04-android-dark.png
   ```
   Add **iPad light and dark** when Phase 0 said the project targets tablets
   (`stop --platform ios`, then `start --platform ios --device "iPad …"`);
   Android tablets are out of scope for the default matrix. Optionally
   spot-check font scaling on iOS
   (`xcrun simctl ui <udid> content_size accessibility-extra-large`, one
   more screenshot, then reset with `content_size medium`).
3. **Read every screenshot with the Read tool** and walk the feature's real
   flows (launch → navigate to the feature → drive each state the spec
   named). Drive states through the helper — on iOS everything after `--`
   passes verbatim to the launch; on Android the same passthrough feeds
   `am start`, and deep links are the idiomatic route — and use
   `--settle` to wait before capturing a slow-rendering state:
   ```bash
   node .claude/skills/develop-react-native-feature/scripts/device.mjs relaunch --platform ios -- -initialRoute error-demo
   node .claude/skills/develop-react-native-feature/scripts/device.mjs screenshot --platform ios --settle 2 --out .cache/develop-react-native-feature/critique/shots/05-error-state.png
   ```
   Navigation and interaction beyond launch arguments/deep links run through
   the project's e2e conventions when present (detox, maestro); otherwise
   drive what is reachable (deep links, launch arguments, seeded state) and
   score the rest from component tests.
4. Score the rubric — **8 dimensions × 5 points = /40**:
   1. visual hierarchy & layout
   2. spacing, alignment & safe-area handling (notch, status bar, home
      indicator — on both platforms)
   3. color & dark-mode correctness (both platforms)
   4. typography & font scaling (Dynamic Type on iOS, font scale on Android)
   5. accessibility (labels, roles, contrast, 44pt/48dp targets)
   6. state coverage (loading/empty/error actually reachable and correct)
   7. platform-idiom fit & cross-platform parity — HIG on iOS, Material on
      Android per the Phase 0 posture; navigation coherent on both; the
      feature behaves equivalently on both platforms without one wearing
      the other's idiom
   8. interaction feedback & motion (ripple on Android, highlight/opacity
      on iOS, transitions)
5. When the critique pass is done, stop the app and the bundler (the helper
   shuts down only simulators/emulators it booted, and restores the Android
   uimode/demo-clock state it changed):
   ```bash
   node .claude/skills/develop-react-native-feature/scripts/device.mjs stop
   node .claude/skills/develop-react-native-feature/scripts/metro.mjs stop
   ```

**Persist the snapshot — required, this is what makes `--auto` converge.**
Write every critique run to
`.cache/develop-react-native-feature/critique/<ISO-timestamp>__<slug>.md`
with this exact shape (it is what `critique-plan.mjs` parses):

```markdown
---
slug: workout-history
timestamp: 2026-07-13T14:30:00
total_score: 31
p0_count: 1
p1_count: 2
---

> Android: not critiqued — no Android SDK/emulator on this machine.

## Priority Issues

- [P0] Error state renders a blank screen. Fix: show the error view with retry.
- [P1] Android dark mode: chart grid lines invisible on background. Fix: use a theme color.
- [P2] Row spacing 6 vs the 8 spacing token. Fix: use spacing.sm.
```

(The `> Android: …` note line appears only when the Android half was skipped;
score the Android-specific dimensions from the code and note the reduced
confidence.)

### Under Claude Code: overlap the two passes (optional)

The two passes are independent, so they can run at the same time. The split
is one-sided:

- **Offload the audit to a background subagent** (the `Task` tool). It asks
  nothing and returns findings you fix from, so it is safe to run headless.
  Keep it on the **session model, not a smaller one**: the audit is a
  judgment pass (hooks, re-renders, accessibility), and a downgraded audit
  saves tokens by missing findings you pay for again in Phase 5.
- **Keep the critique in the foreground.** It drives the simulator and
  emulator and reads screenshots on the main thread. "Foreground" means the
  main thread, not that the run halts for input: in a hands-off run,
  continue past the findings using the persisted-snapshot work-list
  (Autonomous mode) rather than waiting.

Merge both finding sets into one snapshot before Phase 5. Never run two
agents against one booted device at once.

## Phase 5: Fix and loop until clean

This is a loop, not a one-shot pass. Work one finding (or one tightly related
group) at a time so each fix is its own commit. In a hands-off run the
finding list is the P0/P1 output of `critique-plan.mjs` (Phase 4 / Autonomous
mode), and its exit code is the loop's convergence signal: keep looping while
it exits non-zero (P0/P1 remain), and stop when it exits 0 (only deferred
P2/P3 left).

Severity definitions:

- **P0** — broken: crash, red screen, unreadable text, an unreachable or
  blank state, data loss
- **P1** — clearly wrong against the spec, the design tokens, or either
  platform's idiom: invisible dark-mode content, missing accessibility
  labels on interactive elements, layout broken at a large font scale, a
  feature that works on one platform and not the other
- **P2** — polish: off-token spacing, weak hierarchy, missing transition
- **P3** — nice-to-have

1. **Fix by severity (P0/P1 first), driven by the finding text.** A visual
   finding usually lands in the component or its tokens; a state finding in
   the hook/store; a platform-parity finding where the fork is.
2. **Re-run the gates** (Phase 3): the fix changed code, so typecheck, lint,
   and tests must pass again.
3. **Commit that fix on its own** once green: a focused `fix(<area>): ...`
   per finding (or close group), routed through `/commit-message` (`--yes`
   in autonomous mode).
4. **Re-evaluate** (Phase 4): fresh screenshots on both platforms, fresh
   scores, a new snapshot — the loop reads the newest one.

Repeat until **no P0 or P1 findings remain and the critique score plateaus**
(expect a few points per pass). Stop when the remainder is genuine P2/P3
polish, not at a perfect 40.

Once the loop settles, **promote anything reusable before the final pass.**
If the feature introduced a component, hook, or spacing/color token that
belongs in the project's shared design system rather than this feature
alone, extract it there, re-run the gates, and commit it. Skip this when the
feature added nothing shareable.

## Phase 6: Commit, document, and PR

**Precondition: the Phase 5 loop has converged.** Gates green, no open P0/P1,
and the test suite passes. If anything is still red, return to Phase 5; do
not open a PR around an open P0/P1.

The implementation and every fix are already committed incrementally on the
feature branch (Phases 2 and 5), one logical change each. Never bypass hooks
with `--no-verify`. Add the doc commits, then open the PR last so it carries
every commit:

1. **The feature and its fixes** are already committed; nothing to re-commit
   here.
2. **The docs the change moved, each as its own commit, before the PR.** Skip
   any whose trigger did not fire:
   - **README** when user-visible behavior or configuration changed — via
     `/update-readme` when installed, else edit README.md directly with the
     same discipline (surgical edits to the affected sections only, never a
     rewrite).
   - **CLAUDE.md / AGENTS.md** when architecture, conventions, commands, or
     the directory layout changed (a hand-written conventional commit): what
     a future contributor or agent needs to know.

   **Under Claude Code, draft the doc updates in parallel.** When more than
   one trigger fired, delegate each draft to its own subagent in a single
   message (a small/fast model override such as `model: "haiku"` fits — the
   task is mechanical summarization of a diff). The *drafts* parallelize; the
   *commits* do not — review each subagent's edit, then commit them
   sequentially, one per doc. Do the updates inline when a single trigger
   fired or the harness has no subagents.
3. **The PR**, opened last so it carries the feature and the doc commits.

**If `/commit-message` and `/create-pr` are installed,** route through them;
they enforce the format and confirm before acting.

**If they are not** (the project opted out), do it directly with the same
discipline:

- *Commit.* Conventional Commits: an imperative subject of 50 characters or
  fewer (hard limit 72), a blank line, then a body wrapped at 72 explaining
  what changed and why. One logical change per commit.

  ```bash
  git add <files for this change>
  git commit
  ```

- *PR.* Push the branch and open a PR whose body has a short summary and a
  test plan (the gate commands you ran and their result, plus the critique
  matrix captured):

  ```bash
  git push -u origin feat/<slug>
  gh pr create --title "<type>: <summary>" --body "<what changed, why, test plan>"
  ```

**After the PR is open, report to the user and stop:**

```
PR open: <url>

Deferred (P2/P3):
<list any unresolved P2/P3 findings, or "none">
<the Android-skipped note, when the critique ran iOS-only>

Phase 7 (version bump + release): when the PR is approved and merged,
resume this conversation (or start a new one) and say "PR merged, continue
Phase 7".
```

**Stop here.** Do not proceed to Phase 7 without an explicit user signal that
the PR has been merged. PR approval, merge, and the release publish are human
gates.

## Phase 7: Merge, version, and release

Phase 6 ends with the feature PR open; the rest is the release lifecycle. Two
points are **human gates** (you cannot approve your own PR), and the release
publish is an outward action to confirm before running.

1. **Merge the feature PR.** After a human approves it and CI is green, merge
   it (`gh pr merge`, per the repo's merge style).
2. **Decide the version bump** from what merged, by Conventional Commit type:
   a breaking change -> **major**, `feat` -> **minor**, `fix` and other
   user-affecting patches -> **patch**. Where the project records the version
   (`version` in package.json, `expo.version` in app.json, and — for bare
   projects that track them — the native `MARKETING_VERSION` /
   `versionName`), that edit goes in a `chore/release-<X.Y.Z>` PR through the
   same `/commit-message` and `/create-pr` route, merged after approval (same
   human gate as step 1). When git tags are the only version record, skip
   the PR.
3. **Tag and publish the release** on the merged default branch; the tag must
   match the bumped version:

   ```bash
   gh release create v<X.Y.Z> --target main --generate-notes
   ```

   **Confirm before running this:** check the project's CI/CD config to
   understand what fires on `release: published` vs a tag push. After
   publishing, confirm all release workflows go green before considering the
   release done.

**A release here is a git tag and a GitHub release — nothing more.** This
skill never runs EAS Build or EAS Submit, never uploads to TestFlight or the
Play Console, and never touches signing or keystores; distribution pipelines
stay human-run.

## Universal disciplines (portable, every project)

- **Never use `node -e '...'` inline scripts.** Multi-line inline node code
  triggers Claude Code's static-analysis block. Write the script to
  `.cache/develop-react-native-feature/<name>.mjs` with the Write tool, then
  run `node .cache/develop-react-native-feature/<name>.mjs`. The cache dir is
  gitignored.
- **Inspect files with the Read and Grep tools, not shell parsers.** Reaching
  for `python3 -c`, `jq`, or `cat`/`sed` to read or pretty-print a file needs
  broad shell grants and prompts in a hands-off run; the Read and Grep tools
  need no Bash permission. Remove a tracked file with `git rm <path>`, not a
  bare `rm`: neither is auto-allowed (every delete path prompts,
  intentionally), but `git rm` stages a recoverable deletion of tracked
  content while `rm` destroys it.
- **Redirect output to the cache dir, never `/tmp/`.** A `/tmp/` path
  triggers a path-access prompt that `Bash()` allow entries cannot suppress;
  write logs and screenshots to `.cache/develop-react-native-feature/`
  instead. Full gate runs need no manual redirect — the gate runner logs each
  gate to the cache dir for you.
- **Never prefix Bash commands with `cd /absolute/path;`.** The working
  directory is always the project root — run all commands from there
  directly. Compound `cd /abs/path; cmd` patterns trigger Claude Code's
  path-resolution-bypass check and block the command even when the intent is
  read-only. Use relative paths or run commands as-is.
- **Manage the bundler and the app through the helpers, not raw
  simctl/adb/npx choreography.** Metro runs via
  `metro.mjs start|status|stop` (one instance serves both platforms); the
  app runs via `device.mjs start|screenshot|appearance|relaunch|status|stop`
  with `--platform ios|android`, and launch-argument states go through the
  `--` passthrough plus `screenshot --settle <sec>` for slow-rendering
  states. The helpers resolve targets, wait for boot and past the splash,
  wire `adb reverse`, and clean up after themselves, so the critique never
  stalls on a permission prompt.
- **Never use the `&` background operator.** It trips Claude Code's
  static-analysis block regardless of allow entries. `metro.mjs` and
  `device.mjs` own the detached processes (the bundler, the emulator); for
  any other long-running process, write a detached `child_process.spawn`
  launcher to `.cache/develop-react-native-feature/` and run that.
- **Never juggle file versions with `cp` + `git checkout --`.** Experimental
  variants happen via Edit on the working tree (the diff is the record);
  when a revert is truly needed, one prompted `git checkout -- <path>` is
  the deliberate exception, not a loop step. `cp` and destructive git forms
  are intentionally ungranted.
- **Never poll with shell loops.** No `until … sleep …` (or `while`/`sleep`)
  loops watching task files or subagent transcripts — the harness reports
  background completion on its own; continue when it does.
- **No `echo` progress markers.** Bare `echo done`, `&& echo ok`, and
  `; echo ---` separators each trigger a permission check and add nothing —
  the tool result already carries exit status and output. `echo` is
  deliberately ungranted.
- **Never reset or reshape simulators or emulators.** No `xcrun simctl
  erase|delete|create|clone|privacy|keychain|spawn`; no `adb uninstall`,
  `adb root`, `adb shell rm`, `emulator -wipe-data`, or `avdmanager`
  create/delete. The workflow only builds, installs, launches, screenshots,
  and terminates — and shuts down only devices it booted, restoring the
  Android uimode/demo-clock state it changed.
- **Direct `adb` spot checks assume a single device.** A bare `adb shell …`
  with two devices attached fails with "more than one device"; the helper
  always scopes with `-s <serial>`. When you must run adb directly, check
  `adb devices` first and target one device — never guess.
- **Never modify signing, keystores, provisioning, or application/bundle
  identifiers.** Debug builds need none of it; anything that does is human
  work.
- **Security floor, non-negotiable:** never hardcode credentials or API keys,
  never disable TLS verification "for testing", and keep secrets out of
  logs and screenshots — use the project's local-dev config path (e.g.
  `.env` via the project's own mechanism) instead.
- **Build only what the feature needs (YAGNI).** Implement the scope
  confirmed in Phase 1, nothing speculative: no unused props, abstraction
  layers with one consumer "for reuse later", or generality for callers that
  do not exist yet. The simplest thing that satisfies the spec and passes
  the gates wins.
- **The gates are the merge bar, nothing else.** A clean lint run is not
  permission to skip them; a failing unrelated check is not a reason to
  stop.
- **Commit atomically.** One logical change per commit; split unrelated
  concerns into separate commits even within one feature.
- **Keep your diff legible.** Do not reformat or "fix" files your feature did
  not touch, even when a linter flags them project-wide.
- **Tier models by judgment, not by output size.** Where the harness supports
  per-subagent model selection, give the small/fast model only the structured
  extraction and summarization steps (Phase 0 discovery, Phase 6 doc drafts);
  keep shaping, building, the audit, the critique, and the fix loop on the
  session model. The larger saving is context isolation, not model price: a
  subagent that returns only its conclusion keeps the bulky reading out of
  the main context for the rest of the session.

## Worked example (illustration only)

What Phase 0 surfaced in one Expo app, to show the *kind* of thing to look
for. None of this is portable; yours will differ.

- **Flavor:** Expo prebuild (SDK 53, RN 0.79, new architecture on), yarn,
  TypeScript, `ios/` and `android/` checked in.
- **Gates:** `yarn typecheck` (tsc), `yarn lint` (eslint with
  `eslint-config-expo`), `yarn test` (jest-expo +
  `@testing-library/react-native`); no coverage threshold; prettier config
  present but unenforced (not a gate).
- **Navigation:** expo-router — a new screen is `app/workouts/history.tsx`;
  modals via `app/(modals)/`.
- **State idiom:** React Query for server state, zustand for the two global
  UI stores; component state elsewhere.
- **Design language:** project theme module (`src/theme/` tokens +
  `useTheme()`), dark variants present; `react-native-safe-area-context`
  wrapper in the root layout. Posture: project design system.
- **Required Expo skills:** `expo-router` (dependency detected),
  `expo-data-fetching` (React Query in use) — both installed with
  `npx skills add expo/skills --skill <name>`; nothing else from the
  catalog.
- **Critique run (plugin channel):** `drnf-metro start`, `drnf-device start
  --platform ios`, `--platform android`, four baseline screenshots (both
  platforms, light/dark), error state via `relaunch -- -initialRoute
  error-demo`, snapshot written, `drnf-critique-plan` → exit 1 (one P1:
  Android ripple missing on the row action; chart grid invisible in dark
  mode) → fix, re-gate, re-critique → exit 0.
- **Enforcement:** `PreToolUse` hooks routed `git commit`/`gh pr create`
  through `/commit-message` and `/create-pr`; branches were `feat/<slug>`.
- **NOT a gate:** the eslint `react-hooks/exhaustive-deps` backlog warned
  project-wide; only new violations blocked merge.

## Installing this skill and its companions elsewhere

- **This skill:**
  `npx skills add pyaethu-aung/skills --skill develop-react-native-feature`
  (add `--global` to install it for every project), or install the
  `react-native-dev` plugin, which bundles `/update-readme` and puts the
  `drnf-*` helper commands on the PATH.
- **`/commit-message`, `/create-pr`, `/update-readme` (optional):** install
  with `npx skills add pyaethu-aung/skills --skill <name>`, or skip them to
  use each phase's direct fallback.
- **Required Expo skills (Expo projects):** installed per project in
  Phase 0, individually — `npx skills add expo/skills --skill <name>` —
  never the whole catalog.

## What this skill is not

A runnable driver, a project generator, or an app-store release pipeline.
The helpers manage discovery, gates, the bundler, and the app's run targets;
the judgment (shape, implementation, critique, fixes) is the agent following
this playbook. It never runs EAS Build/Submit/Update, never uploads to
TestFlight or the Play Console, and never touches signing or keystores.
Native-module authoring, brownfield embedding, and web (react-native-web)
targets fit partially at best — the critique matrix and gates assume a
standard iOS + Android app target.
