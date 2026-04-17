# Part 4: Synthesizing Events

Prev: [Part 3](part-3.md) | Up: [From Vanilla to Visualizer (PowerShell)](../from-vanilla-to-visualizer-ps1.md) | Next: [Part 5](part-5.md)


### The problem: one hook, two outcomes

Copilot CLI fires a **single** `postToolUse` hook for both success and failure.
The outcome lives in `toolResult.resultType`:

```json
{
  "toolName": "bash",
  "toolResult": { "resultType": "failure", "textResultForLlm": "exit code 1" }
}
```

If you're building a state machine or timeline, you need to distinguish
these — a failed tool is a different state transition than a successful one.

### Solution: conditional event routing

The enhanced `post-tool-use.ps1` stub checks `toolResult.resultType` and
emits different event types:

```powershell
$status = _vizNested 'toolResult.resultType'
if (-not $status) { $status = _vizField 'status','tool_status' }

if ($status -eq 'failure' -or $status -eq 'denied') {
  # Emit postToolUseFailure with error details
  & .visualizer\emit-event.ps1 -EventType postToolUseFailure -Payload $failurePayload -SessionId $SessionId
} else {
  # Emit postToolUse (success)
  & .visualizer\emit-event.ps1 -EventType postToolUse -Payload $successPayload -SessionId $SessionId
}
```

This is **event synthesis** — creating new event types that don't exist in the
original hook system. The consumer (state machine, UI) sees two distinct
events instead of having to interpret a status field.

### Synthesized subagent lifecycle

Copilot CLI has a `subagentStop` hook but **no `subagentStart` hook**. If you
want to show when a subagent *began* working (not just when it stopped), you
need to synthesize it.

The visualizer detects subagent start from `task` tool completions. When a
`postToolUse` event has `toolArgs.agent_type` or other agent identity fields,
the state machine synthesizes a `subagentStart` event:

```
postToolUse (toolName=task, toolArgs.agent_type=explore)
  → synthesize subagentStart { agentName: "explore", ... }

agentStop
  → close the subagent lane
```

This gives the Gantt chart and activity board a complete subagent lifecycle
even though the CLI only sends a stop signal.

### The full event type picture

| Event Type | Source | Description |
|------------|--------|-------------|
| `sessionStart` | CLI hook | Session begins |
| `sessionEnd` | CLI hook | Session ends |
| `userPromptSubmitted` | CLI hook | User sends a prompt |
| `preToolUse` | CLI hook | Tool about to execute |
| `postToolUse` | CLI hook (filtered) | Tool succeeded |
| `postToolUseFailure` | **Synthesized** | Tool failed or was denied |
| `subagentStart` | **Synthesized** | Subagent began working |
| `subagentStop` | CLI hook | Subagent completed |
| `agentStop` | CLI hook | Main agent finished |
| `notification` | **Reserved** | Not currently triggered |
| `errorOccurred` | CLI hook | Error during execution |

### Try it yourself

We'll modify `post-tool-use.ps1` in the lab repo. The vanilla hook already extracts
`resultType` from stdin — we just need to replace the plain append block with a
branching emit.

**Step 1 — Open the hook:**

```powershell
notepad "$env:TEMP\copilot-hooks-lab\.github\hooks\visualizer\post-tool-use.ps1"
```

or modify it in an IDE like VSCode.

**Step 2 — Find the vanilla append block at the bottom of the file:**

```powershell
$logEntry = @{
    event      = "postToolUse"
    timestamp  = $inputObj.timestamp
    toolName   = $inputObj.toolName
    resultType = $inputObj.toolResult.resultType
    cwd        = $inputObj.cwd
} | ConvertTo-Json -Compress

Add-Content -Path "$logDir/events.jsonl" -Value $logEntry
```

**Step 3 — Replace it with this branching emit block:**

```powershell
$SessionId = if ($env:COPILOT_SESSION_ID) { $env:COPILOT_SESSION_ID } else { "lab-" + [int](Get-Date -UFormat %s) }
$resultType = $inputObj.toolResult.resultType

if ($resultType -eq 'failure' -or $resultType -eq 'denied') {
  $payloadJson = (@{
    toolName = $inputObj.toolName
    status   = $resultType
  } | ConvertTo-Json -Compress)
  & .visualizer\emit-event.ps1 -EventType postToolUseFailure -Payload $payloadJson -SessionId $SessionId
} else {
  $payloadJson = (@{
    toolName = $inputObj.toolName
    status   = 'success'
  } | ConvertTo-Json -Compress)
  & .visualizer\emit-event.ps1 -EventType postToolUse -Payload $payloadJson -SessionId $SessionId
}
```

> **Prerequisite:** `.visualizer\emit-event.ps1` only exists after a full (non-vanilla)
> bootstrap. To test the branching logic now, replace the `& .visualizer\emit-event.ps1`
> calls with `Write-Host "EVENT: $payloadJson"` temporarily, then restore them once you
> run the full bootstrap in Part 5.

**Step 4 — Test both paths directly (no real CLI session needed):**

