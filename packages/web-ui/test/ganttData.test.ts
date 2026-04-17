import { describe, it, expect } from "vitest";
import { buildGanttData, computeTimeRange, findLatestRunningSegmentId } from "../src/ganttData.js";
import type { EventEnvelope } from "../../../shared/event-schema/src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_ID = "sess-gantt-01";
const REPO = "/tmp/gantt-repo";
let seq = 0;
let timeCounter = Date.now();

function nextId(): string {
  return `0000000${++seq}-0000-4000-8000-000000000000`;
}
function ts(): string {
  timeCounter += 1000;
  return new Date(timeCounter).toISOString();
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
    payload,
  } as Extract<EventEnvelope, { eventType: T }>;
}

// ---------------------------------------------------------------------------
// buildGanttData
// ---------------------------------------------------------------------------

describe("buildGanttData", () => {
  it("creates session, tool, and subagent rows from a complete event sequence", () => {
    const events: EventEnvelope[] = [
      makeEvent("sessionStart", {}),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
      makeEvent("sessionEnd", {}),
    ];
    const rows = buildGanttData(events);

    expect(rows.length).toBe(2); // session + tool:bash
    expect(rows[0].rowId).toBe("session");
    expect(rows[1].rowId).toBe("tool:bash");
    expect(rows[1].label).toBe("Tool: bash");
  });

  it("marks tool as running when only preToolUse is received", () => {
    const events: EventEnvelope[] = [
      makeEvent("sessionStart", {}),
      makeEvent("preToolUse", { toolName: "grep" }),
    ];
    const rows = buildGanttData(events);
    const toolRow = rows.find((r) => r.rowId === "tool:grep");

    expect(toolRow).toBeDefined();
    expect(toolRow!.segments[0].status).toBe("running");
    expect(toolRow!.segments[0].endTime).toBeNull();
  });

  it("marks tool as failed on postToolUseFailure", () => {
    const events: EventEnvelope[] = [
      makeEvent("sessionStart", {}),
      makeEvent("preToolUse", { toolName: "rm" }),
      makeEvent("postToolUseFailure", {
        toolName: "rm",
        status: "failure",
        errorSummary: "Permission denied",
      }),
    ];
    const rows = buildGanttData(events);
    const toolRow = rows.find((r) => r.rowId === "tool:rm");

    expect(toolRow!.segments[0].status).toBe("failed");
    expect(toolRow!.segments[0].endTime).not.toBeNull();
  });

  it("auto-closes open tool segments when sessionEnd arrives", () => {
    const events: EventEnvelope[] = [
      makeEvent("sessionStart", {}),
      makeEvent("preToolUse", { toolName: "bash" }),
      // No postToolUse — tool is still open
      makeEvent("sessionEnd", {}),
    ];
    const rows = buildGanttData(events);
    const toolRow = rows.find((r) => r.rowId === "tool:bash");

    expect(toolRow).toBeDefined();
    expect(toolRow!.segments[0].endTime).not.toBeNull();
    expect(toolRow!.segments[0].status).toBe("succeeded");
  });

  it("auto-closes open subagent segments when sessionEnd arrives", () => {
    const events: EventEnvelope[] = [
      makeEvent("sessionStart", {}),
      makeEvent("subagentStart", { agentName: "explore" }),
      // No subagentStop — subagent is still open
      makeEvent("sessionEnd", {}),
    ];
    const rows = buildGanttData(events);
    const agentRow = rows.find((r) => r.rowId === "subagent:explore");

    expect(agentRow).toBeDefined();
    expect(agentRow!.segments[0].endTime).not.toBeNull();
    expect(agentRow!.segments[0].status).toBe("succeeded");
  });

  it("uses agentDisplayName for subagent labels when available", () => {
    const events: EventEnvelope[] = [
      makeEvent("sessionStart", {}),
      makeEvent("subagentStart", {
        agentName: "explore-id",
        agentDisplayName: "Explorer Agent",
      }),
      makeEvent("subagentStop", { agentName: "explore-id" }),
    ];
    const rows = buildGanttData(events);
    const agentRow = rows.find((r) => r.rowId === "subagent:Explorer Agent");

    expect(agentRow).toBeDefined();
    expect(agentRow!.label).toBe("Agent: Explorer Agent");
  });

  it("returns empty rows for no events", () => {
    expect(buildGanttData([])).toEqual([]);
  });
});
    it("preserves taskDescription from subagentStart when subagentStop has undefined taskDescription", () => {
      const events: EventEnvelope[] = [
        makeEvent("sessionStart", {}),
        makeEvent("subagentStart", {
          agentName: "qa-engineer",
          taskDescription: "Run full test suite",
          message: "Run full test suite",
          summary: "Run full test suite",
        }),
        makeEvent("subagentStop", { agentName: "qa-engineer" }),
      ];
      const rows = buildGanttData(events);
      const agentRow = rows.find((r) => r.rowId === "subagent:qa-engineer");

      expect(agentRow).toBeDefined();
      const seg = agentRow!.segments[0];
      expect(seg.status).toBe("succeeded");
      expect(seg.details.taskDescription).toBe("Run full test suite");
      expect(seg.details.message).toBe("Run full test suite");
      expect(seg.details.summary).toBe("Run full test suite");
    });

// ---------------------------------------------------------------------------
// computeTimeRange
// ---------------------------------------------------------------------------

describe("computeTimeRange", () => {
  it("returns [0, 0] for empty rows", () => {
    expect(computeTimeRange([])).toEqual([0, 0]);
  });

  it("computes range from completed segments", () => {
    const events: EventEnvelope[] = [
      makeEvent("sessionStart", {}),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
      makeEvent("sessionEnd", {}),
    ];
    const rows = buildGanttData(events);
    const [min, max] = computeTimeRange(rows);

    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThanOrEqual(min);
  });
});

