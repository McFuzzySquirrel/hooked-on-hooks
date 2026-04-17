# Vanilla session-start hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.
$ErrorActionPreference = "Stop"

$inputObj = [Console]::In.ReadToEnd() | ConvertFrom-Json

# Fields the Copilot CLI sends for sessionStart:
#   timestamp      — Unix timestamp in milliseconds
#   cwd            — Current working directory
#   source         — "new", "resume", or "startup"
#   initialPrompt  — The user's initial prompt (if provided)

$logDir = ".github/hooks/logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

$logEntry = @{
    event     = "sessionStart"
    timestamp = $inputObj.timestamp
    source    = $inputObj.source
    cwd       = $inputObj.cwd
} | ConvertTo-Json -Compress

Add-Content -Path "$logDir/events.jsonl" -Value $logEntry
exit 0
