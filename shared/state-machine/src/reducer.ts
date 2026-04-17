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
    activeSubagent: null,
    lastAgentName: null,
    eventCount: 0,
    startedAt: null,
    endedAt: null,
  };
}

/**
 * Pure reducer: derives the next SessionState from the current state and one
 * incoming EventEnvelope. This function has NO side effects and NO I/O.
 *
 * Transition rules follow Product Vision §10.3:
 *   sessionStart          → lifecycle: active,     visualization: idle
 *   sessionEnd            → lifecycle: completed,   visualization: idle
 *   preToolUse            →                         visualization: tool_running
 *   postToolUse           →                         visualization: tool_succeeded
 *   postToolUseFailure    →                         visualization: error
 *   errorOccurred         →                         visualization: error
 *   subagentStart         →                         visualization: subagent_running
 *   subagentStop          →                         visualization: idle
 *   agentStop             →                         visualization: idle
 *   userPromptSubmitted   → no visualization change
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

    case "sessionEnd":
      return {
        ...next,
        lifecycle: "completed",
        visualization: "idle",
        endedAt: event.timestamp,
      };

    case "userPromptSubmitted":
      return next;

    case "preToolUse":
      return {
        ...next,
        visualization: "tool_running",
        currentTool: {
          toolName: event.payload.toolName,
          toolArgs: event.payload.toolArgs,
        },
      };

    case "postToolUse":
      return {
        ...next,
        visualization: "tool_succeeded",
        currentTool: {
          toolName: event.payload.toolName,
          toolArgs: next.currentTool?.toolArgs,
          durationMs: event.payload.durationMs,
        },
      };

    case "postToolUseFailure":
      return {
        ...next,
        visualization: "error",
        currentTool: {
          toolName: event.payload.toolName,
          toolArgs: next.currentTool?.toolArgs,
          durationMs: event.payload.durationMs,
          errorSummary: event.payload.errorSummary,
        },
      };

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
