---
name: develop-go-feature
description: "Develop and ship a Go backend feature end-to-end: plan the API contract and schema, implement with tests, gate on build/vet/race tests/lint/coverage, verify against the OpenAPI doc with /test-api, fix, open a PR, and release. Portable across Go services. Use when asked to add or build a backend feature or endpoint."
metadata:
  version: "1.0.0"
argument-hint: "[--auto] The feature to build (e.g. 'Vehicle telemetry ingestion endpoint')"
allowed-tools: Bash(go*) Bash(gofmt*) Bash(golangci-lint*) Bash(make*) Bash(node*) Bash(git:*) Bash(gh:*) Bash(grep*) Bash(ls*) Bash(cat*) Read Write Edit Task
---

# Develop a Go backend feature

The playbook for taking a Go backend feature from idea to release. It is not a
runnable driver: the "driver" is the sequence of skill invocations and gate
commands below.

The loop, in one line: **learn → plan → implement → gate → verify (contract +
review) → fix ↻ → commit → docs → PR**, then ship: **merge → version bump →
tag + release**. The verify phase runs the live service against its OpenAPI
doc; the gate/verify → fix cycle repeats until no P0/P1 findings remain.

This skill is portable. The *workflow* and *disciplines* are the same in every
project; the *specifics* (gate commands, module layout, conventions, whether
tests run in Docker) differ, so Phase 0 discovers them before any code is
written. A concrete worked example from one service is at the end, as
illustration only: yours will differ.

## Autonomous mode (reduce human-in-the-loop)

By default the workflow pauses in several places: Phase 1 confirms the plan,
and the commit and PR skills each confirm. When the request asks for a
hands-off run (it says "autonomous" or "hands-off", or passes `--auto`),
collapse those into a single review at the PR:

- **Skip the Phase 1 plan confirmation** when the prompt is already a complete
  spec. Phase 0's rule still holds: if the scope is genuinely ambiguous, ask
  once rather than build the wrong thing.
- **Run the full verify phase without pausing.** Classify every finding
  P0/P1/P2 yourself, fix the P0/P1 in the Phase 5 loop, and record the P2s.
- **Surface what was not fixed.** List deferred P2 findings in the PR body
  under a **Deferred (P2)** heading so they can be triaged at review.
- **File edits still gate on permission; handle that out-of-band.** `--auto`
  removes the skill's own confirmations, but Claude Code still prompts before
  each `Edit` / `Write`. For an unattended run, enable one of: accept-edits
  mode (shift+tab, or `--permission-mode acceptEdits`); `bypassPermissions`
  for fully unattended; or grant scoped edits up front with
  `node .claude/skills/develop-go-feature/scripts/setup.mjs --grant-edits --write`,
  which auto-approves `Edit` / `Write` / `MultiEdit` for the project's Go
  source and test directories only (`go.mod`, config, `.github/`, `.claude/`,
  and docs still prompt). The scoped grant is narrower than accept-edits mode
  but persists across sessions, so it is opt-in; pick per your trust
  preference.
- **Commit and open the PR without prompting:** route through
  `/commit-message --yes` and `/create-pr --yes` (same format and skill token,
  no confirmation pause). Opening the PR is **not optional**: never stop
  before it is open.
- **Stop immediately after the PR is open.** Do not auto-merge and do not
  publish the release; PR approval, merge, and the release publish stay human
  (Phase 7). Report the PR URL and deferred findings, then stop.

Autonomous mode removes only the in-flow confirmations. The gates, the fix
loop, atomic commits, and the disciplines are unchanged.

## Phase 0: Set up

### Resolve the install channel (do this first)

This skill ships through two channels and the helper-script command form
differs. Check the skill's **base directory** (shown at invocation) once, and
apply the matching form to every script command in this skill:

- **`.claude/skills/develop-go-feature/`** — the `npx skills` install. Use
  the commands exactly as written throughout
  (`node .claude/skills/develop-go-feature/scripts/<name>.mjs`).
