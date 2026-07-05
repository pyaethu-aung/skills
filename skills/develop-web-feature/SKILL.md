---
name: develop-web-feature
description: "Develop, design, and ship a website feature end-to-end with /impeccable: shape, build, e2e specs, gate, audit, critique, fix, open a PR, and release. Portable across web projects. Use when asked to add, build, craft, or design a new feature."
metadata:
  version: "1.3.0"
argument-hint: "[--auto] The feature to build (e.g. 'Calendar event content type')"
allowed-tools: Bash(npm*) Bash(npx*) Bash(node*) Bash(git:*) Bash(gh:*) Bash(grep*) Bash(ls*) Bash(cat*) Read Write Edit Task
---

# Develop a feature with /impeccable

The playbook for taking a web feature from idea to release using the
`/impeccable` design workflow. It is not a runnable driver: the "driver" is the sequence of
skill invocations and gate commands below.

The loop, in one line: **learn → shape → build → gate → audit + critique →
fix → re-evaluate ↻ → commit → docs → PR**, then ship: **merge → version-bump
PR → merge → tag + release**. Critique browser-tests the live app; the
audit/critique → fix cycle repeats until no P0/P1 findings remain and the score
plateaus. Publishing the release (not merging) is what deploys.

This skill is portable. The *workflow* and *disciplines* are the same in every
project; the *specifics* (gate commands, file layout, conventions, enforcement)
differ, so Phase 0 installs the one hard dependency (`/impeccable`) and
discovers the rest before any code is written. A concrete worked example from
one project is at the end, as illustration only: yours will differ.

## Autonomous mode (reduce human-in-the-loop)

By default the workflow pauses in several places: `craft` confirms scope,
`critique` asks what to fix, and the commit and PR skills each confirm. When
the request asks for a hands-off run (it says "autonomous" or "hands-off", or
passes `--auto`), collapse those into a single review at the PR:

- **Skip craft's scope confirmation** when the prompt is already a complete
  spec, or run one silent `/impeccable shape` pass and proceed. Phase 0's rule
  still holds: if the scope is genuinely ambiguous, ask once rather than build
  the wrong thing.
- **Run `audit` and `critique`, then continue past critique's hand-back.**
  Audit prompts for nothing. `/impeccable critique` always ends by printing a
  **Recommended Actions** list and the line "you can ask me to run these one at
  a time…" (and, with three or more findings, it calls `AskUserQuestion`); it
  has no non-interactive mode of its own. In a hands-off run that ending is a
  **continuation point, not a stop**: do not answer it and do not yield. Two
  things make that reliable:
  - **Derive the work-list from the snapshot, not the prompt.** Critique
    persists every run to `.impeccable/critique/<timestamp>__<slug>.md` (YAML
    frontmatter with `p0_count` / `p1_count`, plus a `## Priority Issues`
    section). Run
    `node .claude/skills/develop-web-feature/scripts/critique-plan.mjs` (add
    `--slug <slug>` to target one file): it reads the latest snapshot, prints the
    P0/P1 to fix and the P2/P3 to defer, and exits non-zero while any P0/P1
    remain (a deterministic convergence signal, like the gate runner). This
    works even when critique would otherwise hard-yield via `AskUserQuestion`.
  - **Keep critique itself non-interactive.** When invoking it, instruct it to
    output the findings and Recommended Actions and to skip the clarifying
    `AskUserQuestion` step, so the call returns instead of waiting.
  Feed the script's P0/P1 into the Phase 5 loop (fix each by its issue text via
  the Phase 5 routing table); record its P2/P3 as Deferred.
- **Surface what was not fixed.** P0/P1 from both passes are fixed in the loop;
  the remaining P2/P3 are deliberately not auto-fixed, but must not vanish in a
  hands-off run. List them in the PR body under a **Deferred (P2/P3)** heading,
  taken from `critique-plan.mjs`'s P2/P3 output (the snapshot in
  `.impeccable/critique/`) and the audit report, so you can triage them at
  review.
- **File edits still gate on permission; handle that out-of-band.** `--auto`
  removes the skill's own confirmations, but Claude Code still prompts before
  each `Edit` / `Write`. For an unattended run, enable one of: accept-edits mode
  (shift+tab, or `--permission-mode acceptEdits`); `bypassPermissions` for fully
  unattended; or grant scoped edits up front with
  `node .claude/skills/develop-web-feature/scripts/setup.mjs --grant-edits --write`,
  which auto-approves `Edit` / `Write` / `MultiEdit` for the project's source and
  test directories only (config, `package.json`, `.github/`, `.claude/`, and docs
  still prompt). The scoped grant is narrower than accept-edits mode but persists
  across sessions, so it is opt-in; pick per your trust preference.
