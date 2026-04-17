# Vanilla error-occurred hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.
$ErrorActionPreference = "Stop"

$inputObj = [Console]::In.ReadToEnd() | ConvertFrom-Json

# Fields the Copilot CLI sends for errorOccurred:
#   timestamp      — Unix timestamp in milliseconds
#   cwd            — Current working directory
#   error.message  — Error message
#   error.name     — Error type/name
#   error.stack    — Stack trace (if available)

$logDir = ".github/hooks/logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

$logEntry = @{
    event        = "errorOccurred"
    timestamp    = $inputObj.timestamp
    errorMessage = $inputObj.error.message
    errorName    = $inputObj.error.name
    cwd          = $inputObj.cwd
} | ConvertTo-Json -Compress

Add-Content -Path "$logDir/events.jsonl" -Value $logEntry
exit 0
