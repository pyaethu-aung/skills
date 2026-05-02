# CLAUDE.md

## Repo structure

- `skills/<name>/SKILL.md` — source of truth for each skill
- `.claude/skills/<name>` — local copy of the skill for Claude Code to use; may differ from source (e.g. extra `model` field)
- `.claude/hooks/` — guard scripts that enforce skill usage
- `.claude/settings.json` — PreToolUse hooks wiring the guards
- `.githooks/commit-msg` — git hook enforcing Conventional Commits on manual commits

## Skills

### `/commit-message`

Always use this skill when committing. Never run `git commit` directly.

- Enforces atomic commits, Conventional Commits format, and the 50/72 rule
- A `PreToolUse` hook blocks direct `git commit` calls and redirects here

### `/create-pr`

Always use this skill when opening a pull request. Never run `gh pr create` directly.

- Derives title and body from commits, confirms before submitting
- A `PreToolUse` hook blocks bare `gh pr create` calls and redirects here

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
4. Document it in `README.md`