- **Commit and open the PR without prompting:** route through
  `/commit-message --yes` and `/create-pr --yes` (same format and skill token,
  no confirmation pause). Opening the PR is **not optional** — never stop
  before it is open.
- **Stop immediately after the PR is open.** Do not auto-merge and do not
  publish the release; PR approval, merge, and the release publish stay human
  (Phase 7). Report the PR URL and deferred findings, then stop. The user will
  resume Phase 7 manually once the PR is merged.

Autonomous mode removes only the in-flow confirmations. The gates, the fix
loop, atomic commits, and the disciplines are unchanged.

## Phase 0: Set up

### Resolve the install channel (do this first)

This skill ships through two channels and the helper-script command form
differs. Check the skill's **base directory** (shown at invocation) once, and
apply the matching form to every script command in this skill:

- **`.claude/skills/develop-web-feature/`** — the `npx skills` install. Use
  the commands exactly as written throughout
  (`node .claude/skills/develop-web-feature/scripts/<name>.mjs`).
- **Anywhere else (the plugin cache)** — the `web-dev` plugin install. The
  plugin puts wrapper commands on the PATH; substitute `dwf-<name>` for
  `node .claude/skills/develop-web-feature/scripts/<name>.mjs` everywhere:
  `dwf-setup`, `dwf-discover`, `dwf-gates`, `dwf-dev-server`,
  `dwf-critique-plan`, `dwf-cache-check`, `dwf-cache-write`. Skill
  invocations are namespaced on this channel (`/web-dev:develop-web-feature`,
  `/git-workflow:commit-message`, …); read every skill reference below
  accordingly.

`setup.mjs` detects the channel itself (from where it runs) and writes the
matching grant and token forms, so no permission entry needs hand-editing
when switching channels — but do not mix channels in one project: the same
skill installed twice under different names is a recipe for confusion.

Each plugin owns its own grants. On the plugin channel, `setup.mjs` manages
only web-dev's entries; when the **git-workflow plugin** is installed, also
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
node .claude/skills/develop-web-feature/scripts/setup.mjs           # preview the delta
node .claude/skills/develop-web-feature/scripts/setup.mjs --write   # apply it
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
`MultiEdit`, scoped to the project's source and test directories, for unattended
runs (see Autonomous mode for the trade-off versus accept-edits mode).

This adds every allow entry a hands-off run needs, **derived from your project**
so it is not tied to any one stack: full-suite gate runs via the gate runner
(`scripts/gates.mjs`, which replaces the broad `<pm> run *` grant), direct grants
only for the test/lint/type tools your
`package.json` actually depends on (Playwright, Vitest/Jest/Mocha, `tsc`, ESLint),
`npx impeccable*`, the Phase 0 scripts, the **dev-server lifecycle helper**, and
read-only / staging / branch-creation git. When the matching skill is installed it
also adds the skill-invocation tokens `Skill(develop-web-feature)`,
`Skill(impeccable)`, `Skill(commit-message)`, `Skill(create-pr)`,
`Skill(update-readme)` (each in both the bare and `:*` form), the `/impeccable`
script forms, the sentinel-prefixed commit / PR forms the guard hooks require, and
`gh pr view` / `gh pr list` for create-pr's existing-PR check and verify. Commit
and PR creation therefore stay gated behind their skills; `gh pr merge` stays
ungranted (Phase 7 is a human gate); and `git push` is never granted in
settings — `/create-pr` pre-approves it via its own `allowed-tools` while it
runs, and the direct no-create-pr fallback prompts once, since an
auto-approved outward push is only safe behind a default-branch `pre-push`
hook that not every project has.

> **Token gotcha:** the Claude Code permission token is `Skill(name)` —
> **singular**. The plural `Skills(name)` silently never matches, so a setup that
> writes it leaves every skill call prompting. Grant both `Skill(name)` and
> `Skill(name:*)`: the `:*` form is what matches an invocation that carries
> arguments (e.g. `/impeccable craft <feature>`).

The only entry that must exist beforehand (to approve `setup.mjs` itself) is
the one matching the install channel — for an `npx skills` install:

```json
"Bash(node .claude/skills/develop-web-feature/scripts/setup.mjs*)"
```

or, for the `web-dev` plugin install (add the second entry only when the
git-workflow plugin is installed too, so its own setup can run):

```json
"Bash(dwf-setup*)"
"Bash(gwf-setup*)"
```

