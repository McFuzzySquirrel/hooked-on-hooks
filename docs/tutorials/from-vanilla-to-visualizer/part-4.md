# Part 4: Synthesizing Events

Prev: [Part 3](part-3.md) | Up: [From Vanilla to Visualizer](../from-vanilla-to-visualizer.md) | Next: [Part 5](part-5.md)

## Screenshot Placeholder


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

The enhanced `post-tool-use.sh` stub checks `toolResult.resultType` and
emits different event types:

```bash
STATUS=$(_vjq '.toolResult.resultType // .status // empty')

if [ "$STATUS" = "failure" ] || [ "$STATUS" = "denied" ]; then
  # Emit postToolUseFailure with error details
  .visualizer/emit-event.sh postToolUseFailure "$FAILURE_PAYLOAD" "$SESSION_ID"
else
  # Emit postToolUse (success)
  .visualizer/emit-event.sh postToolUse "$SUCCESS_PAYLOAD" "$SESSION_ID"
fi
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

We'll modify `post-tool-use.sh` in the lab repo. The vanilla hook already extracts
`RESULT_TYPE` from stdin — we just need to replace the plain append block with a
branching emit.

**Step 1 — Open the hook:**

```bash
nano /tmp/copilot-hooks-lab/.github/hooks/visualizer/post-tool-use.sh
```

or modify it in an IDE like VSCode

**Step 2 — Find the vanilla append block at the bottom of the file:**

```bash
jq -n \
  --arg event "postToolUse" \
  --arg ts "$TIMESTAMP" \
  --arg tool "$TOOL_NAME" \
  --arg result "$RESULT_TYPE" \
  --arg cwd "$CWD" \
  '{event: $event, timestamp: $ts, toolName: $tool, resultType: $result, cwd: $cwd}' \
  >> "$LOG_DIR/events.jsonl"
```

**Step 3 — Replace it with this branching emit block:**

```bash
SESSION_ID=${COPILOT_SESSION_ID:-"lab-$(date +%s)"}

if [ "$RESULT_TYPE" = "failure" ] || [ "$RESULT_TYPE" = "denied" ]; then
  PAYLOAD_JSON=$(jq -nc \
    --arg tool "$TOOL_NAME" \
    --arg status "$RESULT_TYPE" \
    '{"toolName":$tool,"status":$status}')
  .visualizer/emit-event.sh postToolUseFailure "$PAYLOAD_JSON" "$SESSION_ID"
else
  PAYLOAD_JSON=$(jq -nc \
    --arg tool "$TOOL_NAME" \
    --arg status "success" \
    '{"toolName":$tool,"status":$status}')
  .visualizer/emit-event.sh postToolUse "$PAYLOAD_JSON" "$SESSION_ID"
fi
```

> **Prerequisite:** `.visualizer/emit-event.sh` only exists after a full (non-vanilla)
> bootstrap. To test the branching logic now, replace the `.visualizer/emit-event.sh`
> calls with `echo "EVENT: $PAYLOAD_JSON"` temporarily, then restore them once you
> run the full bootstrap in Part 5.

**Step 4 — Test both paths directly (no real CLI session needed):**

```bash
SESSION_ID="synth-demo"

# Simulate a success
echo '{"toolName":"bash","toolResult":{"resultType":"success"}}' \
  | COPILOT_SESSION_ID="$SESSION_ID" bash /tmp/copilot-hooks-lab/.github/hooks/visualizer/post-tool-use.sh

# Simulate a failure
echo '{"toolName":"bash","toolResult":{"resultType":"failure"}}' \
  | COPILOT_SESSION_ID="$SESSION_ID" bash /tmp/copilot-hooks-lab/.github/hooks/visualizer/post-tool-use.sh
```

If you are temporarily using `echo` instead of `.visualizer/emit-event.sh`, you should see two different payloads — one routed to `postToolUse`, one to `postToolUseFailure`.

If you are already writing to `.visualizer/logs/events.jsonl`, the log may also contain earlier events from other experiments. Filter by the fixed `SESSION_ID` you set above.

**Step 5 — After a real CLI session, verify both event types appear:**

```bash
tail -n 50 /tmp/copilot-hooks-lab/.visualizer/logs/events.jsonl \
  | jq -r 'select(.sessionId=="'"$SESSION_ID"'") | .eventType'
```

For the direct simulation above, expected output is:

```text
postToolUse
postToolUseFailure
```

If you inspect the full log without filtering, you may also see unrelated `preToolUse` events from earlier Copilot activity in the same repo.

**Step 6 (Bonus) — Sketch `subagentStart` synthesis:** Vanilla hooks have no
`subagentStart` event. A `preToolUse` for `toolName:"task"` followed by a `postToolUse`
for the same tool signals that a subagent was dispatched.

Here is the **success branch before** adding the synthetic subagent event:

```bash
else
  PAYLOAD_JSON=$(jq -nc \
    --arg tool "$TOOL_NAME" \
    --arg status "success" \
    '{"toolName":$tool,"status":$status}')
  .visualizer/emit-event.sh postToolUse "$PAYLOAD_JSON" "$SESSION_ID"
