# Part 2: Adding Schema & Validation

Prev: [Part 1](part-1.md) | Up: [From Vanilla to Visualizer](../from-vanilla-to-visualizer.md) | Next: [Part 3](part-3.md)


### The problem with raw payloads

Vanilla hooks log whatever the CLI sends. This works for simple logging, but
falls apart when you try to build anything on top of the data:

- **No common shape.** Each hook has its own payload structure. A consumer has
  to handle 8 different shapes with no shared fields.
- **No validation.** If the payload is malformed or missing fields, you won't
  know until something downstream breaks.
- **No versioning.** When the payload format changes (and it will), there's no
  way to tell old format from new.

### The solution: an event envelope

We wrapped every event in a common envelope:

```json
{
  "schemaVersion": "1.0.0",
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "eventType": "preToolUse",
  "timestamp": "2026-04-12T20:55:31.123Z",
  "sessionId": "abc-123",
  "source": "copilot-cli",
  "repoPath": "/path/to/repo",
  "payload": {
    "toolName": "bash",
    "toolArgs": { "command": "npm test" }
  }
}
```

Every event now has:

| Field | Why It Matters |
|-------|---------------|
| `schemaVersion` | Consumers can handle format changes gracefully |
| `eventId` | Every event is uniquely identifiable (UUID) |
| `eventType` | Consumers dispatch on a single field, not payload shape |
| `timestamp` | ISO 8601 string, not a Unix millisecond integer |
| `sessionId` | All events in a session share this — enables session grouping |
| `source` | Always `"copilot-cli"` — makes multi-source ingestion possible |
| `repoPath` | Ties the event to a specific repository |
| `payload` | The hook-specific data, validated per event type |
| `turnId` *(optional)* | Groups all events within one user-prompt turn |
| `traceId` *(optional)* | Links events belonging to one logical operation chain |
| `spanId` / `parentSpanId` *(optional)* | Forms a span tree for nested tool calls |

The `turnId`, `traceId`, `spanId`, and `parentSpanId` fields are part of **Tracing v2**.
They are fully optional — the ingest service pairs tool events without them using a
FIFO heuristic fallback. Emit them when your hook environment can supply them for
exact pairing. See [Tracing Plan v2](../../roadmap/tracing-plan.md) for the full design.

### Try it yourself

1. Pick one vanilla hook script (for example, `pre-tool-use.sh`).
2. Keep the existing parsing logic. Only replace the final append block.

  ```bash
  # Replace this vanilla append block:
  jq -n \
    --arg event "preToolUse" \
    --arg ts "$TIMESTAMP" \
    --arg tool "$TOOL_NAME" \
    --arg args "$TOOL_ARGS" \
    --arg cwd "$CWD" \
    '{event: $event, timestamp: $ts, toolName: $tool, toolArgs: $args, cwd: $cwd}' \
    >> "$LOG_DIR/events.jsonl"
  ```

  with this enhanced append block:

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

  In the vanilla example, this goes directly after:

  ```bash
  LOG_DIR=".github/hooks/logs"
  mkdir -p "$LOG_DIR"
  ```

 You can test the emitter directly — no real
  Copilot CLI run needed:

  ```bash
  # Run this from inside a bootstrapped repo (not the throwaway lab)
  SESSION_ID="lab-$(date +%s)"
  .visualizer/emit-event.sh preToolUse '{"toolName":"bash","toolArgs":{"command":"npm test"}}' "$SESSION_ID"
  ```

  > **Note:** If you are on Windows, use the PowerShell tutorial track instead.
  > Bash commands like `SESSION_ID="lab-$(date +%s)"` do not work in PowerShell.
  > See [From Vanilla to Visualiser (PowerShell)](../../from-vanilla-to-visualizer-ps1.md).

