# Part 3: Enriching Payloads

Prev: [Part 2](part-2.md) | Up: [From Vanilla to Visualizer (PowerShell)](../from-vanilla-to-visualizer-ps1.md) | Next: [Part 4](part-4.md)


### Why vanilla payloads aren't enough

Consider a `preToolUse` event. The vanilla payload is:

```json
{ "toolName": "bash", "toolArgs": "{\"command\":\"npm test\"}" }
```

This tells you *what tool* ran and *what arguments* it had. But in a
multi-agent session, you also want to know:

- **Which agent** dispatched this tool call?
- **What task** was the agent working on?
- **Is this tool part of a skill?** If so, which one?
- **What's the tool call ID?** (for correlating pre/post events)

None of this is in the vanilla payload. But some of it *might* be in the stdin
JSON under various field names — the CLI format isn't fully documented, and
field names can vary.

### The stdin extraction block

This is where the visualizer's complexity lives. A ~35-line PowerShell block that
reads the full stdin JSON and extracts fields into environment variables with
multi-level fallback cascades:

```powershell
# Read Copilot CLI context from stdin (JSON payload)
try { $_vizStdin = [Console]::In.ReadToEnd() } catch { $_vizStdin = '{}' }
if (-not $_vizStdin) { $_vizStdin = '{}' }
try { $_vizJson = $_vizStdin | ConvertFrom-Json } catch { $_vizJson = $null }

# Helper: return the first non-empty top-level field from a list of names
function _vizField([string[]]$names) { if (-not $_vizJson) { return '' }; foreach ($n in $names) { $v = $_vizJson.PSObject.Properties[$n]; if ($v -and $v.Value) { return [string]$v.Value } }; return '' }

# Helper: return a nested property value (e.g. "toolResult.resultType")
function _vizNested([string]$path) { if (-not $_vizJson) { return '' }; $parts = $path -split '\.'; $cur = $_vizJson; foreach ($p in $parts) { if (-not $cur) { return '' }; $v = $cur.PSObject.Properties[$p]; if (-not $v) { return '' }; $cur = $v.Value }; if ($cur -is [string]) { return $cur } elseif ($cur) { return [string]$cur } else { return '' } }

# Extract fields — stdin values fill unset vars
if (-not $env:TOOL_NAME)          { $env:TOOL_NAME = _vizField 'tool_name','toolName' }
if (-not $env:AGENT_NAME)         { $v = _vizNested 'agent.name'; if ($v) { $env:AGENT_NAME = $v } else { $v = _vizNested 'agent.id'; if ($v) { $env:AGENT_NAME = $v } else { $env:AGENT_NAME = _vizField 'agent_name','agentName','name' } } }
if (-not $env:TASK_DESC)          { $v = _vizNested 'toolArgs.description'; if ($v) { $env:TASK_DESC = $v } else { $env:TASK_DESC = _vizField 'task_description','taskDescription','task' } }
# ... 25+ more field extractions
```

### Why the fallback cascades?

The Copilot CLI's stdin format isn't fully documented. Fields may appear under
different names (`agent_name` vs `agentName` vs `agent.name`) depending on
the context. The fallback cascade tries every known path:

```powershell
# Agent name: try nested paths first, then flat field names
if (-not $env:AGENT_NAME) {
  $v = _vizNested 'agent.name'
  if ($v) { $env:AGENT_NAME = $v }
  else {
    $v = _vizNested 'agent.id'
    if ($v) { $env:AGENT_NAME = $v }
    else { $env:AGENT_NAME = _vizField 'agent_name','agentName','name' }
  }
}
```

This is defensive coding — we'd rather extract a value from an unexpected path
than miss it entirely.

### Rich payload construction

After extraction, the hook builds an enriched JSON payload using PowerShell
hashtables and `ConvertTo-Json`:

```powershell
# Vanilla payload
$payload = @{ toolName = "bash" }

# Enhanced payload (simplified)
$payload = @{
  toolName = $(if ($env:TOOL_NAME) { $env:TOOL_NAME } else { 'unknown' })
  toolArgs = $(if ($env:TOOL_ARGS) { try { $env:TOOL_ARGS | ConvertFrom-Json } catch { $env:TOOL_ARGS } } else { $null })
}
if ($env:AGENT_NAME)  { $payload.agentName = $env:AGENT_NAME }
if ($env:TASK_DESC)   { $payload.taskDescription = $env:TASK_DESC }
if ($env:SKILL_NAME)  { $payload.skillName = $env:SKILL_NAME }

$payloadJson = $payload | ConvertTo-Json -Compress -Depth 10
```

Notice the conditional field inclusion — empty values are omitted rather than
included as empty strings. This keeps payloads clean and avoids polluting
downstream consumers with noise.

### What changed from vanilla

