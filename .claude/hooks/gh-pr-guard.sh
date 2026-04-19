#!/bin/bash
# Blocks bare `gh pr create` calls and redirects to the /create-pr skill.
# Calls that include both --title and --body are fully drafted (i.e. produced
# by the skill after confirmation) and are allowed through.

input=$(cat)
cmd=$(python3 -c "import sys, json; print(json.load(sys.stdin).get('tool_input', {}).get('command', ''))" <<< "$input" 2>/dev/null)

if echo "$cmd" | grep -q -- '--title' && echo "$cmd" | grep -q -- '--body'; then
  exit 0
fi

echo '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "Do not run gh pr create directly. Use the /create-pr skill instead — it derives the title and body from commits, enforces a consistent PR format, and confirms before submitting."}}'
