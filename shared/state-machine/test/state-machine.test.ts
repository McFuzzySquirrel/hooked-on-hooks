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
    makeEvent("chatSessionStart",      { workspaceSessionId: SESSION_ID },             12),
    makeEvent("chatMessage",           { role: "user", text: "hello" },              13),
    makeEvent("chatToolCall",          { toolName: "read_file", status: "started", toolCallId: "call-1" }, 14),
    makeEvent("chatToolCall",          { toolName: "read_file", status: "completed", toolCallId: "call-1", durationMs: 12 }, 15),
    makeEvent("chatArtifactImported",  { artifactType: "tool-call-content", path: "chat/call/content.txt" }, 16),
    makeEvent("chatSessionEnd",        { reason: "complete" },                        17),
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

  it("chatSessionStart/chatSessionEnd update lifecycle boundaries", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("chatSessionStart", { workspaceSessionId: SESSION_ID }));
    expect(state.lifecycle).toBe("active");
    expect(state.visualization).toBe("idle");

    state = reduceEvent(state, makeEvent("chatSessionEnd", { reason: "complete" }));
    expect(state.lifecycle).toBe("completed");
    expect(state.visualization).toBe("idle");
  });

  it("chatMessage user increments turn count", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("chatSessionStart", { workspaceSessionId: SESSION_ID }));
    state = reduceEvent(state, makeEvent("chatMessage", { role: "user", text: "hello" }));
    expect(state.turnCount).toBe(1);
    expect(state.currentTurnStartTime).toBeTruthy();
  });

  it("chatToolCall started/completed follows tool visualization semantics", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("chatSessionStart", { workspaceSessionId: SESSION_ID }));
    state = reduceEvent(state, makeEvent("chatToolCall", { toolName: "read_file", status: "started", toolCallId: "call-1" }));
    expect(state.visualization).toBe("tool_running");
    expect(Object.keys(state.activeTools)).toHaveLength(1);

    state = reduceEvent(state, makeEvent("chatToolCall", { toolName: "read_file", status: "completed", toolCallId: "call-1", durationMs: 10 }));
    expect(state.visualization).toBe("tool_succeeded");
    expect(Object.keys(state.activeTools)).toHaveLength(0);
    expect(state.currentTool?.durationMs).toBe(10);
  });

  it("chatToolCall failed transitions to error", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("chatSessionStart", { workspaceSessionId: SESSION_ID }));
    state = reduceEvent(state, makeEvent("chatToolCall", { toolName: "bash", status: "started", toolCallId: "call-2" }));
    state = reduceEvent(state, makeEvent("chatToolCall", { toolName: "bash", status: "failed", toolCallId: "call-2", errorSummary: "boom" }));
    expect(state.visualization).toBe("error");
    expect(state.currentTool?.errorSummary).toBe("boom");
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

// ---------------------------------------------------------------------------
// Concurrent tool execution (P0-1)
// ---------------------------------------------------------------------------

describe("Concurrent tool execution (P0-1)", () => {
  it("tracks multiple concurrent in-flight tools in activeTools", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));

    const preA = makeEvent("preToolUse", { toolName: "view", toolArgs: { path: "a.ts" } }, 1);
    const preB = makeEvent("preToolUse", { toolName: "view", toolArgs: { path: "b.ts" } }, 2);

    state = reduceEvent(state, preA);
    expect(Object.keys(state.activeTools)).toHaveLength(1);
    expect(state.visualization).toBe("tool_running");

    state = reduceEvent(state, preB);
    expect(Object.keys(state.activeTools)).toHaveLength(2);
    expect(state.visualization).toBe("tool_running");
  });

  it("removes tools from activeTools on postToolUse and stays tool_running if more remain", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));

    const preA = makeEvent("preToolUse", { toolName: "view" }, 1);
    const preB = makeEvent("preToolUse", { toolName: "grep" }, 2);

    state = reduceEvent(state, preA);
    state = reduceEvent(state, preB);
    expect(Object.keys(state.activeTools)).toHaveLength(2);

    // Complete the first tool — one still remains
    state = reduceEvent(state, makeEvent("postToolUse", { toolName: "view", status: "success" }, 3));
    expect(Object.keys(state.activeTools)).toHaveLength(1);
    expect(state.visualization).toBe("tool_running");

    // Complete the second — none remain
    state = reduceEvent(state, makeEvent("postToolUse", { toolName: "grep", status: "success" }, 4));
    expect(Object.keys(state.activeTools)).toHaveLength(0);
    expect(state.visualization).toBe("tool_succeeded");
  });

  it("currentTool reflects the most recently completed tool", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "view" }, 1));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "grep" }, 2));
    state = reduceEvent(state, makeEvent("postToolUse", { toolName: "grep", status: "success", durationMs: 5 }, 3));

    expect(state.currentTool?.toolName).toBe("grep");
    expect(state.currentTool?.durationMs).toBe(5);
  });

  it("matches postToolUse by toolCallId when available", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "view", toolCallId: "call-1" }, 1));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "view", toolCallId: "call-2" }, 2));

    // Complete the second one first (by toolCallId)
    state = reduceEvent(state, makeEvent("postToolUse", { toolName: "view", status: "success", toolCallId: "call-2" }, 3));
    expect(Object.keys(state.activeTools)).toHaveLength(1);
    // The remaining tool should be call-1
    const remaining = Object.values(state.activeTools);
    expect(remaining[0]?.toolCallId).toBe("call-1");
  });
});

