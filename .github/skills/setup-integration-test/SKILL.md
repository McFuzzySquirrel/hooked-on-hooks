---
name: setup-integration-test
description: >
  Process for creating a fixture-driven integration test that exercises the
  full hook-emitter → JSONL → ingest-service → state-machine → web-UI pipeline
  for the Copilot Activity Visualiser. Use this skill whenever you need
  to write an end-to-end integration test without requiring a live Copilot CLI
  session or a running browser.
---

# Skill: Set Up a Fixture-Based Integration Test

Integration tests for the Copilot Activity Visualiser verify that
events flow correctly through the entire pipeline from emission to state
derivation. Because the pipeline spans four packages, integration tests use
pre-built JSONL fixture files and mock transports rather than real CLI runs.

---

## Step 1: Choose the Test Scope and Select a Fixture Session

Decide which pipeline segment(s) the test should cover:

| Scope | Pipeline Covered | Use When |
|-------|-----------------|----------|
| Unit integration | State machine only | Verifying determinism or new transition rules |
| Service integration | Ingest service + state machine | Verifying file watcher, parsing, and state update |
| Full pipeline | Emitter → JSONL → ingest → state → state push | Verifying end-to-end event flow |
| UI integration | State push → React UI | Verifying UI responds to state changes (no CLI needed) |

Select or create a JSONL fixture file from `tests/fixtures/sessions/`:

- `happy-path.jsonl` — Normal session: sessionStart → preToolUse → postToolUse → agentStop
- `failure-path.jsonl` — Session with error: sessionStart → preToolUse → postToolUseFailure → errorOccurred → agentStop
- `subagent-path.jsonl` — Session with subagent: sessionStart → subagentStart → preToolUse → postToolUse → subagentStop → agentStop
- `large-session.jsonl` — 10k+ event session for performance tests

If none of these match your test scenario, create a new fixture (see Step 2).

---

## Step 2: Create a Fixture JSONL File (if needed)

Use the `makeEvent` factory to generate a sequence of events and serialize
them to a JSONL file:

```typescript
// tests/fixtures/sessions/my-scenario.jsonl.ts (generate script)
import { makeEvent } from "../makeEvent.js";
import { writeFileSync } from "node:fs";

const events = [
  makeEvent("sessionStart", { sessionId: "fixture-session-1" }),
  makeEvent("preToolUse", { sessionId: "fixture-session-1", agentId: "agent-1" }),
  makeEvent("postToolUse", { sessionId: "fixture-session-1", agentId: "agent-1" }),
  makeEvent("agentStop", { sessionId: "fixture-session-1" }),
];

const jsonl = events.map((e) => JSON.stringify(e)).join("\n");
writeFileSync("tests/fixtures/sessions/my-scenario.jsonl", jsonl, "utf8");
```

Run the generator once, commit the `.jsonl` output file, and delete the
generator script. The fixture file is the artifact — not the generator.

**Tip:** All fixtures must contain fully-redacted events (no sensitive fields).
Pass each event through `applyRedaction` in the generator before serializing.

---

## Step 3: Write the Integration Test

### Option A — State Machine Integration (Vitest, no I/O)

Tests `rebuildState` in isolation. No filesystem or network required.

```typescript
// shared/state-machine/test/my-scenario.integration.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEvent } from "../../event-schema/src/index.js";
import { rebuildState } from "../src/index.js";

describe("my-scenario: state machine integration", () => {
  it("produces correct final state from fixture session", () => {
    const raw = readFileSync(
      join(__dirname, "../../../tests/fixtures/sessions/my-scenario.jsonl"),
      "utf8"
    );

    const events = raw
      .trim()
      .split("\n")
      .map((line) => parseEvent(JSON.parse(line)))
      .filter((result) => result.ok)
      .map((result) => result.value);

    const finalState = rebuildState(events);

    expect(finalState.lifecycle).toBe("completed");
    expect(finalState.agents["agent-1"].status).toBe("idle");
    // Add additional assertions matching the fixture sequence
  });

  it("is deterministic: identical inputs produce identical outputs", () => {
    const raw = readFileSync(
      join(__dirname, "../../../tests/fixtures/sessions/my-scenario.jsonl"),
      "utf8"
    );
    const events = raw
      .trim()
      .split("\n")
      .map((line) => parseEvent(JSON.parse(line)).value!);

    const run1 = rebuildState(events);
    const run2 = rebuildState(events);
    const run3 = rebuildState(events);

    expect(run1).toEqual(run2);
    expect(run2).toEqual(run3);
  });
});
```

