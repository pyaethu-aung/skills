---
name: develop-ios-feature
description: "Develop and ship a SwiftUI iOS feature end-to-end: shape the feature, build views and observable models with previews and tests, gate on xcodebuild or swift build/test plus SwiftLint, critique the running app in the iOS Simulator (or on a connected device), fix, open a PR, and release. Portable across Xcode app and Swift package projects; requires macOS with Xcode. Use when asked to add or build an iOS or SwiftUI feature or screen."
metadata:
  version: "1.0.0"
argument-hint: "[--auto] The feature to build (e.g. 'Workout history screen with weekly chart')"
allowed-tools: Bash(xcodebuild*) Bash(xcrun*) Bash(xcode-select*) Bash(swift*) Bash(swiftlint*) Bash(swiftformat*) Bash(plutil*) Bash(node*) Bash(git:*) Bash(gh:*) Bash(grep*) Bash(ls*) Bash(cat*) Read Write Edit Task
---

# Develop a SwiftUI iOS feature

The playbook for taking a SwiftUI iOS feature from idea to release. It is not
a runnable driver: the "driver" is the sequence of skill invocations and gate
commands below.

The loop, in one line: **learn → shape → build → gate → evaluate (simulator
critique + code audit) → fix ↻ → commit → docs → PR**, then ship: **merge →
version bump → tag + release**. The evaluate phase judges the app running in
the iOS Simulator (or, opt-in, on a connected physical device); the
gate/evaluate → fix cycle repeats until no P0/P1 findings remain.

This skill is portable. The *workflow* and *disciplines* are the same in every
project; the *specifics* (Xcode app vs Swift package layout, schemes, gate
commands, state-management idiom) differ, so Phase 0 discovers them before any
code is written. It requires **macOS with full Xcode** (not just the Command
Line Tools); app layouts also need at least one iOS Simulator runtime. A
concrete worked example from one app is at the end, as illustration only:
yours will differ.

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
  critique to `.cache/develop-ios-feature/critique/<timestamp>__<slug>.md`
  (YAML frontmatter with `p0_count` / `p1_count`, plus a `## Priority Issues`
  section). Run
  `node .claude/skills/develop-ios-feature/scripts/critique-plan.mjs` (add
  `--slug <slug>` to target one file): it reads the latest snapshot, prints
  the P0/P1 to fix and the P2/P3 to defer, and exits non-zero while any P0/P1
  remain — a deterministic convergence signal, like the gate runner. Keep
  looping while it exits non-zero.
- **Surface what was not fixed.** P0/P1 findings are fixed in the Phase 5
  loop; the remaining P2/P3 are deliberately not auto-fixed, but must not
  vanish in a hands-off run. List them in the PR body under a
  **Deferred (P2/P3)** heading, taken from `critique-plan.mjs`'s output, so
  they can be triaged at review.
- **File edits still gate on permission; handle that out-of-band.** `--auto`
  removes the skill's own confirmations, but Claude Code still prompts before
  each `Edit` / `Write`. For an unattended run, enable one of: accept-edits
  mode (shift+tab, or `--permission-mode acceptEdits`); `bypassPermissions`
  for fully unattended; or grant scoped edits up front with
  `node .claude/skills/develop-ios-feature/scripts/setup.mjs --grant-edits --write`,
  which auto-approves `Edit` / `Write` / `MultiEdit` for the project's Swift
  source and test directories only, plus `project.pbxproj` when the project
  lacks filesystem-synchronized groups (root config, `.github/`, `.claude/`,
  and docs still prompt). The scoped grant is narrower than accept-edits mode
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
`"Bash(dif-setup*)"` / `"Bash(gwf-setup*)"` entries for
`.claude/settings.local.json` and the `--write` commands to run — rather
than proceeding into a run that prompts on every command.

Autonomous mode removes only the in-flow confirmations. The gates, the fix
loop, atomic commits, and the disciplines are unchanged.

## Phase 0: Set up

### Resolve the install channel (do this first)

This skill ships through two channels and the helper-script command form
differs. Check the skill's **base directory** (shown at invocation) once, and
apply the matching form to every script command in this skill:

- **`.claude/skills/develop-ios-feature/`** — the `npx skills` install. Use
  the commands exactly as written throughout
  (`node .claude/skills/develop-ios-feature/scripts/<name>.mjs`).
- **Anywhere else (the plugin cache)** — the `ios-dev` plugin install. The
  plugin puts wrapper commands on the PATH; substitute `dif-<name>` for
  `node .claude/skills/develop-ios-feature/scripts/<name>.mjs` everywhere:
  `dif-setup`, `dif-discover`, `dif-gates`, `dif-device`,
  `dif-critique-plan`, `dif-cache-check`, `dif-cache-write`. Skill
  invocations are namespaced on this channel
  (`/ios-dev:develop-ios-feature`, `/ios-dev:update-readme`,
  `/git-workflow:commit-message`, …); read every skill reference below
  accordingly.