// ---------------------------------------------------------------------------
// Orphaned tool handling (P0-3)
// ---------------------------------------------------------------------------

describe("Orphaned tool handling (P0-3)", () => {
  it("sessionEnd clears activeTools and increments orphanedToolCount", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "create" }, 1));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "edit" }, 2));
    // No postToolUse — session ends with 2 orphans
    state = reduceEvent(state, makeEvent("sessionEnd", {}, 3));

    expect(Object.keys(state.activeTools)).toHaveLength(0);
    expect(state.orphanedToolCount).toBe(2);
    expect(state.lifecycle).toBe("completed");
    expect(state.visualization).toBe("idle");
  });

  it("orphanedToolCount accumulates across multiple sessionEnd events", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "view" }, 1));
    state = reduceEvent(state, makeEvent("sessionEnd", {}, 2));
    expect(state.orphanedToolCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Agent name fallback (P0-4)
// ---------------------------------------------------------------------------

describe("Agent name fallback (P0-4)", () => {
  it("agentStop preserves agentName when provided", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    state = reduceEvent(state, makeEvent("agentStop", { agentName: "orchestrator" }, 1));
    expect(state.lastAgentName).toBe("orchestrator");
  });

  it("agentStop falls back to lastAgentName when agentName is empty", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    state = reduceEvent(state, makeEvent("agentStop", { agentName: "first-agent" }, 1));
    state = reduceEvent(state, makeEvent("agentStop", {}, 2));
    expect(state.lastAgentName).toBe("first-agent");
  });

  it("lastAgentName remains null when no agent name is ever provided", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    state = reduceEvent(state, makeEvent("agentStop", {}, 1));
    expect(state.lastAgentName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Intent tracking (P1-1)
// ---------------------------------------------------------------------------

describe("Intent tracking (P1-1)", () => {
  it("extracts currentIntent from report_intent preToolUse", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    state = reduceEvent(state, makeEvent("preToolUse", {
      toolName: "report_intent",
      toolArgs: { intent: "Building feature PRD" }
    }, 1));
    expect(state.currentIntent).toBe("Building feature PRD");
  });

  it("updates currentIntent on subsequent report_intent calls", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    state = reduceEvent(state, makeEvent("preToolUse", {
      toolName: "report_intent",
      toolArgs: { intent: "Exploring codebase" }
    }, 1));
    state = reduceEvent(state, makeEvent("postToolUse", { toolName: "report_intent", status: "success" }, 2));
    state = reduceEvent(state, makeEvent("preToolUse", {
      toolName: "report_intent",
      toolArgs: { intent: "Implementing changes" }
    }, 3));
    expect(state.currentIntent).toBe("Implementing changes");
  });

  it("non-report_intent tools do not change currentIntent", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    state = reduceEvent(state, makeEvent("preToolUse", {
      toolName: "report_intent",
      toolArgs: { intent: "Phase 1" }
    }, 1));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "view" }, 2));
    expect(state.currentIntent).toBe("Phase 1");
  });
});

// ---------------------------------------------------------------------------
// Wait state visualization (P1-3)
// ---------------------------------------------------------------------------

describe("Wait state visualization (P1-3)", () => {
  it("ask_user sets visualization to waiting_for_user", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "ask_user" }, 1));
    expect(state.visualization).toBe("waiting_for_user");
  });

  it("read_agent sets visualization to waiting_for_agent", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "read_agent" }, 1));
    expect(state.visualization).toBe("waiting_for_agent");
  });

  it("postToolUse after ask_user returns to tool_succeeded", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "ask_user" }, 1));
    expect(state.visualization).toBe("waiting_for_user");
    state = reduceEvent(state, makeEvent("postToolUse", { toolName: "ask_user", status: "success" }, 2));
    expect(state.visualization).toBe("tool_succeeded");
  });

  it("regular tools still set tool_running", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "bash" }, 1));
    expect(state.visualization).toBe("tool_running");
  });
});

// ---------------------------------------------------------------------------
// Turn grouping (P1-4)
// ---------------------------------------------------------------------------

describe("Turn grouping (P1-4)", () => {
  it("userPromptSubmitted increments turnCount", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    expect(state.turnCount).toBe(0);

    state = reduceEvent(state, makeEvent("userPromptSubmitted", { prompt: "hello" }, 1));
    expect(state.turnCount).toBe(1);
    expect(state.currentTurnStartTime).toBeTruthy();

    state = reduceEvent(state, makeEvent("userPromptSubmitted", { prompt: "next" }, 5));
    expect(state.turnCount).toBe(2);
  });

  it("turnCount is preserved across tool events", () => {
    let state = initialSessionState(SESSION_ID);
    state = reduceEvent(state, makeEvent("sessionStart", {}, 0));
    state = reduceEvent(state, makeEvent("userPromptSubmitted", { prompt: "go" }, 1));
    state = reduceEvent(state, makeEvent("preToolUse", { toolName: "view" }, 2));
    state = reduceEvent(state, makeEvent("postToolUse", { toolName: "view", status: "success" }, 3));
    expect(state.turnCount).toBe(1);
  });
});
