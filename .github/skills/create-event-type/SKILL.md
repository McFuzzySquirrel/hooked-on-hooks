---
name: create-event-type
description: >
  Step-by-step process for adding a new event type to the Copilot Agent
  Activity Visualizer. Touches four locations in sequence: event schema
  definition, hook emitter registration, state machine transition handling,
  and web UI rendering rule. Use this skill whenever a new lifecycle event
  type needs to be introduced beyond the MVP set.
---

# Skill: Create a New Event Type

Adding a new event type to the Copilot Activity Visualiser requires
coordinated changes across four packages in a specific order. This skill
walks through each step with the correct sequence, templates, and validation
checkpoints so nothing is missed.

---

## Step 1: Define the Event Schema

Open `shared/event-schema/src/schema.ts`.

Add a new Zod schema for the event payload, then add it to the discriminated
union:

```typescript
// 1. Define the new payload schema
const MyNewEventPayload = z.object({
  // Add all fields specific to this event type
  agentId: z.string(),
  customField: z.string().optional(),
});

// 2. Define the envelope variant
const MyNewEvent = EventEnvelopeBase.extend({
  type: z.literal("myNewEventType"),
  payload: MyNewEventPayload,
});

// 3. Add to the discriminated union (in the z.discriminatedUnion call)
// Before:
//   z.discriminatedUnion("type", [SessionStartEvent, PreToolUseEvent, ...])
// After:
//   z.discriminatedUnion("type", [SessionStartEvent, PreToolUseEvent, ..., MyNewEvent])
```

Export the new type inference:

```typescript
export type MyNewEvent = z.infer<typeof MyNewEvent>;
```

**Validation checkpoint:** Run `npm run typecheck` in `shared/event-schema/`. Zero errors required before proceeding.

---

## Step 2: Register the Hook Emitter

Open `packages/hook-emitter/src/hooks.ts`.

Register a new hook callback for the event and emit a schema-compliant
envelope:

```typescript
import { applyRedaction } from "../../shared/redaction/src/index.js";
import { writeJsonlEvent } from "./transport/jsonl.js";

copilotHooks.on("myNewEventType", async (rawPayload) => {
  const event: MyNewEvent = {
    id: generateUUID(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    sessionId: getCurrentSessionId(),
    timestamp: new Date().toISOString(),
    type: "myNewEventType",
    payload: {
      agentId: rawPayload.agentId,
      customField: rawPayload.customField,
    },
  };

  // Always apply redaction before any write
  const redacted = applyRedaction(event);
  await writeJsonlEvent(redacted);
});
```

**Validation checkpoint:**
- Run `npm run typecheck` in `packages/hook-emitter/`.
- Add a Vitest unit test in `packages/hook-emitter/test/` confirming the new event type produces a valid redacted envelope.

---

## Step 3: Handle the Transition in the State Machine

Open `shared/state-machine/src/reducer.ts`.

Add a `case` branch to the `switch (event.type)` block in `reduceEvent`:

```typescript
case "myNewEventType": {
  // Determine which state this event maps to.
  // Refer to Product Vision §10.3 or the event spec for the correct target state.
  const agentKey = event.payload.agentId;
  return {
    ...state,
    agents: {
      ...state.agents,
      [agentKey]: {
        ...state.agents[agentKey],
        status: "tool_running", // replace with the correct target state
      },
    },
  };
}
```

**Important:** The `switch` must remain exhaustive. If TypeScript reports an unreachable default branch, the union coverage is correct. If the `default` branch is still reachable, the new event type was not added to the discriminated union in Step 1.

**Validation checkpoint:**
- Run `npm run typecheck` in `shared/state-machine/`.
- Add a Vitest determinism fixture test: apply the new event type to a baseline state and assert the output matches the expected state. Run the assertion three times to confirm determinism.

---

## Step 4: Add the UI Rendering Rule

Open `packages/web-ui/src/live/StateTile.tsx`.

Add the new state mapping to the tile renderer:

```typescript
// In the stateTileConfig map or switch:
case "myNewEventType":
  return {
    label: "My New State",           // Screen-reader accessible label (ACC-03)
    cssClass: "tile--my-new-state",  // Define in StateTile.css
    ariaLive: "polite",
  };
```

Add the CSS definition in `packages/web-ui/src/live/StateTile.css`:

```css
.tile--my-new-state {
  background-color: var(--color-my-new-state);
  /* Verify contrast meets WCAG 2.1 AA against the board background (ACC-01) */
}

@media (prefers-reduced-motion: reduce) {
  .tile--my-new-state {
    animation: none; /* Replace any animation with a static indicator */
  }
}
```

Define the CSS custom property in the design tokens file:

```css
:root {
  --color-my-new-state: #xxxxxx; /* Pick a color that meets AA contrast */
}
```

**Validation checkpoint:**
- Run `npm run typecheck` in `packages/web-ui/`.
- Add a Vitest component test in `packages/web-ui/test/` confirming the new tile renders with the correct CSS class.
- Visually inspect the tile in the dev server (`npm run dev` in `packages/web-ui/`).
- Check contrast ratio with a browser accessibility inspector tool.

---

## Step 5: Update the Test Fixture Factory

Open `tests/fixtures/makeEvent.ts`.

Add the new event type to the `makeEvent` factory so all existing integration
tests and any future tests can produce instances of it:

```typescript
case "myNewEventType":
  return {
    ...baseEnvelope,
    type: "myNewEventType",
    payload: {
      agentId: overrides?.agentId ?? "agent-fixture-1",
      customField: overrides?.customField,
    },
  };
```

Run the full test suite to confirm no existing tests are broken by the new
discriminated union branch:

```bash
npm run test
```

---

## Step 6: Validate End-to-End

Run the integration test harness (see `setup-integration-test` skill) with a
fixture session that includes the new event type. Confirm:

1. The new event appears in the JSONL output with a valid envelope.
2. The state machine transitions to the correct state on ingestion.
3. The live board displays the new tile correctly.
4. The replay timeline includes and correctly plays back the new event.
5. Redaction applies correctly (no sensitive fields in the JSONL output).

---

## Reference

See the following documents for event type requirements and state mapping rules:

- [Product Vision](../../../docs/product-vision.md) — §10 System States/Lifecycle (transition rules), §8 Security and Privacy (redaction requirements)
- [Feature: Foundation Event Capture](../../../docs/features/foundation-event-capture.md) — §3 FND-FR-01 (event type registry), §3 FND-FR-05 (schema compatibility)
- [Feature: Deterministic State Engine](../../../docs/features/deterministic-state-engine.md) — §3 STAT-FR-01 (transition mapping), §3 STAT-FR-02 (determinism)
- [docs/specs/event-schema.md](../../../docs/specs/event-schema.md) — Canonical event envelope and field definitions
