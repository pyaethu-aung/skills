# CLAUDE.md

## Repo structure

- `skills/<name>/SKILL.md` — source of truth for each skill
- `.claude/skills/<name>` — local copy of the skill for Claude Code to use; may differ from source (e.g. extra `model` field)
- `.claude/hooks/` — guard scripts that enforce skill usage
- `.claude/settings.json` — PreToolUse hooks wiring the guards
- `.claude-plugin/marketplace.json` — plugin marketplace manifest listing the `git-workflow`, `web-dev`, and `go-dev` plugins
- `plugins/<name>/` — plugin roots; their `skills/` and `hooks/` script entries are **symlinks** into `skills/` and `.claude/hooks/` (single source of truth; the plugin installer dereferences them), plus a `.claude-plugin/plugin.json` manifest and, for `git-workflow`, a `hooks/hooks.json`; `web-dev` ships `bin/dwf-*` wrappers and `go-dev` ships `bin/dgf-*` wrappers so their workflow skills' helper scripts have stable, path-independent commands on the plugin channel, and `git-workflow` ships `bin/gwf-setup` + `scripts/setup.mjs` for its own permission grants — each plugin owns its own scripts and grants, never another plugin's
- `.githooks/commit-msg` — git hook enforcing Conventional Commits on manual commits

## Skills

### `/commit-message`

Always use this skill when committing or amending. Never run `git commit` directly.

- Enforces atomic commits, Conventional Commits format, and the 50/72 rule
- Handles amends (message-only amends allowed on a clean tree; warns before rewriting pushed history) and warns when committing directly on `main`/`master`
- `--yes` skips the confirmation prompts (staging and commit) for hands-off runs; the character-count check still applies, and 51–72 char subjects are auto-shortened to ≤ 50
- The confirmation dialog itself carries the summary — subject and measured count in the question text, files and full message in the option preview; never a bare "Proceed?"
- A `PreToolUse` hard gate denies any `git commit` lacking the `CLAUDE_COMMIT_VIA_SKILL=1` token, which only this skill sets, and redirects here

### `/create-pr`

Always use this skill when opening a pull request. Never run `gh pr create` directly.

- Derives title and body from commits, confirms before submitting
- Detects the repo's default branch via `gh repo view`; if invoked on it with unpushed commits, moves them to a feature branch and resets the local default branch to the remote
- Accepts `[--yes]` to skip the confirmation prompts (branch name and submission) for hands-off runs; do not pass it for one-off PRs
- A `PreToolUse` hard gate denies any `gh pr create` lacking the `CLAUDE_PR_VIA_SKILL=1` token, which only this skill sets, and redirects here

### `/update-readme`

Use after any change worth documenting — new feature, new skill, config change, or breaking change.

- Updates `README.md` to reflect the change, or creates it if missing
- Inspects recent commits and the working tree to determine what to document
- Accepts `[--yes]` to skip the confirmation prompt for hands-off runs; do not pass it for one-off updates

### `/postgres-scaffold`

Use when implementing or updating database schema.

- Generates goose migration files and optionally GORM model structs for PostgreSQL tables
- Discovers existing migration layout before generating anything

### `/test-api`

Use when testing API endpoints against an OpenAPI/Swagger specification.

- Accepts an optional OpenAPI doc URL or file path as an argument
- Discovers or loads the spec, executes requests, and validates responses

### `/test-design`

Use when validating that a live website matches its design system and design file.

- Accepts an optional website URL and design source (Pencil, Figma, `tokens.json`, PNG exports)
- Compares design tokens, component presence, layout/spacing, and visual snapshots using Playwright

### `/develop-web-feature`

Use when adding, building, or designing a new web feature end-to-end.

