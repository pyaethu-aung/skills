#!/bin/bash
# Blocks direct git commit calls that lack a valid Conventional Commits message.
# Commits produced by the /commit-message skill already follow the format and pass through.

input=$(cat)
cmd=$(python3 -c "import sys, json; print(json.load(sys.stdin).get('tool_input', {}).get('command', ''))" <<< "$input" 2>/dev/null)

# Allow file/stdin-based commits (git commit -F) — used by the skill for multi-line messages
if echo "$cmd" | grep -qE 'git commit.*-F'; then
  exit 0
fi

# Extract message from -m "..." or -m '...'
msg=$(python3 -c "
import sys, re
cmd = sys.stdin.read().strip()
m = re.search(r'''-m [\"']([^\"']+)[\"']''', cmd)
if m:
    print(m.group(1))
" <<< "$cmd" 2>/dev/null)

CC_PATTERN='^(feat|fix|chore|ci|docs|refactor|perf|test|style|build|revert)(\([^)]+\))?(!)?: .+'

if echo "$msg" | grep -qE "$CC_PATTERN"; then
  exit 0
fi

echo '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "Do not run git commit directly. Use the /commit-message skill instead — it enforces Conventional Commits format, the 50/72 rule, and atomic commits."}}'
