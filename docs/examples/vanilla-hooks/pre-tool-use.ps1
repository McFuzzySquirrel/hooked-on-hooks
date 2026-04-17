# Vanilla pre-tool-use hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.
$ErrorActionPreference = "Stop"

$inputObj = [Console]::In.ReadToEnd() | ConvertFrom-Json

# Fields the Copilot CLI sends for preToolUse:
#   timestamp  — Unix timestamp in milliseconds
#   cwd        — Current working directory
#   toolName   — Name of the tool (e.g. "bash", "edit", "view", "create")
#   toolArgs   — JSON string containing the tool's arguments

$logDir = ".github/hooks/logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

$logEntry = @{
    event     = "preToolUse"
    timestamp = $inputObj.timestamp
    toolName  = $inputObj.toolName
    toolArgs  = $inputObj.toolArgs
    cwd       = $inputObj.cwd
} | ConvertTo-Json -Compress

Add-Content -Path "$logDir/events.jsonl" -Value $logEntry

# To deny a tool execution, output JSON with permissionDecision:
# Write-Output '{"permissionDecision":"deny","permissionDecisionReason":"Blocked by policy"}'

exit 0
