#!/bin/bash
set -euo pipefail
# Vanilla pre-tool-use hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.

INPUT=$(cat)

# Fields the Copilot CLI sends for preToolUse:
#   timestamp  — Unix timestamp in milliseconds
#   cwd        — Current working directory
#   toolName   — Name of the tool (e.g. "bash", "edit", "view", "create")
#   toolArgs   — JSON string containing the tool's arguments
TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName // empty')
TOOL_ARGS=$(echo "$INPUT" | jq -r '.toolArgs // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

LOG_DIR=".github/hooks/logs"
mkdir -p "$LOG_DIR"

jq -n \
  --arg event "preToolUse" \
  --arg ts "$TIMESTAMP" \
  --arg tool "$TOOL_NAME" \
  --arg args "$TOOL_ARGS" \
  --arg cwd "$CWD" \
  '{event: $event, timestamp: $ts, toolName: $tool, toolArgs: $args, cwd: $cwd}' \
  >> "$LOG_DIR/events.jsonl"

# To deny a tool execution, output JSON with permissionDecision:
# echo '{"permissionDecision":"deny","permissionDecisionReason":"Blocked by policy"}'

exit 0
