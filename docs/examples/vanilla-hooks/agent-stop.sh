#!/bin/bash
set -euo pipefail
# Vanilla agent-stop hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.

INPUT=$(cat)

# Fields the Copilot CLI sends for agentStop:
#   timestamp  — Unix timestamp in milliseconds
#   cwd        — Current working directory
#
# Note: The agentStop payload is not fully documented by GitHub.
# The fields below are based on observed behavior. Additional fields
# may be present — the raw INPUT is logged for inspection.
TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

LOG_DIR=".github/hooks/logs"
mkdir -p "$LOG_DIR"

# Log the complete raw payload so you can see exactly what the CLI sends.
jq -n \
  --arg event "agentStop" \
  --arg ts "$TIMESTAMP" \
  --arg cwd "$CWD" \
  --argjson raw "$INPUT" \
  '{event: $event, timestamp: $ts, cwd: $cwd, rawPayload: $raw}' \
  >> "$LOG_DIR/events.jsonl"

exit 0
