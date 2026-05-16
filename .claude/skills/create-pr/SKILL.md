---
name: create-pr
description: Use when creating a GitHub pull request. Derives title and body from commits, enforces a consistent PR format, and confirms before submitting.
metadata:
  version: "1.0.2"
model: haiku
allowed-tools: Bash(git log:*) Bash(git diff:*) Bash(git status:*) Bash(git branch:*) Bash(git push:*) Bash(gh pr:*) Bash(gh repo:*)
---

# PR Creation Rules

Follow these rules every time a pull request is created.

## Current branch
```!
git branch --show-current
```

## Guard: commits on main/master not pushed to remote

If the current branch (shown above) is `main` or `master`, run this to
list local commits not yet on the remote:

```bash
git log @{upstream}..HEAD --oneline
```

If that command errors (no upstream configured), treat it as no
unpushed commits and continue.

If the current branch is already a feature branch, skip this command
and the rest of this section.

If the log is **non-empty** (there are unpushed commits on main/master):

1. Derive a semantic branch name from those commits:
   - Use the dominant Conventional Commits type as the prefix
     (`feat`, `fix`, `chore`, etc.)
   - Append a short slug from the commit subjects
     (e.g. `feat/add-pagination-support`)
   - Kebab-case, lowercase, no special characters except `/` and `-`
2. Show the user the proposed branch name and ask them to confirm or
   provide an alternative before proceeding.
3. On confirmation, create and switch to the new branch:
   ```bash
   git checkout -b <branch-name>
   ```
4. Continue with the rest of the PR creation flow from the new branch.

## Commits not yet in main
```!
git log main..HEAD --oneline
```

If the log above is empty, stop and tell the user:
"No commits ahead of main. Nothing to open a PR for."

## Diff summary
```!
git diff main..HEAD --stat
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

After drafting the title and body, pause and show the user:

```
Branch:  <branch name>  →  main
Commits: <count> commit(s)

Title:
  <proposed title>

Body:
  <proposed body>

Proceed? (yes / edit / cancel)
```

- **yes** — push the branch if not already pushed, then run
  `gh pr create --title "<title>" --body "<body>" --base main`
- **edit** — ask what to change, revise, and show the summary again
- **cancel** — stop without creating the PR

Do not run `gh pr create` until the user explicitly confirms.

## 4. After Creation

Print the PR URL returned by `gh pr create` so the user can open it
directly.
