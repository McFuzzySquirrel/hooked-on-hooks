import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { parseEvent, type EventEnvelope } from "../../../shared/event-schema/src/index.js";
import { rebuildState, reduceEvent, initialSessionState, pairToolEvents, type SessionState } from "../../../shared/state-machine/src/index.js";

export type { SessionState };

interface PairingDiagnostics {
  totalPairs: number;
  byMode: {
    toolCallId: number;
    spanId: number;
    heuristic: number;
  };
  unmatched: {
    preToolUse: number;
    postToolUse: number;
  };
}

function computePairingDiagnostics(events: EventEnvelope[]): PairingDiagnostics {
  const pairs = pairToolEvents(events);
  const byMode: PairingDiagnostics["byMode"] = {
    toolCallId: 0,
    spanId: 0,
    heuristic: 0,
  };

  for (const pair of pairs) {
    byMode[pair.pairingMode] += 1;
  }

  const preCount = events.filter((event) => event.eventType === "preToolUse").length;
  const postCount = events.filter((event) => event.eventType === "postToolUse" || event.eventType === "postToolUseFailure").length;

  return {
    totalPairs: pairs.length,
    byMode,
    unmatched: {
      preToolUse: Math.max(0, preCount - pairs.length),
      postToolUse: Math.max(0, postCount - pairs.length),
    },
  };
}

export async function parseJsonlFile(filePath: string): Promise<EventEnvelope[]> {
  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  const events: EventEnvelope[] = [];

  for (const line of lines) {
    const parsed = parseEvent(JSON.parse(line));
    if (parsed.ok) {
      events.push(parsed.value);
    }
  }

  return events;
}

/**
 * Parses a JSONL file and replays all valid events through the deterministic
 * state machine to reconstruct the current SessionState (STAT-FR-03).
 */
