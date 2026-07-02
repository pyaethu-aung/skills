#!/bin/bash
# Hard gate: deny EVERY git commit unless it carries the /commit-message skill token.
#
# Skill invocation is not visible to PreToolUse hooks, so the /commit-message skill
# signals itself by prefixing its commit with CLAUDE_COMMIT_VIA_SKILL=1. Any git
# commit lacking that token (in any form: compound `&&` chains, env-var prefixes,
# `git -C <path> commit`, extra spaces) is denied and redirected to the skill.
#
# Parsing is structural (tokenize each command segment, skip env assignments and
# git global options, check the subcommand), so it does NOT false-positive on
# innocent commands that merely contain the string "git commit" (e.g. a grep).
input=$(cat)

# Fast path: if "commit" never appears, it cannot be a git commit.
case "$input" in
  *commit*) ;;
  *) exit 0 ;;
esac

printf '%s' "$input" | python3 -c '
import sys, json, re, shlex
SENTINEL = "CLAUDE_COMMIT_VIA_SKILL=1"
try:
    cmd = (json.load(sys.stdin).get("tool_input", {}) or {}).get("command", "") or ""
except Exception:
    sys.exit(0)
TAKES_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"}
def is_commit(seg):
    try:
        toks = shlex.split(seg)
    except ValueError:
        toks = seg.split()
    i = 0
    while i < len(toks) and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[i]):
        i += 1
    if i >= len(toks) or toks[i] != "git":
        return False
    i += 1
    while i < len(toks):
        t = toks[i]
        if t in TAKES_ARG:
            i += 2
            continue
        if t.startswith("-"):
            i += 1
            continue
        break
    return i < len(toks) and toks[i] == "commit"
segs = re.split(r"&&|\|\||;|\n|\|", cmd)
if not any(is_commit(s) for s in segs):
    sys.exit(0)
if SENTINEL in cmd:
    sys.exit(0)
reason = ("Direct git commit is blocked. Use the /commit-message skill, which enforces "
          "Conventional Commits and the 50/72 rule. (A commit is allowed only when it carries "
          "CLAUDE_COMMIT_VIA_SKILL=1, which the skill sets; a deliberate manual commit must "
          "prefix the command with that token.)")
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason}}))
'