```powershell
$SessionId = "synth-demo"

# Simulate a success
'{"toolName":"bash","toolResult":{"resultType":"success"}}' | & "$env:TEMP\copilot-hooks-lab\.github\hooks\visualizer\post-tool-use.ps1"

# Simulate a failure
'{"toolName":"bash","toolResult":{"resultType":"failure"}}' | & "$env:TEMP\copilot-hooks-lab\.github\hooks\visualizer\post-tool-use.ps1"
```

If you are temporarily using `Write-Host` instead of `.visualizer\emit-event.ps1`, you should see two different payloads — one routed to `postToolUse`, one to `postToolUseFailure`.

**Step 5 — After a real CLI session, verify both event types appear:**

```powershell
Get-Content "$env:TEMP\copilot-hooks-lab\.visualizer\logs\events.jsonl" -Tail 50 |
  ForEach-Object { $_ | ConvertFrom-Json } |
  Where-Object { $_.sessionId -eq $SessionId } |
  Select-Object -ExpandProperty eventType
```

For the direct simulation above, expected output is:

```text
postToolUse
postToolUseFailure
```

**Step 6 (Bonus) — Sketch `subagentStart` synthesis:** Vanilla hooks have no
`subagentStart` event. A `preToolUse` for `toolName:"task"` followed by a `postToolUse`
for the same tool signals that a subagent was dispatched.

Here is the **success branch before** adding the synthetic subagent event:

```powershell
} else {
  $payloadJson = (@{
    toolName = $inputObj.toolName
    status   = 'success'
  } | ConvertTo-Json -Compress)
  & .visualizer\emit-event.ps1 -EventType postToolUse -Payload $payloadJson -SessionId $SessionId
}
```

Replace that success branch with this version:

```powershell
} else {
  $payloadJson = (@{
    toolName = $inputObj.toolName
    status   = 'success'
  } | ConvertTo-Json -Compress)
  & .visualizer\emit-event.ps1 -EventType postToolUse -Payload $payloadJson -SessionId $SessionId

  if ($inputObj.toolName -eq 'task') {
    $agentName = $inputObj.toolArgs.agent_type
    if (-not $agentName) { $agentName = $inputObj.toolArgs.agentName }
    $synthPayload = (@{ agentName = $agentName } | ConvertTo-Json -Compress)
    & .visualizer\emit-event.ps1 -EventType subagentStart -Payload $synthPayload -SessionId $SessionId
  }
}
```

If you want to simulate it directly, send a fake successful `task` tool result through the hook:

```powershell
$SessionId = "subagent-demo"

'{"toolName":"task","toolArgs":{"agent_type":"Explore"},"toolResult":{"resultType":"success"}}' |
  & "$env:TEMP\copilot-hooks-lab\.github\hooks\visualizer\post-tool-use.ps1"
```

Then verify that the same session produced both the task completion and the synthesized start event:

These synthesized events are written to `.visualizer/logs/events.jsonl`, not the vanilla `.github/hooks/logs/events.jsonl` file.

```powershell
Get-Content "$env:TEMP\copilot-hooks-lab\.visualizer\logs\events.jsonl" -Tail 50 |
  ForEach-Object { $_ | ConvertFrom-Json } |
  Where-Object { $_.sessionId -eq $SessionId } |
  Select-Object eventType, @{N='detail'; E={ $_.payload.toolName, $_.payload.agentName -ne $null -join '' }}
```

Expected output will include both events for the same `sessionId`. A real run looks like this:

```json
{"schemaVersion":"1.0.0","eventId":"ee68fda2-...","eventType":"postToolUse","timestamp":"2026-04-16T21:17:12.429Z","sessionId":"subagent-demo","source":"copilot-cli","repoPath":"C:\\Users\\you\\copilot-hooks-lab","payload":{"toolName":"task","status":"success"}}
{"schemaVersion":"1.0.0","eventId":"85ae3553-...","eventType":"subagentStart","timestamp":"2026-04-16T21:17:13.445Z","sessionId":"subagent-demo","source":"copilot-cli","repoPath":"C:\\Users\\you\\copilot-hooks-lab","payload":{"agentName":"Explore"}}
```

### Real prompt example: spinning up agents

If you want a realistic prompt that triggers both a subagent task and another
tool workflow, this one produced good coverage in testing:

```text
I would like to test you running a subagent that is looking for info on what we can do with postTool use and another agent creating a readme for this repo
```

In vanilla `.github/hooks/logs/events.jsonl`, you will typically see:

- `userPromptSubmitted` with the original prompt text
- `agentStop` for the main agent turn
- `subagentStop` for the explore subagent completion
- a follow-up `userPromptSubmitted` system notification about `read_agent`

In `.visualizer/logs/events.jsonl`, the same run can include synthesized
`subagentStart` events (from `task` success), giving you both lifecycle edges:

- synthesized start: `subagentStart`
- native stop: `subagentStop`

This is the key value of synthesis: a complete subagent timeline even when the
source hooks only provide stop semantics.

### Optional visualizer checkpoint

Run the optional checkpoint from [From Vanilla to Visualizer (PowerShell)](../from-vanilla-to-visualizer-ps1.md).
After this part, look for synthesized events such as `postToolUseFailure` and
`subagentStart` in the live timeline.

---

Prev: [Part 3](part-3.md) | Up: [From Vanilla to Visualizer (PowerShell)](../from-vanilla-to-visualizer-ps1.md) | Next: [Part 5](part-5.md)