Add it to `.claude/settings.local.json` once; `setup.mjs` handles everything
else. Because that grant ends in `*`, it also authorizes the `--write` form, so
the dry run is a discipline the workflow follows (preview, confirm a non-empty
delta, then `--write`), not a second approval prompt.

### Ensure dependencies

**`/impeccable` is required.** The whole workflow is built on it. If it is not
already available in the project, install it from the project root:

```bash
npx impeccable skills install
```

After a mid-session install, do two things before using it:

1. **Re-run the setup script with `--write`.** The dry run now shows the
   impeccable entries as the delta (`Skill(impeccable)`, `Skill(impeccable:*)`,
   and its script grants): the conditional detection only sees
   `.claude/skills/impeccable` after the install, so a setup run from before
   it could not have granted them.
2. **Confirm `/impeccable` is invocable, then run `/impeccable init`.**
   Claude Code watches existing skill directories, so when `.claude/skills/`
   already existed at session start the new skill appears in the same session
   on its own. If it does not appear, `.claude/skills/` itself was created by
   this install (common on the plugin channel, where this skill does not live
   there) and the watcher cannot see it: **stop and hand back** — ask the
   user to run `/reload-skills` (a user-typed command; Claude Code 2.1.152+)
   or, failing that, to restart the session and re-invoke this skill. This
   bootstrap stop happens at most once per project.

Use the CLI, not a hand copy of the skill file: it installs the design skill
**and** its anti-pattern detector engine. A copy-only or symlink-only install
leaves `/impeccable critique`'s detector failing with "bundled detector not
found." Do not proceed without `/impeccable`.

**When `/impeccable` is already installed, check for an update** before the
baseline gate run: read the installed version from
`.claude/skills/impeccable/SKILL.md`'s frontmatter and compare it with
`npm view impeccable version` (the latest published release). If they differ,
update with `npx impeccable@latest skills install`. Phase 0 is the safe
moment — no audit or critique has run yet, so detector output and scores stay
consistent within the run; never update mid-loop. Updating an existing skill
edits files the skill watcher already sees, so no reload or restart is needed
(only a *first* install has the bootstrap stop above). Fail open: if the
installed version cannot be determined or the registry is unreachable
(offline), skip the check and proceed with the installed version — never
reinstall blindly on every run. In a hands-off run, apply the update without
pausing; it lands before any evaluation.

**`/commit-message`, `/create-pr`, and `/update-readme` are optional.** They
standardize commits, PRs, and README updates, but the workflow completes
without them. If the project has them (or you choose to add them: they are
single-file skills, drop each `SKILL.md` into `.claude/skills/<name>/`),
Phase 6 routes through them. If the user chooses not to install them, Phase 6
falls back to doing the commit, the PR, and the README update directly, with
the same conventions inlined there.

**Choose the browser driver (CLI preferred, MCP fallback).** Critique drives the
live UI and the e2e gate runs the browser. `discover.mjs` reports which drivers
are available and recommends one by this rule:

- **Playwright CLI present** (a `@playwright/test` / `playwright` dependency):
  **use the CLI.** It is what a `playwright test` gate and CI run, and the
  portable, installable path. If its browser binary is missing, install it once
  from the project root (cached and idempotent, a no-op when present; add
  `--with-deps` for the OS libraries a CI image needs):
  ```bash
  npx playwright install chromium
  ```
- **No CLI, but a Playwright MCP server configured** (a `playwright` entry in
  `.mcp.json`, or the `mcp__playwright__*` tools otherwise available): **use the
  MCP browser tools** for the critique. No install needed.
- **Neither configured:** **default to the CLI and install it** from the project
  root: `npm i -D @playwright/test && npx playwright install chromium`.

The CLI path needs no extra grant (`setup.mjs` adds `Bash(npx playwright*)`); the
MCP browser tools are granted only when MCP is the chosen driver (a Playwright
server in `.mcp.json` and no CLI dependency), scoped to inspect/drive tools. An
MCP server cannot run the CI gate (CI has no agent), so a project whose gate is
`playwright test` always has the CLI present and takes the first branch; the
**committed** e2e specs the skill writes are therefore always CLI, and MCP is
only ever the ad-hoc critique-inspection driver.

### Learn this project (do not skip)

**First, check for a cached baseline:**

```bash
node .claude/skills/develop-web-feature/scripts/cache-check.mjs
```

If the cache file exists, read it and trust it: skip the discovery below,
re-deriving only the entries whose source has changed. One thing is never
cached — the **green baseline**: always re-run the gates once on a clean tree,
because it is a live fact (dependency or coverage drift), not a static answer.
If there is no cache file, proceed with full discovery.