`setup.mjs` detects the channel itself (from where it runs) and writes the
matching grant and token forms, so no permission entry needs hand-editing
when switching channels — but do not mix channels in one project: the same
skill installed twice under different names is a recipe for confusion.

Each plugin owns its own grants. On the plugin channel, `setup.mjs` manages
only ios-dev's entries; when the **git-workflow plugin** is installed, also
run its `gwf-setup` (same dry-run / `--write` contract) to grant the
commit/PR skill tokens and the sentinel forms its guard hooks demand. Skip it
when git-workflow is not installed — never hand-write another plugin's
entries.

### Configure permissions

The setup script wires up every required allow entry in
`.claude/settings.local.json` (personal and gitignored, never the committed
`settings.json`). It is idempotent and safe to re-run on every session. **It
defaults to a dry run:** it prints the entries it would add and writes nothing,
so any new grant is visible before it lands. Re-run with `--write` to apply.

```bash
node .claude/skills/develop-ios-feature/scripts/setup.mjs           # preview the delta
node .claude/skills/develop-ios-feature/scripts/setup.mjs --write   # apply it
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
`MultiEdit`, scoped to the project's Swift source and test directories (plus
`project.pbxproj` when new files must be registered there), for unattended
runs (see Autonomous mode for the trade-off versus accept-edits mode).

This adds every allow entry a hands-off run needs, **derived from your
project** so it is not tied to any one layout: full-suite gate runs via the
gate runner (`scripts/gates.mjs`, whose one entry replaces broad xcodebuild
orchestration grants), the direct `xcodebuild` / `swift build` / `swift test`
forms for single-target iteration, **subcommand-scoped** `xcrun simctl`
(list/boot/install/launch/screenshot lifecycle only) and `xcrun devicectl`
(list/info/install/launch/terminate/screenshot only) entries, `swiftlint` and
`swiftformat --lint` only when the project configures them, narrow
`make test*` / `make lint*` / `make build*` forms only for Makefile targets
that exist, the Phase 0 scripts, the **app run-target helper**, and
read-only / staging / branch-creation git. When the matching skill is
installed it also adds the skill-invocation tokens
`Skill(develop-ios-feature)`, `Skill(commit-message)`, `Skill(create-pr)`,
`Skill(update-readme)` (each in both the bare and `:*` form), the
sentinel-prefixed commit / PR forms the guard hooks require, and
`gh pr view` / `gh pr list` for create-pr's existing-PR check and verify.

Deliberately **never** granted (each prompts if ever needed): `git push`,
`git rm`, `git reset`, bare `rm`; `xcrun simctl erase|delete|create|clone|
privacy|keychain|spawn` (the workflow only boots, installs, launches,
screenshots, and shuts down — it never resets or reshapes simulators);
`xcrun devicectl device reboot|uninstall|wipe` and pairing management
(physical hardware is looked at, never administered); and `agvtool` (version
bumps edit the file through the normal edit flow). `gh pr merge` stays
ungranted too — Phase 7 is a human gate.

> **Token gotcha:** the Claude Code permission token is `Skill(name)` —
> **singular**. The plural `Skills(name)` silently never matches, so a setup
> that writes it leaves every skill call prompting. Grant both `Skill(name)`
> and `Skill(name:*)`: the `:*` form is what matches an invocation that
> carries arguments (e.g. `/develop-ios-feature Workout history screen`).

The only entry that must exist beforehand (to approve `setup.mjs` itself) is
the one matching the install channel — for an `npx skills` install:

```json
"Bash(node .claude/skills/develop-ios-feature/scripts/setup.mjs*)"
```

or, for the `ios-dev` plugin install (add the second entry only when the
git-workflow plugin is installed too, so its own setup can run):

```json
"Bash(dif-setup*)"
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

**Full Xcode is the one hard dependency.** Confirm `xcode-select -p` points
at an Xcode installation (not the bare Command Line Tools) and
`xcodebuild -version` works. App layouts additionally need at least one iOS
Simulator runtime and an available iPhone device (`xcrun simctl list` — the
discovery script reports both); when the critique will target hardware
instead, a connected, paired device must show in
`xcrun devicectl list devices`. Swift-package layouts need only the Swift
toolchain (`swift --version`).

SwiftLint, SwiftFormat, and xcbeautify are optional accelerators: the gates
use them only when the project configures them, and nothing installs them for
you — a lint config with no binary fails the gate with an install hint rather
than being skipped.