fi
```

Replace that success branch with this version:

```bash
else
  PAYLOAD_JSON=$(jq -nc \
    --arg tool "$TOOL_NAME" \
    --arg status "success" \
    '{"toolName":$tool,"status":$status}')
  .visualizer/emit-event.sh postToolUse "$PAYLOAD_JSON" "$SESSION_ID"

  if [ "$TOOL_NAME" = "task" ]; then
    AGENT_NAME=$(echo "$INPUT" | jq -r '.toolArgs.agent_type // .toolArgs.agentName // empty')
    SYNTH_PAYLOAD=$(jq -nc \
      --arg agent "$AGENT_NAME" \
      '{"agentName":$agent}')
    .visualizer/emit-event.sh subagentStart "$SYNTH_PAYLOAD" "$SESSION_ID"
  fi
fi
```

If you want to simulate it directly, send a fake successful `task` tool result through the hook:

```bash
SESSION_ID="subagent-demo"

echo '{"toolName":"task","toolArgs":{"agent_type":"Explore"},"toolResult":{"resultType":"success"}}' \
  | COPILOT_SESSION_ID="$SESSION_ID" bash /tmp/copilot-hooks-lab/.github/hooks/visualizer/post-tool-use.sh
```

Then verify that the same session produced both the task completion and the synthesized start event:

These synthesized events are written to `.visualizer/logs/events.jsonl`, not the vanilla `.github/hooks/logs/events.jsonl` file.

```bash
tail -n 50 /tmp/copilot-hooks-lab/.visualizer/logs/events.jsonl \
  | jq -r 'select(.sessionId=="'"$SESSION_ID"'") | [.eventType, (.payload.toolName // .payload.agentName // "")] | @tsv'
```

Expected output will include both events for the same `sessionId`. A real run looks like this:

```json
{"schemaVersion":"1.0.0","eventId":"ee68fda2-2773-4b66-977a-85b5adc8e620","eventType":"postToolUse","timestamp":"2026-04-16T21:17:12.429Z","sessionId":"subagent-demo","source":"copilot-cli","repoPath":"/tmp/copilot-hooks-lab","payload":{"toolName":"task","status":"success"}}
{"schemaVersion":"1.0.0","eventId":"85ae3553-c849-4d68-9928-abb252c44115","eventType":"subagentStart","timestamp":"2026-04-16T21:17:13.445Z","sessionId":"subagent-demo","source":"copilot-cli","repoPath":"/tmp/copilot-hooks-lab","payload":{"agentName":"Explore"}}
```

In a larger real prompt that used both `task` and `skill`, the same pattern still held:

- `preToolUse` for `task` (`agent_type:"explore"`) was followed by `postToolUse` for `task`
- then the hook synthesized `subagentStart` with `agentName:"explore"`
- `skill` completed as normal `postToolUse` and did **not** synthesize `subagentStart`

This is expected because this tutorial's synthesis rule is intentionally scoped to
`TOOL_NAME="task"` only.

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

Example (abridged):

```json
{"event":"userPromptSubmitted","prompt":"I would like to test you running a subagent that is looking for info on what we can do with postTool use and another agent creating a readme for this repo"}
{"event":"agentStop","rawPayload":{"sessionId":"b24e89d8-78ab-4fa4-9565-339d225182c6","stopReason":"end_turn"}}
{"event":"subagentStop","rawPayload":{"sessionId":"b24e89d8-78ab-4fa4-9565-339d225182c6","agentName":"explore","stopReason":"end_turn"}}
{"event":"userPromptSubmitted","prompt":"<system_notification> Agent \"posttooluse-research\" (explore) has finished processing and is now idle... </system_notification>"}
```

In `.visualizer/logs/events.jsonl`, the same run can include synthesized
`subagentStart` events (from `task` success), giving you both lifecycle edges:

- synthesized start: `subagentStart`
- native stop: `subagentStop`

This is the key value of synthesis: a complete subagent timeline even when the
source hooks only provide stop semantics.

### Optional visualizer checkpoint

Run the optional checkpoint from [From Vanilla to Visualizer](../from-vanilla-to-visualizer.md).
After this part, look for synthesized events such as `postToolUseFailure` and
`subagentStart` in the live timeline.

---

Prev: [Part 3](part-3.md) | Up: [From Vanilla to Visualizer](../from-vanilla-to-visualizer.md) | Next: [Part 5](part-5.md)
