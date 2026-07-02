# skills

A collection of AI agent skills installable via [`npx skills`](https://github.com/vercel-labs/skills).

## Available Skills

### `commit-message`

Guides Claude through every commit with structure, discipline, and consistency.

- **Atomic commits** — stages only files that belong to one logical change and flags unrelated concerns before committing
- **50/72 rule** — measures subject line length with `wc -c` (never manual counting) and enforces the hard 72-character limit
- **[Conventional Commits](https://www.conventionalcommits.org/) format** — `<type>[optional scope]: <description>` with a full type table (`feat`, `fix`, `chore`, `ci`, `docs`, `refactor`, `perf`, `test`, `style`, `build`, `revert`) and [SemVer](https://semver.org/) impact notes
- **Argument hints** — accepts an optional keyword or phrase when invoked (e.g., `/commit-message fix login redirect`) to seed the commit type and description; all Conventional Commits and 50/72 constraints still apply
- **Confirmation prompt** — always shows files, character count, and full message before running `git commit`

### `create-pr`

Guides Claude through opening a GitHub pull request with a consistent format and a confirmation step before submitting.

- **Derives title and body from commits** — inspects `git log` and recent PR history to match the project's established style
- **Structured body template** — Summary, Changes, and Test plan sections
- **Main-branch guard** — if invoked on `main` or `master` with unpushed commits, derives a semantic branch name, asks for confirmation, and creates the branch before opening the PR
- **Confirmation prompt** — shows branch, commit count, title, and body before running `gh pr create`
- **Prints the PR URL** after creation for quick access

### `update-readme`

Guides Claude through updating or creating README.md after any change worth documenting.

- **Scope detection** — inspects recent commits and diffs to determine which sections need updating
- **Surgical edits** — touches only the affected section; never rewrites unrelated content
- **Skip logic** — skips internal-only changes (refactors, CI tweaks, test fixes) that users wouldn't notice
- **Creates from scratch** — generates a structured README.md if none exists
- **Confirmation prompt** — shows affected sections and proposed changes before writing

### `test-api`

Tests API endpoints against an OpenAPI/Swagger specification.

- **Auto-discovery** — searches the project for `openapi.yaml`, `openapi.yml`, `openapi.json`, `swagger.*` files when no argument is provided
- **Optional argument** — accepts a URL or file path directly: `/test-api https://api.example.com/openapi.json`
- **Read-only by default** — only runs `GET` and `HEAD` requests; mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`) require explicit confirmation
- **Response validation** — checks status codes, Content-Type headers, and required top-level fields against the spec schema
- **Auth support** — prompts for Bearer token or API key when the spec declares a security scheme
- **Pre-flight summary** — lists all endpoints to test and confirms before making any request

### `test-design`

Tests a live website against its design system and design file (Pencil, Figma, or exported assets).

- **Auto-discovery** — finds design-system tokens (`src/design-system/`, `tokens.json`, `tailwind.config.*`) and design files (`.pen`, Figma URL in env, `design/` exports) when no argument is provided
- **Dev-server detection** — when no URL is passed, scans listening localhost ports with `lsof`/`ss`, keeps HTML responders, and matches them to the project's framework (Next.js → 3000, Vite → 5173, Astro → 4321, …); never auto-starts the dev server
- **Optional arguments** — accepts any URL (localhost, staging, prod) and/or a design source: `/test-design http://localhost:3000 ./design/home.pen`
- **Five-axis comparison** — design tokens, component presence, layout & spacing, visual screenshot diff, and usability (a11y, tap-target size, focus-visible, contrast)
- **Playwright CLI first** — uses `npx playwright` when available; falls back to a loaded Playwright MCP server only if the CLI isn't installed
- **Pencil MCP integration** — reads `.pen` files via `mcp__pencil__*` tools (never via `Read`/`Grep`, since `.pen` files are encrypted)
- **Pre-flight summary** — lists routes, viewports, executor, and checks before launching a browser; confirms before any `playwright install`
- **Two-tier output** — pass/fail summary first; offers to write a full markdown report (`test-design-report.md`) with token tables and inline screenshot diffs

### `postgres-scaffold`

Guides Claude through implementing or updating PostgreSQL database schema.

- **Goose migration files** — correctly timestamped filenames, `Up`/`Down` sections, `StatementBegin`/`StatementEnd` wrapping
- **UUIDv7 primary keys** — uses `DEFAULT uuidv7()` on PG 17+, falls back to `pg_uuidv7` extension or Go-side `BeforeCreate` hook
- **Schema conventions** — snake_case plural table names, standard audit columns (`created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by`), FK actions, soft-delete partial indexes
- **Optional GORM models** — generates only when the project uses GORM; uses a custom `Base`/`AuditBase` struct instead of `gorm.Model`
- **Confirmation prompt** — shows the full schema plan before writing any files

### `develop-web-feature`

Guides Claude through building a website feature end-to-end with `/impeccable`, from idea to a published release.

- **Full lifecycle loop:** shape, build, write e2e specs, gate, audit, critique, fix, commit, document, PR — then merge, version-bump, tag, and release — iterating `/impeccable audit` and `/impeccable critique` until the score plateaus
- **Autonomous `--auto` mode:** collapses in-flow confirmations (scope, critique's hand-back) into a single review at the PR, using `critique-plan.mjs` to keep the fix loop converging non-interactively; still stops for the human gates (PR merge, release publish)
- **Phase 0 permissions setup:** `setup.mjs` wires up every required allow entry in `.claude/settings.local.json`, previewing the delta before writing so a skill update can never widen permissions silently
- **Project discovery first:** a setup phase reads `CLAUDE.md` / `AGENTS.md` and config to find the gates, feature pattern, enforcement, and design system before any code is written
- **Cached discovery:** caches the discovery phase's findings to your OS user cache (keyed per repo) and skips rediscovery on later runs, re-deriving only entries whose source changed; the green-baseline gate run always repeats on a clean tree
- **Seven helper scripts:** `setup.mjs`, `discover.mjs`, `gates.mjs`, `dev-server.mjs`, `critique-plan.mjs`, `cache-check.mjs`, `cache-write.mjs` — drive permissions, discovery, gating, the dev server, and autonomous convergence without raw shell commands
- **Dependency handling:** installs the required `/impeccable` via `npx impeccable skills install`; treats `/commit-message` and `/create-pr` as optional, with a direct commit/PR fallback when they are absent
- **Portable:** project specifics live in the discovery phase, so the same skill works across web projects (a worked example is included as illustration only)

| Skill | Description | Recommended model |
|---|---|---|
| [`commit-message`](skills/commit-message/SKILL.md) | Enforces atomic commits, the 50/72 subject/body rule, and Conventional Commits format | `haiku` |
| [`create-pr`](skills/create-pr/SKILL.md) | Derives PR title and body from commits, enforces a consistent format, and confirms before submitting | `haiku` |
| [`develop-web-feature`](skills/develop-web-feature/SKILL.md) | Builds a web feature end-to-end with /impeccable: shape, build, gate, audit, critique, fix, PR, release | `opus` |
| [`postgres-scaffold`](skills/postgres-scaffold/SKILL.md) | Generates goose migration files and optionally GORM model structs for PostgreSQL tables | `sonnet` |
| [`test-api`](skills/test-api/SKILL.md) | Tests API endpoints against an OpenAPI/Swagger specification | `sonnet` |
| [`test-design`](skills/test-design/SKILL.md) | Tests a live website against its design system and design file via Playwright | `sonnet` |
| [`update-readme`](skills/update-readme/SKILL.md) | Updates or creates README.md after changes worth documenting | `sonnet` |

## For contributors

See [CLAUDE.md](CLAUDE.md) for repo conventions, skill usage rules, and the branch workflow expected when working in this repo with Claude Code.

## Installation

Install a specific skill into your project:

```bash
npx skills add pyaethu-aung/skills --skill commit-message
npx skills add pyaethu-aung/skills --skill create-pr
npx skills add pyaethu-aung/skills --skill develop-web-feature
npx skills add pyaethu-aung/skills --skill postgres-scaffold
npx skills add pyaethu-aung/skills --skill test-api
npx skills add pyaethu-aung/skills --skill test-design
npx skills add pyaethu-aung/skills --skill update-readme
```

Install globally:

```bash
npx skills add pyaethu-aung/skills --skill commit-message --global
npx skills add pyaethu-aung/skills --skill create-pr --global
npx skills add pyaethu-aung/skills --skill develop-web-feature --global
npx skills add pyaethu-aung/skills --skill postgres-scaffold --global
npx skills add pyaethu-aung/skills --skill test-api --global
npx skills add pyaethu-aung/skills --skill test-design --global
npx skills add pyaethu-aung/skills --skill update-readme --global
```

## CI

### Skill format validation

Every pull request targeting `main` runs `.github/workflows/validate-skills.yml`, which executes `.github/scripts/validate_skills.py` against every directory under `skills/`.

**What it checks:**

- `SKILL.md` exists in the skill directory
- The file starts with valid YAML frontmatter (`---` delimiters)
- `name` is present, non-empty, and matches the directory name
- `description` is present and non-empty
- `metadata.version` is present and follows semver (`x.y.z`)
- The body (content after the frontmatter) is non-empty

**Run locally before opening a PR:**

```bash
python3 .github/scripts/validate_skills.py
```

**To make this check required before merging**, enable branch protection on `main` in the GitHub repository settings:

> Settings → Branches → Add branch protection rule → `main`
> → ✅ Require status checks to pass before merging
> → Search for and add: `Validate skill format`

### Hook script linting

Every pull request that modifies `.claude/hooks/` runs `.github/workflows/lint-hooks.yml`, which executes `shellcheck` against every `.sh` file in that directory.

**What it checks:**

- Unsafe variable expansion (unquoted `$var`)
- Command injection risks
- Shell syntax errors and unreachable code
- Portability issues

**To make this check required before merging**, enable branch protection on `main` in the GitHub repository settings:

> Settings → Branches → Add branch protection rule → `main`
> → ✅ Require status checks to pass before merging
> → Search for and add: `ShellCheck`

---

## Claude Code Enforcement

### `commit-message`

This repo ships a `commit-msg` hook in `.githooks/` that enforces the same rules as the `commit-message` skill for manual `git commit` runs.

**What it checks:**

- Message follows `<type>[optional scope]: <description>` (Conventional Commits)
- Subject line ≤ 72 characters (warns at > 50)
- No trailing period on the subject line
- Blank line between subject and body (when a body is present)

**Activate after cloning:**

```bash
git config core.hooksPath .githooks
```

This is a one-time setup per clone. The hook then runs automatically on every `git commit`.

**Verify it's wired up:**

```bash
git config --get core.hooksPath   # must print: .githooks
ls -l .githooks/commit-msg        # must be present and executable (-rwxr-xr-x)
```

If `core.hooksPath` is empty, Git is still looking at `.git/hooks/` and will silently ignore the script. If `commit-msg` is not executable, run `chmod +x .githooks/commit-msg`.

**Block Claude from bypassing the skill:**

Add the following to your `.claude/settings.json` to prevent Claude from running `git commit` directly and redirect it to `/commit-message` instead:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(git commit*)",
            "command": "bash .claude/hooks/git-commit-guard.sh",
            "statusMessage": "Enforcing /commit-message skill..."
          }
        ]
      }
    ]
  }
}
```

Then copy [`git-commit-guard.sh`](.claude/hooks/git-commit-guard.sh) into your project's `.claude/hooks/` directory. The script allows commits whose message matches Conventional Commits format (`-m` flag) and commits produced via `git commit -F` (heredoc), and blocks everything else.

### `create-pr`

**Block Claude from bypassing the skill:**

Add the following to your `.claude/settings.json` to prevent Claude from running `gh pr create` directly and redirect it to `/create-pr` instead:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(gh pr create*)",
            "command": "bash .claude/hooks/gh-pr-guard.sh",
            "statusMessage": "Enforcing /create-pr skill..."
          }
        ]
      }
    ]
  }
}
```

Then copy [`gh-pr-guard.sh`](.claude/hooks/gh-pr-guard.sh) into your project's `.claude/hooks/` directory. The script blocks bare `gh pr create` calls but allows through calls that include both `--title` and `--body`, which are only produced by the skill after the confirmation step.

## Related Links

- [Conventional Commits specification](https://www.conventionalcommits.org/)
- [Semantic Versioning (SemVer)](https://semver.org/)
- [How to Write a Git Commit Message — Chris Beams](https://cbea.ms/git-commit/)
- [`npx skills` — Vercel Labs](https://github.com/vercel-labs/skills)

## License

MIT
