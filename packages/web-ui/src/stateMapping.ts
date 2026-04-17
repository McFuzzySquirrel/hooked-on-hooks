import type { SessionState, VisualizationState } from "../../../shared/state-machine/src/index.js";
import type { LaneData, VisualStatus } from "./types.js";

/**
 * Map the state machine's VisualizationState to the UI's VisualStatus.
 * Both enumerations use the same values; this function acts as the explicit
 * boundary between the backend model and the UI model (LIVE-FR-02).
 */
export function vizToStatus(viz: VisualizationState): VisualStatus {
  switch (viz) {
    case "idle":            return "idle";
    case "tool_running":    return "running";
    case "tool_succeeded":  return "succeeded";
    case "subagent_running": return "subagent_running";
    case "error":           return "error";
    default: {
      // Exhaustiveness guard: fails compilation if a new VisualizationState is
      // added without updating this mapping.
      const _exhaustive: never = viz;
      return "idle";
    }
  }
}

/**
 * Derives the ordered list of LaneData records to display on the Live Board
 * from the current SessionState (LIVE-FR-01).
 *
 * Lanes produced:
 * 1. Session lane — always present, reflects overall lifecycle + visualization.
 * 2. Tool lane    — present when currentTool is not null.
 * 3. Subagent lane — present when activeSubagent is not null.
 */
export function mapStateToLanes(state: SessionState): LaneData[] {
  const lanes: LaneData[] = [];

  // --- Session lane (always rendered) ---
  // Override status for terminal lifecycle states: a completed session should
  // show "Succeeded" (not "Idle"), and a failed session should show "Error".
  const sessionStatus: VisualStatus =
    state.lifecycle === "completed" ? "succeeded" :
    state.lifecycle === "failed"    ? "error" :
    vizToStatus(state.visualization);

  lanes.push({
    id: "session",
    label: `Session: ${state.sessionId}`,
    status: sessionStatus,
    details: state.lifecycle
  });

  // --- Tool lane (rendered when a tool is active or last completed) ---
  if (state.currentTool) {
    const toolStatus: VisualStatus =
      state.visualization === "tool_running"   ? "running" :
      state.visualization === "tool_succeeded" ? "succeeded" :
      state.visualization === "error"          ? "error" : "idle";

    lanes.push({
      id: "tool",
      label: `Tool: ${state.currentTool.toolName}`,
      status: toolStatus,
      details: state.currentTool.errorSummary
    });
  }

  // --- Subagent lane (rendered while a subagent is active) ---
  if (state.activeSubagent) {
    lanes.push({
      id: "subagent",
      label: `Agent: ${state.activeSubagent.agentDisplayName ?? state.activeSubagent.agentName}`,
      status: "subagent_running",
      details:
        state.activeSubagent.agentDescription
        ?? state.activeSubagent.taskDescription
        ?? state.activeSubagent.summary
        ?? state.activeSubagent.message
    });
  }

  return lanes;
}
