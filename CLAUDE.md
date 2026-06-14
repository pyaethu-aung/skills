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

### `/update-readme`

Use after any change worth documenting — new feature, new skill, config change, or breaking change.

- Updates `README.md` to reflect the change, or creates it if missing
- Inspects recent commits and the working tree to determine what to document

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

- Accepts a feature description as an argument (e.g. `Calendar event content type`)
- Runs the full loop: shape → build → gate → audit → critique → fix → commit → PR

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