| Aspect | Vanilla | Enhanced |
|--------|---------|----------|
| Fields logged | 2–4 from stdin | 10+ with fallback extraction |
| Agent context | ❌ | ✅ agentName, agentDisplayName |
| Task context | ❌ | ✅ taskDescription |
| Skill metadata | ❌ | ✅ skillName, skillId |
| Tool call correlation | ❌ | ✅ toolCallId |
| Payload construction | Direct stdin echo | Conditional hashtable builder + `ConvertTo-Json` |

### Try it yourself

We'll extend the `pre-tool-use.ps1` change from Part 2. If you completed that lab,
your hook already ends with this block:

```powershell
$SessionId = if ($env:COPILOT_SESSION_ID) { $env:COPILOT_SESSION_ID } else { "lab-" + [int](Get-Date -UFormat %s) }

$payload = @{ toolName = $inputObj.toolName }
if ($inputObj.toolArgs) {
  try { $payload.toolArgs = $inputObj.toolArgs | ConvertFrom-Json } catch { $payload.toolArgs = $inputObj.toolArgs }
}
$payloadJson = $payload | ConvertTo-Json -Compress -Depth 10

& .visualizer\emit-event.ps1 -EventType preToolUse -Payload $payloadJson -SessionId $SessionId
```

1. Open `$env:TEMP\copilot-hooks-lab\.github\hooks\visualizer\pre-tool-use.ps1`.

2. Replace the `$payload` block above with this enriched version that adds
   agent and task context via the `_vizField` helper:

   ```powershell
   # Read stdin via the _vizField helpers (stdin was already consumed above,
   # so use the $inputObj variable the script already captured)
   function _vizField([string[]]$names) { foreach ($n in $names) { $v = $inputObj.PSObject.Properties[$n]; if ($v -and $v.Value) { return [string]$v.Value } }; return '' }

   # Fallback extracts for enrichment fields
   $agentName = _vizField 'agent_name','agentName'
   $taskDesc = _vizField 'task_description','taskDescription','task'

   $SessionId = if ($env:COPILOT_SESSION_ID) { $env:COPILOT_SESSION_ID } else { "lab-" + [int](Get-Date -UFormat %s) }

   # Build enriched payload — omit fields that are empty
   $payload = @{
     toolName = $(if ($inputObj.toolName) { $inputObj.toolName } else { 'unknown' })
   }
   if ($inputObj.toolArgs) {
     try { $payload.toolArgs = $inputObj.toolArgs | ConvertFrom-Json } catch { $payload.toolArgs = $inputObj.toolArgs }
   }
   if ($agentName) { $payload.agentName = $agentName }
   if ($taskDesc) { $payload.taskDescription = $taskDesc }
   $payloadJson = $payload | ConvertTo-Json -Compress -Depth 10

   & .visualizer\emit-event.ps1 -EventType preToolUse -Payload $payloadJson -SessionId $SessionId
   ```

   > **Note:** `.visualizer\emit-event.ps1` is only present after a full bootstrap (Part 1).

3. Run a short Copilot CLI session from inside `$env:TEMP\copilot-hooks-lab`.

4. Compare the output to a vanilla line from Part 1. Your enriched output will look like this:

   ```json
   {
     "schemaVersion": "1.0.0",
     "eventId": "057608f6-177c-48dd-8123-4d0c1d0dff12",
     "eventType": "preToolUse",
     "timestamp": "2026-04-16T20:52:37.979Z",
     "sessionId": "lab-1776372757",
     "source": "copilot-cli",
     "repoPath": "C:\\Users\\you\\copilot-hooks-lab",
     "payload": {
       "toolName": "report_intent",
       "toolArgs": { "intent": "Examining sessionStart hook" }
     }
   }
   ```

   > **Why no `agentName` or `taskDescription`?** Those fields only appear when the
   > Copilot CLI actually sends them in stdin. For simple single-agent sessions they
   > are often absent — the conditional builder correctly omits them rather than
   > including empty strings. In a multi-agent session with subagents you will start
   > seeing them populate.

5. Check that empty fields are omitted — if `agentName` wasn't in the stdin payload,
   it should not appear as an empty string in the output.

Quick compare command:

```powershell
Get-Content .github/hooks/logs/events.jsonl -Tail 1
Get-Content .visualizer/logs/events.jsonl -Tail 1
```

### Optional visualizer checkpoint

Run the optional checkpoint from [From Vanilla to Visualizer (PowerShell)](../from-vanilla-to-visualizer-ps1.md).
After this part, `preToolUse` cards should include richer payload context when
Copilot provides it (for example, task/agent metadata in multi-agent runs).

---

Prev: [Part 2](part-2.md) | Up: [From Vanilla to Visualizer (PowerShell)](../from-vanilla-to-visualizer-ps1.md) | Next: [Part 4](part-4.md)
