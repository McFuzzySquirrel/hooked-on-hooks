#!/bin/bash
set -euo pipefail
# Vanilla session-start hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.

INPUT=$(cat)

# Fields the Copilot CLI sends for sessionStart:
#   timestamp      — Unix timestamp in milliseconds
#   cwd            — Current working directory
#   source         — "new", "resume", or "startup"
#   initialPrompt  — The user's initial prompt (if provided)
TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')
SOURCE=$(echo "$INPUT" | jq -r '.source // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

LOG_DIR=".github/hooks/logs"
mkdir -p "$LOG_DIR"

jq -n \
  --arg event "sessionStart" \
  --arg ts "$TIMESTAMP" \
  --arg source "$SOURCE" \
  --arg cwd "$CWD" \
  '{event: $event, timestamp: $ts, source: $source, cwd: $cwd}' \
  >> "$LOG_DIR/events.jsonl"

exit 0