export async function rebuildStateFromFile(filePath: string): Promise<SessionState> {
  const events = await parseJsonlFile(filePath);
  return rebuildState(events);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

interface TaskAgentInfo {
  agentName: string;
  taskDescription?: string;
  message?: string;
  summary?: string;
}

function extractTaskAgentInfo(event: EventEnvelope): TaskAgentInfo | null {
  if (
    event.eventType !== "preToolUse"
    && event.eventType !== "postToolUse"
    && event.eventType !== "postToolUseFailure"
  ) {
    return null;
  }

  const payload = event.payload as Record<string, unknown>;
  if (payload.toolName !== "task") {
    return null;
  }

  const toolArgs = asRecord(payload.toolArgs);
  if (!toolArgs) {
    return null;
  }

  const agentType = typeof toolArgs.agent_type === "string" ? toolArgs.agent_type : undefined;
  const taskName = typeof toolArgs.name === "string" ? toolArgs.name : undefined;
  const agentName = agentType ?? taskName;
  if (!agentName || agentName.trim().length === 0) {
    return null;
  }

  const description = typeof toolArgs.description === "string" ? toolArgs.description : undefined;

  return {
    agentName,
    taskDescription: description,
    message: description,
    summary: description,
  };
}

function buildSyntheticEvent(
  base: EventEnvelope,
  eventType: "subagentStart" | "subagentStop",
  payload: Record<string, unknown>,
): EventEnvelope {
  return {
    schemaVersion: base.schemaVersion,
    eventId: randomUUID(),
    eventType,
    timestamp: base.timestamp,
    sessionId: base.sessionId,
    source: base.source,
    repoPath: base.repoPath,
    payload,
  } as EventEnvelope;
}

export async function createIngestServer(): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  await server.register(cors, { origin: true });
  const acceptedEvents: EventEnvelope[] = [];
  let currentState: SessionState = initialSessionState("unknown");

  type PushFn = (data: string) => void;
  const sseSubscribers = new Set<PushFn>();

  function broadcastState(): void {
    const payload = `data: ${JSON.stringify(currentState)}\n\n`;
    for (const push of sseSubscribers) {
      push(payload);
    }
  }

  server.post("/events", async (request, reply) => {
    const parsed = parseEvent(request.body);
    if (!parsed.ok) {
      return reply.status(400).send({ ok: false, error: parsed.error });
    }

    let incoming = parsed.value;
    const eventsToApply: EventEnvelope[] = [];

    // Enrich incoming subagentStop from real hooks with taskDescription from tracked state.
    // Falls back to "Completed" when no description was captured, so the field is never blank.
    if (incoming.eventType === "subagentStop") {
      const payload = { ...(incoming.payload as Record<string, unknown>) };
      if (typeof payload.taskDescription !== "string" || payload.taskDescription.length === 0) {
        payload.taskDescription = currentState.activeSubagent?.taskDescription ?? "Completed";
      }
      incoming = { ...incoming, payload } as EventEnvelope;
    }

    if (incoming.eventType === "agentStop" && currentState.activeSubagent?.taskDescription) {
      const payload = { ...(incoming.payload as Record<string, unknown>) };
      const activeTaskDescription = currentState.activeSubagent.taskDescription;

      if (typeof payload.taskDescription !== "string" || payload.taskDescription.length === 0) {
        payload.taskDescription = activeTaskDescription;
      }
      if (typeof payload.description !== "string" || payload.description.length === 0) {
        payload.description = activeTaskDescription;
      }
      if (typeof payload.message !== "string" || payload.message.length === 0) {
        payload.message = activeTaskDescription;
      }
      if (typeof payload.summary !== "string" || payload.summary.length === 0) {
        payload.summary = activeTaskDescription;
      }

      incoming = { ...incoming, payload } as EventEnvelope;
    }

    const taskAgent = extractTaskAgentInfo(incoming);

    // Synthesize subagent lifecycle from task tool calls when agent_type is present.
    // Observed runtime behavior indicates the task postToolUse payload carries the
    // actionable subagent metadata, so we start the lane there.
    if ((incoming.eventType === "postToolUse" || incoming.eventType === "postToolUseFailure") && taskAgent) {
      const activeName = currentState.activeSubagent?.agentName;

      // If a different subagent appears, close the previous one first.
      if (activeName && activeName !== taskAgent.agentName) {
        eventsToApply.push(buildSyntheticEvent(incoming, "subagentStop", {
          agentName: activeName,
          taskDescription: currentState.activeSubagent?.taskDescription ?? "Completed",
          message: currentState.activeSubagent?.message,
          summary: currentState.activeSubagent?.summary,
        }));
      }

      if (activeName !== taskAgent.agentName) {
        eventsToApply.push(buildSyntheticEvent(incoming, "subagentStart", {
          agentName: taskAgent.agentName,
          taskDescription: taskAgent.taskDescription,
          message: taskAgent.message,
          summary: taskAgent.summary,
        }));
      }
    }

    // agentStop is treated as the end of the current active subagent lane.
    if (incoming.eventType === "agentStop" && currentState.activeSubagent) {
      const payload = incoming.payload as Record<string, unknown>;
      const message = typeof payload.message === "string" ? payload.message : currentState.activeSubagent.message;
      const summary = typeof payload.summary === "string" ? payload.summary : currentState.activeSubagent.summary;

      eventsToApply.push(buildSyntheticEvent(incoming, "subagentStop", {
        agentName: currentState.activeSubagent.agentName,
        taskDescription: currentState.activeSubagent.taskDescription ?? "Completed",
        message,
        summary,
      }));
    }

    eventsToApply.push(incoming);

    for (const event of eventsToApply) {
      acceptedEvents.push(event);
      if (currentState.sessionId === "unknown") {
        currentState = initialSessionState(event.sessionId);
      }
      currentState = reduceEvent(currentState, event);
    }

    broadcastState();
    return reply.send({ ok: true });
  });

  server.get("/events", async () => {
    return { count: acceptedEvents.length, events: acceptedEvents };
  });

  server.get("/diagnostics/pairing", async () => {
    const diagnostics = computePairingDiagnostics(acceptedEvents);
    return diagnostics;
  });

  /**
   * GET /state/stream — SSE endpoint for real-time state push (LIVE-FR-03).
   * Immediately emits the current SessionState on connect, then streams updates
   * as events are ingested via POST /events.
   */
  server.get("/state/stream", (request, reply) => {
    const stream = new PassThrough();

    void reply
      .type("text/event-stream")
      .header("Cache-Control", "no-cache")
      .header("Connection", "keep-alive")
      .header("Access-Control-Allow-Origin", "*")
      .send(stream);

    stream.write(`data: ${JSON.stringify(currentState)}\n\n`);

    const pushFn: PushFn = (data) => {
      if (!stream.destroyed) stream.write(data);
    };
    sseSubscribers.add(pushFn);

    request.raw.on("close", () => {
      sseSubscribers.delete(pushFn);
      if (!stream.destroyed) stream.destroy();
    });
  });

  return server;
}
