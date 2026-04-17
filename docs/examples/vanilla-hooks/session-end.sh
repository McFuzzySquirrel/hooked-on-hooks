#!/bin/bash
set -euo pipefail
# Vanilla session-end hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.

INPUT=$(cat)

# Fields the Copilot CLI sends for sessionEnd:
#   timestamp  — Unix timestamp in milliseconds
#   cwd        — Current working directory
#   reason     — "complete", "error", "abort", "timeout", or "user_exit"
TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')
REASON=$(echo "$INPUT" | jq -r '.reason // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

LOG_DIR=".github/hooks/logs"
mkdir -p "$LOG_DIR"

jq -n \
  --arg event "sessionEnd" \
  --arg ts "$TIMESTAMP" \
  --arg reason "$REASON" \
  --arg cwd "$CWD" \
  '{event: $event, timestamp: $ts, reason: $reason, cwd: $cwd}' \
  >> "$LOG_DIR/events.jsonl"

exit 0