**`/commit-message`, `/create-pr`, and `/update-readme` are optional
companions.** They standardize commits, PRs, and README updates, but the
workflow completes without them. On the npx channel install them with
`npx skills add pyaethu-aung/skills --skill <name>`. If a companion is
absent, the phase that uses it falls back to doing the work directly with the
same conventions inlined there.

### Learn this project (do not skip)

**First, check for a cached baseline:**

```bash
node .claude/skills/develop-ios-feature/scripts/cache-check.mjs
```

If the cache file exists, read it and trust it: skip the discovery below,
re-deriving only the entries whose source has changed. One thing is never
cached — the **green baseline**: always re-run the gates once on a clean
tree, because it is a live fact (dependency or simulator drift), not a static
answer. If there is no cache file, proceed with full discovery.

**Run the discovery script** to get a structured overview of the layout,
schemes and targets, build-setting heuristics, inferred gates, test and lint
setup, toolchain and simulator/device availability, git hooks, enforcement
config, and which doc files are present:

```bash
node .claude/skills/develop-ios-feature/scripts/discover.mjs
```

Use the output as a starting point. Then read `CLAUDE.md` / `AGENTS.md`,
`README`, the lint config, and any doc files the script flagged as present to
fill in the rest. Establish:

- **The layout:** an Xcode app (`.xcodeproj` / `.xcworkspace`), a Swift
  package (`Package.swift`), or a hybrid where features live in local
  packages. This decides the gates and whether the simulator critique runs.
- **File membership:** whether the project uses Xcode 16
  filesystem-synchronized groups (the discovery script reports this). When it
  does, new `.swift` files on disk join their target automatically. When it
  does **not**, every new file must be registered in `project.pbxproj` or it
  silently never compiles — plan for that edit on every file you add, and
  verify with a build immediately after the first one.
- **The gates:** the exact commands that must pass before a PR. Run them once
  now on a clean tree so you know the green baseline — use the gate runner,
  which executes the gates, logs each to the cache dir, and prints a
  PASS/FAIL summary:
  `node .claude/skills/develop-ios-feature/scripts/gates.mjs` (add
  `--coverage` or `--ui` when needed). For any *other* command, run it
  plainly — no `$?`, `$(…)`, or backticks; shell expansion trips Claude
  Code's command-injection heuristic and forces a permission prompt even when
  the base command is allowed.
- **The state-management idiom:** `@Observable` (iOS 17+), `ObservableObject`
  + `@Published`, TCA, or something else. Match it; do not mix idioms.
- **The feature pattern:** how an existing comparable screen is structured.
  Find the newest one and copy its file layout (view, view model, model,
  previews, tests). Match it; do not invent a new shape.
- **Preview and test conventions:** `#Preview` vs `PreviewProvider`, whether
  the project uses swift-snapshot-testing, whether an XCUITest target exists,
  and what the deployment target allows.
- **Enforcement:** are commits/PRs routed through skills or hooks? Is direct
  push to the default branch blocked? What is the branch-naming convention?
- **What is NOT a gate:** many repos carry a SwiftLint backlog that fails on
  files you never touched. Confirm which checks actually block merge so you
  do not chase noise.

If any of these is ambiguous, ask rather than guess.

### Under Claude Code: delegate the discovery reading

