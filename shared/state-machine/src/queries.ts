import type { EventEnvelope } from "../../../shared/event-schema/src/index.js";

export type PreToolEvent = Extract<EventEnvelope, { eventType: "preToolUse" }>;
export type PostToolEvent = Extract<EventEnvelope, { eventType: "postToolUse" | "postToolUseFailure" }>;

export type PairingMode = "toolCallId" | "spanId" | "heuristic";

export interface ToolEventPair {
  pre: PreToolEvent;
  post: PostToolEvent;
  pairingMode: PairingMode;
}

/**
 * Returns all events that belong to a trace, preserving input order.
 */
export function findEventsByTraceId(events: EventEnvelope[], traceId: string): EventEnvelope[] {
  return events.filter((event) => event.traceId === traceId);
}

/**
 * Returns all tool failure events in order.
 */
export function findToolFailures(events: EventEnvelope[]): Extract<EventEnvelope, { eventType: "postToolUseFailure" }>[] {
  return events.filter((event): event is Extract<EventEnvelope, { eventType: "postToolUseFailure" }> => event.eventType === "postToolUseFailure");
}

/**
 * Deterministically pairs preToolUse with postToolUse/postToolUseFailure.
 *
 * Pairing strategy (in order):
 * 1) Exact toolCallId match (payload field)
 * 2) Exact spanId match (envelope field)
 * 3) FIFO heuristic by toolName
 */
export function pairToolEvents(events: EventEnvelope[]): ToolEventPair[] {
  const openByToolCallId = new Map<string, PreToolEvent>();
  const openBySpanId = new Map<string, PreToolEvent>();
  const openByToolName = new Map<string, PreToolEvent[]>();
  const pairs: ToolEventPair[] = [];

  for (const event of events) {
    if (event.eventType === "preToolUse") {
      const toolCallId = event.payload.toolCallId;
      if (toolCallId) {
        openByToolCallId.set(toolCallId, event);
      }
      if (event.spanId) {
        openBySpanId.set(event.spanId, event);
      }
      const queue = openByToolName.get(event.payload.toolName) ?? [];
      queue.push(event);
      openByToolName.set(event.payload.toolName, queue);
      continue;
    }

    if (event.eventType !== "postToolUse" && event.eventType !== "postToolUseFailure") {
      continue;
    }

    const toolCallId = event.payload.toolCallId;
    if (toolCallId) {
      const pre = openByToolCallId.get(toolCallId);
      if (pre) {
        pairs.push({ pre, post: event, pairingMode: "toolCallId" });
        openByToolCallId.delete(toolCallId);
        if (pre.spanId) {
          openBySpanId.delete(pre.spanId);
        }
        removeFromToolQueue(openByToolName, pre);
        continue;
      }
    }

    if (event.spanId) {
      const pre = openBySpanId.get(event.spanId);
      if (pre) {
        pairs.push({ pre, post: event, pairingMode: "spanId" });
        if (pre.payload.toolCallId) {
          openByToolCallId.delete(pre.payload.toolCallId);
        }
        openBySpanId.delete(event.spanId);
        removeFromToolQueue(openByToolName, pre);
        continue;
      }
    }

    const queue = openByToolName.get(event.payload.toolName) ?? [];
    const pre = queue.shift();
    if (!pre) {
      continue;
    }

    pairs.push({ pre, post: event, pairingMode: "heuristic" });
    openByToolName.set(event.payload.toolName, queue);

    if (pre.payload.toolCallId) {
      openByToolCallId.delete(pre.payload.toolCallId);
    }
    if (pre.spanId) {
      openBySpanId.delete(pre.spanId);
    }
  }

  return pairs;
}

function removeFromToolQueue(openByToolName: Map<string, PreToolEvent[]>, target: PreToolEvent): void {
  const queue = openByToolName.get(target.payload.toolName);
  if (!queue || queue.length === 0) {
    return;
  }
  const idx = queue.findIndex((item) => item.eventId === target.eventId);
  if (idx === -1) {
    return;
  }
  queue.splice(idx, 1);
  openByToolName.set(target.payload.toolName, queue);
}

/* ------------------------------------------------------------------ */
/*  P2-1: Execution time breakdown                                     */
/* ------------------------------------------------------------------ */

export interface TimeBreakdown {
  totalDurationMs: number;
  toolExecutionMs: number;
  llmThinkingMs: number;
  userWaitMs: number;
  agentWaitMs: number;
}

/**
 * Compute a time breakdown for a session: how much time was spent in tool
 * execution, LLM thinking (gaps between tools), user waits (ask_user), and
 * agent waits (read_agent).
 */
export function computeTimeBreakdown(events: EventEnvelope[]): TimeBreakdown {
  if (events.length === 0) {
    return { totalDurationMs: 0, toolExecutionMs: 0, llmThinkingMs: 0, userWaitMs: 0, agentWaitMs: 0 };
  }

  const sorted = [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const sessionStart = Date.parse(sorted[0].timestamp);
  const sessionEnd = Date.parse(sorted[sorted.length - 1].timestamp);
  const totalDurationMs = Math.max(0, sessionEnd - sessionStart);

  const pairs = pairToolEvents(events);
  let toolExecutionMs = 0;
  let userWaitMs = 0;
  let agentWaitMs = 0;

  for (const pair of pairs) {
    const start = Date.parse(pair.pre.timestamp);
    const end = Date.parse(pair.post.timestamp);
    const duration = Math.max(0, end - start);

    const toolName = pair.pre.payload.toolName;
    if (toolName === "ask_user") {
      userWaitMs += duration;
    } else if (toolName === "read_agent" || toolName === "write_agent") {
      agentWaitMs += duration;
    } else {
      toolExecutionMs += duration;
    }
  }

  const llmThinkingMs = Math.max(0, totalDurationMs - toolExecutionMs - userWaitMs - agentWaitMs);

  return { totalDurationMs, toolExecutionMs, llmThinkingMs, userWaitMs, agentWaitMs };
}

/* ------------------------------------------------------------------ */
/*  P2-2: Tool usage distribution                                      */
/* ------------------------------------------------------------------ */

export interface ToolDistributionEntry {
  toolName: string;
  count: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

/**
 * Compute tool usage distribution: how many times each tool was used and
 * the total/average duration of each.
 */
export function computeToolDistribution(events: EventEnvelope[]): ToolDistributionEntry[] {
  const pairs = pairToolEvents(events);
  const byTool = new Map<string, { count: number; totalMs: number }>();

  for (const pair of pairs) {
    const name = pair.pre.payload.toolName;
    const start = Date.parse(pair.pre.timestamp);
    const end = Date.parse(pair.post.timestamp);
    const duration = Math.max(0, end - start);

    const entry = byTool.get(name) ?? { count: 0, totalMs: 0 };
    entry.count++;
    entry.totalMs += duration;
    byTool.set(name, entry);
  }

  return [...byTool.entries()]
    .map(([toolName, { count, totalMs }]) => ({
      toolName,
      count,
      totalDurationMs: totalMs,
      avgDurationMs: count > 0 ? Math.round(totalMs / count) : 0,
    }))
    .sort((a, b) => b.count - a.count);
}
