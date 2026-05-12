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
    case "sourceEvent":
      return { sourceEventType: "assistant.message", data: { model: "gpt-5.3-codex" } };
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

  it("normalizes legacy envelopes into the stable hybrid envelope", () => {
    const result = parseEvent({
      ...baseEnvelope("sessionStart"),
      payload: {}
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sourceVersion).toBe("unknown");
      expect(result.value.userId).toBe("unknown");
      expect(result.value.machineId).toBe("unknown");
      expect(result.value.workspaceId).toBe("unknown");
      expect(result.value.privacy.classification).toBe("internal");
      expect(result.value.confidence).toBe("exact");
      expect(result.value.facets.toolCalls).toEqual([]);
    }
  });

  it("accepts source-specific payloads and keeps unknown envelope fields", () => {
    const result = parseEvent({
      ...baseEnvelope("notification"),
      source: "vscode",
      sourceVersion: "1.99.0",
      workspaceId: "workspace-1",
      payload: { notificationType: "info", title: "VS Code", message: "ok", vscodeOnly: true },
      extraEnvelopeField: "future"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.source).toBe("vscode");
      expect((result.value as unknown as Record<string, unknown>).extraEnvelopeField).toBe("future");
      expect((result.value.payload as Record<string, unknown>).vscodeOnly).toBe(true);
    }
  });

  it("accepts normalized facets, tool classifications, and confidence metadata", () => {
    const result = parseEvent({
      ...baseEnvelope("preToolUse"),
      sourceVersion: "0.1.0",
      userId: "user-1",
      machineId: "machine-1",
      workspaceId: "workspace-1",
      privacy: { classification: "confidential", locallyRedacted: true },
      confidence: "inferred",
      facets: {
        toolCalls: [{
          toolName: "task",
          category: "subagent_task_launch",
          status: "requested",
          confidence: "inferred"
        }]
      },
      payload: { toolName: "task", toolArgs: { agent_type: "qa-engineer" } }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.privacy.classification).toBe("confidential");
      expect(result.value.facets.toolCalls[0]?.category).toBe("subagent_task_launch");
      expect(result.value.confidence).toBe("inferred");
    }
  });

  it("accepts direct local source events with extracted facets", () => {
    const result = parseEvent({
      ...baseEnvelope("sourceEvent"),
      source: "copilot-session-store",
      sourceVersion: "session-store-v1",
      payload: {
        sourceEventType: "assistant.message",
        data: {
          model: "gpt-5.3-codex",
          inputTokens: 10,
          outputTokens: 20,
          toolRequests: [{ name: "subagent", arguments: { agentName: "qa-engineer" } }]
        }
      },
      facets: {
        modelUsage: [{ model: "gpt-5.3-codex", inputTokens: 10, outputTokens: 20, totalTokens: 30, confidence: "exact" }]
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.eventType).toBe("sourceEvent");
      expect(result.value.source).toBe("copilot-session-store");
      expect(result.value.payload.sourceEventType).toBe("assistant.message");
      expect(result.value.facets.modelUsage[0]?.model).toBe("gpt-5.3-codex");
    }
  });
});
