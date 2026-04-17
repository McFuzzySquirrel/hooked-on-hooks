import { describe, it, expect } from "vitest";
import { matchesFilter, applyFilter } from "../src/filterState.js";
import type { EventEnvelope } from "../../../shared/event-schema/src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_ID = "sess-filter-01";
let seq = 0;

function nextId(): string {
  return `F000000${++seq}-0000-4000-8000-000000000000`;
}

function make<T extends EventEnvelope["eventType"]>(
  eventType: T,
  payload: Extract<EventEnvelope, { eventType: T }>["payload"]
): Extract<EventEnvelope, { eventType: T }> {
  return {
    schemaVersion: "1.0.0",
    eventId: nextId(),
    eventType,
    timestamp: new Date().toISOString(),
    sessionId: SESSION_ID,
    source: "copilot-cli" as const,
    repoPath: "/tmp/repo",
    payload
  } as Extract<EventEnvelope, { eventType: T }>;
}

// Representative events covering different actor types
const SESSION_START   = make("sessionStart", {});
const PRE_TOOL_BASH   = make("preToolUse",   { toolName: "bash" });
const PRE_TOOL_GREP   = make("preToolUse",   { toolName: "grep" });
const POST_TOOL       = make("postToolUse",  { toolName: "bash", status: "success" });
const AGENT_START     = make("subagentStart",{ agentName: "Explore" });
const NOTIFICATION    = make("notification", { notificationType: "info", title: "T", message: "M" });
const ERROR_EVENT     = make("errorOccurred",{ message: "boom" });

const ALL_EVENTS: EventEnvelope[] = [
  SESSION_START, PRE_TOOL_BASH, PRE_TOOL_GREP, POST_TOOL, AGENT_START, NOTIFICATION, ERROR_EVENT
];

// ---------------------------------------------------------------------------
// LIVE-FR-05 — matchesFilter: event type filtering
// ---------------------------------------------------------------------------

describe("matchesFilter: event type filtering (LIVE-FR-05)", () => {
  it("empty filter passes all events", () => {
    for (const event of ALL_EVENTS) {
      expect(matchesFilter(event, {})).toBe(true);
    }
  });

  it("eventTypes filter passes only matching event types", () => {
    const filter = { eventTypes: ["preToolUse"] };
    expect(matchesFilter(PRE_TOOL_BASH, filter)).toBe(true);
    expect(matchesFilter(PRE_TOOL_GREP, filter)).toBe(true);
    expect(matchesFilter(SESSION_START, filter)).toBe(false);
    expect(matchesFilter(NOTIFICATION, filter)).toBe(false);
  });

  it("multiple event types in filter allows any of them through", () => {
    const filter = { eventTypes: ["preToolUse", "errorOccurred"] };
    expect(matchesFilter(PRE_TOOL_BASH, filter)).toBe(true);
    expect(matchesFilter(ERROR_EVENT, filter)).toBe(true);
    expect(matchesFilter(SESSION_START, filter)).toBe(false);
    expect(matchesFilter(NOTIFICATION, filter)).toBe(false);
  });

  it("empty eventTypes array is treated as no filter (passes all)", () => {
    const filter = { eventTypes: [] };
    for (const event of ALL_EVENTS) {
      expect(matchesFilter(event, filter)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// LIVE-FR-05 — matchesFilter: actor name filtering
// ---------------------------------------------------------------------------

describe("matchesFilter: actor name filtering (LIVE-FR-05)", () => {
  it("actorName filter passes events with matching tool name (case-insensitive)", () => {
    expect(matchesFilter(PRE_TOOL_BASH, { actorName: "bash" })).toBe(true);
    expect(matchesFilter(PRE_TOOL_BASH, { actorName: "BASH" })).toBe(true);
    expect(matchesFilter(PRE_TOOL_BASH, { actorName: "bas" })).toBe(true);  // substring
  });

  it("actorName filter blocks events with non-matching tool name", () => {
    expect(matchesFilter(PRE_TOOL_GREP, { actorName: "bash" })).toBe(false);
  });

  it("actorName filter passes events with matching agent name", () => {
    expect(matchesFilter(AGENT_START, { actorName: "explore" })).toBe(true);
    expect(matchesFilter(AGENT_START, { actorName: "Explore" })).toBe(true);
  });

  it("actorName filter blocks events that have no actor (e.g. sessionStart)", () => {
    expect(matchesFilter(SESSION_START, { actorName: "bash" })).toBe(false);
  });

  it("whitespace-only actorName is treated as no actor filter (passes all)", () => {
    for (const event of ALL_EVENTS) {
      expect(matchesFilter(event, { actorName: "   " })).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// LIVE-FR-05 — matchesFilter: combined filters
// ---------------------------------------------------------------------------

describe("matchesFilter: combined eventType + actorName filters", () => {
  it("both filters must be satisfied", () => {
    const filter = { eventTypes: ["preToolUse"], actorName: "bash" };
    expect(matchesFilter(PRE_TOOL_BASH, filter)).toBe(true);   // ✓ type and ✓ actor
    expect(matchesFilter(PRE_TOOL_GREP, filter)).toBe(false);  // ✓ type but ✗ actor
    expect(matchesFilter(SESSION_START, filter)).toBe(false);  // ✗ type and ✗ actor
  });
});

// ---------------------------------------------------------------------------
// applyFilter — array filtering
// ---------------------------------------------------------------------------

describe("applyFilter: filters event array by filter config", () => {
  it("empty filter returns all events in original order", () => {
    const result = applyFilter(ALL_EVENTS, {});
    expect(result).toEqual(ALL_EVENTS);
  });

  it("eventTypes filter reduces array to matching events only", () => {
    const result = applyFilter(ALL_EVENTS, { eventTypes: ["preToolUse"] });
    expect(result.length).toBe(2);
    expect(result.every((e) => e.eventType === "preToolUse")).toBe(true);
  });

  it("actorName filter reduces array to matching actor events only", () => {
    const result = applyFilter(ALL_EVENTS, { actorName: "bash" });
    // PRE_TOOL_BASH and POST_TOOL both have toolName "bash"
    expect(result.length).toBe(2);
    expect(result.every((e) => {
      const p = e.payload as Record<string, unknown>;
      return p.toolName === "bash";
    })).toBe(true);
  });

  it("does not mutate the input array", () => {
    const input = [...ALL_EVENTS];
    applyFilter(input, { eventTypes: ["preToolUse"] });
    expect(input.length).toBe(ALL_EVENTS.length);
  });

  it("combined filter can result in empty array", () => {
    const result = applyFilter(ALL_EVENTS, { eventTypes: ["sessionStart"], actorName: "bash" });
    expect(result.length).toBe(0);
  });
});
