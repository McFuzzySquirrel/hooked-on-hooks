import { describe, it, expect } from "vitest";
import { reduceEvent, rebuildState, initialSessionState } from "../src/index.js";
import type { SessionState } from "../src/index.js";
import type { EventEnvelope } from "../../event-schema/src/index.js";

// ---------------------------------------------------------------------------
// Fixture helpers — produce schema-compliant EventEnvelope records without I/O
// ---------------------------------------------------------------------------

const SESSION_ID = "sess-test-001";
const REPO = "/tmp/test-repo";
const SOURCE = "copilot-cli" as const;
const SCHEMA_V = "1.0.0";

let seq = 0;
function nextId(): string {
  seq++;
  const hex = seq.toString(16).padStart(8, "0");
  return `${hex}-0000-4000-8000-000000000000`;
}
function ts(offset = 0): string {
  return new Date(1_700_000_000_000 + offset * 1000).toISOString();
}

function makeEvent<T extends EventEnvelope["eventType"]>(
  eventType: T,
  payload: Extract<EventEnvelope, { eventType: T }>["payload"],
  offset = 0,
): Extract<EventEnvelope, { eventType: T }> {
  return {
    schemaVersion: SCHEMA_V,
    eventId: nextId(),
    eventType,
    timestamp: ts(offset),
    sessionId: SESSION_ID,
    source: SOURCE,
    repoPath: REPO,
    payload,
  } as Extract<EventEnvelope, { eventType: T }>;
}

// ---------------------------------------------------------------------------
// A representative sequence covering all 11 event types in lifecycle order
// ---------------------------------------------------------------------------

function buildFullSequence(): EventEnvelope[] {
  return [
    makeEvent("sessionStart",          {},                                             0),
    makeEvent("userPromptSubmitted",   { prompt: "List files" },                      1),
    makeEvent("preToolUse",            { toolName: "read_file", toolArgs: { f: "x" } }, 2),
    makeEvent("postToolUse",           { toolName: "read_file", status: "success", durationMs: 42 }, 3),
    makeEvent("subagentStart",         { agentName: "sub-1", agentDisplayName: "Sub One", agentDescription: "Subagent research", message: "Inspect the repo", summary: "Inspect the repo" }, 4),
    makeEvent("subagentStop",          { agentName: "sub-1" },                        5),
    makeEvent("preToolUse",            { toolName: "write_file" },                    6),
    makeEvent("postToolUseFailure",    { toolName: "write_file", status: "failure", errorSummary: "Permission denied" }, 7),
    makeEvent("notification",          { notificationType: "info", title: "T", message: "M" }, 8),
    makeEvent("errorOccurred",         { message: "fatal error", code: "E1" },        9),
    makeEvent("agentStop",             { agentName: "main-agent" },                   10),
    makeEvent("sessionEnd",            {},                                             11),
  ];
}

// ---------------------------------------------------------------------------
// STAT-FR-02 — Determinism
// ---------------------------------------------------------------------------

describe("STAT-FR-02: Determinism", () => {
  it("produces identical SessionState for identical event sequences", () => {
    const events = buildFullSequence();

    const stateA = rebuildState(events);
    const stateB = rebuildState(events);

    expect(stateA).toEqual(stateB);
  });

  it("produces identical state when reducing event-by-event vs rebuildState", () => {
    const events = buildFullSequence();

    let manual = initialSessionState(SESSION_ID);
    for (const event of events) {
      manual = reduceEvent(manual, event);
    }

    const bulk = rebuildState(events);
    expect(manual).toEqual(bulk);
  });

  it("different event sequences produce different states", () => {
    const withFailure = [
      makeEvent("sessionStart",       {},                                       0),
      makeEvent("preToolUse",         { toolName: "run" },                      1),
      makeEvent("postToolUseFailure", { toolName: "run", status: "failure" },  2),
    ];
    const withSuccess = [
      makeEvent("sessionStart",       {},                                       0),
      makeEvent("preToolUse",         { toolName: "run" },                      1),
      makeEvent("postToolUse",        { toolName: "run", status: "success" },  2),
    ];

    const failState = rebuildState(withFailure);
    const successState = rebuildState(withSuccess);

    expect(failState.visualization).toBe("error");
    expect(successState.visualization).toBe("tool_succeeded");
  });
});

// ---------------------------------------------------------------------------
// STAT-FR-01 — Transition mapping (Product Vision §10.3)
// ---------------------------------------------------------------------------