The reading in this step (the flagged docs, the lint config, the comparable
feature's full file layout) is the largest context cost in the workflow, and
only the terse baseline survives into the cache. Under Claude Code, **do not
read those files on the main thread**: spawn a read-only discovery subagent
and let it do the reading. Invoke the Task tool with `subagent_type:
"Explore"`, a small/fast model override (e.g. `model: "haiku"` — the task is
structured extraction, not judgment) when the harness supports one, and a
prompt of this shape:

> Run `node .claude/skills/develop-ios-feature/scripts/discover.mjs`, read
> the doc files it flags plus CLAUDE.md / AGENTS.md and the lint config, and
> locate the newest feature comparable to `<feature>`. Return only the terse
> baseline markdown for the project cache (layout and file-membership
> verdict, gates, scheme, state idiom, design-language adoption mode,
> feature pattern, preview/test conventions, enforcement, what is NOT a
> gate), ready for `cache-write.mjs`.

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

1. Write the findings markdown to `.cache/develop-ios-feature/findings-draft.md`
   using the Write tool (not a shell command).
2. Run the cache script:
   ```bash
   node .claude/skills/develop-ios-feature/scripts/cache-write.mjs .cache/develop-ios-feature/findings-draft.md
   ```

Keep the content terse — a cheat sheet, not documentation. Treat an entry as
stale and re-derive it when its source moves: the gates when the project file
or lint config changes; the feature pattern when a newer comparable feature
lands. The gate run itself is never cached — confirm green on a clean tree
every time. The "Worked example" below shows the shape of a filled-in
baseline.

### Design language (decide the adoption mode)

The design language is **Apple's Human Interface Guidelines**; since iOS 26
the system-wide look is **Liquid Glass**. The project's own stated design
system wins when it has one — absent that, HIG + Liquid Glass is the
default. Decide the **adoption mode** once here, from the discovery output
(deployment target, SDK version, opt-out key — `discover.mjs` reports all
three and the derived mode), and record it in the cached baseline:

1. **native** — deployment target ≥ iOS 26: use the Liquid Glass APIs
   directly (`.glassEffect(_:in:)`, `GlassEffectContainer`,
   `.buttonStyle(.glass)`), no availability gates.
2. **gated + fallback** — deployment target < 26 but built with the
   iOS 26+ SDK: adopt Liquid Glass behind `if #available(iOS 26.0, *)`;
   the fallback branch renders the same layout with `.ultraThinMaterial`
   (plus a shape background/stroke where the glass carried the silhouette).
3. **unavailable / opted out** — SDK < 26, or the project sets
   `UIDesignRequiresCompatibility` in its Info.plist, or it has its own
   design system: follow the project's existing conventions and do not
   introduce glass.

The mode is a Phase 0 fact, not a per-view choice: Phase 1 plans against it,
Phase 2 builds to it, and Phase 4 critiques against it.

## Phase 1: Shape

Shape the feature before writing code. Produce a short written spec:

1. **Views and hierarchy.** The screens/views the feature adds or changes,
   and where each mounts in navigation (a `NavigationStack` destination, a
   tab, a sheet, a full-screen cover).
2. **State model.** Which observable model owns what, following the idiom
   from Phase 0; where the `@State` / `@Binding` / `@Environment` boundaries
   sit; how data flows in and out (services, persistence).
3. **All UI states, enumerated up front:** loading, empty, error, populated.
   Every state named here gets a view treatment, a `#Preview`, and a test.
4. **Accessibility plan.** Labels/traits/values for non-text elements,
   Dynamic Type behavior (does the layout survive
   `accessibilityExtraLarge`?), and minimum 44pt hit targets.
5. **Preview plan.** Which previews to add — per meaningful state, and worth
   checking in both color schemes.
6. **Design-language plan** (per the Phase 0 adoption mode). Which custom
   surfaces get Liquid Glass — system components get it free, so prefer
   them and list only the custom chrome (floating controls, badges,
   overlays) that needs `.glassEffect`; any tint or `.interactive()`
   choices; and, in gated mode, the exact fallback treatment for older iOS.
   In unavailable/opted-out mode this item just names the project
   conventions being followed.
7. **Out of scope.** An explicit list, the YAGNI anchor for Phase 2.

**Confirm.** Present the spec and wait for confirmation — the cheapest place
to catch a scope mismatch. In `--auto`, self-check instead: is every state
reachable and handled? Is the state ownership minimal (no shared model
recreated per view)? Is the navigation idiomatic for this project? Then
proceed.

## Phase 2: Build

**Branch first.** Create a feature branch off the default branch
(`<type>/<slug>`, e.g. `feat/workout-history`) before the first commit;
never commit to the default branch.

Follow the feature pattern from Phase 0 and build bottom-up so each layer is
testable when it lands:

1. **Model and services** (data types, persistence or API access), with unit
   tests in the same commit.
2. **Observable model / view model** (state + logic, in the project's
   idiom), with tests that exercise every UI state from the Phase 1 spec.
3. **Views**, smallest first, each with a `#Preview` per meaningful state.
   Match the project's design tokens and component conventions — shared
   spacing/color/typography constants over magic numbers.
4. **Navigation wiring** (the destination, tab, or sheet from the spec).
5. **A UI or snapshot test for the happy path** — written *as you build, not
   after*, in the project's convention (XCUITest target or
   swift-snapshot-testing). A well-written test must fail on the code before
   your change and pass after.

**Build to the Phase 0 design-language mode.** Prefer system components
first — toolbars, tab bars, buttons, and sheets adopt Liquid Glass
automatically under the iOS 26 SDK, so custom chrome is the only place the
APIs appear. When custom chrome is warranted: `.glassEffect(_:in:)` on the
surface, related glass shapes grouped (and morphed) in one
`GlassEffectContainer` with `glassEffectID`, `.buttonStyle(.glass)` (or
`.glassProminent`) for buttons. In **gated + fallback** mode, centralize the
availability check in one shared adaptive modifier the project owns (e.g. an
`adaptiveGlass()` ViewModifier: `if #available(iOS 26.0, *)` →
`.glassEffect(…)`, else `.background(.ultraThinMaterial, in: …)`) instead of
scattering `#available` checks per view, and pin a `#Preview` to the
fallback branch so both renderings stay covered. Two hard rules in every
mode: never rebuild fake glass with blur stacks where the real API exists,
and never stack glass on glass — legibility over glass is a P1 in the
critique.

