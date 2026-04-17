import type { LaneData } from "../types.js";

/** Human-readable labels for each visual status value (LIVE-FR-02). */
const STATUS_LABELS: Record<LaneData["status"], string> = {
  idle:            "Idle",
  running:         "Running",
  succeeded:       "Succeeded",
  error:           "Error",
  subagent_running: "Subagent Running"
};

const STATUS_COLORS: Record<LaneData["status"], string> = {
  idle:             "#94a3b8",
  running:          "#f59e0b",
  succeeded:        "#22c55e",
  error:            "#ef4444",
  subagent_running: "#a855f7",
};

const detailsStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "0.8rem",
  maxWidth: 200,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

interface Props {
  lane: LaneData;
}

/**
 * Renders a single lane row on the Live Board.
 * Uses data-status for CSS styling hooks and aria-live for screen reader updates.
 */
export function LaneItem({ lane }: Props) {
  const color = STATUS_COLORS[lane.status];
  const isActive = lane.status === "running" || lane.status === "subagent_running";

  return (
    <div
      role="listitem"
      aria-label={`${lane.label}: ${STATUS_LABELS[lane.status]}`}
      data-status={lane.status}
      style={{
        display: "flex",
        gap: "1rem",
        padding: "0.5rem 0",
        alignItems: "center",
        borderBottom: "1px solid #334155",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: color,
          color,
          flexShrink: 0,
          animation: isActive
            ? "lane-dot-pulse 1.5s ease-in-out infinite"
            : "none",
        }}
      />
      <span style={{ flex: 1, color: "#f1f5f9", fontSize: "0.9rem" }}>
        {lane.label}
      </span>
      <span
        aria-live="polite"
        style={{
          minWidth: 140,
          fontWeight: 600,
          fontSize: "0.85rem",
          color,
        }}
      >
        {STATUS_LABELS[lane.status]}
      </span>
      {lane.details && (
        <span aria-label="details" style={detailsStyle}>
          {lane.details}
        </span>
      )}
    </div>
  );
}