**Run the discovery script** to get a structured overview of the project's
scripts, inferred gates, git hooks, enforcement config, and which doc files are
present:

```bash
node .claude/skills/develop-web-feature/scripts/discover.mjs
```

Use the output as a starting point. Then read `CLAUDE.md` / `AGENTS.md`,
`README`, the lint config, and any doc files the script flagged as present to
fill in the rest. Establish:

- **The gates:** the exact commands that must pass before a PR (test? lint?
  typecheck? build? a coverage threshold?). Run them once now on a clean tree
  so you know the green baseline — use the gate runner, which executes the
  project's gates, logs each to the cache dir, and prints a PASS/FAIL summary:
  `node .claude/skills/develop-web-feature/scripts/gates.mjs` (add `--coverage`
  or `--e2e` when needed). It replaces hand-written `<pm> run … > log 2>&1`
  commands. For any *other* command, run it plainly — no `$?`, `$(…)`, or
  backticks; shell expansion trips Claude Code's command-injection heuristic
  and forces a permission prompt even when the base command is allowed.
- **The feature pattern:** how an existing comparable feature is structured.
  Find the newest one and copy its file layout (types, logic, state, UI,
  i18n, tests). Match it; do not invent a new shape.
- **Enforcement:** are commits/PRs routed through skills or hooks? Is direct
  push to the default branch blocked? What is the branch-naming convention?
- **The design system:** token file, component primitives, color/spacing
  rules, accessibility bar, localization. `/impeccable` reads PRODUCT.md /
  DESIGN.md if present; honor them.
- **What is NOT a gate:** many repos carry a formatter or doc backlog that
  fails on files you never touched. Confirm which checks actually block merge
  so you do not chase noise.

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

> Run `node .claude/skills/develop-web-feature/scripts/discover.mjs`, read
> the doc files it flags plus CLAUDE.md / AGENTS.md and the lint config, and
> locate the newest feature comparable to `<feature>`. Return only the terse
> baseline markdown for the project cache (gates, feature pattern,
> enforcement, design system, what is NOT a gate), ready for
> `cache-write.mjs`.

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

1. Write the findings markdown to `.cache/develop-web-feature/findings-draft.md`
   using the Write tool (not a shell command).
2. Run the cache script:
   ```bash
   node .claude/skills/develop-web-feature/scripts/cache-write.mjs .cache/develop-web-feature/findings-draft.md
   ```

Keep the content terse — a cheat sheet, not documentation. Treat an entry as
stale and re-derive it when its source moves: the gates when `package.json`
scripts or the lint config change; the feature pattern when a newer comparable
feature lands. The gate run itself is never cached — confirm green on a clean
tree every time. The "Worked example" below shows the shape of a filled-in
baseline.

## Phase 1: Shape before building

```
/impeccable craft <feature>
```

`craft` runs a shape-and-confirm step first: it proposes scope and waits.
Confirm or adjust before any code is written. The confirmation is the cheapest
place to catch a scope mismatch. (Use `/impeccable shape <feature>` for
planning only, without the build.)

## Phase 2: Build

**Branch first.** Create a feature branch off the default branch
(`<type>/<slug>`, e.g. `feat/event-mode`) before the first commit; never commit
to the default branch.

Follow the feature pattern from Phase 0. Match the surrounding code: use the
project's primitives and design tokens, not ad-hoc markup or hard-coded
values. Honor the design system and `/impeccable`'s shared laws (no em dashes
in copy, accessibility bar, real translations where the project is localized).

**Write e2e specs for the feature as you build it.** Every user-facing scenario
introduced or changed must have a corresponding Playwright spec in `e2e/`. The
spec is the proof that the feature works end-to-end in a real browser, not just
that units pass in jsdom. Keep specs interaction-driven: navigate, fill, click,
assert — one scenario per test, role-based selectors first, `data-testid` where
a role is ambiguous. A well-written spec must fail on the code before your
change and pass after. Place specs alongside the implementation commit; do not
leave them for the end.

**Commit as you go.** When a logical chunk of the implementation is gate-green
(Phase 3), commit it through `/commit-message`, one logical change per commit,
rather than batching at the end. The implementation, each Phase 5 fix, and the
Phase 6 docs all land as their own commits, so the history tracks every step.

Treat each of the following as its own commit boundary — do not bundle them:

