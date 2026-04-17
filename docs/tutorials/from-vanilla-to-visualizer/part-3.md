# Part 3: Enriching Payloads

Prev: [Part 2](part-2.md) | Up: [From Vanilla to Visualizer](../from-vanilla-to-visualizer.md) | Next: [Part 4](part-4.md)


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

This is where the visualizer's complexity lives. A ~35-line shell snippet that
reads the full stdin JSON and extracts fields into environment variables with
multi-level fallback cascades:

```bash
# Read Copilot CLI context from stdin (JSON payload)
_VIZ_STDIN=$(cat 2>/dev/null || echo '{}')
if [ -z "$_VIZ_STDIN" ]; then _VIZ_STDIN='{}'; fi
_vjq() { echo "$_VIZ_STDIN" | jq -r "$1" 2>/dev/null || true; }

# Extract fields — stdin values fill unset vars
: "${TOOL_NAME:=$(_vjq '.tool_name // .toolName // empty')}"
: "${AGENT_NAME:=$(_vjq '.agent_name // .agentName // .agent.name // .agent.id // .agent.slug // .actor.name // .name // empty')}"
: "${TASK_DESC:=$(_vjq '.task_description // .taskDescription // .task // .toolArgs.description // .tool_args.description // empty')}"
# ... 25+ more field extractions
```

### Why the fallback cascades?

The Copilot CLI's stdin format isn't fully documented. Fields may appear under
different names (`agent_name` vs `agentName` vs `agent.name`) depending on
the context. The fallback cascade tries every known path:

```bash
# Agent name: try 7 different paths before giving up
: "${AGENT_NAME:=$(_vjq '.agent_name // .agentName // .agent.name // .agent.id // .agent.slug // .actor.name // .name // empty')}"
```

This is defensive coding — we'd rather extract a value from an unexpected path
than miss it entirely.

### Rich payload construction

After extraction, the hook builds an enriched JSON payload using `jq`:

```bash
# Vanilla payload
_VIZ_PAYLOAD='{"toolName":"bash"}'

# Enhanced payload (simplified)
_VIZ_PAYLOAD=$(jq -nc \
  --arg tool "$TOOL_NAME" \
  --arg agent "$AGENT_NAME" \
  --arg task "$TASK_DESC" \
  --arg skill "$SKILL_NAME" \
  '{"toolName":$tool}
   + (if ($agent|length)>0 then {"agentName":$agent} else {} end)
   + (if ($task|length)>0 then {"taskDescription":$task} else {} end)
   + (if ($skill|length)>0 then {"skillName":$skill} else {} end)')
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
| Payload construction | Direct stdin echo | `jq` conditional builder |

### Try it yourself

We'll extend the `pre-tool-use.sh` change from Part 2. If you completed that lab,
your hook already ends with this block:

```bash
SESSION_ID=${COPILOT_SESSION_ID:-"lab-$(date +%s)"}

PAYLOAD_JSON=$(jq -nc \
  --arg tool "$TOOL_NAME" \
  --arg args "$TOOL_ARGS" \
  '{
    toolName: $tool,
    toolArgs: (($args | fromjson?) // {})
  }')

.visualizer/emit-event.sh preToolUse "$PAYLOAD_JSON" "$SESSION_ID"
```

1. Open `/tmp/copilot-hooks-lab/.github/hooks/visualizer/pre-tool-use.sh`.

2. Replace the `PAYLOAD_JSON` block above with this enriched version that adds
   agent and task context via fallback extracts:

   ```bash
   # Re-read stdin via a safe accessor (stdin was already consumed above,
   # so use the $INPUT variable the script already captured)
   _vjq() { echo "$INPUT" | jq -r "$1" 2>/dev/null || true; }

   # Fallback extracts for enrichment fields
   AGENT_NAME="${AGENT_NAME:-$(_vjq '.agent_name // .agentName // .agent.name // empty')}"
   TASK_DESC="${TASK_DESC:-$(_vjq '.task_description // .taskDescription // .task // empty')}"

   SESSION_ID=${COPILOT_SESSION_ID:-"lab-$(date +%s)"}

   # Build enriched payload — omit fields that are empty
   PAYLOAD_JSON=$(jq -nc \
     --arg tool "$TOOL_NAME" \
     --arg args "$TOOL_ARGS" \
     --arg agent "$AGENT_NAME" \
     --arg task "$TASK_DESC" \
     '{"toolName":$tool, "toolArgs":(($args | fromjson?) // {})}
      + (if ($agent|length)>0 then {"agentName":$agent} else {} end)
      + (if ($task|length)>0 then {"taskDescription":$task} else {} end)')

   .visualizer/emit-event.sh preToolUse "$PAYLOAD_JSON" "$SESSION_ID"
   ```

   > **Note:** `.visualizer/emit-event.sh` is only present after a full bootstrap (Part 1).

3. Run a short Copilot CLI session from inside `/tmp/copilot-hooks-lab`.

4. Compare the output to a vanilla line from Part 1. Your enriched output will look like this:

   ```json
   {
     "schemaVersion": "1.0.0",
     "eventId": "057608f6-177c-48dd-8123-4d0c1d0dff12",
     "eventType": "preToolUse",
     "timestamp": "2026-04-16T20:52:37.979Z",
     "sessionId": "lab-1776372757",
     "source": "copilot-cli",
     "repoPath": "/tmp/copilot-hooks-lab",
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

6. Now inspect the **vanilla** log and notice what changed:

   ```json
   { "event": "userPromptSubmitted", "timestamp": "1776372750868", "prompt": "what can I do with sessionStart?", "cwd": "/tmp/copilot-hooks-lab" }
   { "event": "postToolUse", "timestamp": "1776372760155", "toolName": "report_intent", "resultType": "success", "cwd": "/tmp/copilot-hooks-lab" }
   { "event": "postToolUse", "timestamp": "1776372760222", "toolName": "view", "resultType": "success", "cwd": "/tmp/copilot-hooks-lab" }
   { "event": "agentStop", "timestamp": "1776372774996", "cwd": "/tmp/copilot-hooks-lab", "rawPayload": { "sessionId": "b24e89d8-...", "stopReason": "end_turn" } }
   ```

   > **`preToolUse` is gone from the vanilla log.** That's expected — you migrated that
   > hook to the visualiser emit. The remaining hooks (`postToolUse`, `userPromptSubmitted`,
   > `agentStop`) are still vanilla and still write to `.github/hooks/logs/events.jsonl`.
   >
   > This is the migration pattern: hook by hook, you move events from the raw log into
   > the validated, enveloped JSONL. By the time you finish Part 4's full bootstrap, all
   > hooks will be migrated and the vanilla log will be empty.

### Optional visualizer checkpoint

Run the optional checkpoint from [From Vanilla to Visualizer](../from-vanilla-to-visualizer.md).
After this part, `preToolUse` cards should include richer payload context when
Copilot provides it (for example, task/agent metadata in multi-agent runs).

---

Prev: [Part 2](part-2.md) | Up: [From Vanilla to Visualizer](../from-vanilla-to-visualizer.md) | Next: [Part 4](part-4.md)