**Register every new file** in `project.pbxproj` when Phase 0 said the
project lacks filesystem-synchronized groups, and run a build right away — an
unregistered file compiles nothing and fails silently. Never bump the
deployment target to reach a newer API without asking; use `if #available`
per the project's convention instead. Never touch signing settings or bundle
identifiers.

**Commit as you go.** When a logical chunk is gate-green (Phase 3), commit it
through `/commit-message`, one logical change per commit, rather than
batching at the end. Treat each of the following as its own commit boundary —
do not bundle them:

- A model (or service) and its tests
- An observable/view model and its tests
- A view (or tightly related view group) and its previews
- Navigation wiring
- A UI/snapshot test batch for one scenario group
- A localization/strings update
- A doc update (README, architecture docs)

If a single task touches more than two of the above categories, split it
before committing: stage one category, commit, then the next. Check the
project's `CLAUDE.md` for project-specific commit boundary guidance.

While building, iterate on one target at a time (a single-scheme
`xcodebuild build`, or `swift test --filter FooTests` in a package) and save
the full suite for the gate runner.

## Phase 3: Gate

Run the gate runner —
`node .claude/skills/develop-ios-feature/scripts/gates.mjs` (the gates
derived or pinned in Phase 0). All must pass before a PR; this is the only
bar that blocks merge. The default derivation:

- **App layouts:** `xcodebuild build` then `xcodebuild test`, on a resolved
  iOS Simulator destination (an already-booted iPhone when there is one,
  else the newest available), with `CODE_SIGNING_ALLOWED=NO` and derived
  data under the cache dir. Gates always run on the simulator — deterministic
  and signing-free; a physical device is a critique target (Phase 4), never
  a gate target.
- **Package layouts:** `swift build` then `swift test`.
- **lint / format**: `swiftlint lint` and `swiftformat --lint .` — only when
  the project has the matching config; config present but binary missing
  fails with an install hint.
- `--coverage` measures line coverage from the result bundle and enforces a
  threshold when one is pinned in `gates.json`.
- `--ui` adds the XCUITest target when one exists.

A project whose gates differ (a fastlane lane, an exact
`-workspace`/`-scheme` pair, a device destination it insists on) pins exact
commands in `.cache/develop-ios-feature/gates.json`, which overrides
detection entirely — the gate runner executes them without their own standing
grants (its subprocesses are not re-checked against the allow list). Never
weaken a gate to pass it: fixing the code is Phase 5's job.

## Phase 4: Evaluate

The gates prove the code compiles and its tests pass; this phase proves the
feature looks and behaves right. Two passes, like a code review and a design
review:

1. **Audit (static, code).** A structured self-review of the branch diff
   against this checklist:
   - retain cycles: `[weak self]` (or explicit capture lists) in escaping
     closures held by the object they capture
   - concurrency: `@MainActor` where UI state mutates; no data-race warnings;
     structured tasks (`.task`, `TaskGroup`) over detached ones
   - state ownership: no `@State` for shared models; no observable model
     recreated on every `body` evaluation; bindings passed down, not
     duplicated
   - no force unwraps / `try!` / `as!` on paths that can fail at runtime
   - magic numbers vs the project's shared constants/design tokens
   - hardcoded user-facing strings vs the project's localization convention
   - every UI state from the Phase 1 spec has a view treatment and a preview
2. **Critique (drives the real app — app layouts only).** Judge what
   actually renders, not what the source implies.

### Critique must drive the real app, not just previews

Run the critique against the app running on a target, using the run-target
helper. **The iOS Simulator is the default target.** A connected physical
device is opt-in — use it when the user asks for it, or when no simulator
runtime is available — via `--physical` (or `--udid` with the device's
identifier). Device builds use the project's existing code signing as-is
(the workflow never modifies signing; when the project cannot sign, the
helper fails plainly — critique on the simulator instead).

1. Build, install, and launch on the target (boots the simulator when
   needed; re-running after a fix rebuilds and relaunches):
   ```bash
   node .claude/skills/develop-ios-feature/scripts/device.mjs start --scheme <Scheme>
   ```
