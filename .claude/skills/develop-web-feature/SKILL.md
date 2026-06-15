---
name: develop-web-feature
description: "Develop, design, and ship a website feature end-to-end with /impeccable: shape, build, gate, audit, critique, fix, and open a PR. Portable across web projects. Use when asked to add, build, craft, or design a new feature."
metadata:
  version: "1.1.0"
argument-hint: "The feature to build (e.g. 'Calendar event content type')"
allowed-tools: Bash(npm*) Bash(npx*) Bash(node*) Bash(git:*) Bash(gh:*) Bash(grep*) Bash(ls*) Bash(cat*) Read Write Edit
---

# Develop a feature with /impeccable

The playbook for taking a web feature from idea to PR using the `/impeccable`
design workflow. It is not a runnable driver: the "driver" is the sequence of
skill invocations and gate commands below.

The loop, in one line: **learn → shape → build → gate → audit → critique →
fix → commit → PR**, iterating audit/critique until the score plateaus.

This skill is portable. The *workflow* and *disciplines* are the same in every
project; the *specifics* (gate commands, file layout, conventions, enforcement)
differ, so Phase 0 installs the one hard dependency (`/impeccable`) and
discovers the rest before any code is written. A concrete worked example from
one project is at the end, as illustration only: yours will differ.

## Phase 0: Set up

### Ensure dependencies

**`/impeccable` is required.** The whole workflow is built on it. If it is not
already available in the project, install it from the project root:

```bash
npx impeccable skills install
```

then, inside the AI tool:

```
/impeccable init
```

Use the CLI, not a hand copy of the skill file: it installs the design skill
**and** its anti-pattern detector engine. A copy-only or symlink-only install
leaves `/impeccable critique`'s detector failing with "bundled detector not
found." Do not proceed without `/impeccable`.

**`/commit-message` and `/create-pr` are optional.** They standardize commits
and PRs, but the workflow completes without them. If the project has them (or
you choose to add them: they are single-file skills, drop each `SKILL.md` into
`.claude/skills/<name>/`), Phase 6 routes through them. If the user chooses not
to install them, Phase 6 falls back to doing the commit and PR directly, with
the same conventions inlined there.

### Learn this project (do not skip)

**First, check for a cached baseline.** This skill caches its Phase 0 findings
per project in your OS user cache directory — `$XDG_CACHE_HOME/develop-web-feature/`
(falling back to `$HOME/.cache/develop-web-feature/`) on Linux, or
`$HOME/Library/Caches/develop-web-feature/` on macOS — under a filename keyed to
this repo's absolute path. If that file exists, read it and trust it: skip the
discovery below, re-deriving only the entries whose source has changed. One
thing is never cached — the **green baseline**: always re-run the gates once on
a clean tree, because it is a live fact (dependency or coverage drift), not a
static answer. If there is no cache file, discover everything from scratch and
write it at the end of this phase (see "Cache the baseline").

Before building, find this project's answers. Most live in `CLAUDE.md` /
`AGENTS.md`, `README`, `package.json` scripts, the lint config, and
`.claude/settings.json`. Establish:

- **The gates:** the exact commands that must pass before a PR (test? lint?
  typecheck? build? a coverage threshold?). Run them once now on a clean tree
  so you know the green baseline.
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

### Cache the baseline

Write what you found to the OS user cache so the next run skips rediscovery:

```bash
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/develop-web-feature"   # macOS: "$HOME/Library/Caches/develop-web-feature"
mkdir -p "$CACHE_DIR"
KEY="$(basename "$PWD")-$(printf '%s' "$PWD" | shasum | cut -c1-8)"   # repo name + path hash, collision-safe
# write the findings to "$CACHE_DIR/$KEY.md"
```

It lives outside the repo on purpose: a regenerable cache, never committed, no
`.gitignore` entry needed. Record the five findings above plus the date you
captured them, and keep it terse — a cheat sheet, not documentation. Treat an
entry as stale and re-derive it when its source moves: the gates when
`package.json` scripts or the lint config change; the feature pattern when a
newer comparable feature lands. The gate run itself is never cached — confirm
green on a clean tree every time. The "Worked example" below shows the shape of
a filled-in baseline.

## Phase 1: Shape before building

```
/impeccable craft <feature>
```

`craft` runs a shape-and-confirm step first: it proposes scope and waits.
Confirm or adjust before any code is written. The confirmation is the cheapest
place to catch a scope mismatch. (Use `/impeccable shape <feature>` for
planning only, without the build.)

## Phase 2: Build

