/**
 * SessionLifecycleState tracks the overall session lifecycle.
 * Transitions: not_started -> active -> completed | failed
 */
export type SessionLifecycleState = "not_started" | "active" | "completed" | "failed";

/**
 * VisualizationState reflects the current rendering state of the session,
 * as defined in Product Vision §10.2 and §10.3.
 */
export type VisualizationState =
  | "idle"
  | "tool_running"
  | "tool_succeeded"
  | "subagent_running"
  | "waiting_for_user"
  | "waiting_for_agent"
  | "error";

/** Snapshot of the tool currently being or last executed. */
export interface ToolInfo {
  toolName: string;
  toolArgs?: Record<string, unknown>;
  durationMs?: number;
  errorSummary?: string;
  /** The eventId of the preToolUse that started this tool invocation. */
  eventId?: string;
  /** Optional toolCallId for deterministic pairing with postToolUse. */
  toolCallId?: string;
  /** ISO timestamp when this tool started. */
  startedAt?: string;
}

/** Snapshot of the active subagent. */
export interface SubagentInfo {
  agentName: string;
  agentDisplayName?: string;
  agentDescription?: string;
  /** The agent_type category (e.g. "ui-engineer", "rubber-duck"). */
  agentType?: string;
  taskDescription?: string;
  message?: string;
  summary?: string;
}

/**
 * SessionState is the full typed state snapshot produced by the deterministic
 * state machine after processing one or more EventEnvelope records.
 */
export interface SessionState {
  /** The session identifier carried from the first event's sessionId field. */
  sessionId: string;
  /** Overall session lifecycle position. */
  lifecycle: SessionLifecycleState;
  /** Current visualization rendering state for the live board. */
  visualization: VisualizationState;
  /** Current or most recent tool invocation details. Null if no tool has run. */
  currentTool: ToolInfo | null;
  /**
   * All currently in-flight tools, keyed by eventId.
   * Supports concurrent tool execution (multiple preToolUse before postToolUse).
   */
  activeTools: Record<string, ToolInfo>;
  /** Currently running subagent. Null when no subagent is active. */
  activeSubagent: SubagentInfo | null;
  /** Name of the last agent that stopped. Null if unknown. */
  lastAgentName: string | null;
  /** Total number of events reduced into this state snapshot. */
  eventCount: number;
  /** ISO timestamp from the sessionStart event. Null if session has not started. */
  startedAt: string | null;
  /** ISO timestamp from the sessionEnd event. Null if session has not ended. */
  endedAt: string | null;
  /** Current workflow intent from the most recent report_intent tool call. */
  currentIntent: string | null;
  /** Number of user prompt turns in this session. */
  turnCount: number;
  /** ISO timestamp when the current turn started. Null before first prompt. */
  currentTurnStartTime: string | null;
  /** Number of tools that were orphaned (preToolUse with no matching post). */
  orphanedToolCount: number;
}