3. Trigger the hook once with a known-good payload.
4. Confirm the JSONL line now includes envelope fields like `schemaVersion`,
   `eventId`, and `sessionId`.

   A successful emit produces a line like this in `.visualizer/logs/events.jsonl`:

   ```json
   {
     "schemaVersion": "1.0.0",
     "eventId": "b8c377a9-e6e4-44af-aeef-dfbe6f3497af",
     "eventType": "preToolUse",
     "timestamp": "2026-04-16T20:39:16.689Z",
     "sessionId": "lab-1776371955",
     "source": "copilot-cli",
     "repoPath": "/tmp/copilot-hooks-lab",
     "payload": {
       "toolName": "bash",
       "toolArgs": { "command": "npm test" }
     }
   }
   ```

   Compare this to the vanilla `preToolUse` output from Part 1 — same event, but
   now every field is normalised, versioned, and uniquely identified.

   If you run a real Copilot CLI session with the modified hook, you'll see something like this:

   ```json
   {"schemaVersion":"1.0.0","eventId":"7b3f2d1f-...","eventType":"preToolUse","timestamp":"2026-04-16T20:41:54.696Z","sessionId":"lab-1776372113","source":"copilot-cli","repoPath":"/tmp/copilot-hooks-lab","payload":{"toolName":"report_intent","toolArgs":{"intent":"Examining available hooks"}}}
   {"schemaVersion":"1.0.0","eventId":"22823d99-...","eventType":"preToolUse","timestamp":"2026-04-16T20:41:55.659Z","sessionId":"lab-1776372114","source":"copilot-cli","repoPath":"/tmp/copilot-hooks-lab","payload":{"toolName":"view","toolArgs":{"path":"/tmp/copilot-hooks-lab/.github/hooks/visualizer"}}}
   ```

   > **Spot the problem:** Every event has a *different* `sessionId`. That's because
   > `SESSION_ID=${COPILOT_SESSION_ID:-"lab-$(date +%s)"}` generates a new timestamp on
   > each hook invocation. Events from the same session are still not correlated.
   >
   > The full visualiser solves this by extracting the real `sessionId` from the
   > `agentStop` event (which is the only hook that carries it natively) and backfilling
   > it across all events. That's covered in Part 4.
5. Trigger a malformed payload directly via the emitter, for example:

  ```bash
  SESSION_ID="lab-$(date +%s)"
  .visualizer/emit-event.sh preToolUse '{"toolName":123}' "$SESSION_ID"
  ```

  This fails schema validation because `toolName` must be a string.
  Verify it was rejected by checking that no new line was appended for that
  failed command.

Optional verify commands:

```bash
# Show the newest enriched line and verify envelope fields exist
tail -n 1 .visualizer/logs/events.jsonl | jq '{schemaVersion, eventId, sessionId, eventType}'
```

### Zod schemas

We used [Zod](https://zod.dev/) for runtime validation. Each event type has
its own payload schema:

```typescript
// shared/event-schema/src/schema.ts (simplified)
const PreToolUsePayload = z.object({
  toolName: z.string().min(1),
  toolArgs: z.record(z.string(), z.unknown()).optional(),
});

const PostToolUsePayload = z.object({
  toolName: z.string().min(1),
  status: z.literal("success"),
  durationMs: z.number().int().nonnegative().optional(),
});
```

If an event doesn't match its schema, it's **rejected** — not silently
swallowed. The emitter returns `{ accepted: false, error: "..." }` and the
event never hits the log file.

### What changed from vanilla

```diff
 # Vanilla: log the raw JSON as-is
-echo "$INPUT" >> events.jsonl
+
+# Enhanced: wrap in envelope, validate, then persist
+.visualizer/emit-event.sh preToolUse "$PAYLOAD_JSON" "$SESSION_ID"
```

The hook script no longer writes directly to a log file. Instead, it calls the
emit script, which validates, wraps in an envelope, redacts secrets, and
appends to JSONL.

### Optional visualizer checkpoint

Run the optional checkpoint from [From Vanilla to Visualizer](../from-vanilla-to-visualizer.md).
After this part, you should start seeing envelope-based `preToolUse` events in
the visualizer flow (while other hooks may still be vanilla).

---

Prev: [Part 1](part-1.md) | Up: [From Vanilla to Visualizer](../from-vanilla-to-visualizer.md) | Next: [Part 3](part-3.md)
