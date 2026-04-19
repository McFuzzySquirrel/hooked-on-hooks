import type { EventEnvelope } from "../../../shared/event-schema/src/index.js";
import type { SessionState } from "./types.js";

/**
 * Returns the canonical empty SessionState for a given sessionId.
 * Used as the accumulator seed for rebuildState and as the initial
 * state before the first event is processed.
 */
export function initialSessionState(sessionId: string): SessionState {
  return {
    sessionId,
    lifecycle: "not_started",
    visualization: "idle",
    currentTool: null,
    activeTools: {},
    activeSubagent: null,
    lastAgentName: null,
    eventCount: 0,
    startedAt: null,
    endedAt: null,
    currentIntent: null,
    turnCount: 0,
    currentTurnStartTime: null,
    orphanedToolCount: 0,
  };
}

/**
 * Pure reducer: derives the next SessionState from the current state and one
 * incoming EventEnvelope. This function has NO side effects and NO I/O.
 *
 * Transition rules follow Product Vision §10.3:
 *   sessionStart          → lifecycle: active,     visualization: idle
 *   sessionEnd            → lifecycle: completed,   visualization: idle, orphan activeTools
 *   preToolUse            →                         visualization: tool_running | waiting_*
 *   postToolUse           →                         visualization: tool_succeeded (if no more active)
 *   postToolUseFailure    →                         visualization: error
 *   errorOccurred         →                         visualization: error
 *   subagentStart         →                         visualization: subagent_running
 *   subagentStop          →                         visualization: idle
 *   agentStop             →                         visualization: idle
 *   userPromptSubmitted   → turnCount++
 *   notification          → no visualization change
 */
export function reduceEvent(state: SessionState, event: EventEnvelope): SessionState {
  const next: SessionState = { ...state, eventCount: state.eventCount + 1 };

  switch (event.eventType) {
    case "sessionStart":
      return {
        ...next,
        lifecycle: "active",
        visualization: "idle",
        startedAt: event.timestamp,
      };

    case "sessionEnd": {
      const orphanCount = Object.keys(next.activeTools).length;
      return {
        ...next,
        lifecycle: "completed",
        visualization: "idle",
        endedAt: event.timestamp,
        activeTools: {},
        orphanedToolCount: next.orphanedToolCount + orphanCount,
      };
    }

    case "userPromptSubmitted":
      return {
        ...next,
        turnCount: next.turnCount + 1,
        currentTurnStartTime: event.timestamp,
      };

    case "preToolUse": {
      const toolInfo: ToolInfo = {
        toolName: event.payload.toolName,
        toolArgs: event.payload.toolArgs,
        eventId: event.eventId,
        toolCallId: event.payload.toolCallId,
        startedAt: event.timestamp,
      };

      const newActiveTools = { ...next.activeTools, [event.eventId]: toolInfo };

      // Extract intent from report_intent tool calls
      let intentUpdate = next.currentIntent;
      if (event.payload.toolName === "report_intent") {
        const args = event.payload.toolArgs;
        if (args && typeof args.intent === "string") {
          intentUpdate = args.intent;
        }
      }

      // Determine visualization based on tool type
      let viz: SessionState["visualization"] = "tool_running";
      if (event.payload.toolName === "ask_user") {
        viz = "waiting_for_user";
      } else if (event.payload.toolName === "read_agent") {
        viz = "waiting_for_agent";
      }

      return {
        ...next,
        visualization: viz,
        currentTool: toolInfo,
        activeTools: newActiveTools,
        currentIntent: intentUpdate,
      };
    }

    case "postToolUse": {
      const { activeTools: remaining, matched } = removeMatchingTool(next.activeTools, event);
      const completedTool: ToolInfo = {
        toolName: event.payload.toolName,
        toolArgs: matched?.toolArgs ?? next.currentTool?.toolArgs,
        durationMs: event.payload.durationMs,
        eventId: matched?.eventId,
        toolCallId: event.payload.toolCallId,
        startedAt: matched?.startedAt,
      };
      const activeCount = Object.keys(remaining).length;

      return {
        ...next,
        visualization: activeCount > 0 ? "tool_running" : "tool_succeeded",
        currentTool: completedTool,
        activeTools: remaining,
      };
    }

    case "postToolUseFailure": {
      const { activeTools: remaining, matched } = removeMatchingTool(next.activeTools, event);
      return {
        ...next,
        visualization: "error",
        currentTool: {
          toolName: event.payload.toolName,
          toolArgs: matched?.toolArgs ?? next.currentTool?.toolArgs,
          durationMs: event.payload.durationMs,
          errorSummary: event.payload.errorSummary,
          eventId: matched?.eventId,
          toolCallId: event.payload.toolCallId,
          startedAt: matched?.startedAt,
        },
        activeTools: remaining,
      };
    }

    case "subagentStart":
      return {
        ...next,
        visualization: "subagent_running",
        activeSubagent: {
          agentName: event.payload.agentName,
          agentDisplayName: event.payload.agentDisplayName,
          agentDescription: event.payload.agentDescription,
          taskDescription: event.payload.taskDescription,
          message: event.payload.message,
          summary: event.payload.summary,
        },
      };

    case "subagentStop":
      return { ...next, visualization: "idle", activeSubagent: null };

    case "agentStop":
      return {
        ...next,
        visualization: "idle",
        lastAgentName: event.payload.agentName || state.lastAgentName,
      };

    case "notification":
      return next;

    case "errorOccurred":
      return { ...next, visualization: "error" };

    default: {
      // Exhaustiveness guard — TypeScript will error here if a new event type
      // is added to EventEnvelope without a corresponding case above.
      const _exhaustive: never = event;
      return next;
    }
  }
}

/**
 * Finds and removes the matching preToolUse entry from activeTools for a
 * post event. Uses the same priority as pairToolEvents: toolCallId first,
 * then FIFO by toolName.
 */
function removeMatchingTool(
  activeTools: Record<string, ToolInfo>,
  postEvent: Extract<EventEnvelope, { eventType: "postToolUse" | "postToolUseFailure" }>,
): { activeTools: Record<string, ToolInfo>; matched: ToolInfo | null } {
  const entries = Object.entries(activeTools);
  const toolCallId = postEvent.payload.toolCallId;

  // Priority 1: match by toolCallId
  if (toolCallId) {
    const match = entries.find(([, info]) => info.toolCallId === toolCallId);
    if (match) {
      const remaining = { ...activeTools };
      delete remaining[match[0]];
      return { activeTools: remaining, matched: match[1] };
    }
  }

  // Priority 2: FIFO by toolName
  const match = entries.find(([, info]) => info.toolName === postEvent.payload.toolName);
  if (match) {
    const remaining = { ...activeTools };
    delete remaining[match[0]];
    return { activeTools: remaining, matched: match[1] };
  }

  return { activeTools, matched: null };
}

/**
 * Replays all events in order to reconstruct the current SessionState from
 * persisted logs. Satisfies STAT-FR-03 (restart recovery).
 *
 * If the events array is empty, returns the initial state with sessionId "unknown".
 */
export function rebuildState(events: EventEnvelope[]): SessionState {
  if (events.length === 0) {
    return initialSessionState("unknown");
  }
  const sessionId = events[0].sessionId;
  return events.reduce(
    (state, event) => reduceEvent(state, event),
    initialSessionState(sessionId),
  );
}