2. Capture the screenshot matrix into the cache dir. On the simulator:
   **light and dark** on the iPhone target, plus **iPad light and dark**
   when Phase 0 said `TARGETED_DEVICE_FAMILY` includes iPad (`stop`, then
   `start --device "iPad …"`). Optionally spot-check Dynamic Type
   (`xcrun simctl ui <udid> content_size accessibility-extra-large`, one
   more screenshot, then reset with `content_size medium`):
   ```bash
   node .claude/skills/develop-ios-feature/scripts/device.mjs screenshot --appearance light --out .cache/develop-ios-feature/critique/shots/01-iphone-light.png
   node .claude/skills/develop-ios-feature/scripts/device.mjs screenshot --appearance dark  --out .cache/develop-ios-feature/critique/shots/02-iphone-dark.png
   ```
   On a physical device the matrix degrades gracefully: appearance cannot be
   forced and the status bar cannot be pinned, so capture the device's
   current appearance (the helper uses `devicectl device screenshot` when
   the installed Xcode supports it, and says `NO SCREENSHOT` when it does
   not) and score the dark-mode dimension from previews and snapshot-test
   images instead.
3. **Read every screenshot with the Read tool** and walk the feature's real
   flows (launch → navigate to the feature → drive each state the spec
   named). Drive launch-argument states through the helper — everything
   after `--` passes verbatim to the launch, and `--settle` waits before
   capturing a slow-rendering state — never through raw
   `simctl terminate; simctl launch` chains:
   ```bash
   node .claude/skills/develop-ios-feature/scripts/device.mjs relaunch -- -filmStyle "Vivid Slide"
   node .claude/skills/develop-ios-feature/scripts/device.mjs screenshot --settle 2 --out .cache/develop-ios-feature/critique/shots/03-vivid-slide.png
   ```
   Navigation and interaction beyond launch arguments/deep links run
   through the project's XCUITest conventions when present; otherwise drive
   what is reachable (deep links, launch arguments, seeded state) and score
   the rest from previews.
4. Score the rubric — **8 dimensions × 5 points = /40**:
   1. visual hierarchy & layout
   2. spacing, alignment & safe-area handling
   3. color & dark-mode correctness
   4. typography & Dynamic Type
   5. accessibility (labels, traits, contrast, 44pt targets)
   6. state coverage (loading/empty/error actually reachable and correct)
   7. navigation coherence & platform-idiom (HIG) fit — including Liquid
      Glass correctness per the Phase 0 adoption mode: legibility over
      glass, sane tinting, no glass-on-glass, system components not
      re-skinned
   8. interaction feedback & motion
5. **Fallback parity (gated + fallback mode only).** The screenshots above
   show the Liquid Glass branch; the fallback branch ships too, so it gets
   judged too. When discovery reported an older-iOS-runtime simulator
   (older than 26), repeat the key screenshots on it —
   `device.mjs stop`, then `device.mjs start --udid <older-runtime iPhone>`
   — and critique the fallback rendering with the same rubric; classify
   findings like any other. When no older runtime is installed, skip and
   say so in the snapshot (one line under the frontmatter), scoring the
   fallback from its pinned preview instead.
6. When the critique pass is done, stop the app (shuts the simulator down
   only if the helper booted it; physical devices are never rebooted):
   ```bash
   node .claude/skills/develop-ios-feature/scripts/device.mjs stop
   ```

**Persist the snapshot — required, this is what makes `--auto` converge.**
Write every critique run to
`.cache/develop-ios-feature/critique/<ISO-timestamp>__<slug>.md` with this
exact shape (it is what `critique-plan.mjs` parses):

```markdown
---
slug: workout-history
timestamp: 2026-07-10T14:30:00
total_score: 31
p0_count: 1
p1_count: 2
---

## Priority Issues

- [P0] Error state renders a blank screen. Fix: show the error view with retry.
- [P1] Dark mode: chart grid lines invisible on background. Fix: use a semantic color.
- [P2] Row spacing 6pt vs the 8pt token. Fix: use Spacing.small.
```

**Package layouts** skip the run-target half (`device.mjs` says `NO APP` and
exits 3): the audit and checklist still run in full, the visual dimensions
are scored from `#Preview` reasoning and snapshot-test images when the
project has swift-snapshot-testing, and the snapshot file is still written —
the convergence loop is identical.

### Under Claude Code: overlap the two passes (optional)

The two passes are independent, so they can run at the same time. The split
is one-sided:

- **Offload the audit to a background subagent** (the `Task` tool). It asks
  nothing and returns findings you fix from, so it is safe to run headless.
  Keep it on the **session model, not a smaller one**: the audit is a
  judgment pass (concurrency, state ownership, accessibility), and a
  downgraded audit saves tokens by missing findings you pay for again in
  Phase 5.
- **Keep the critique in the foreground.** It drives the simulator and reads
  screenshots on the main thread. "Foreground" means the main thread, not
  that the run halts for input: in a hands-off run, continue past the
  findings using the persisted-snapshot work-list (Autonomous mode) rather
  than waiting.