- **Anywhere else (the plugin cache)** — the `go-dev` plugin install. The
  plugin puts wrapper commands on the PATH; substitute `dgf-<name>` for
  `node .claude/skills/develop-go-feature/scripts/<name>.mjs` everywhere:
  `dgf-setup`, `dgf-discover`, `dgf-gates`, `dgf-server`, `dgf-cache-check`,
  `dgf-cache-write`. Skill invocations are namespaced on this channel
  (`/go-dev:develop-go-feature`, `/go-dev:test-api`,
  `/go-dev:postgres-scaffold`, `/git-workflow:commit-message`, …); read every
  skill reference below accordingly.

`setup.mjs` detects the channel itself (from where it runs) and writes the
matching grant and token forms, so no permission entry needs hand-editing
when switching channels — but do not mix channels in one project: the same
skill installed twice under different names is a recipe for confusion.

Each plugin owns its own grants. On the plugin channel, `setup.mjs` manages
only go-dev's entries; when the **git-workflow plugin** is installed, also
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
node .claude/skills/develop-go-feature/scripts/setup.mjs           # preview the delta
node .claude/skills/develop-go-feature/scripts/setup.mjs --write   # apply it
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
`MultiEdit`, scoped to the project's Go source and test directories, for
unattended runs (see Autonomous mode for the trade-off versus accept-edits
mode).

