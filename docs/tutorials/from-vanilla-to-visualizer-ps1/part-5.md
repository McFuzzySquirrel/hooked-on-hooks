# Part 5: The Emit Pattern

Prev: [Part 4](part-4.md) | Up: [From Vanilla to Visualizer (PowerShell)](../from-vanilla-to-visualizer-ps1.md) | Next: [Part 6](part-6.md)


### Architecture: emit and forget

The vanilla approach writes directly to a log file. The visualizer separates
**capture** from **delivery**:

```
Hook script → emit-event.ps1 → emit-event-cli.ts → { JSONL file + HTTP POST }
```

1. **Hook script** extracts fields and builds the payload
2. **`emit-event.ps1`** is a thin PowerShell wrapper that calls the TypeScript emitter
3. **`emit-event-cli.ts`** validates, wraps in envelope, redacts secrets, then:
   - **Always:** appends to `.visualizer/logs/events.jsonl`
   - **Optionally:** POSTs to `http://127.0.0.1:7070/events` (the ingest service)

### JSONL is the source of truth

The JSONL file is append-only and always written. HTTP delivery is best-effort:

```typescript
// packages/hook-emitter/src/index.ts (simplified)
// 1. Always write to JSONL
await fs.appendFile(jsonlPath, JSON.stringify(event) + "\n");

// 2. Optionally POST to HTTP (swallow errors)
try {
  await fetch(httpEndpoint, { method: "POST", body: JSON.stringify(event) });
} catch {
  // Silently swallow — event is already persisted in JSONL
}
```

### Optional correlation IDs (Tracing v2)

The emitter accepts optional correlation fields in `EmitOptions` that are
stamped into the event envelope before writing:

```typescript
import { emitEvent } from "@visualizer/hook-emitter";

await emitEvent("preToolUse", payload, sessionId, {
  turnId:       process.env.COPILOT_TURN_ID,
  traceId:      process.env.COPILOT_TRACE_ID,
  spanId:       process.env.COPILOT_SPAN_ID,
  parentSpanId: process.env.COPILOT_PARENT_SPAN_ID,
});
```

All fields are optional. If your hook environment doesn't supply them, the
ingest service still pairs `preToolUse` → `postToolUse` events using a
FIFO heuristic fallback. Supplying a `toolCallId` in the payload gives the
precisest pairing with no heuristic needed.

The live pairing breakdown is visible in the web UI's **Tool Pairing** bar
(polling `GET /diagnostics/pairing`) so you can see how much of your session
is exact-matched vs. heuristic-matched at a glance.

![Tool Pairing tooltip showing exact `toolCallId` correlation](../assets/tutorial-screenshots/ui-features/ui-pairing-tooltip.png)

In the screenshot above, the hover tooltip explains why `by ID` is the
highest-confidence match class: both tool lifecycle events carried the same
`toolCallId`, so ingest did not need to fall back to `spanId` or FIFO pairing.

If the ingest service is down, events pile up in the JSONL file. When it comes
back, you can replay them:

```powershell
npm run replay:jsonl -- /path/to/events.jsonl
```

You do **not** need the visualizer app running to validate this part. The core
goal is proving local JSONL persistence even when HTTP delivery fails.

### Redaction

Before writing to JSONL, the emitter runs a redaction pass that strips:

- API keys and tokens → `[REDACTED]`
- Patterns matching common secret formats
- Prompt bodies (opt-in only — off by default)

The golden rule: **the default must be safe.** Operators opt *in* to storing
sensitive data, never opt *out*.

### What changed from vanilla

```diff
 # Vanilla: one line, direct to file
-Add-Content -Path .github/hooks/logs/events.jsonl -Value $logEntry
+
+# Enhanced: validate -> redact -> JSONL + optional HTTP
+& .visualizer\emit-event.ps1 -EventType preToolUse -Payload $payloadJson -SessionId $SessionId
```

In PowerShell hooks, use `try/catch` around emits (or tolerate non-fatal
emit failures) so hook telemetry issues don't crash the host process.

### Try it yourself

Part 1 bootstrapped the lab in vanilla mode, and Parts 2-4 continued from that setup.
In current builds, vanilla bootstrap
already creates `.visualizer/emit-event.ps1`. Verify first:

```powershell
Test-Path "$env:TEMP\copilot-hooks-lab\.visualizer\emit-event.ps1"
```

If the file is missing in your environment, run:

```powershell
npx tsx scripts/bootstrap-existing-repo.ts "$env:TEMP\copilot-hooks-lab" --create-hooks
```

Then run this sequence:

1. Point HTTP delivery to a non-listening endpoint.
2. Emit an event while HTTP is effectively down.
3. Confirm the event still appends to `.visualizer/logs/events.jsonl`.
4. Optional: if you later run ingest, replay the saved JSONL file.
5. Optional: verify replay restores events downstream.

Reliable way to simulate HTTP down while preserving JSONL writes:

```powershell
$SessionId = "offline-" + [int](Get-Date -UFormat %s)
Set-Location "$env:TEMP\copilot-hooks-lab"

$env:VISUALIZER_HTTP_ENDPOINT = "http://127.0.0.1:9999/events"
& .visualizer\emit-event.ps1 -EventType sessionStart -Payload '{}' -SessionId $SessionId
Remove-Item Env:VISUALIZER_HTTP_ENDPOINT
```

Verify the event was still persisted locally:

```powershell
Get-Content "$env:TEMP\copilot-hooks-lab\.visualizer\logs\events.jsonl" -Tail 30 |
  ForEach-Object { $_ | ConvertFrom-Json } |
  Where-Object { $_.sessionId -eq $SessionId } |
  Select-Object -ExpandProperty eventType
```

Replay once ingest is back:

```powershell
npm run replay:jsonl -- "$env:TEMP\copilot-hooks-lab\.visualizer\logs\events.jsonl"
```

If ingest is not running yet, you can stop after the JSONL verification step.

### Optional visualizer checkpoint

Run the optional checkpoint from [From Vanilla to Visualizer (PowerShell)](../from-vanilla-to-visualizer-ps1.md).
This part is still valid without the app running, but if ingest is up you can
visually confirm replayed events reappear downstream.

![Filters panel for isolating event types and actors during replay](../assets/tutorial-screenshots/ui-features/ui-filter-controls.png)

---

Prev: [Part 4](part-4.md) | Up: [From Vanilla to Visualizer (PowerShell)](../from-vanilla-to-visualizer-ps1.md) | Next: [Part 6](part-6.md)
