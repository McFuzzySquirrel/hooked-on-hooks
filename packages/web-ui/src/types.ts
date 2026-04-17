/**
 * Shared type definitions for the Live Visualization Board (LIVE feature).
 */

/**
 * Visual status of a single activity lane, aligned with Product Vision §10.2
 * and the state machine's VisualizationState.
 */
export type VisualStatus = "idle" | "running" | "succeeded" | "error" | "subagent_running";

/**
 * Data model for a single rendered lane on the Live Board.
 * One lane per active concern: session, tool, subagent.
 */
export interface LaneData {
  /** Stable key for React reconciliation. */
  id: string;
  /** Human-readable label shown in the lane header. */
  label: string;
  /** Current visual status drives the rendered state indicator. */
  status: VisualStatus;
  /** Optional supporting detail (lifecycle state, error summary, etc.). */
  details?: string;
}

/**
 * Filter configuration for narrowing the event timeline (LIVE-FR-05).
 * All fields are optional; an empty filter passes all events.
 */
export interface FilterConfig {
  /** If non-empty, only events whose eventType is in this list are shown. */
  eventTypes?: string[];
  /** If non-empty, only events whose tool or agent name contains this string are shown. */
  actorName?: string;
}

/**
 * Snapshot of a single event shown in the EventInspector panel (LIVE-FR-04).
 */
export interface InspectorEntry {
  eventId: string;
  eventType: string;
  timestamp: string;
  sessionId: string;
  turnId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  payload: Record<string, unknown>;
}

/** Replay speeds available in the MVP replay controls. */
export type ReplaySpeed = 0.5 | 1 | 2 | 4;