describe("STAT-FR-01: Transition mapping (Product Vision §10.3)", () => {
  it("sessionStart → lifecycle: active, visualization: idle", () => {
    const state = reduceEvent(initialSessionState(SESSION_ID), makeEvent("sessionStart", {}));
    expect(state.lifecycle).toBe("active");
    expect(state.visualization).toBe("idle");
    expect(state.startedAt).toBeTruthy();
  });

  it("sessionEnd → lifecycle: completed, visualization: idle", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}));
    state = reduceEvent(state, makeEvent("sessionEnd", {}));
    expect(state.lifecycle).toBe("completed");
    expect(state.visualization).toBe("idle");
    expect(state.endedAt).toBeTruthy();
  });

  it("preToolUse → visualization: tool_running, currentTool populated", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "grep", toolArgs: { q: "foo" } }));
    expect(state.visualization).toBe("tool_running");
    expect(state.currentTool?.toolName).toBe("grep");
    expect(state.currentTool?.toolArgs).toEqual({ q: "foo" });
  });

  it("postToolUse → visualization: tool_succeeded", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "grep" }));
    state = reduceEvent(state, makeEvent("postToolUse", { toolName: "grep", status: "success", durationMs: 10 }));
    expect(state.visualization).toBe("tool_succeeded");
    expect(state.currentTool?.durationMs).toBe(10);
  });

  it("postToolUseFailure → visualization: error, errorSummary captured", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "rm" }));
    state = reduceEvent(state, makeEvent("postToolUseFailure", { toolName: "rm", status: "failure", errorSummary: "Not found" }));
    expect(state.visualization).toBe("error");
    expect(state.currentTool?.errorSummary).toBe("Not found");
  });

  it("errorOccurred → visualization: error", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}));
    state = reduceEvent(state, makeEvent("errorOccurred", { message: "boom", code: "E9" }));
    expect(state.visualization).toBe("error");
  });

  it("subagentStart → visualization: subagent_running, activeSubagent populated", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}));
    state = reduceEvent(state, makeEvent("subagentStart", {
      agentName: "sub-a",
      agentDisplayName: "Sub A",
      agentDescription: "Investigate schema drift",
      taskDescription: "Trace subagent payload",
      message: "Starting trace",
      summary: "Starting trace"
    }));
    expect(state.visualization).toBe("subagent_running");
    expect(state.activeSubagent?.agentName).toBe("sub-a");
    expect(state.activeSubagent?.agentDisplayName).toBe("Sub A");
    expect(state.activeSubagent?.agentDescription).toBe("Investigate schema drift");
    expect(state.activeSubagent?.taskDescription).toBe("Trace subagent payload");
    expect(state.activeSubagent?.summary).toBe("Starting trace");
  });

  it("subagentStop → visualization: idle, activeSubagent cleared", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}));
    state = reduceEvent(state, makeEvent("subagentStart", { agentName: "sub-a" }));
    state = reduceEvent(state, makeEvent("subagentStop", { agentName: "sub-a" }));
    expect(state.visualization).toBe("idle");
    expect(state.activeSubagent).toBeNull();
  });

  it("agentStop → visualization: idle, lastAgentName recorded", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}));
    state = reduceEvent(state, makeEvent("agentStop", { agentName: "orchestrator" }));
    expect(state.visualization).toBe("idle");
    expect(state.lastAgentName).toBe("orchestrator");
  });

  it("userPromptSubmitted → no visualization change", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}));
    const beforeViz = state.visualization;
    state = reduceEvent(state, makeEvent("userPromptSubmitted", { prompt: "do something" }));
    expect(state.visualization).toBe(beforeViz);
  });

  it("notification → no visualization change", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "t" }));
    const beforeViz = state.visualization;
    state = reduceEvent(state, makeEvent("notification", { notificationType: "info", title: "T", message: "M" }));
    expect(state.visualization).toBe(beforeViz);
    expect(state.visualization).toBe("tool_running");
  });
});

// ---------------------------------------------------------------------------
// STAT-FR-03 — Restart recovery
// ---------------------------------------------------------------------------

describe("STAT-FR-03: Restart recovery", () => {
  it("rebuildState from empty array returns initial unknown state", () => {
    const state = rebuildState([]);
    expect(state.sessionId).toBe("unknown");
    expect(state.lifecycle).toBe("not_started");
    expect(state.eventCount).toBe(0);
  });

  it("rebuildState from full sequence reproduces complete final state", () => {
    const events = buildFullSequence();
    const state = rebuildState(events);

    expect(state.sessionId).toBe(SESSION_ID);
    expect(state.lifecycle).toBe("completed");
    expect(state.visualization).toBe("idle");
    expect(state.eventCount).toBe(events.length);
    expect(state.startedAt).toBeTruthy();
    expect(state.endedAt).toBeTruthy();
  });

  it("rebuildState from partial events restores intermediate state correctly", () => {
    const partial: EventEnvelope[] = [
      makeEvent("sessionStart", {},                                         0),
      makeEvent("preToolUse",   { toolName: "grep" },                      1),
      makeEvent("postToolUse",  { toolName: "grep", status: "success" },   2),
      makeEvent("subagentStart",{ agentName: "sub-x" },                    3),
      // session not ended — mid-flight recovery
    ];

    const state = rebuildState(partial);
    expect(state.lifecycle).toBe("active");
    expect(state.visualization).toBe("subagent_running");
    expect(state.activeSubagent?.agentName).toBe("sub-x");
    expect(state.eventCount).toBe(4);
  });

  it("eventCount increments by exactly one per event", () => {
    const events = buildFullSequence();
    let state = initialSessionState(SESSION_ID);
    events.forEach((event, i) => {
      state = reduceEvent(state, event);
      expect(state.eventCount).toBe(i + 1);
    });
  });
});