- A new or substantially rewritten component
- A new or substantially rewritten hook
- A new utility module and its test
- A new or updated type definition
- An e2e spec (or a batch of specs for one scenario group)
- An i18n / locale key addition
- A doc update (README, architecture docs, design docs)

If a single task touches more than two of the above categories, split it before
committing: stage one category, commit, then the next. Check the project's
`CLAUDE.md` for project-specific commit boundary guidance.

## Phase 3: Gate

Run the gate runner —
`node .claude/skills/develop-web-feature/scripts/gates.mjs` (the gates derived
in Phase 0). All must pass before a PR; this is the only bar that blocks merge.
Iterate on one test file at a time while building (`npx vitest run <file>` or
the project's equivalent), and preview in a browser if the project has a dev
server.

## Phase 4: Evaluate

```
/impeccable audit <feature>
```

Technical pass: a11y, performance, theming, responsive, anti-patterns. It is
static: it reads source and scores it, with no browser and no user prompts.

```
/impeccable critique <feature>
```

Design pass: heuristics scored out of 40, persona walkthroughs, an AI-slop
verdict, and a deterministic detector run. It persists a snapshot and prints
a score trend across runs. It drives a browser and ends by asking you what to
fix, so it stays in the foreground. In a hands-off run that closing question is
**not** a stop: derive the work-list from the persisted snapshot via
`critique-plan.mjs` and continue (see Autonomous mode).

### Under Claude Code: overlap the two passes (optional)

Both passes are read-only and ignore each other's output, so they can run at
the same time. They are asymmetric, so the split is one-sided:

- **Offload `audit` to a background subagent** (the `Task` tool). It asks
  nothing and returns a report you fix from, so it is safe to run headless.
  Keep it on the **session model, not a smaller one**: audit is a judgment
  pass (a11y, performance, anti-patterns), and a downgraded audit saves
  tokens by missing findings you pay for again in Phase 5.
- **Keep `critique` in the foreground — in default and hands-off runs
  alike.** It drives a browser and calls
  `AskUserQuestion`, neither of which an autonomous subagent can do, and
  it already fans out its own Assessment A/B subagents internally: nesting it
  inside a subagent would force critique back to its slower sequential
  fallback. "Foreground" means the main thread, not that the run halts for
  input: in a hands-off run, continue past critique's closing question using the
  persisted-snapshot work-list (Autonomous mode) rather than waiting on it.

Merge both finding sets before Phase 5. **Never run two browser-driving
`/impeccable` commands at once against one app:** they contend on the
dev-server port and browser resources. Only critique drives the browser here
(audit is static), which is the point of the split. Harnesses without parallel
subagents run the two passes sequentially, in either order.

### Critique must drive the real UI, not just source

Critique earns its keep by judging what actually renders and behaves, so under
Claude Code run it against the live app, not source alone, using the **browser
driver chosen in Phase 0** (the Playwright CLI, or the Playwright MCP tools when
MCP is the fallback):

1. Start the dev server with the lifecycle helper, which spawns it detached,
   waits for the port, and prints the ready URL — no raw `curl`/`lsof` needed:
   ```bash
   node .claude/skills/develop-web-feature/scripts/dev-server.mjs start
   ```
2. Screenshot each key state across **both themes (light and dark)** and
   **mobile and desktop** widths. CLI: `npx playwright screenshot --viewport-size=...`.
   MCP: `browser_navigate`, then `browser_resize` + `browser_take_screenshot`.
3. For real flows (the clicks, typing, and submits a user performs, plus the
   edge cases the personas would hit). CLI: write a short spec under `e2e/` and
   run it with `npx playwright test`. MCP: drive the flow with `browser_navigate`
   / `browser_click` / `browser_type` and read state via `browser_snapshot`. Feed
   the screenshots and any failures into the critique alongside its detector
   output. The **committed** e2e specs (the gate) are always CLI; an MCP flow
   here is ad-hoc inspection, not a saved spec.
4. When the critique pass is done, stop the server (kills the whole process
   group; no `pkill`/`kill` needed):
   ```bash
   node .claude/skills/develop-web-feature/scripts/dev-server.mjs stop
   ```

Write all temp screenshots to `.cache/develop-web-feature/` (CLI:
`npx playwright screenshot --output=.cache/develop-web-feature/01-desktop-light.png`;
MCP: pass that path as `browser_take_screenshot`'s `filename`).
`cache-write.mjs` already creates this directory and gitignores it. Temp files
in the project root require a destructive `rm` cleanup step, which is not
auto-allowed.

This runs on the main thread; the audit subagent stays static and touches no
browser. If the project ships a `/verify` skill, route the interaction pass
through it.

## Phase 5: Fix and loop until clean

This is a loop, not a one-shot pass. Work one finding (or one tightly related
group) at a time so each fix is its own commit. In a hands-off run the finding
list is the P0/P1 output of `critique-plan.mjs` (Phase 4 / Autonomous mode), and
its exit code is the loop's convergence signal: keep looping while it exits
non-zero (P0/P1 remain), and stop when it exits 0 (only deferred P2/P3 left).

1. **Fix by severity (P0/P1 first), driven by the findings.** Both audit and
   critique tag every issue with a severity and a **Suggested command**; run
   the command each finding names instead of free-handing the fix. Typical
   routings:
   - performance / LCP / bundle -> `/impeccable optimize`
   - responsive breakage or overflow -> `/impeccable adapt`
   - confusing copy or error text -> `/impeccable clarify`
   - spacing, rhythm, hierarchy -> `/impeccable layout`
   - clutter, cognitive overload, or too many visible options -> `/impeccable distill`
   - generic type -> `/impeccable typeset`; flat color -> `/impeccable colorize`
   - missing i18n, edge cases, error states -> `/impeccable harden`
   - empty or first-run states -> `/impeccable onboard`
2. **Re-run the gates** (Phase 3): the refine commands changed code, so
   `test && lint && build` must pass again.
3. **Commit that fix on its own** once green: a focused `fix(<area>): ...` per
   finding (or close group), so the history shows what each change addressed.
   Route through `/commit-message` (`--yes` in autonomous mode).
4. **Re-evaluate** (Phase 4): re-run `audit` and the browser-tested `critique`
   to refresh the finding list.

Repeat until **no P0 or P1 findings remain and the critique score plateaus**
(expect a few points per pass). Stop when the remainder is genuine P2/P3
polish, not at a perfect 40.

Once the loop settles, **promote anything reusable before the final polish.**
If the feature introduced a component, token, or pattern that belongs in the
shared design system rather than this feature alone, run `/impeccable extract`
to pull it into the project's shared primitives, then re-run the gates and commit it. Skip this when the
feature added nothing shareable. It is the cheapest moment to catch a
feature-local duplicate of what should be a shared primitive.

Then run `/impeccable polish` as the closing pass, re-run the gates one final
time, and commit it.

## Phase 6: Commit, document, and PR

**Precondition: the Phase 5 loop has converged.** Gates green, no open P0 or
P1 audit or critique finding, and the full e2e suite passes. Run the e2e suite
now (`npx playwright test`, or the project's `test:e2e` script) and fix any
failure before opening the PR — a red e2e test is a broken user flow, not a
cosmetic issue. If anything is still red or unresolved, return to Phase 5; do
not open a PR around an open P0/P1 or a failing e2e spec.

The implementation and every P* fix are already committed incrementally on the
feature branch (Phases 2 and 5), one logical change each. Never bypass hooks
with `--no-verify`. Add the doc commits, then open the PR last so it carries
every commit:

1. **The feature and its fixes** are already committed (Phases 2 and 5);
   nothing to re-commit here.
2. **The docs the change moved, each as its own commit, before the PR.** Skip
   any whose trigger did not fire; most features touch one or two, not all
   three:
   - **README** when user-visible behavior changed — via `/update-readme`
     when installed, else edit README.md directly with the same discipline
     (surgical edits to the affected sections only, never a rewrite).
   - **CLAUDE.md / AGENTS.md** when architecture, conventions, commands, or the
     directory layout changed (a hand-written conventional commit): what a
     future contributor or agent needs to know.
   - **DESIGN.md** (`/impeccable document`) when the design system changed (new
     tokens, primitives, or patterns, often right after `extract`); reconcile
     its output with the file's hand-written notes rather than overwriting them.

   This matches the project's own history, where `docs:`, `chore(claude):`, and
   `docs(design):` commits land separately from the `feat:` commit.

   **Under Claude Code, draft the doc updates in parallel.** When more than
   one trigger fired, the updates are independent of each other: delegate
   each to its own subagent and launch them in a single message so they run
   concurrently — one general-purpose subagent for the README update (routed
   through `/update-readme` when installed, else a direct surgical edit), and
   one for the CLAUDE.md / AGENTS.md update.
   Both are mechanical summarization of a diff, so pass a small/fast model
   override (e.g. `model: "haiku"`) when the harness supports one.
   `/impeccable document` (DESIGN.md) stays on the main thread and the
   session model: it reasons about the design system. The *drafts*
   parallelize; the *commits* do not — review each subagent's edit, then
   commit them sequentially, one per doc, through the same boundaries as
   above. Do the updates inline only when a single trigger fired or the
   harness has no subagents.
3. **The PR**, opened last so it carries the feature and the doc commits.

**If `/commit-message` and `/create-pr` are installed,** route through them;
they enforce the format and confirm before acting.

**If they are not** (the project opted out), do it directly with the same
discipline:

- *Commit.* Conventional Commits: an imperative subject of 50 characters or
  fewer (hard limit 72), a blank line, then a body wrapped at 72 explaining
  what changed and why. One logical change per commit; split unrelated concerns
  into separate commits.

  ```bash
  git add <files for this change>
  git commit
  ```

- *PR.* Push the branch and open a PR whose body has a short summary and a test
  plan (the gate commands you ran and their result):

  ```bash
  git push -u origin feat/<slug>
  gh pr create --title "<type>: <summary>" --body "<what changed, why, test plan>"
  ```

**After the PR is open, report to the user and stop:**

```
PR open: <url>

Deferred (P2/P3):
<list any unresolved P2/P3 findings from audit/critique, or "none">

Phase 7 (version bump + release): when the PR is approved and merged,
resume this conversation (or start a new one) and say "PR merged, continue
Phase 7". The version bump is <major|minor|patch> — <current> → <next>.
```

**Stop here.** Do not proceed to Phase 7 without an explicit user signal that
the PR has been merged. PR approval, merge, and the release publish are human
gates.

## Phase 7: Merge, version, and release

Phase 6 ends with the feature PR open; the rest is the release lifecycle. Two
points are **human gates** (you cannot approve your own PR), and the release
publish is an outward action to confirm before running.

1. **Merge the feature PR.** After a human approves it and CI is green, merge it
   (`gh pr merge`, per the repo's merge style). Merging to `main` does not deploy
   anything on its own (see step 5).
2. **Decide the version bump** from what merged, by Conventional Commit type:
   a breaking change -> **major**, `feat` -> **minor**, `fix` and other
   user-affecting patches -> **patch**. Check the project's current version in
   `package.json` to determine the next version number.
3. **Open the version-bump PR**, separate from the feature, because `main` is
   protected. On a `chore/release-<X.Y.Z>` branch, set `version` in
   `package.json` to `<X.Y.Z>`, then commit and open the PR through the same
   `/commit-message` and `/create-pr` route as Phase 6, with the subject
   `chore(release): bump version to <X.Y.Z>` (matching the repo's history).
4. **Merge the version-bump PR** after approval (same human gate as step 1).
5. **Tag and publish the release** on the merged `main`; the tag must match the
   bumped version:

   ```bash
   gh release create v<X.Y.Z> --target main --generate-notes
   ```

   **Confirm before running this:** publishing the release is the deploy
   trigger. Check the project's CI/CD config to understand what fires on
   `release: published` vs a tag push — deployment workflows vary by project.
   After publishing, confirm all release workflows go green before considering
   the release done.

## Universal disciplines (portable, every project)

- **Never use `node -e '...'` inline scripts.** Multi-line inline node code
  triggers Claude Code's static-analysis block. Write the script to
  `.cache/develop-web-feature/<name>.mjs` with the Write tool, then run
  `node .cache/develop-web-feature/<name>.mjs`. The cache dir is gitignored.
- **Inspect files with the Read and Grep tools, not shell parsers.** Reaching for
  `python3 -c`, `jq`, or `cat`/`sed` to read or pretty-print a file needs broad
  shell grants and prompts in a hands-off run; the Read and Grep tools need no
  Bash permission. Remove a tracked file with `git rm <path>`, not a bare
  `rm`: neither is auto-allowed (every delete path prompts, intentionally),
  but `git rm` stages a recoverable deletion of tracked content while `rm`
  destroys it.
- **Redirect output to the cache dir, never `/tmp/`.** A `/tmp/` path triggers a
  path-access prompt that `Bash()` allow entries cannot suppress; write logs to
  `.cache/develop-web-feature/<name>.log` instead. Full gate runs need no manual
  redirect — the gate runner (`scripts/gates.mjs`) logs each gate to the cache
  dir for you.
- **Never prefix Bash commands with `cd /absolute/path;`.** The working
  directory is always the project root — run all commands from there directly.
  Compound `cd /abs/path; cmd` and `cd /abs/path && cmd` patterns trigger
  Claude Code's path-resolution-bypass check and block the command even when
  the intent is read-only. Use relative paths or run commands as-is.
- **Manage the dev server through the helper, not raw process tools.** Start,
  query, and stop it with
  `node .claude/skills/develop-web-feature/scripts/dev-server.mjs start|url|stop`.
  Raw `curl`/`lsof`/`pkill`/`kill` are not auto-allowed (and should not be); the
  helper waits for the port, reports the URL, and kills the whole process group
  on stop, so the critique pass never stalls on a permission prompt.
- **Never use the `&` background operator.** It trips Claude Code's
  static-analysis block regardless of allow entries. Background the dev server
  with the helper above; for any other long-running process, write a detached
  `child_process.spawn` launcher to `.cache/develop-web-feature/` and run that.
- **Build only what the feature needs (YAGNI).** Implement the scope confirmed
  in Phase 1, nothing speculative: no unused props or options, no config flags
  or abstraction layers for callers that do not exist yet, no generality added
  "for later". The simplest thing that satisfies the feature and passes the
  gates wins; add structure when a second real caller actually arrives, not
  before. Applies to the feature's code, not to this workflow.
- **The gates are the merge bar, nothing else.** A clean formatter or a high
  critique score is not permission to skip them; a failing unrelated check is
  not a reason to stop.
- **Commit atomically.** One logical change per commit; split unrelated
  concerns into separate commits even within one feature.
- **Keep your diff legible.** Do not reformat or "fix" files your feature did
  not touch, even when a linter flags them project-wide.
- **Specifics live in three+ places.** Type systems, i18n registries, and
  config unions often require the same addition in several files; a value
  added in one place that fails the typecheck usually needs its sibling edits.
- **When a "clever" pattern fails the linter, prefer the plain one.** Modern
  React/TS lint rules reject many indirection tricks; the straightforward
  derived value is usually both correct and accepted.
- **Treat the detector as one signal.** `/impeccable critique`'s automated
  scan can be unavailable or noisy; weigh it alongside the design review, not
  above it.
- **Tier models by judgment, not by output size.** Where the harness supports
  per-subagent model selection, give the small/fast model only the structured
  extraction and summarization steps (Phase 0 discovery, Phase 6 README and
  CLAUDE.md drafts); keep shaping, building, audit, critique, and the fix
  loop on the session model. A cheap finding or fix pass inflates the Phase 5
  loop and costs more than it saves. The larger saving is context isolation,
  not model price: a subagent that returns only its conclusion keeps the
  bulky reading out of the main context for the rest of the session.

## Worked example (illustration only)

What Phase 0 surfaced in one React + Vite + Tailwind project, to show the
*kind* of thing to look for. None of this is portable; yours will differ.

- **Gates:** `npm run test && npm run lint && npm run build`. The formatter was
  *not* a gate (a large pre-existing backlog made it fail on untouched files).
- **Feature pattern:** each content mode = a type union entry + a pure builder
  util + a config hook + a form component + parallel tests, wired into two
  shared registry files. Copying the newest mode was the fastest start.
- **i18n in multiple files:** a key needed adding to each locale JSON file
  *and* to a `TranslationKey` union type, or the build failed.
- **Lint was strict:** framework-specific rules (e.g. React Compiler) rejected
  patterns that worked in other projects. Several rewrites came from these.
- **Enforcement:** `PreToolUse` hooks routed `git commit`/`gh pr create`
  through `/commit-message` and `/create-pr`; a `pre-push` hook blocked pushes
  to the default branch; branches were `feat/<slug>`.
- **Design system:** a token palette with a strict accent economy, defined
  accessibility bar, and copy conventions documented in `PRODUCT.md`.

## Installing this skill and its dependencies elsewhere

- **`/impeccable` (required):** from the target project root, run
  `npx impeccable skills install`, then `/impeccable init` inside the AI tool.
  It is the npm package `impeccable`; the CLI compiles the skill and installs
  the detector engine that `/impeccable critique` needs.
- **`/commit-message`, `/create-pr`, `/update-readme` (optional):** install
  with `npx skills add pyaethu-aung/skills --skill commit-message` (and
  `--skill create-pr`, `--skill update-readme`), or skip them to use Phase
  6's direct fallback.
- **This skill:** `npx skills add pyaethu-aung/skills --skill develop-web-feature`
  (add `--global` to install it for every project).

## What this skill is not

A runnable driver. The browser-driving harness (start the dev server, click
through the UI, screenshot) lives inside `/impeccable critique`, which spins it
up itself (`/impeccable audit` is static: it reads and scores source, with no
browser). For a standalone way to
launch and drive a specific app, author a `run-<app>` skill with
`/run-skill-generator`.
