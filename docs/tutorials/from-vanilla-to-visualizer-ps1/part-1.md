# Part 1: Starting from Vanilla

Up: [From Vanilla to Visualizer (PowerShell)](../from-vanilla-to-visualizer-ps1.md) | Next: [Part 2](part-2.md)


### What Copilot CLI gives you

When Copilot CLI fires a hook, it pipes a JSON object on **stdin**. That's it.
No headers, no env vars, no framing — just raw JSON.

Here's what a vanilla `preToolUse` hook looks like in PowerShell:

```powershell
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
```

Read stdin, extract the fields, build a structured JSON log entry, and append.
This is the baseline that every Copilot CLI hook starts from.

## Try it yourself

Rather than copying files manually, use the bootstrap script with the `--vanilla` flag.
This creates the hook scripts and wires them up automatically.

1. Create a throwaway test repo.

   ```powershell
   New-Item -ItemType Directory -Path "$env:TEMP\copilot-hooks-lab" -Force
   Set-Location "$env:TEMP\copilot-hooks-lab"
   git init
   ```

2. Bootstrap vanilla hooks into it from the `hooked-on-hooks` repo.

   ```powershell
    # Run this from inside the hooked-on-hooks repo
   npx tsx scripts/bootstrap-existing-repo.ts "$env:TEMP\copilot-hooks-lab" --vanilla --create-hooks
   ```

   This creates `.github/hooks/visualizer/*.sh` and `.github/hooks/visualizer/*.ps1` scripts
   and a `visualizer-hooks.json` manifest that points to them. No manual copying needed.

   > **Why `visualizer/`?** The bootstrap isolates all generated files into a dedicated
   > subdirectory so they never collide with your own hooks and can be cleanly removed later
   > (see [ADR-004](../../adr/004-visualizer-hooks-subdirectory.md)).

3. Confirm the scripts were created.

   ```powershell
   Get-ChildItem "$env:TEMP\copilot-hooks-lab\.github\hooks\visualizer"
   ```

4. Run a short Copilot CLI session from inside the lab repo that triggers at least one tool call.

5. Open `.github/hooks/logs/events.jsonl` and inspect 3-5 lines.
6. Note which fields are present, then compare with the "What's missing"
   list below.

   Quick inspect command:

   ```powershell
   Get-Content "$env:TEMP\copilot-hooks-lab\.github\hooks\logs\events.jsonl" -Tail 10 |
     ForEach-Object { $_ | ConvertFrom-Json } | Format-List
   ```

   You should see one JSON object per line. A `sessionStart` entry looks like this:

   ```json
   {
     "event": "sessionStart",
     "timestamp": "1776370981977",
     "source": "new",
     "cwd": "C:\\Users\\you\\copilot-hooks-lab"
   }
   ```

   Notice what's there — and what's not. There's no `sessionId`, no agent identity,
   no way to correlate this event with anything else in the log. That's exactly the
   gap the visualiser fills.

---

### The 8 hook types and their payloads

Copilot CLI supports exactly 8 hook types. Here's what each sends on stdin:

| Hook | Key Fields | Notes |
|------|-----------|-------|
| `sessionStart` | `timestamp`, `cwd`, `source` | `source` is `"new"`, `"resume"`, or `"startup"`. `initialPrompt` may appear on resume sessions |
| `sessionEnd` | `timestamp`, `cwd`, `reason` | `reason` is `"complete"`, `"error"`, `"abort"`, `"timeout"`, or `"user_exit"` |
| `userPromptSubmitted` | `timestamp`, `cwd`, `prompt` | Full prompt text — may contain sensitive data |
| `preToolUse` | `timestamp`, `cwd`, `toolName`, `toolArgs` | `toolArgs` is a JSON **string**, not an object |
| `postToolUse` | `timestamp`, `cwd`, `toolName`, `resultType` | `resultType` is `"success"`, `"failure"`, or `"denied"` — at the top level, not nested |
| `agentStop` | `timestamp`, `cwd`, `sessionId`, `transcriptPath`, `stopReason` | `stopReason` is `"end_turn"` or similar; `transcriptPath` points to the session JSONL |
| `subagentStop` | `timestamp`, `cwd` | May include additional fields similar to `agentStop` |
| `errorOccurred` | `timestamp`, `cwd`, `error` | `error` has `message`, `name`, `stack` |

Here are real examples from an actual session:

**`preToolUse`** — `toolArgs` is always a JSON string you need to parse:
```json
{
  "event": "preToolUse",
  "timestamp": "1776370991449",
  "toolName": "bash",
  "toolArgs": "{\"command\": \"ls -la\", \"description\": \"List root directory\"}",
  "cwd": "C:\\Users\\you\\copilot-hooks-lab"
}
```

**`postToolUse`** — `resultType` is top-level, and `toolArgs` is not repeated:
```json
{
  "event": "postToolUse",
  "timestamp": "1776370992124",
  "toolName": "bash",
  "resultType": "success",
  "cwd": "C:\\Users\\you\\copilot-hooks-lab"
}
```

**`agentStop`** — the most information-rich vanilla event, including `sessionId`:
```json
{
  "event": "agentStop",
  "timestamp": "1776371020579",
  "cwd": "C:\\Users\\you\\copilot-hooks-lab",
  "rawPayload": {
    "timestamp": 1776371020579,
    "cwd": "C:\\Users\\you\\copilot-hooks-lab",
    "sessionId": "b24e89d8-78ab-4fa4-9565-339d225182c6",
    "transcriptPath": "C:\\Users\\you\\.copilot\\session-state\\b24e89d8...\\events.jsonl",
    "stopReason": "end_turn"
  }
}
```

> **Note:** `sessionId` only appears in `agentStop` — not in `preToolUse`, `postToolUse`, or any other event.
> This is one of the core gaps the visualiser fills: it extracts the `sessionId` from `agentStop` and
> backfills it onto every envelope event so you can correlate a full session.

### What's missing

Vanilla payloads are minimal by design. They tell you *what happened* but not
much about *who* or *why*. You won't find:

- **Session IDs** — no way to correlate events across a session
- **Agent identity** — no agent name, display name, or description
- **Tool context** — no info about which agent/subagent dispatched the tool
- **Failure detail** — success and failure come through the same hook
- **Subagent lifecycle** — no `subagentStart` event; only `subagentStop`

These gaps are what the visualizer fills. Let's see how.

### Optional visualizer checkpoint

Want to see this stage in the UI? Run the optional checkpoint from
[From Vanilla to Visualizer (PowerShell)](../from-vanilla-to-visualizer-ps1.md). At this point,
most output is still vanilla-only in `.github/hooks/logs/events.jsonl`, so the
web UI may show little or no activity yet.

Up: [From Vanilla to Visualizer (PowerShell)](../from-vanilla-to-visualizer-ps1.md) | Next: [Part 2](part-2.md)
