#!/bin/bash
# Blocks direct `gh pr create` calls and redirects to the /create-pr skill.

echo '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "Do not run gh pr create directly. Use the /create-pr skill instead — it derives the title and body from commits, enforces a consistent PR format, and confirms before submitting."}}'