Merge both finding sets into one snapshot before Phase 5. Never run two
agents against one booted simulator at once.

## Phase 5: Fix and loop until clean

This is a loop, not a one-shot pass. Work one finding (or one tightly related
group) at a time so each fix is its own commit. In a hands-off run the
finding list is the P0/P1 output of `critique-plan.mjs` (Phase 4 / Autonomous
mode), and its exit code is the loop's convergence signal: keep looping while
it exits non-zero (P0/P1 remain), and stop when it exits 0 (only deferred
P2/P3 left).

Severity definitions:

- **P0** — broken: crash, unreadable text, an unreachable or blank state,
  data loss
- **P1** — clearly wrong against the spec, the design tokens, or the HIG:
  invisible dark-mode content, missing accessibility labels on interactive
  elements, layout broken at large Dynamic Type
- **P2** — polish: off-token spacing, weak hierarchy, missing transition
- **P3** — nice-to-have

1. **Fix by severity (P0/P1 first), driven by the finding text.** A visual
   finding usually lands in the view or its tokens; a state finding in the
   observable model; a concurrency finding where the audit pointed.
2. **Re-run the gates** (Phase 3): the fix changed code, so build, test, and
   lint must pass again.
3. **Commit that fix on its own** once green: a focused `fix(<area>): ...`
   per finding (or close group), routed through `/commit-message` (`--yes`
   in autonomous mode).
4. **Re-evaluate** (Phase 4): fresh screenshots, fresh scores, a new
   snapshot — the loop reads the newest one.

Repeat until **no P0 or P1 findings remain and the critique score plateaus**
(expect a few points per pass). Stop when the remainder is genuine P2/P3
polish, not at a perfect 40.

Once the loop settles, **promote anything reusable before the final pass.**
If the feature introduced a view modifier, color/spacing token, or component
that belongs in the project's shared design system rather than this feature
alone, extract it there, re-run the gates, and commit it. Skip this when the
feature added nothing shareable.

## Phase 6: Commit, document, and PR

**Precondition: the Phase 5 loop has converged.** Gates green, no open P0/P1,
and the UI/snapshot suite passes. If anything is still red, return to
Phase 5; do not open a PR around an open P0/P1.

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
  test plan (the gate commands you ran and their result):

  ```bash
  git push -u origin feat/<slug>
  gh pr create --title "<type>: <summary>" --body "<what changed, why, test plan>"
  ```

**After the PR is open, report to the user and stop:**

