# Vanilla post-tool-use hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.
$ErrorActionPreference = "Stop"

$inputObj = [Console]::In.ReadToEnd() | ConvertFrom-Json

# Fields the Copilot CLI sends for postToolUse:
#   timestamp              — Unix timestamp in milliseconds
#   cwd                    — Current working directory
#   toolName               — Name of the tool that was executed
#   toolArgs               — JSON string containing the tool's arguments
#   toolResult.resultType  — "success", "failure", or "denied"
#   toolResult.textResultForLlm — The result text shown to the agent

$logDir = ".github/hooks/logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

$logEntry = @{
    event      = "postToolUse"
    timestamp  = $inputObj.timestamp
    toolName   = $inputObj.toolName
    resultType = $inputObj.toolResult.resultType
    cwd        = $inputObj.cwd
} | ConvertTo-Json -Compress

Add-Content -Path "$logDir/events.jsonl" -Value $logEntry
exit 0