Follow the feature pattern from Phase 0. Match the surrounding code: use the
project's primitives and design tokens, not ad-hoc markup or hard-coded
values. Honor the design system and `/impeccable`'s shared laws (no em dashes
in copy, accessibility bar, real translations where the project is localized).

## Phase 3: Gate

Run the project's gate commands (from Phase 0). All must pass before a PR;
this is the only bar that blocks merge. Iterate on one test file at a time
while building, and preview in a browser if the project has a dev server.

## Phase 4: Evaluate

```
/impeccable audit <feature>
```

Technical pass: a11y, performance, theming, responsive, anti-patterns. Then:

```
/impeccable critique <feature>
```

Design pass: heuristics scored out of 40, persona walkthroughs, an AI-slop
verdict, and a deterministic detector run. It persists a snapshot and prints
a score trend across runs.

## Phase 5: Fix, then re-evaluate

Address findings by severity (P0/P1 first). The critique suggests follow-up
commands (`/impeccable harden`, `clarify`, `polish`, `adapt`, `onboard`).
Re-run `/impeccable critique`; expect the score to climb a few points per pass
and plateau. Stop when the remaining items are P2/P3 polish, not when it hits
a perfect 40.

## Phase 6: Commit and PR

Always branch off the default branch (`<type>/<slug>`, e.g. `feat/event-mode`)
rather than committing to it, and never bypass hooks with `--no-verify`.

**If `/commit-message` and `/create-pr` are installed,** route through them;
they enforce the format and confirm before acting.

**If they are not** (the project opted out), do it directly with the same
discipline:

- *Commit.* Conventional Commits: an imperative subject of 50 characters or
  fewer (hard limit 72), a blank line, then a body wrapped at 72 explaining
  what changed and why. One logical change per commit; split unrelated concerns
  into separate commits.

  ```bash
  git checkout -b feat/<slug>
  git add <files for this change>
  git commit
  ```

- *PR.* Push the branch and open a PR whose body has a short summary and a test
  plan (the gate commands you ran and their result):

  ```bash
  git push -u origin feat/<slug>
  gh pr create --title "<type>: <summary>" --body "<what changed, why, test plan>"
  ```

After a user-facing change, update the README (a `/update-readme` skill if
present, or by hand).

## Universal disciplines (portable, every project)

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

## Worked example: qr-generator (illustration only)

What Phase 0 surfaced in one React + Vite + Tailwind project, to show the
*kind* of thing to look for. None of this is portable; yours will differ.

- **Gates:** `npm run test && npm run lint && npm run build`. Prettier was
  *not* a gate (a 286-file pre-existing backlog made `npm run format` fail on
  untouched files).
- **Feature pattern:** each QR "content mode" = a type union entry + a pure
  `buildXString` util + a `useXConfig` hook + an `XForm` component + parallel
  tests, wired into two files. Copying the newest mode was the fastest start.
- **i18n in three files:** a key needed adding to `en.json`, `my.json`, **and**
  both a `ControlStrings` interface and a `TranslationKey` union in
  `src/types/i18n.ts`, or lint/build failed.
- **Lint was React Compiler strict:** no `setState` in an effect, no ref
  access during render, `useCallback` wanted an inline function. Three
  separate rewrites came from these.
- **Enforcement:** `PreToolUse` hooks routed `git commit`/`gh pr create`
  through `/commit-message` and `/create-pr`; a `pre-push` hook blocked pushes
  to `main`; branches were `feat/<slug>`.
- **Design system:** warm token palette, a strict "three accent elements per
  view" economy, no em dashes, WCAG AA, English + Burmese.

## Installing this skill and its dependencies elsewhere

- **`/impeccable` (required):** from the target project root, run
  `npx impeccable skills install`, then `/impeccable init` inside the AI tool.
  It is the npm package `impeccable`; the CLI compiles the skill and installs
  the detector engine that `/impeccable critique` needs.
- **`/commit-message`, `/create-pr` (optional):** install with
  `npx skills add pyaethu-aung/skills --skill commit-message` (and
  `--skill create-pr`), or skip them to use Phase 6's direct fallback.
- **This skill:** `npx skills add pyaethu-aung/skills --skill develop-web-feature`
  (add `--global` to install it for every project).

## What this skill is not

A runnable driver. The browser-driving harness (start the dev server, click
through the UI, screenshot) lives inside `/impeccable audit` and
`/impeccable critique`, which spin it up themselves. For a standalone way to
launch and drive a specific app, author a `run-<app>` skill with
`/run-skill-generator`.