```
PR open: <url>

Deferred (P2/P3):
<list any unresolved P2/P3 findings, or "none">

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
   user-affecting patches -> **patch**. When the project records the version
   in a file (`MARKETING_VERSION` in `project.pbxproj`, a `VERSION` file, a
   config plist), that edit goes in a `chore/release-<X.Y.Z>` PR through the
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
skill never archives, signs, uploads to TestFlight, or submits to the App
Store; distribution pipelines (fastlane, Xcode Cloud) stay human-run.

## Universal disciplines (portable, every project)

- **Never use `node -e '...'` inline scripts.** Multi-line inline node code
  triggers Claude Code's static-analysis block. Write the script to
  `.cache/develop-ios-feature/<name>.mjs` with the Write tool, then run
  `node .cache/develop-ios-feature/<name>.mjs`. The cache dir is gitignored.
- **Inspect files with the Read and Grep tools, not shell parsers.** Reaching
  for `python3 -c`, `jq`, or `cat`/`sed` to read or pretty-print a file needs
  broad shell grants and prompts in a hands-off run; the Read and Grep tools
  need no Bash permission. Remove a tracked file with `git rm <path>`, not a
  bare `rm`: neither is auto-allowed (every delete path prompts,
  intentionally), but `git rm` stages a recoverable deletion of tracked
  content while `rm` destroys it.
- **Redirect output to the cache dir, never `/tmp/`.** A `/tmp/` path
  triggers a path-access prompt that `Bash()` allow entries cannot suppress;
  write logs and screenshots to `.cache/develop-ios-feature/` instead. Full
  gate runs need no manual redirect — the gate runner logs each gate to the
  cache dir for you.
- **Never prefix Bash commands with `cd /absolute/path;`.** The working
  directory is always the project root — run all commands from there
  directly. Compound `cd /abs/path; cmd` patterns trigger Claude Code's
  path-resolution-bypass check and block the command even when the intent is
  read-only. Use relative paths or run commands as-is.
- **Manage the app through the run-target helper, not raw simctl/devicectl
  choreography.** Build, launch, screenshot, and stop with
  `node .claude/skills/develop-ios-feature/scripts/device.mjs start|screenshot|appearance|relaunch|status|stop`,
  and drive launch-argument states with the `--` passthrough
  (`relaunch -- -myFlag value`) plus `screenshot --settle <sec>` for
  slow-rendering states. The helper resolves the target, waits for boot and
  past the splash, reads the bundle id, and cleans up after itself, so the
  critique never stalls on a permission prompt.
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
- **Never reset or reshape simulators or devices.** No `xcrun simctl
  erase|delete|create|clone|privacy|keychain|spawn`; on physical hardware no
  `devicectl device reboot|uninstall|wipe` and no pairing management. The
  workflow only builds, installs, launches, screenshots, and terminates —
  and shuts down only simulators it booted.
- **Never modify code signing, provisioning profiles, or bundle
  identifiers.** Device builds use the project's existing signing as-is;
  when it cannot sign, say so and critique on the simulator.
- **Never use the `&` background operator.** It trips Claude Code's
  static-analysis block regardless of allow entries. The run-target helper
  owns the app lifecycle; for any other long-running process, write a
  detached `child_process.spawn` launcher to `.cache/develop-ios-feature/`
  and run that.
- **Security floor, non-negotiable:** never hardcode credentials or API keys,
  never disable ATS/TLS verification "for testing", and keep secrets out of
  logs and screenshots — use the project's local-dev config path instead.
- **Build only what the feature needs (YAGNI).** Implement the scope
  confirmed in Phase 1, nothing speculative: no unused view configuration,
  protocols with one conformance "for mocking later", or generality for
  callers that do not exist yet. The simplest thing that satisfies the spec
  and passes the gates wins.
- **The gates are the merge bar, nothing else.** A clean SwiftLint run is
  not permission to skip them; a failing unrelated check is not a reason to
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

What Phase 0 surfaced in one SwiftUI app, to show the *kind* of thing to look
for. None of this is portable; yours will differ.

- **Layout:** `MyApp.xcodeproj` with filesystem-synchronized groups (Xcode
  16), scheme `MyApp`, deployment target iOS 17, iPhone-only
  (`TARGETED_DEVICE_FAMILY = 1`).
- **Gates:** `xcodebuild build` + `test` on the newest available iPhone
  simulator; `swiftlint lint` (config present, `--strict` in CI); no
  coverage threshold.
- **State idiom:** `@Observable` models owned by the screen's root view via
  `@State`, injected downward with `@Environment`.
- **Design language:** deployment target iOS 17, built with the iOS 26 SDK,
  no `UIDesignRequiresCompatibility` → **gated + fallback**: Liquid Glass on
  the feature's floating filter bar via a shared `adaptiveGlass()` modifier
  (`.glassEffect` on 26+, `.ultraThinMaterial` below), system components
  left to auto-adopt; fallback screenshots on the installed iOS 18.4
  runtime.
- **Feature pattern:** each screen = `Features/<Name>/` holding
  `<Name>View.swift`, `<Name>Model.swift`, `<Name>+Previews.swift`, and a
  matching `<Name>ModelTests.swift`; design tokens in `Style/Tokens.swift`.
- **Critique run (plugin channel):** `dif-device start --scheme MyApp`, four
  screenshots (iPhone light/dark, Dynamic Type spot check, error state via
  a launch argument), snapshot written, `dif-critique-plan` → exit 1 (one
  P1: chart grid invisible in dark mode) → fix, re-gate, re-critique →
  exit 0.
- **Enforcement:** `PreToolUse` hooks routed `git commit`/`gh pr create`
  through `/commit-message` and `/create-pr`; branches were `feat/<slug>`.
- **NOT a gate:** the SwiftLint `todo` rule warned project-wide; only new
  violations blocked merge.

## Installing this skill and its companions elsewhere

- **This skill:**
  `npx skills add pyaethu-aung/skills --skill develop-ios-feature`
  (add `--global` to install it for every project), or install the `ios-dev`
  plugin, which bundles `/update-readme` and puts the `dif-*` helper
  commands on the PATH.
- **`/commit-message`, `/create-pr`, `/update-readme` (optional):** install
  with `npx skills add pyaethu-aung/skills --skill <name>`, or skip them to
  use each phase's direct fallback.

## What this skill is not

A runnable driver, a project generator, or an App Store release pipeline.
The helpers manage discovery, gates, and the app's run target; the judgment
(shape, implementation, critique, fixes) is the agent following this
playbook. It does not archive, sign, upload to TestFlight, or submit to the
App Store, and it is SwiftUI/iOS-focused — UIKit-heavy or multiplatform
(macOS/watchOS/visionOS) work may fit partially, but the critique matrix and
gates assume an iOS target.
