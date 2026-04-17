import { describe, expect, it } from "vitest";
import { findEventsByTraceId, findToolFailures, pairToolEvents } from "../src/index.js";
import type { EventEnvelope } from "../../event-schema/src/index.js";

const BASE = {
  schemaVersion: "1.0.0",
  sessionId: "session-1",
  source: "copilot-cli" as const,
  repoPath: "/tmp/repo",
};

let seq = 0;
function nextEventId(): string {
  seq++;
  const hex = seq.toString(16).padStart(8, "0");
  return `${hex}-0000-4000-8000-000000000000`;
}

function mk<T extends EventEnvelope["eventType"]>(
  eventType: T,
  payload: Extract<EventEnvelope, { eventType: T }>['payload'],
  extras?: Partial<Extract<EventEnvelope, { eventType: T }>>,
): Extract<EventEnvelope, { eventType: T }> {
  return {
    ...BASE,
    eventId: nextEventId(),
    timestamp: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
    eventType,
    payload,
    ...extras,
  } as Extract<EventEnvelope, { eventType: T }>;
}

describe("state-machine queries", () => {
  it("filters events by traceId while preserving order", () => {
    const events: EventEnvelope[] = [
      mk("sessionStart", {}, { traceId: "trace-a" }),
      mk("preToolUse", { toolName: "bash" }, { traceId: "trace-b" }),
      mk("postToolUse", { toolName: "bash", status: "success" }, { traceId: "trace-a" }),
    ];

    const filtered = findEventsByTraceId(events, "trace-a");
    expect(filtered.length).toBe(2);
    expect(filtered[0].eventType).toBe("sessionStart");
    expect(filtered[1].eventType).toBe("postToolUse");
  });

  it("returns only postToolUseFailure events", () => {
    const events: EventEnvelope[] = [
      mk("postToolUse", { toolName: "bash", status: "success" }),
      mk("postToolUseFailure", { toolName: "bash", status: "failure", errorSummary: "boom" }),
    ];

    const failures = findToolFailures(events);
    expect(failures).toHaveLength(1);
    expect(failures[0].payload.errorSummary).toBe("boom");
  });

  it("pairs pre/post by toolCallId when present", () => {
    const events: EventEnvelope[] = [
      mk("preToolUse", { toolName: "bash", toolCallId: "call-1" }),
      mk("postToolUse", { toolName: "bash", status: "success", toolCallId: "call-1" }),
    ];

    const pairs = pairToolEvents(events);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].pairingMode).toBe("toolCallId");
  });

  it("pairs pre/post by spanId when toolCallId is absent", () => {
    const events: EventEnvelope[] = [
      mk("preToolUse", { toolName: "bash" }, { spanId: "span-1" }),
      mk("postToolUse", { toolName: "bash", status: "success" }, { spanId: "span-1" }),
    ];

    const pairs = pairToolEvents(events);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].pairingMode).toBe("spanId");
  });

  it("falls back to deterministic FIFO heuristic by toolName", () => {
    const events: EventEnvelope[] = [
      mk("preToolUse", { toolName: "bash" }),
      mk("preToolUse", { toolName: "bash" }),
      mk("postToolUse", { toolName: "bash", status: "success" }),
      mk("postToolUseFailure", { toolName: "bash", status: "failure" }),
    ];

    const pairs = pairToolEvents(events);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].pairingMode).toBe("heuristic");
    expect(pairs[1].pairingMode).toBe("heuristic");
    expect(pairs[0].pre.eventId).not.toBe(pairs[1].pre.eventId);
  });
});
