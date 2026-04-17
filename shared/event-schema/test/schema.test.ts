import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { EVENT_TYPES, parseEvent, SCHEMA_VERSION } from "../src/index.js";

function baseEnvelope(eventType: string) {
  return {
    schemaVersion: SCHEMA_VERSION,
    eventId: randomUUID(),
    eventType,
    timestamp: new Date().toISOString(),
    sessionId: "session-1",
    source: "copilot-cli",
    repoPath: "/tmp/repo"
  };
}

function payloadFor(eventType: string): Record<string, unknown> {
  switch (eventType) {
    case "preToolUse":
      return { toolName: "bash", toolArgs: { command: "npm test" } };
    case "postToolUse":
      return { toolName: "bash", status: "success", durationMs: 42 };
    case "postToolUseFailure":
      return { toolName: "bash", status: "failure", durationMs: 42, errorSummary: "boom" };
    case "subagentStart":
      return {
        agentName: "Explore",
        agentDisplayName: "Explore Agent",
        agentDescription: "Codebase exploration",
        taskDescription: "Inspect subagent lifecycle",
        message: "Starting Explore",
        summary: "Starting Explore"
      };
    case "subagentStop":
      return {
        agentName: "Explore",
        taskDescription: "Inspect subagent lifecycle",
        message: "Explore finished",
        summary: "Explore finished",
        result: "Explore finished"
      };
    case "notification":
      return { notificationType: "agent_completed", title: "Done", message: "ok" };
    case "errorOccurred":
      return { message: "error" };
    default:
      return {};
  }
}

describe("event schema", () => {
  it("validates all MVP event types", () => {
    for (const eventType of EVENT_TYPES) {
      const result = parseEvent({
        ...baseEnvelope(eventType),
        payload: payloadFor(eventType)
      });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects malformed event without throwing", () => {
    const malformed = {
      eventType: "preToolUse",
      payload: { toolName: "bash" }
    };
    const result = parseEvent(malformed);
    expect(result.ok).toBe(false);
  });

  it("accepts additive fields for compatibility", () => {
    const result = parseEvent({
      ...baseEnvelope("sessionStart"),
      payload: { extra: true },
      extraEnvelopeField: "future"
    });
    expect(result.ok).toBe(true);
  });

  it("accepts rich subagent lifecycle payloads", () => {
    const start = parseEvent({
      ...baseEnvelope("subagentStart"),
      payload: payloadFor("subagentStart")
    });
    const stop = parseEvent({
      ...baseEnvelope("subagentStop"),
      payload: payloadFor("subagentStop")
    });

    expect(start.ok).toBe(true);
    expect(stop.ok).toBe(true);
  });

  it("accepts optional tracing metadata on envelope and tool payloads", () => {
    const result = parseEvent({
      ...baseEnvelope("preToolUse"),
      turnId: "turn-1",
      traceId: "trace-1",
      spanId: "span-1",
      parentSpanId: "span-0",
      payload: {
        toolName: "bash",
        toolCallId: "call-1",
        toolArgs: { command: "echo hi" }
      }
    });
    expect(result.ok).toBe(true);
  });
});