// ---------------------------------------------------------------------------
// R4: Auto-close orphaned tool segments
// ---------------------------------------------------------------------------

describe("R4 — auto-close orphaned segments", () => {
  it("auto-closes a tool when a new preToolUse arrives for the same tool", () => {
    const events: EventEnvelope[] = [
      makeEvent("sessionStart", {}),
      makeEvent("preToolUse", { toolName: "bash" }),
      // No postToolUse — a second preToolUse arrives for the same tool
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
    ];
    const rows = buildGanttData(events);
    const toolRow = rows.find((r) => r.rowId === "tool:bash");

    expect(toolRow).toBeDefined();
    // Should have 2 segments: first auto-closed, second completed normally
    expect(toolRow!.segments.length).toBe(2);
    expect(toolRow!.segments[0].endTime).not.toBeNull();
    expect(toolRow!.segments[0].status).toBe("succeeded");
    expect(toolRow!.segments[0].autoClosed).toBe(true);
    expect(toolRow!.segments[1].endTime).not.toBeNull();
    expect(toolRow!.segments[1].status).toBe("succeeded");
  });

  it("does not auto-close tools with different names", () => {
    const events: EventEnvelope[] = [
      makeEvent("sessionStart", {}),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("preToolUse", { toolName: "grep" }),
    ];
    const rows = buildGanttData(events);
    const bashRow = rows.find((r) => r.rowId === "tool:bash");
    const grepRow = rows.find((r) => r.rowId === "tool:grep");

    // Both should still be running (not auto-closed)
    expect(bashRow!.segments[0].endTime).toBeNull();
    expect(bashRow!.segments[0].status).toBe("running");
    expect(grepRow!.segments[0].endTime).toBeNull();
    expect(grepRow!.segments[0].status).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// R5: Collapse repeated tool calls
// ---------------------------------------------------------------------------

describe("R5 — collapse repeated tool calls", () => {
  it("collapses >3 consecutive completed segments into a summary", () => {
    const events: EventEnvelope[] = [
      makeEvent("sessionStart", {}),
      // 5 consecutive bash calls
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
      makeEvent("sessionEnd", {}),
    ];
    const rows = buildGanttData(events);
    const toolRow = rows.find((r) => r.rowId === "tool:bash");

    expect(toolRow).toBeDefined();
    // 5 completed segments should be collapsed into 1 summary segment
    expect(toolRow!.segments.length).toBe(1);
    expect(toolRow!.segments[0].eventType).toBe("collapsed");
    expect(toolRow!.segments[0].details.count).toBe(5);
    // The collapsed group should exist
    expect(toolRow!.collapsedGroups).toBeDefined();
    expect(toolRow!.collapsedGroups!.length).toBe(1);
    expect(toolRow!.collapsedGroups![0].count).toBe(5);
    expect(toolRow!.collapsedGroups![0].children.length).toBe(5);
  });

  it("does NOT collapse 3 or fewer consecutive segments", () => {
    const events: EventEnvelope[] = [
      makeEvent("sessionStart", {}),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
      makeEvent("sessionEnd", {}),
    ];
    const rows = buildGanttData(events);
    const toolRow = rows.find((r) => r.rowId === "tool:bash");

    expect(toolRow).toBeDefined();
    // 3 segments should stay individual (not collapsed)
    expect(toolRow!.segments.length).toBe(3);
    expect(toolRow!.collapsedGroups).toBeUndefined();
  });

  it("keeps a still-running segment visible after collapsed group", () => {
    const events: EventEnvelope[] = [
      makeEvent("sessionStart", {}),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
      // 5th invocation still running
      makeEvent("preToolUse", { toolName: "bash" }),
    ];
    const rows = buildGanttData(events);
    const toolRow = rows.find((r) => r.rowId === "tool:bash");

    expect(toolRow).toBeDefined();
    // 4 completed (collapsed) + 1 running = 2 visible segments
    expect(toolRow!.segments.length).toBe(2);
    expect(toolRow!.segments[0].eventType).toBe("collapsed");
    expect(toolRow!.segments[1].status).toBe("running");
    expect(toolRow!.segments[1].endTime).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R3: findLatestRunningSegmentId
// ---------------------------------------------------------------------------

describe("findLatestRunningSegmentId", () => {
  it("returns null when no segments are running", () => {
    const events: EventEnvelope[] = [
      makeEvent("sessionStart", {}),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("postToolUse", { toolName: "bash", status: "success" }),
      makeEvent("sessionEnd", {}),
    ];
    const rows = buildGanttData(events);
    expect(findLatestRunningSegmentId(rows)).toBeNull();
  });

  it("returns the ID of the most recently started running segment", () => {
    const events: EventEnvelope[] = [
      makeEvent("sessionStart", {}),
      makeEvent("preToolUse", { toolName: "bash" }),
      makeEvent("preToolUse", { toolName: "grep" }),
    ];
    const rows = buildGanttData(events);
    const grepRow = rows.find((r) => r.rowId === "tool:grep");
    const id = findLatestRunningSegmentId(rows);

    // grep was started last, so it should be the latest running
    expect(id).toBe(grepRow!.segments[0].id);
  });

  it("considers session as a running segment", () => {
    const events: EventEnvelope[] = [
      makeEvent("sessionStart", {}),
    ];
    const rows = buildGanttData(events);
    const id = findLatestRunningSegmentId(rows);

    expect(id).not.toBeNull();
    expect(id).toBe(rows[0].segments[0].id);
  });
});
