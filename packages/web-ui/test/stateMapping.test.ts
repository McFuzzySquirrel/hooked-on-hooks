import { describe, it, expect } from "vitest";
import { initialSessionState, reduceEvent } from "../../../shared/state-machine/src/index.js";
import { mapStateToLanes, vizToStatus } from "../src/stateMapping.js";
import type { SessionState } from "../../../shared/state-machine/src/index.js";
import type { EventEnvelope } from "../../../shared/event-schema/src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_ID = "sess-live-01";
const REPO = "/tmp/live-repo";
let seq = 0;

function nextId(): string {
  return `0000000${++seq}-0000-4000-8000-000000000000`;
}
function ts(): string {
  return new Date().toISOString();
}

function makeEvent<T extends EventEnvelope["eventType"]>(
  eventType: T,
  payload: Extract<EventEnvelope, { eventType: T }>["payload"]
): Extract<EventEnvelope, { eventType: T }> {
  return {
    schemaVersion: "1.0.0",
    eventId: nextId(),
    eventType,
    timestamp: ts(),
    sessionId: SESSION_ID,
    source: "copilot-cli" as const,
    repoPath: REPO,
    payload
  } as Extract<EventEnvelope, { eventType: T }>;
}

function applyEvents(events: EventEnvelope[]): SessionState {
  return events.reduce(
    (state, event) => reduceEvent(state, event),
    initialSessionState(SESSION_ID)
  );
}

// ---------------------------------------------------------------------------
// vizToStatus — Product Vision §10.2 mapping
// ---------------------------------------------------------------------------

