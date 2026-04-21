---
name: update-readme
description: Use after any change worth documenting — new feature, new skill, config change, or breaking change. Updates README.md to reflect the change, or creates it if missing.
metadata:
  version: "1.0.0"
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
git diff HEAD~1 HEAD --stat
```

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

After drafting the changes, show the user a summary:

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

Do not write any files until the user explicitly confirms.
