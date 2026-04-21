# skills

A collection of AI agent skills installable via [`npx skills`](https://github.com/vercel-labs/skills).

## Available Skills

### `commit-message`

Guides Claude through every commit with structure, discipline, and consistency.

- **Atomic commits** — stages only files that belong to one logical change and flags unrelated concerns before committing
- **50/72 rule** — measures subject line length with `wc -c` (never manual counting) and enforces the hard 72-character limit
- **[Conventional Commits](https://www.conventionalcommits.org/) format** — `<type>[optional scope]: <description>` with a full type table (`feat`, `fix`, `chore`, `ci`, `docs`, `refactor`, `perf`, `test`, `style`, `build`, `revert`) and [SemVer](https://semver.org/) impact notes
- **Confirmation prompt** — always shows files, character count, and full message before running `git commit`

### `create-pr`

Guides Claude through opening a GitHub pull request with a consistent format and a confirmation step before submitting.

- **Derives title and body from commits** — inspects `git log` and recent PR history to match the project's established style
- **Structured body template** — Summary, Changes, and Test plan sections
- **Confirmation prompt** — shows branch, commit count, title, and body before running `gh pr create`
- **Prints the PR URL** after creation for quick access

### `postgres-scaffold`

Guides Claude through implementing or updating PostgreSQL database schema.

- **Goose migration files** — correctly timestamped filenames, `Up`/`Down` sections, `StatementBegin`/`StatementEnd` wrapping
- **UUIDv7 primary keys** — uses `DEFAULT uuidv7()` on PG 17+, falls back to `pg_uuidv7` extension or Go-side `BeforeCreate` hook
- **Schema conventions** — snake_case plural table names, standard audit columns (`created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by`), FK actions, soft-delete partial indexes
- **Optional GORM models** — generates only when the project uses GORM; uses a custom `Base`/`AuditBase` struct instead of `gorm.Model`
- **Confirmation prompt** — shows the full schema plan before writing any files

| Skill | Description |
|---|---|
| [`commit-message`](skills/commit-message/SKILL.md) | Enforces atomic commits, the 50/72 subject/body rule, and Conventional Commits format |
| [`create-pr`](skills/create-pr/SKILL.md) | Derives PR title and body from commits, enforces a consistent format, and confirms before submitting |
| [`postgres-scaffold`](skills/postgres-scaffold/SKILL.md) | Generates goose migration files and optionally GORM model structs for PostgreSQL tables |

## For contributors

See [CLAUDE.md](CLAUDE.md) for repo conventions, skill usage rules, and the branch workflow expected when working in this repo with Claude Code.

## Installation

Install a specific skill into your project:

```bash
npx skills add pyaethu-aung/skills --skill commit-message
npx skills add pyaethu-aung/skills --skill create-pr
npx skills add pyaethu-aung/skills --skill postgres-scaffold
```

Install globally:

```bash
npx skills add pyaethu-aung/skills --skill commit-message --global
npx skills add pyaethu-aung/skills --skill create-pr --global
npx skills add pyaethu-aung/skills --skill postgres-scaffold --global
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