describe("vizToStatus: VisualizationState → VisualStatus", () => {
  it.each([
    ["idle",            "idle"],
    ["tool_running",    "running"],
    ["tool_succeeded",  "succeeded"],
    ["subagent_running", "subagent_running"],
    ["error",           "error"]
  ] as const)("maps %s to %s", (viz, expected) => {
    expect(vizToStatus(viz)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// mapStateToLanes — LIVE-FR-01 and LIVE-FR-02
// ---------------------------------------------------------------------------

describe("mapStateToLanes: LIVE-FR-01 (session + activity lanes)", () => {
  it("initial state produces a single session lane in idle status", () => {
    const state = initialSessionState(SESSION_ID);
    const lanes = mapStateToLanes(state);

    expect(lanes.length).toBe(1);
    expect(lanes[0]?.id).toBe("session");
    expect(lanes[0]?.status).toBe("idle");
    expect(lanes[0]?.label).toContain(SESSION_ID);
  });

  it("after sessionStart, session lane shows idle lifecycle: active", () => {
    const state = applyEvents([makeEvent("sessionStart", {})]);
    const lanes = mapStateToLanes(state);

    expect(lanes[0]?.status).toBe("idle");
    expect(lanes[0]?.details).toBe("active");
  });

  it("after preToolUse, session lane shows running and tool lane appears", () => {
    const state = applyEvents([
      makeEvent("sessionStart", {}),
      makeEvent("preToolUse", { toolName: "bash", toolArgs: { command: "ls" } })
    ]);
    const lanes = mapStateToLanes(state);

    expect(lanes[0]?.status).toBe("running");     // session lane
    expect(lanes.some((l) => l.id === "tool")).toBe(true);

    const toolLane = lanes.find((l) => l.id === "tool");
    expect(toolLane?.label).toContain("bash");
    expect(toolLane?.status).toBe("running");
  });

  it("after postToolUse, session and tool lanes show succeeded", () => {
    const state = applyEvents([
      makeEvent("sessionStart", {}),
      makeEvent("preToolUse", { toolName: "grep" }),
      makeEvent("postToolUse", { toolName: "grep", status: "success", durationMs: 10 })
    ]);
    const lanes = mapStateToLanes(state);

    expect(lanes[0]?.status).toBe("succeeded");   // session lane
    const toolLane = lanes.find((l) => l.id === "tool");
    expect(toolLane?.status).toBe("succeeded");
  });

  it("after postToolUseFailure, lanes show error and errorSummary in details", () => {
    const state = applyEvents([
      makeEvent("sessionStart", {}),
      makeEvent("preToolUse", { toolName: "rm" }),
      makeEvent("postToolUseFailure", { toolName: "rm", status: "failure", errorSummary: "Permission denied" })
    ]);
    const lanes = mapStateToLanes(state);

    expect(lanes[0]?.status).toBe("error");
    const toolLane = lanes.find((l) => l.id === "tool");
    expect(toolLane?.status).toBe("error");
    expect(toolLane?.details).toBe("Permission denied");
  });

  it("after subagentStart, subagent lane appears and session shows subagent_running", () => {
    const state = applyEvents([
      makeEvent("sessionStart", {}),
      makeEvent("subagentStart", {
        agentName: "Explore",
        agentDisplayName: "Explore Agent",
        agentDescription: "Codebase exploration"
      })
    ]);
    const lanes = mapStateToLanes(state);

    expect(lanes[0]?.status).toBe("subagent_running");
    const agentLane = lanes.find((l) => l.id === "subagent");
    expect(agentLane).toBeDefined();
    expect(agentLane?.label).toContain("Explore Agent");
    expect(agentLane?.status).toBe("subagent_running");
    expect(agentLane?.details).toBe("Codebase exploration");
  });

  it("after subagentStop, subagent lane is removed and session returns to idle", () => {
    const state = applyEvents([
      makeEvent("sessionStart", {}),
      makeEvent("subagentStart", { agentName: "Explore" }),
      makeEvent("subagentStop", { agentName: "Explore" })
    ]);
    const lanes = mapStateToLanes(state);

    expect(lanes[0]?.status).toBe("idle");
    expect(lanes.some((l) => l.id === "subagent")).toBe(false);
  });

  it("after sessionEnd, session lane shows succeeded with lifecycle completed", () => {
    const state = applyEvents([
      makeEvent("sessionStart", {}),
      makeEvent("sessionEnd", {})
    ]);
    const lanes = mapStateToLanes(state);

    expect(lanes[0]?.status).toBe("succeeded");
    expect(lanes[0]?.details).toBe("completed");
  });

  it("errorOccurred event shows error on session lane", () => {
    const state = applyEvents([
      makeEvent("sessionStart", {}),
      makeEvent("errorOccurred", { message: "fatal", code: "E9" })
    ]);
    const lanes = mapStateToLanes(state);
    expect(lanes[0]?.status).toBe("error");
  });

  it("uses agentDisplayName when available in subagent lane label", () => {
    const state = applyEvents([
      makeEvent("sessionStart", {}),
      makeEvent("subagentStart", { agentName: "sub-id", agentDisplayName: "My Specialist" })
    ]);
    const agentLane = mapStateToLanes(state).find((l) => l.id === "subagent");
    expect(agentLane?.label).toContain("My Specialist");
    expect(agentLane?.label).not.toContain("sub-id");
  });

  it("falls back to agentName when agentDisplayName is absent", () => {
    const state = applyEvents([
      makeEvent("sessionStart", {}),
      makeEvent("subagentStart", { agentName: "raw-name" })
    ]);
    const agentLane = mapStateToLanes(state).find((l) => l.id === "subagent");
    expect(agentLane?.label).toContain("raw-name");
  });

  it("falls back through task and summary fields for subagent details", () => {
    const withTask = applyEvents([
      makeEvent("sessionStart", {}),
      makeEvent("subagentStart", { agentName: "planner", taskDescription: "Plan the patch" })
    ]);
    const withSummary = applyEvents([
      makeEvent("sessionStart", {}),
      makeEvent("subagentStart", { agentName: "planner", summary: "Plan ready" })
    ]);

    expect(mapStateToLanes(withTask).find((l) => l.id === "subagent")?.details).toBe("Plan the patch");
    expect(mapStateToLanes(withSummary).find((l) => l.id === "subagent")?.details).toBe("Plan ready");
  });
});
