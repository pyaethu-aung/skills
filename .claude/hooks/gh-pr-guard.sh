#!/bin/bash
# Hard gate: deny EVERY gh pr create unless it carries the /create-pr skill token.
#
# The /create-pr skill prefixes its command with CLAUDE_PR_VIA_SKILL=1. Any
# `gh pr create` lacking that token (in any form) is denied and redirected to
# the skill. Parsing is structural, so it does not false-positive on commands
# that merely contain the string "gh pr create".
input=$(cat)

# Fast path: if "pr" never appears, it cannot be `gh pr create`.
case "$input" in
  *pr*) ;;
  *) exit 0 ;;
esac

printf '%s' "$input" | python3 -c '
import sys, json, re, shlex
SENTINEL = "CLAUDE_PR_VIA_SKILL=1"
try:
    cmd = (json.load(sys.stdin).get("tool_input", {}) or {}).get("command", "") or ""
except Exception:
    sys.exit(0)
def is_pr_create(seg):
    try:
        toks = shlex.split(seg)
    except ValueError:
        toks = seg.split()
    i = 0
    while i < len(toks) and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[i]):
        i += 1
    if i >= len(toks) or toks[i] != "gh":
        return False
    i += 1
    while i < len(toks) and toks[i].startswith("-"):
        i += 1
    if i >= len(toks) or toks[i] != "pr":
        return False
    i += 1
    while i < len(toks) and toks[i].startswith("-"):
        i += 1
    return i < len(toks) and toks[i] == "create"
segs = re.split(r"&&|\|\||;|\n|\|", cmd)
if not any(is_pr_create(s) for s in segs):
    sys.exit(0)
if SENTINEL in cmd:
    sys.exit(0)
reason = ("Direct gh pr create is blocked. Use the /create-pr skill, which derives the "
          "title and body from commits, enforces the PR format, and confirms first. "
          "(Allowed only when the command carries CLAUDE_PR_VIA_SKILL=1, which the skill sets.)")
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason}}))
'
