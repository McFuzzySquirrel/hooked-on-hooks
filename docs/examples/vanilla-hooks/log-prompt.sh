#!/bin/bash
set -euo pipefail
# Vanilla user-prompt-submitted hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.

INPUT=$(cat)

# Fields the Copilot CLI sends for userPromptSubmitted:
#   timestamp  — Unix timestamp in milliseconds
#   cwd        — Current working directory
#   prompt     — The exact text the user submitted
TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

LOG_DIR=".github/hooks/logs"
mkdir -p "$LOG_DIR"

# ⚠️  Prompts may contain sensitive data. Consider redacting before persisting.
jq -n \
  --arg event "userPromptSubmitted" \
  --arg ts "$TIMESTAMP" \
  --arg prompt "$PROMPT" \
  --arg cwd "$CWD" \
  '{event: $event, timestamp: $ts, prompt: $prompt, cwd: $cwd}' \
  >> "$LOG_DIR/events.jsonl"

exit 0
