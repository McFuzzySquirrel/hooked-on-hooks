# Vanilla session-end hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.
$ErrorActionPreference = "Stop"

$inputObj = [Console]::In.ReadToEnd() | ConvertFrom-Json

# Fields the Copilot CLI sends for sessionEnd:
#   timestamp  — Unix timestamp in milliseconds
#   cwd        — Current working directory
#   reason     — "complete", "error", "abort", "timeout", or "user_exit"

$logDir = ".github/hooks/logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

$logEntry = @{
    event     = "sessionEnd"
    timestamp = $inputObj.timestamp
    reason    = $inputObj.reason
    cwd       = $inputObj.cwd
} | ConvertTo-Json -Compress

Add-Content -Path "$logDir/events.jsonl" -Value $logEntry
exit 0
