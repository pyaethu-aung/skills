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

| Skill | Description |
|---|---|
| [`commit-message`](skills/commit-message/SKILL.md) | Enforces atomic commits, the 50/72 subject/body rule, and Conventional Commits format |
| [`create-pr`](skills/create-pr/SKILL.md) | Derives PR title and body from commits, enforces a consistent format, and confirms before submitting |

## Installation

Install a specific skill into your project:

```bash
npx skills add pyaethu-aung/skills --skill commit-message
npx skills add pyaethu-aung/skills --skill create-pr
```

Install globally:

```bash
npx skills add pyaethu-aung/skills --skill commit-message --global
npx skills add pyaethu-aung/skills --skill create-pr --global
```

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
