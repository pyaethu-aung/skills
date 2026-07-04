---
name: update-readme
description: Use after any change worth documenting — new feature, new skill, config change, or breaking change. Updates README.md to reflect the change, or creates it if missing.
metadata:
  version: "1.1.0"
argument-hint: "[--yes] (skip the confirmation prompt for hands-off runs)"
allowed-tools: Bash(git log:*) Bash(git diff:*) Bash(git status:*) Bash(ls:*) Glob Read Write Edit
---

# README Update Rules

Follow these rules when updating or creating README.md.

## Understand what changed

Inspect the recent commit(s) and working tree to determine what is worth documenting:

```!
git log --oneline -10
```

```!
git status --short
```

```!
git diff HEAD~1 HEAD --stat
```

If the diff above errored because the repo has only one commit (no
`HEAD~1`), run `git log -1 --stat` instead.

If the change being documented spans more than the last commit (or is
still uncommitted, per the status above), widen the diff yourself,
e.g. `git diff HEAD~3 HEAD --stat` or `git diff --stat`.

---

## 1. Decide if README.md needs updating

Update README.md when the change involves any of:

- A new feature, skill, command, or tool a user would discover through the README
- A changed or removed public interface, option, or behaviour
- A new installation or setup step
- A breaking change
- A new section of the project (new directory, new subsystem)

**Skip** for changes that are internal only: refactors, test fixes, CI tweaks, comment edits, or anything a user of the project would never notice.

If the change does not warrant a README update, stop and tell the user why.

---

## 2. Read existing README.md

If README.md exists, read it in full before making any changes:

- Identify which section(s) the change belongs in
- Match the existing tone, heading style, and formatting
- Do not restructure or rewrite sections unrelated to the change

If README.md does not exist, create one from scratch using the structure in §4.

---

## 3. Scope of edits

- **Add** content for new features or skills
- **Update** content for changed behaviour or options
- **Remove** content for deleted features — do not leave stale documentation
- **Never** rewrite the whole file for a small change; edit only the relevant section(s)

---

## 4. README structure (when creating from scratch)

Use this structure as a starting point — adapt to what the project actually contains:

```markdown
# <project name>

<one-sentence description of what the project does>

## <primary feature or section>

<description>

## Installation

<install steps>

## Usage

<usage instructions>
```

---

## 5. Confirm before writing

After drafting the changes, show the user a summary (skip the pause if
`--yes` was passed; see the autonomous-mode note below):

```
Action:   update / create
File:     README.md

Sections affected:
  <section name> — <what changes and why>
  ...

Proceed? (yes / edit / cancel)
```

- **yes** — write the changes
- **edit** — ask what to change, revise, and show the summary again
- **cancel** — stop without writing anything

Do not write any files until the user explicitly confirms, unless
`--yes` was passed.

**Autonomous mode (`--yes`).** Skip the confirmation prompt and write the
changes directly; sections 1–4 still apply in full. This is for hands-off
runs where a human reviews the result later (for example in the PR); do
not pass `--yes` for one-off updates.
