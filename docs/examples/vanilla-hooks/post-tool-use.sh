#!/bin/bash
set -euo pipefail
# Vanilla post-tool-use hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.

INPUT=$(cat)

# Fields the Copilot CLI sends for postToolUse:
#   timestamp              — Unix timestamp in milliseconds
#   cwd                    — Current working directory
#   toolName               — Name of the tool that was executed
#   toolArgs               — JSON string containing the tool's arguments
#   toolResult.resultType  — "success", "failure", or "denied"
#   toolResult.textResultForLlm — The result text shown to the agent
TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName // empty')
RESULT_TYPE=$(echo "$INPUT" | jq -r '.toolResult.resultType // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

LOG_DIR=".github/hooks/logs"
mkdir -p "$LOG_DIR"

jq -n \
  --arg event "postToolUse" \
  --arg ts "$TIMESTAMP" \
  --arg tool "$TOOL_NAME" \
  --arg result "$RESULT_TYPE" \
  --arg cwd "$CWD" \
  '{event: $event, timestamp: $ts, toolName: $tool, resultType: $result, cwd: $cwd}' \
  >> "$LOG_DIR/events.jsonl"

exit 0
