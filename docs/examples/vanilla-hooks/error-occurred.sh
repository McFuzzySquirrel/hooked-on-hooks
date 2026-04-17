#!/bin/bash
set -euo pipefail
# Vanilla error-occurred hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.

INPUT=$(cat)

# Fields the Copilot CLI sends for errorOccurred:
#   timestamp      — Unix timestamp in milliseconds
#   cwd            — Current working directory
#   error.message  — Error message
#   error.name     — Error type/name
#   error.stack    — Stack trace (if available)
TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')
ERROR_MSG=$(echo "$INPUT" | jq -r '.error.message // empty')
ERROR_NAME=$(echo "$INPUT" | jq -r '.error.name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

LOG_DIR=".github/hooks/logs"
mkdir -p "$LOG_DIR"

jq -n \
  --arg event "errorOccurred" \
  --arg ts "$TIMESTAMP" \
  --arg msg "$ERROR_MSG" \
  --arg name "$ERROR_NAME" \
  --arg cwd "$CWD" \
  '{event: $event, timestamp: $ts, errorMessage: $msg, errorName: $name, cwd: $cwd}' \
  >> "$LOG_DIR/events.jsonl"

exit 0
