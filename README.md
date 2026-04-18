# skills

A collection of AI agent skills installable via [`npx skills`](https://github.com/vercel-labs/skills).

## Available Skills

### `commit-message`

Guides Claude through every commit with structure, discipline, and consistency.

- **Atomic commits** — stages only files that belong to one logical change and flags unrelated concerns before committing
- **50/72 rule** — measures subject line length with `wc -c` (never manual counting) and enforces the hard 72-character limit
- **[Conventional Commits](https://www.conventionalcommits.org/) format** — `<type>[optional scope]: <description>` with a full type table (`feat`, `fix`, `chore`, `ci`, `docs`, `refactor`, `perf`, `test`, `style`, `build`, `revert`) and [SemVer](https://semver.org/) impact notes
- **Confirmation prompt** — always shows files, character count, and full message before running `git commit`

| Skill | Description |
|---|---|
| [`commit-message`](skills/commit-message/SKILL.md) | Enforces atomic commits, the 50/72 subject/body rule, and Conventional Commits format |

## Installation

Install a specific skill into your project:

```bash
npx skills add pyaethu-aung/skills --skill commit-message
```

Install globally:

```bash
npx skills add pyaethu-aung/skills --skill commit-message --global
```

## Related Links

- [Conventional Commits specification](https://www.conventionalcommits.org/)
- [Semantic Versioning (SemVer)](https://semver.org/)
- [How to Write a Git Commit Message — Chris Beams](https://cbea.ms/git-commit/)
- [`npx skills` — Vercel Labs](https://github.com/vercel-labs/skills)

## License

MIT