### Option B — Ingest Service Integration (Vitest, filesystem)

Tests the file watcher and parsing pipeline against a real fixture JSONL file.

```typescript
// packages/ingest-service/test/my-scenario.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWatcher, stopWatcher } from "../src/watcher.js";

describe("my-scenario: ingest service integration", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "visualizer-test-"));
    copyFileSync(
      join(__dirname, "../../../tests/fixtures/sessions/my-scenario.jsonl"),
      join(tmpDir, "session.jsonl")
    );
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses all events from fixture JSONL and derives final state", async () => {
    const stateUpdates: SessionState[] = [];

    const watcher = await startWatcher(join(tmpDir, "session.jsonl"), {
      onStateUpdate: (state) => stateUpdates.push(state),
    });

    // Allow the watcher to process the existing file and emit state updates
    await new Promise((resolve) => setTimeout(resolve, 200));
    await stopWatcher(watcher);

    const finalState = stateUpdates.at(-1);
    expect(finalState?.lifecycle).toBe("completed");
  });
});
```

### Option C — UI Integration (Vitest + React Testing Library, mock SSE)

Tests that the `<LiveBoard>` React component responds correctly to state
changes delivered over a mocked SSE stream.

```typescript
// packages/web-ui/test/live-board.integration.test.tsx
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { LiveBoard } from "../src/live/LiveBoard.js";
import { MockStateStream } from "../../tests/fixtures/MockStateStream.js";

describe("LiveBoard: integration with state stream", () => {
  it("renders tool_running state when preToolUse event arrives", async () => {
    const stream = new MockStateStream();
    render(<LiveBoard stateStream={stream} />);

    await act(async () => {
      stream.emit({ agents: { "agent-1": { status: "tool_running" } } });
    });

    expect(screen.getByRole("status", { name: /agent-1/i })).toHaveClass(
      "tile--tool-running"
    );
  });
});
```

---

## Step 4: Run and Validate

```bash
# Run all integration tests for a specific package
npm run test --workspace=packages/ingest-service

# Run all integration tests across the workspace
npm run test

# Run with coverage to confirm integration tests contribute to the gate
npm run test -- --coverage
```

Confirm:
- All assertions pass.
- Coverage on the tested modules increases.
- The test completes in under 5 seconds (integration tests should be fast).
- No files are left in `tmp` directories after the test runs (verify `afterAll` cleanup).

---

## Step 5: Add to CI

Integration tests run automatically via the `npm run test` command already
wired in `.github/workflows/ci.yml` by `project-architect`. No additional CI
configuration is required as long as your test file uses the `.integration.test.ts`
naming convention and lives inside a `test/` directory under a workspace package.

If your integration test requires a longer timeout (e.g., large fixture files),
configure it at the test level:

```typescript
it("processes 10k+ events within acceptable latency", { timeout: 10_000 }, async () => {
  // ...
});
```

---

## Reference

See the following documents for test strategy requirements:

- [Product Vision](../../../docs/product-vision.md) — §7 Non-Functional Requirements (NF-01 latency, NF-02 reliability, NF-03 responsiveness), §11 Success Metrics
- [Feature: Foundation Event Capture](../../../docs/features/foundation-event-capture.md) — §6 Testing Strategy, key test scenarios 1–4
- [Feature: Deterministic State Engine](../../../docs/features/deterministic-state-engine.md) — §6 Testing Strategy, key test scenarios 1–3
- [Feature: Live Visualization Board](../../../docs/features/live-visualization-board.md) — §6 Testing Strategy, key test scenarios 1–3
- [Feature: Replay and Session Review](../../../docs/features/replay-and-session-review.md) — §6 Testing Strategy, key test scenarios 1–3
- [Feature: Privacy Retention and Export Controls](../../../docs/features/privacy-retention-and-export-controls.md) — §6 Testing Strategy, key test scenarios 1–4
