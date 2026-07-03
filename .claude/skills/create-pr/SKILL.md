---
name: create-pr
description: Use when creating a GitHub pull request. Derives title and body from commits, enforces a consistent PR format, and confirms before submitting.
metadata:
  version: "1.1.0"
model: haiku
argument-hint: "[--yes] (skip the confirmation prompt for hands-off runs)"
allowed-tools: Bash(git log:*) Bash(git diff:*) Bash(git status:*) Bash(git branch:*) Bash(git checkout:*) Bash(git push:*) Bash(gh pr:*) Bash(CLAUDE_PR_VIA_SKILL=1 gh pr create:*) Bash(gh repo:*)
---

# PR Creation Rules

Follow these rules every time a pull request is created.

## Default branch
```!
gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'
```

The branch shown above is referred to as `<default>` in the rest of
this skill. If the command failed (offline, no gh auth), fall back to
`main`.

## Current branch
```!
git branch --show-current
```

## Commits not yet on origin's default branch
```!
git log origin/$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')..HEAD --oneline
```

If the log above is empty, stop and tell the user:
"No commits ahead of origin/<default>. Nothing to open a PR for."

## Guard: sitting on the default branch

If the current branch (shown above) **is** `<default>` and the commit
list above is non-empty, the commits were made directly on the default
branch. Move them to a feature branch before continuing:

1. Derive a semantic branch name from those commits:
   - Use the dominant Conventional Commits type as the prefix
     (`feat`, `fix`, `chore`, etc.)
   - Append a short slug from the commit subjects
     (e.g. `feat/add-pagination-support`)
   - Kebab-case, lowercase, no special characters except `/` and `-`
2. Show the user the proposed branch name and ask them to confirm or
   provide an alternative before proceeding. If `--yes` was passed,
   skip this confirmation and use the derived name directly.
3. On confirmation, create and switch to the new branch:
   ```bash
   git checkout -b <branch-name>
   ```
4. Point the local default branch back at the remote so it no longer
   carries the commits:
   ```bash
   git branch -f <default> origin/<default>
   ```
5. Continue with the rest of the PR creation flow from the new branch.
   The commit list above still applies: it was measured against
   `origin/<default>`, which the new branch is still ahead of.

If the current branch is already a feature branch, skip this section.

## Diff summary
```!
git diff origin/$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')..HEAD --stat
```

## Recent PRs for style reference
```!
gh pr list --state all --limit 5 --json number,title,body
```

Use the PR history above to match this project's established PR style
(title format, body sections, level of detail).

---

## 1. PR Title

- Mirror the Conventional Commits subject style used in this repo
- Imperative mood, no trailing period
- 72 characters or fewer
- If all commits share one type/scope, reflect that:
  `feat(api): add pagination support to list endpoints`
- If commits span multiple types, use the dominant one or summarise:
  `chore: improve commit-message skill`

## 2. PR Body

Use this template:

```
## Summary
- <bullet: what changed and why>
- <bullet: …>

## Changes
- <bullet: notable file or area touched>
- <bullet: …>

## Test plan
- [ ] <what to verify manually or via CI>
- [ ] <…>
```

- **Summary**: explain the *why*, not the how; 1–3 bullets
- **Changes**: list key files or areas affected
- **Test plan**: checklist a reviewer can follow to verify correctness
- Omit sections that add no value for trivial changes

## 3. Confirmation Before Submitting

After drafting the title and body, pause and show the user (skip the pause if
`--yes` was passed; see the autonomous-mode note below):

```
Branch:  <branch name>  →  <default>
Commits: <count> commit(s)

Title:
  <proposed title>

Body:
  <proposed body>

Proceed? (yes / edit / cancel)
```

- **yes**: push the branch if not already pushed, then run
  `CLAUDE_PR_VIA_SKILL=1 gh pr create --title "<title>" --body "<body>" --base <default>`
- **edit**: ask what to change, revise, and show the summary again
- **cancel**: stop without creating the PR

Do not run `gh pr create` until the user explicitly confirms, unless `--yes`
was passed.

**Autonomous mode (`--yes`).** Skip the confirmation prompt and open the PR
directly, with the same format and skill token. This is for hands-off runs
where a human reviews the opened PR; do not pass `--yes` for one-off PRs.

## 4. After Creation

Print the PR URL returned by `gh pr create` so the user can open it
directly.
