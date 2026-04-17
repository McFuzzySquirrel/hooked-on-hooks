# Vanilla subagent-stop hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.
$ErrorActionPreference = "Stop"

$inputObj = [Console]::In.ReadToEnd() | ConvertFrom-Json

# Fields the Copilot CLI sends for subagentStop:
#   timestamp  — Unix timestamp in milliseconds
#   cwd        — Current working directory
#
# Note: The subagentStop payload is not fully documented by GitHub.
# The raw input is logged so you can inspect exactly what is sent.

$logDir = ".github/hooks/logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

$logEntry = @{
    event      = "subagentStop"
    timestamp  = $inputObj.timestamp
    cwd        = $inputObj.cwd
    rawPayload = $inputObj
} | ConvertTo-Json -Compress

Add-Content -Path "$logDir/events.jsonl" -Value $logEntry
exit 0
