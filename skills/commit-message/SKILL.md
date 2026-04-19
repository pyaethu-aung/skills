---
name: commit-message
description: Use when creating or amending git commits. Enforces atomic commits, the 50/72 subject/body rule, and Conventional Commits format.
allowed-tools: Bash(git log:*) Bash(git diff:*) Bash(git status:*) Bash(git add:*) Bash(git commit:*) Bash(echo:*) Bash(wc:*)
---

# Commit Message Rules

Follow these rules for every commit.

## Working tree status
```!
git status --short
```

## Staged changes
```!
git diff --staged
```

If the staged diff above is empty, inspect the working tree status above:

- If there are unstaged or untracked changes, infer which files belong to
  the same logical change based on their names and paths, show the user
  which files you intend to stage and ask them to confirm before running
  `git add <files>`.
- If there are no changes at all, stop and tell the user:
  "Nothing to commit — working tree is clean."
- If the changes span multiple unrelated concerns, stage only the files
  that form one logical change, tell the user what you staged and why,
  and note that the remaining files should be committed separately.

## Recent commit history
```!
git log --oneline -10
```

Use the history above to match this project's existing commit style
(types, scopes, level of detail in subjects). If the project deviates
from Conventional Commits, follow the project's established pattern.

## 1. Atomic Commits

Each commit must represent one logical, self-contained change.

- **One reason to exist**: do not mix a bug fix with a refactor or a dependency bump with a feature
- **Builds at every commit**: the codebase must compile and tests must pass at every commit
- **Reviewable in isolation**: a reviewer should understand the change without needing context from adjacent commits

If `git diff --staged` spans multiple concerns, stop and tell the user
which concerns you see, then ask them to stage and commit each one
separately using `git add -p` or by staging specific files.

## 2. The 50/72 Rule

| Part         | Rule                                      |
|--------------|-------------------------------------------|
| Subject line | 50 characters or fewer (hard limit: 72)   |
| Body lines   | Wrap at 72 characters                     |
| Separator    | Always one blank line between subject and body |

## 3. Conventional Commits

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | When to use                                             | SemVer |
|------------|---------------------------------------------------------|--------|
| `feat`     | New feature for the user                                | MINOR  |
| `fix`      | Bug fix for the user                                    | PATCH  |
| `chore`    | Maintenance, dependency updates, tooling                | —      |
| `ci`       | CI/CD configuration changes                             | —      |
| `docs`     | Documentation only                                      | —      |
| `refactor` | Code change that neither fixes a bug nor adds a feature | —      |
| `perf`     | Performance improvement                                 | PATCH  |
| `test`     | Adding or correcting tests                              | —      |
| `style`    | Formatting, whitespace, missing semicolons              | —      |
| `build`    | Build system or external dependency changes             | —      |
| `revert`   | Reverts a previous commit                               | —      |

### Scope (optional)

A noun in parentheses describing the section of the codebase:

```
feat(auth): add OAuth2 login flow
fix(ui): correct button alignment on mobile
chore(deps): bump lodash from 4.17.20 to 4.17.21
```

### Subject line rules

- Imperative mood: "add feature" not "added" (past tense) or "adds" (third-person)
- No capital letter after the colon
- No trailing period
- 50 characters or fewer

### Body rules

- Explain **what** and **why**, not how
- Wrap at 72 characters
- Separated from subject by one blank line

### Footer rules

- Format: `Token: value` (hyphens in token names, not spaces)
- Common tokens: `Fixes`, `Closes`, `Refs`, `Reviewed-by`, `BREAKING CHANGE`
- `BREAKING CHANGE` must be uppercase
- **Never** add a `Co-Authored-By` trailer — omit it even if suggested

### Breaking changes

Use `!` before the colon, or a `BREAKING CHANGE:` footer, or both:

```
feat(api)!: change income input from string to integer

BREAKING CHANGE: income values must now be integers.
String-based input is no longer accepted.
```

## 4. Subject Line Character Count (REQUIRED)

Before showing the confirmation prompt, you MUST measure the subject
line length by running:

```bash
echo -n "<subject line>" | wc -c
```

Use the number returned by that command — never count manually. Display
the result:

```
Subject: "<subject line>" (N chars ✅ / ⚠️ / ❌)
```

Rules:
- **≤ 50 chars** → ✅ proceed
- **51–72 chars** → ⚠️ warn the user and ask if they want to shorten
  before proceeding
- **> 72 chars** → ❌ revise the subject line before showing the
  confirmation prompt; never propose a message that exceeds 72 chars

Do not skip this step. The count must appear in every confirmation.

## 5. Confirmation Before Commit

After the character count check, pause and show the user a summary
before running `git commit`:

```
Subject: "<subject line>" (N chars ✅)

Files to be committed:
  <list from git diff --staged --name-only>

Proposed message:
  <full commit message>

Proceed? (yes / edit message / cancel)
```

- **yes** — run `git commit` using a heredoc to preserve line breaks:
  ```bash
  git commit -F - <<'EOF'
  <full commit message>
  EOF
  ```
- **edit message** — ask the user what to change, revise, and show the
  summary again
- **cancel** — stop without committing; leave the index as-is

Do not run `git commit` until the user explicitly confirms.

## Examples

Simple fix (subject only):
```
fix(auth): prevent session token from expiring prematurely
```

Feature with body (note 72-char body wrap):
```
feat(api): add pagination support to list endpoints

Without pagination, list endpoints return all records in a single       |
response. This causes memory spikes and slow response times as data     |
grows. Adds cursor-based pagination with a default page size of 20.     |
```

Dependency bump:
```
chore(deps): bump lodash from 4.17.20 to 4.17.21
```

CI change:
```
ci: add linter to pull request workflow
```