- Accepts `[--auto]` and a feature description as arguments (e.g. `Calendar event content type`)
- Runs the full loop: shape → build → gate → audit → critique → fix → commit → document → PR, then merge → version-bump → release
- `--auto` (or "autonomous"/"hands-off" in the request) collapses in-flow confirmations into a single review at the PR; the human gates (PR merge, release publish) still require explicit sign-off
- Subagent delegation (Phase 0 discovery, Phase 6 doc drafts) uses only built-in agent types (`Explore`, general-purpose) with per-call model overrides; custom agent definitions may ship via `plugins/web-dev/agents/` when actually needed, but the SKILL.md must keep the built-in-type instructions as the baseline — `npx skills` consumers cannot receive agent definitions
- Ships on two channels: `npx skills` runs the helper scripts by project path, the `web-dev` plugin as `dwf-*` PATH commands; Phase 0 resolves the channel once from the skill's base directory, and each plugin's grants come from its own setup command (`dwf-setup`, `gwf-setup`)
- Setup grants follow least privilege: only read-only, staging (`git add` / `git restore --staged`), and branch-creation git is pre-approved; `git push`, `git rm`, and `git reset` are never auto-granted and prompt when needed

### `/develop-go-feature`

Use when adding or building a Go backend feature or endpoint end-to-end.

- Accepts `[--auto]` and a feature description as arguments (e.g. `Vehicle telemetry ingestion endpoint`)
- Runs the full loop: learn → plan (contract first) → implement → gate → verify → fix → commit → document → PR, then merge → version → release
- Gates: `go build` / `go vet` / `go test -race`, `golangci-lint` when configured, coverage threshold and integration/e2e when pinned; when the project's docs prescribe testing through Docker, the docker-based commands are pinned in `.cache/develop-go-feature/gates.json` and run inside the gate runner (no standing docker grant)
- Verify phase starts the service via `server.mjs` and contract-tests it against the OpenAPI doc with `/test-api`; schema work routes through `/postgres-scaffold`
- `--auto` collapses in-flow confirmations into a single review at the PR; the human gates (PR merge, release publish) still require explicit sign-off
- Ships on two channels: `npx skills` runs the helper scripts by project path, the `go-dev` plugin as `dgf-*` PATH commands; Phase 0 resolves the channel once from the skill's base directory, and grants come from `dgf-setup` (plus `gwf-setup` when git-workflow is installed)
- Setup grants follow the same least-privilege stance as `/develop-web-feature`; docker commands are additionally never auto-granted

## Commit conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>
```

- Subject line: 50 chars or fewer (hard limit: 72)
- Types: `feat`, `fix`, `chore`, `ci`, `docs`, `refactor`, `perf`, `test`, `style`, `build`, `revert`
- Imperative mood, no trailing period, no capital after the colon

## Branch workflow

- Work on a feature branch; never commit directly to `main`
- Open PRs against `main` using `/create-pr`
- Delete the feature branch after merging

## Adding a new skill

1. Create `skills/<name>/SKILL.md`
2. Copy it for local install: `cp -r skills/<name> .claude/skills/<name>`; add a `model` field to the local copy if needed
3. If the skill wraps a sensitive command, add a guard hook in `.claude/hooks/` and wire it in `.claude/settings.json`
4. If it belongs to a toolchain, symlink it into the matching plugin (`ln -s ../../../skills/<name> plugins/<plugin>/skills/<name>`) and bump that plugin's `version` in its `plugin.json` and in `.claude-plugin/marketplace.json` (skip the bump while the plugin has never been released — new content folds into the initial version); a guard hook also gets a symlink under the plugin's `hooks/` and a `${CLAUDE_PLUGIN_ROOT}` entry in its `hooks/hooks.json`. CI enforces the bump via `check_plugin_versions.py`, and a skill symlinked into several plugins requires bumping **each** of them in the same PR (e.g. `update-readme` gates both `web-dev` and `go-dev`; `test-api` and `postgres-scaffold` gate `go-dev`) — deliberate, since every plugin shipping the skill must re-release for its users to get the change
5. Document it in `README.md`