This adds every allow entry a hands-off run needs, **derived from your
project** so it is not tied to any one layout: full-suite gate runs via the
gate runner (`scripts/gates.mjs`, whose one entry replaces broad `go test *`
orchestration grants), the direct `go build` / `go vet` / `go test` / `gofmt`
forms for single-package iteration, `golangci-lint run` and `goose` only when
the project actually uses them, narrow `make test*` / `make lint*` /
`make build*` forms only for Makefile targets that exist, the Phase 0
scripts, the **service lifecycle helper**, and read-only / staging /
branch-creation git. When the matching skill is installed it also adds the
skill-invocation tokens `Skill(develop-go-feature)`, `Skill(test-api)`,
`Skill(postgres-scaffold)`, `Skill(commit-message)`, `Skill(create-pr)`,
`Skill(update-readme)` (each in both the bare and `:*` form), the
sentinel-prefixed commit / PR forms the guard hooks require, and
`gh pr view` / `gh pr list` for create-pr's existing-PR check and verify.
Commit and PR creation therefore stay gated behind their skills; `gh pr merge`
stays ungranted (Phase 7 is a human gate); `git push` is never granted in
settings — `/create-pr` pre-approves it via its own `allowed-tools` while it
runs; and docker commands are never granted — when tests must run in Docker
the pinned gate commands run *inside* the gate runner (see "Learn this
project"), and any ad-hoc docker command prompts per use.

> **Token gotcha:** the Claude Code permission token is `Skill(name)` —
> **singular**. The plural `Skills(name)` silently never matches, so a setup
> that writes it leaves every skill call prompting. Grant both `Skill(name)`
> and `Skill(name:*)`: the `:*` form is what matches an invocation that
> carries arguments (e.g. `/test-api api/openapi.yaml`).

The only entry that must exist beforehand (to approve `setup.mjs` itself) is
the one matching the install channel — for an `npx skills` install:

```json
"Bash(node .claude/skills/develop-go-feature/scripts/setup.mjs*)"
```

or, for the `go-dev` plugin install (add the second entry only when the
git-workflow plugin is installed too, so its own setup can run):

```json
"Bash(dgf-setup*)"
"Bash(gwf-setup*)"
```

Add it to `.claude/settings.local.json` once; `setup.mjs` handles everything
else. Because that grant ends in `*`, it also authorizes the `--write` form,
so the dry run is a discipline the workflow follows (preview, confirm a
non-empty delta, then `--write`), not a second approval prompt.

### Ensure the toolchain

**The Go toolchain is the one hard dependency.** Confirm `go version` works
and the project root has a `go.mod`. If imports have drifted, `go mod tidy`
before the baseline gate run so dependency noise never lands in the feature
diff.

**`/test-api`, `/postgres-scaffold`, `/commit-message`, `/create-pr`, and
`/update-readme` are optional companions.** They standardize contract
testing, schema work, commits, PRs, and README updates, but the workflow
completes without them. On the plugin channel `/test-api` and
`/postgres-scaffold` ship with go-dev; on the npx channel install them with
`npx skills add pyaethu-aung/skills --skill test-api` (and
`--skill postgres-scaffold`). If a companion is absent, the phase that uses
it falls back to doing the work directly with the same conventions inlined
there.

### Learn this project (do not skip)

**First, check for a cached baseline:**

```bash
node .claude/skills/develop-go-feature/scripts/cache-check.mjs
```

If the cache file exists, read it and trust it: skip the discovery below,
re-deriving only the entries whose source has changed. One thing is never
cached — the **green baseline**: always re-run the gates once on a clean
tree, because it is a live fact (dependency or coverage drift), not a static
answer. If there is no cache file, proceed with full discovery.

**Run the discovery script** to get a structured overview of the module,
entrypoints, Makefile targets, inferred gates, OpenAPI doc location, Docker
setup, git hooks, enforcement config, and which doc files are present:

```bash
node .claude/skills/develop-go-feature/scripts/discover.mjs
```

Use the output as a starting point. Then read `CLAUDE.md` / `AGENTS.md`,
`README`, the lint config, and any doc files the script flagged as present to
fill in the rest. Establish:

- **The gates:** the exact commands that must pass before a PR (build? vet?
  unit tests with `-race`? lint? a coverage threshold? integration tests?).
  Run them once now on a clean tree so you know the green baseline — use the
  gate runner, which executes the gates, logs each to the cache dir, and
  prints a PASS/FAIL summary:
  `node .claude/skills/develop-go-feature/scripts/gates.mjs` (add
  `--coverage` or `--e2e` when needed). For any *other* command, run it
  plainly — no `$?`, `$(…)`, or backticks; shell expansion trips Claude
  Code's command-injection heuristic and forces a permission prompt even when
  the base command is allowed.
- **Whether tests run in Docker.** When the project has a `Dockerfile` or
  compose file **and** the user or `AGENTS.md` / `CLAUDE.md` explicitly says
  to test through Docker (dependencies and config may exist only in the
  image), pin the docker-based commands as the gates via
  `.cache/develop-go-feature/gates.json`, e.g.
  `{"gates": [{"name": "test", "command": "docker compose run --rm app go test -race ./..."}]}`.
  The gate runner executes them without a docker grant (its subprocesses are
  not re-checked against the allow list). A Docker file existing on its own
  is **not** enough — many repos carry one only for deployment; follow the
  project's stated instruction, and when unclear, ask.
- **The API contract:** where the OpenAPI/Swagger doc lives, whether it is
  hand-written or generated (e.g. swaggo annotations, oapi-codegen), and
  which direction is the source of truth. The verify phase tests the live
  service against this doc.
- **The feature pattern:** how an existing comparable feature is structured.
  Find the newest one and copy its file layout (handler, service, repository,
  DTOs, migrations, tests). Match it; do not invent a new shape.
- **Enforcement:** are commits/PRs routed through skills or hooks? Is direct
  push to the default branch blocked? What is the branch-naming convention?
- **What is NOT a gate:** many repos carry a lint or formatting backlog that
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

> Run `node .claude/skills/develop-go-feature/scripts/discover.mjs`, read
> the doc files it flags plus CLAUDE.md / AGENTS.md and the lint config, and
> locate the newest feature comparable to `<feature>`. Return only the terse
> baseline markdown for the project cache (gates, Docker-testing verdict,
> OpenAPI doc location and source of truth, feature pattern, enforcement,
> what is NOT a gate), ready for `cache-write.mjs`.

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

1. Write the findings markdown to `.cache/develop-go-feature/findings-draft.md`
   using the Write tool (not a shell command).
2. Run the cache script:
   ```bash
   node .claude/skills/develop-go-feature/scripts/cache-write.mjs .cache/develop-go-feature/findings-draft.md
   ```

Keep the content terse — a cheat sheet, not documentation. Treat an entry as
stale and re-derive it when its source moves: the gates when the Makefile or
lint config changes; the feature pattern when a newer comparable feature
lands. The gate run itself is never cached — confirm green on a clean tree
every time. The "Worked example" below shows the shape of a filled-in
baseline.

## Phase 1: Plan (contract first)

Shape the feature before writing code, starting from the API contract:

1. **Design the contract.** Draft or extend the OpenAPI doc for the new or
   changed endpoints *before* implementing them (unless Phase 0 established
   the doc is generated from code annotations — then draft the intended
   contract in the plan text instead, and the annotations in Phase 2 realize
   it). The doc is what the verify phase tests against, so it must lead, not
   trail.
2. **Design the schema.** When the feature touches the database, run
   `/postgres-scaffold` to shape the goose migration and (optionally) the
   GORM models. When it is not installed, follow the project's existing
   migration conventions directly.
3. **Write the plan.** A short document covering: endpoints and their
   request/response shapes; the error taxonomy (which failures map to which
   status codes and error bodies); authz (who may call this and how it is
   checked); the layers touched (handler, service, repository, DTOs, route
   wiring); migrations; and the test plan (unit, integration, contract).
4. **Confirm.** Present the plan and wait for confirmation — the cheapest
   place to catch a scope mismatch. In `--auto`, self-check instead: is every
   mutation idempotent or safely retryable? Are list endpoints paginated? Are
   transaction boundaries right? Is the change backward compatible for
   existing clients? Are all queries parameterized? No secrets in code or
   config? Then proceed.

## Phase 2: Implement

**Branch first.** Create a feature branch off the default branch
(`<type>/<slug>`, e.g. `feat/telemetry-ingestion`) before the first commit;
never commit to the default branch.

Follow the feature pattern from Phase 0 and build bottom-up so each layer is
testable when it lands:

1. **Migration** (from Phase 1 / `/postgres-scaffold`), then the model.
2. **Repository** (data access; parameterized queries only).
3. **Service** (business logic; context propagated end-to-end, errors
   wrapped with `%w` into the project's error taxonomy).
4. **Handler + route wiring** (validation at the edge, authz middleware,
   response shapes exactly as the contract says).

**Write tests as you build, not after.** Table-driven unit tests land in the
same commit as the unit they test. Integration tests (real database, real
router) go behind the project's convention — a `-tags=integration` build tag
or its `make` target — and cover every new endpoint's happy path and its
error taxonomy. A well-written test must fail on the code before your change
and pass after.

**Keep the OpenAPI doc in sync.** Whichever direction Phase 0 established
(doc-first or annotations-first), the contract and the code must agree at
every commit that touches an endpoint.

**Commit as you go.** When a logical chunk is gate-green (Phase 3), commit it
through `/commit-message`, one logical change per commit, rather than
batching at the end. Treat each of the following as its own commit boundary —
do not bundle them:

- A migration (and its model)
- A repository (or a substantial change to one) and its tests
- A service and its tests
- A handler + route wiring and its tests
- An integration/e2e test batch for one scenario group
- The OpenAPI doc update (when it is a hand-written doc)
- A doc update (README, architecture docs)

If a single task touches more than two of the above categories, split it
before committing: stage one category, commit, then the next. Check the
project's `CLAUDE.md` for project-specific commit boundary guidance.

While building, iterate on one package at a time (`go test ./internal/foo/`,
`go vet ./internal/foo/`, `gofmt -l .`) and save the full suite for the gate
runner.

## Phase 3: Gate

Run the gate runner —
`node .claude/skills/develop-go-feature/scripts/gates.mjs` (the gates derived
or pinned in Phase 0). All must pass before a PR; this is the only bar that
blocks merge. The default derivation:

- **build**: `go build ./...`
- **vet**: `go vet ./...`
- **lint**: `golangci-lint run` — only when the project has a `.golangci.*`
  config; config present but binary missing fails with an install hint
- **test**: `go test -race ./...`; with `--coverage` it also enforces the
  project's coverage threshold when one is configured

`--e2e` adds the integration/e2e suite (the project's make target, else
`go test -race -tags=integration ./...`). A project whose gates differ (or
run in Docker) pins exact commands in `.cache/develop-go-feature/gates.json`,
which overrides detection entirely. Never weaken a gate to pass it: fixing
the code is Phase 5's job.

## Phase 4: Verify (contract + integration + review)

The gates prove the code is sound in isolation; this phase proves the running
service honors its contract.

1. **Start the service** with the lifecycle helper, which spawns it detached,
   waits for the health endpoint (or port), and prints the base URL:
   ```bash
   node .claude/skills/develop-go-feature/scripts/server.mjs start
   ```
   If the service needs backing dependencies (Postgres, Redis), bring them up
   the project's documented way (its compose file or make target — expect a
   one-off permission prompt; docker is deliberately not pre-granted). A
   project whose start command is unusual pins it in
   `.cache/develop-go-feature/server.json`
   (`{"command": "...", "url": "...", "health": "/healthz"}`), including a
   compose-based command when the service itself runs in Docker.
2. **Contract test against the OpenAPI doc.** Run `/test-api` with the doc
   discovered in Phase 0 and the URL from `server.mjs url`. It executes
   read-only endpoints by default and confirms before anything mutating —
   run mutating endpoints only against a local/dev environment, never shared
   infrastructure. Every endpoint this feature added or changed must be
   exercised and must match the doc: status codes, response shapes, error
   bodies. When the project has its own contract-test target
   (`make test-api` or similar), `gates.mjs --api` runs that instead.
3. **Integration/e2e suite:** `gates.mjs --e2e` (if not already green in
   Phase 3).
4. **Review the diff** — a structured self code-review of everything on the
   branch, checking for: errors wrapped and mapped to the taxonomy (no
   swallowed errors); `context.Context` propagated to every I/O call, with
   timeouts at the edges; goroutine hygiene (no leaks, shared state guarded,
   `-race` clean); SQL parameterized everywhere; input validated at the
   handler edge; authz enforced on every new route; no hardcoded secrets or
   credentials; logs free of secrets and personal data (for fleet services:
   no raw location/telematics tied to individuals). Classify findings P0
   (broken/unsafe), P1 (must fix before merge), P2 (follow-up).
5. **Optionally scan dependencies:** `gates.mjs --vuln` runs `govulncheck`
   when it is installed. It is advisory (network-dependent), not a merge
   gate; treat any finding on a package your diff touches as P1.
6. **Stop the service:**
   ```bash
   node .claude/skills/develop-go-feature/scripts/server.mjs stop
   ```

Under Claude Code, the diff review (step 4) can run as a background subagent
on the session model while the contract run (step 2) proceeds on the main
thread — merge both finding sets before Phase 5. Never run two agents against
one live service at once.

## Phase 5: Fix and loop until clean

This is a loop, not a one-shot pass. Work one finding (or one tightly related
group) at a time so each fix is its own commit:

1. **Fix by severity (P0/P1 first).** A contract mismatch has two possible
   fixes — the code or the doc; pick whichever Phase 0 said is the source of
   truth, never "whichever is easier".
2. **Re-run the gates** (Phase 3): the fix changed code, so build, vet, test,
   and lint must pass again.
3. **Commit that fix on its own** once green: a focused `fix(<area>): ...`
   per finding (or close group), routed through `/commit-message` (`--yes`
   in autonomous mode).
4. **Re-verify** (Phase 4): re-run the contract test and the review pass on
   what changed.

Repeat until no P0 or P1 findings remain. Stop when the remainder is genuine
P2 follow-up work, not at perfection. P2s do not vanish: they go in the PR
body under **Deferred (P2)**.

## Phase 6: Commit, document, and PR

**Precondition: the Phase 5 loop has converged.** Gates green, no open P0/P1,
contract test clean, and the full integration/e2e suite passes. If anything
is still red, return to Phase 5; do not open a PR around an open P0/P1.

The implementation and every fix are already committed incrementally on the
feature branch (Phases 2 and 5), one logical change each. Never bypass hooks
with `--no-verify`. Add the doc commits, then open the PR last so it carries
every commit:

1. **The feature and its fixes** are already committed; nothing to re-commit
   here.
2. **The docs the change moved, each as its own commit, before the PR.** Skip
   any whose trigger did not fire:
   - **README** when user-visible behavior, endpoints, or configuration
     changed — via `/update-readme` when installed, else edit README.md
     directly with the same discipline (surgical edits to the affected
     sections only, never a rewrite).
   - **CLAUDE.md / AGENTS.md** when architecture, conventions, commands, or
     the directory layout changed (a hand-written conventional commit): what
     a future contributor or agent needs to know.
   - **The OpenAPI doc**, if any final reconciliation happened during the fix
     loop and is not yet committed.

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

Deferred (P2):
<list any unresolved P2 findings, or "none">

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
   user-affecting patches -> **patch**. Go services version through git tags
   (`v<X.Y.Z>`); when the project also records the version in a file (a
   `VERSION` file, an ldflags default, a chart value), that edit goes in a
   `chore/release-<X.Y.Z>` PR through the same `/commit-message` and
   `/create-pr` route, merged after approval (same human gate as step 1).
   When tags are the only version record, skip the PR.
3. **Tag and publish the release** on the merged default branch; the tag must
   match the bumped version:

   ```bash
   gh release create v<X.Y.Z> --target main --generate-notes
   ```

   **Confirm before running this:** publishing the release is typically the
   deploy trigger. Check the project's CI/CD config to understand what fires
   on `release: published` vs a tag push — deployment workflows vary by
   project. After publishing, confirm all release workflows go green before
   considering the release done.

## Universal disciplines (portable, every project)

- **Never use `node -e '...'` inline scripts.** Multi-line inline node code
  triggers Claude Code's static-analysis block. Write the script to
  `.cache/develop-go-feature/<name>.mjs` with the Write tool, then run
  `node .cache/develop-go-feature/<name>.mjs`. The cache dir is gitignored.
- **Inspect files with the Read and Grep tools, not shell parsers.** Reaching
  for `python3 -c`, `jq`, or `cat`/`sed` to read or pretty-print a file needs
  broad shell grants and prompts in a hands-off run; the Read and Grep tools
  need no Bash permission. Remove a tracked file with `git rm <path>`, not a
  bare `rm`: neither is auto-allowed (every delete path prompts,
  intentionally), but `git rm` stages a recoverable deletion of tracked
  content while `rm` destroys it.
- **Redirect output to the cache dir, never `/tmp/`.** A `/tmp/` path
  triggers a path-access prompt that `Bash()` allow entries cannot suppress;
  write logs to `.cache/develop-go-feature/<name>.log` instead. Full gate
  runs need no manual redirect — the gate runner logs each gate to the cache
  dir for you.
- **Never prefix Bash commands with `cd /absolute/path;`.** The working
  directory is always the project root — run all commands from there
  directly. Compound `cd /abs/path; cmd` patterns trigger Claude Code's
  path-resolution-bypass check and block the command even when the intent is
  read-only. Use relative paths or run commands as-is.
- **Manage the service through the helper, not raw process tools.** Start,
  query, and stop it with
  `node .claude/skills/develop-go-feature/scripts/server.mjs start|url|stop`.
  Raw `curl`/`lsof`/`pkill`/`kill` are not auto-allowed (and should not be);
  the helper waits for the health check, reports the URL, and kills the whole
  process group on stop, so the verify phase never stalls on a permission
  prompt.
- **Never use the `&` background operator.** It trips Claude Code's
  static-analysis block regardless of allow entries. Background the service
  with the helper above; for any other long-running process, write a detached
  `child_process.spawn` launcher to `.cache/develop-go-feature/` and run
  that.
- **Security floor, non-negotiable:** parameterized queries only; never
  disable TLS verification, bypass auth, or hardcode credentials, even "for
  testing" — use env vars and the project's local-dev config path instead.
- **Build only what the feature needs (YAGNI).** Implement the scope
  confirmed in Phase 1, nothing speculative: no unused config flags,
  interfaces with one implementation "for mocking later", or generality for
  callers that do not exist yet. The simplest thing that satisfies the
  contract and passes the gates wins.
- **The gates are the merge bar, nothing else.** A clean `gofmt` run is not
  permission to skip them; a failing unrelated check is not a reason to stop.
- **The contract and the code never diverge.** Every commit that touches an
  endpoint carries its doc (or annotation) change.
- **Commit atomically.** One logical change per commit; split unrelated
  concerns into separate commits even within one feature.
- **Keep your diff legible.** Do not reformat or "fix" files your feature did
  not touch, even when a linter flags them project-wide.
- **Tier models by judgment, not by output size.** Where the harness supports
  per-subagent model selection, give the small/fast model only the structured
  extraction and summarization steps (Phase 0 discovery, Phase 6 doc drafts);
  keep planning, building, the diff review, and the fix loop on the session
  model. The larger saving is context isolation, not model price: a subagent
  that returns only its conclusion keeps the bulky reading out of the main
  context for the rest of the session.

## Worked example (illustration only)

What Phase 0 surfaced in one Gin + GORM + Postgres service, to show the
*kind* of thing to look for. None of this is portable; yours will differ.

- **Gates:** `go build ./... && go vet ./... && golangci-lint run &&
  go test -race ./...`, pinned in `gates.json` to run inside the dev image
  (`docker compose run --rm api go test -race ./...`) because CLAUDE.md said
  the test database config exists only there.
- **Contract:** hand-written `api/openapi.yaml` was the source of truth;
  handlers were checked against it in review, and `/test-api` ran against
  `make run` on `:8080` with `/healthz`.
- **Feature pattern:** each resource = a goose migration + a GORM model +
  a repository with interface + a service + a Gin handler group, wired in
  `internal/router/router.go`; table-driven tests beside each file and
  integration tests under `tests/integration` behind `-tags=integration`.
- **Enforcement:** `PreToolUse` hooks routed `git commit`/`gh pr create`
  through `/commit-message` and `/create-pr`; branches were `feat/<slug>`.
- **NOT a gate:** `golangci-lint` carried a legacy-package backlog;
  `.golangci.yml` had `new-from-rev` set, so only new findings blocked merge.

## Installing this skill and its companions elsewhere

- **This skill:**
  `npx skills add pyaethu-aung/skills --skill develop-go-feature`
  (add `--global` to install it for every project), or install the `go-dev`
  plugin, which bundles the companions below.
- **`/test-api`, `/postgres-scaffold`, `/commit-message`, `/create-pr`,
  `/update-readme` (optional):** install with
  `npx skills add pyaethu-aung/skills --skill <name>`, or skip them to use
  each phase's direct fallback.

## What this skill is not

A runnable driver, a scaffold generator, or a deployment pipeline. The
helpers manage discovery, gates, and the service lifecycle; the judgment
(plan, implementation, review) is the agent following this playbook. For
schema scaffolding use `/postgres-scaffold`; for standalone contract testing
use `/test-api` directly.
