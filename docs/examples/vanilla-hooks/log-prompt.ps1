# Vanilla user-prompt-submitted hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.
$ErrorActionPreference = "Stop"

$inputObj = [Console]::In.ReadToEnd() | ConvertFrom-Json

# Fields the Copilot CLI sends for userPromptSubmitted:
#   timestamp  — Unix timestamp in milliseconds
#   cwd        — Current working directory
#   prompt     — The exact text the user submitted

$logDir = ".github/hooks/logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

# ⚠️  Prompts may contain sensitive data. Consider redacting before persisting.
$logEntry = @{
    event     = "userPromptSubmitted"
    timestamp = $inputObj.timestamp
    prompt    = $inputObj.prompt
    cwd       = $inputObj.cwd
} | ConvertTo-Json -Compress

Add-Content -Path "$logDir/events.jsonl" -Value $logEntry
exit 0
