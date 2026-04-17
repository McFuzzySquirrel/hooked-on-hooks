import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { GanttRow, GanttSegment } from "../ganttData.js";
import { computeTimeRange, findLatestRunningSegmentId } from "../ganttData.js";

/* ------------------------------------------------------------------ */
/*  Style constants                                                    */
/* ------------------------------------------------------------------ */

const ROW_HEIGHT = 40;
const LABEL_WIDTH = 200;
const TIME_AXIS_HEIGHT = 32;
const BAR_V_PADDING = 6;
const MIN_BAR_WIDTH = 6;
const POINT_EVENT_WIDTH = 8;
const MIN_PIXELS_PER_TICK = 100;
const MAX_TOOLTIP_VALUE_LENGTH = 120;

/** Dashed repeating gradient for idle gap segments. */
const IDLE_GAP_GRADIENT =
  "repeating-linear-gradient(90deg, var(--gantt-idle, #475569) 0px, var(--gantt-idle, #475569) 4px, transparent 4px, transparent 8px)";

const CATEGORY_COLORS: Record<GanttSegment["category"], string> = {
  session: "var(--gantt-session, #3b82f6)",
  tool: "var(--gantt-tool-success, #22c55e)",
  subagent: "var(--gantt-subagent, #a855f7)",
  error: "var(--gantt-error, #ef4444)",
  prompt: "var(--gantt-prompt, #06b6d4)",
};

/**
 * R2: Bar colour is determined by CATEGORY, not status.
 * Status is communicated via icon overlays instead.
 */
function barColor(seg: GanttSegment): string {
  if (seg.status === "failed") return "var(--gantt-tool-failed, #ef4444)";
  if (seg.status === "idle") return "var(--gantt-idle, #475569)";
  // Running and succeeded bars both use category colour
  return CATEGORY_COLORS[seg.category];
}

/** Status icon overlay text (R2). */
function statusIcon(seg: GanttSegment, isLatestRunning: boolean): string | null {
  if (seg.status === "running" && isLatestRunning) return "⏳";
  if (seg.status === "running") return "⋯"; // orphaned/stale running
  if (seg.status === "failed") return "✗";
  if (seg.status === "succeeded" && seg.endTime !== null && seg.endTime !== seg.startTime) return "✓";
  return null;
}

/** Compute bar opacity based on segment state. */
function barOpacity(seg: GanttSegment, isIdleGap: boolean, isOrphanedRunning: boolean, isRunning: boolean, isIdle: boolean): number {
  if (isIdleGap) return 0.35;
  if (isOrphanedRunning) return 0.55;
  if (isRunning && isIdle) return 0.5;
  return 0.9;
}

/* ------------------------------------------------------------------ */
/*  Tooltip                                                            */
/* ------------------------------------------------------------------ */

interface TooltipData {
  segment: GanttSegment;
  x: number;
  y: number;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function Tooltip({ data }: { data: TooltipData }) {
  const { segment, x, y } = data;
  const dur =
    segment.endTime !== null && segment.endTime !== segment.startTime
      ? formatDuration(segment.endTime - segment.startTime)
      : null;

  const style: React.CSSProperties = {
    position: "fixed",
    left: x + 12,
    top: y - 8,
    zIndex: 1000,
    background: "#1e293b",
    border: "1px solid #475569",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: "0.8rem",
    lineHeight: 1.6,
    pointerEvents: "none",
    maxWidth: 340,
    color: "#f1f5f9",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  };

  // Extract key payload fields (skip very long values and nested objects)
  const detailEntries = Object.entries(segment.details)
    .filter(([, v]) => (typeof v !== "object" || v === null) && String(v).length < MAX_TOOLTIP_VALUE_LENGTH)
    .slice(0, 6);

  return (
    <div style={style} role="tooltip" aria-label="Segment details">
      <div style={{ fontWeight: 700, marginBottom: 4, color: barColor(segment) }}>
        {segment.label}
      </div>
      <div>
        <span style={{ color: "#94a3b8" }}>Type: </span>
        {segment.eventType}
      </div>
      <div>
        <span style={{ color: "#94a3b8" }}>Start: </span>
        {formatTime(segment.startTime)}
      </div>
      <div>
        <span style={{ color: "#94a3b8" }}>End: </span>
        {segment.endTime !== null ? formatTime(segment.endTime) : "In progress…"}
      </div>
      {dur && (
        <div>
          <span style={{ color: "#94a3b8" }}>Duration: </span>
          {dur}
        </div>
      )}
      <div>
        <span style={{ color: "#94a3b8" }}>Status: </span>
        <span
          style={{
            color:
              segment.status === "failed"
                ? "#ef4444"
                : segment.status === "running"
                  ? "#f59e0b"
                  : "#22c55e",
          }}
        >
          {segment.status}
        </span>
      </div>
      {detailEntries.length > 0 && (
        <div
          style={{
            borderTop: "1px solid #475569",
            marginTop: 6,
            paddingTop: 6,
          }}
        >
          {detailEntries.map(([k, v]) => (
            <div key={k} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <span style={{ color: "#94a3b8" }}>{k}: </span>
              {String(v)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Time axis                                                          */
/* ------------------------------------------------------------------ */

function TimeAxis({
  minTime,
  maxTime,
  width,
}: {
  minTime: number;
  maxTime: number;
  width: number;
}) {
  const range = maxTime - minTime || 1;
  // Aim for ~5-8 ticks
  const tickCount = Math.min(8, Math.max(2, Math.floor(width / MIN_PIXELS_PER_TICK)));
  const ticks: number[] = [];
  for (let i = 0; i <= tickCount; i++) {
    ticks.push(minTime + (range * i) / tickCount);
  }

  return (
    <div
      style={{
        position: "relative",
        height: TIME_AXIS_HEIGHT,
        marginLeft: LABEL_WIDTH,
        borderBottom: "1px solid #475569",
        fontSize: "0.7rem",
        color: "#94a3b8",
        userSelect: "none",
      }}
      aria-hidden="true"
    >
      {ticks.map((t) => {
        const pct = ((t - minTime) / range) * 100;
        return (
          <span
            key={t}
            style={{
              position: "absolute",
              left: `${pct}%`,
              bottom: 4,
              transform: "translateX(-50%)",
              whiteSpace: "nowrap",
            }}
          >
            {formatTime(t)}
          </span>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  GanttChart component                                               */
/* ------------------------------------------------------------------ */

interface Props {
  rows: GanttRow[];
  /** When true, the session has ended — stop animating running bars. */
  sessionCompleted?: boolean;
  /** When true, the visualization state is idle — pause animations for running bars. */
  isIdle?: boolean;
  /** Optional callback when a segment bar is selected. */
  onSegmentSelect?: (segment: GanttSegment, row: GanttRow) => void;
  /** Currently selected time window, used to highlight the active segment. */
  selectedPeriod?: {
    startTime: number;
    endTime: number;
    label: string;
  } | null;
}

export function GanttChart({ rows, sessionCompleted, isIdle, onSegmentSelect, selectedPeriod }: Props) {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [now, setNow] = useState(Date.now());
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  // R3: Identify the single most-recent running segment for pulse animation
  const latestRunningId = useMemo(() => findLatestRunningSegmentId(rows), [rows]);

  // Tick `now` forward while there are running segments, session is active, and not idle
  const hasRunning =
    !sessionCompleted &&
    !isIdle &&
    rows.some((r) =>
      r.segments.some(
        (s) => s.endTime === null && s.status === "running" && s.category !== "session"
      )
    );

  useEffect(() => {
    if (!hasRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [hasRunning]);

  // Measure container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const w = el.getBoundingClientRect().width - LABEL_WIDTH;
      setContainerWidth(Math.max(w, 100));
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleMouseMove = useCallback(
    (seg: GanttSegment, e: React.MouseEvent) => {
      setTooltip({ segment: seg, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  if (rows.length === 0) {
    return (
      <section
        aria-label="Gantt chart"
        style={{
          background: "#1e293b",
          borderRadius: 10,
          padding: "2rem",
          textAlign: "center",
          border: "1px solid #475569",
        }}
      >
        <p style={{ color: "#94a3b8", margin: 0 }}>
          No events yet — the Gantt chart will appear when events arrive.
        </p>
      </section>
    );
  }

  const [minTime, rawMax] = computeTimeRange(rows);
  const maxTime = hasRunning ? Math.max(rawMax, now) : rawMax;
  const range = maxTime - minTime || 1;
  const barAreaWidth = containerWidth;

  return (
    <section aria-label="Gantt chart" ref={containerRef}>
      <div
        style={{
          background: "#1e293b",
          borderRadius: 10,
          border: "1px solid #475569",
          overflow: "hidden",
        }}
      >
        {/* Time axis */}
        <TimeAxis minTime={minTime} maxTime={maxTime} width={barAreaWidth} />

        {/* Rows */}
        {rows.map((row, rowIdx) => (
          <div
            key={row.rowId}
            style={{
              display: "flex",
              height: ROW_HEIGHT,
              borderBottom:
                rowIdx < rows.length - 1 ? "1px solid #334155" : "none",
              alignItems: "center",
            }}
            role="listitem"
            aria-label={row.label}
          >
            {/* Label */}
            <div
              style={{
                width: LABEL_WIDTH,
                minWidth: LABEL_WIDTH,
                paddingLeft: 14,
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "#f1f5f9",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={row.label}
            >
              {row.label}
              {/* R5: Show collapsed group count badge */}
              {row.collapsedGroups && row.collapsedGroups.length > 0 && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: "0.65rem",
                    color: "#94a3b8",
                    fontWeight: 400,
                  }}
                >
                  ({row.collapsedGroups.reduce((s, g) => s + g.count, 0)} calls)
                </span>
              )}
            </div>

            {/* Bar area */}
            <div
              style={{
                position: "relative",
                flex: 1,
                height: ROW_HEIGHT,
                overflow: "hidden",
              }}
            >
              {row.segments.map((seg) => {
                const startPct =
                  ((seg.startTime - minTime) / range) * 100;
                const end = seg.endTime ?? now;
                const widthPct = ((end - seg.startTime) / range) * 100;
                const isPoint = seg.endTime === seg.startTime;
                const isRunning = seg.endTime === null;
                const isIdleGap = seg.status === "idle" && seg.eventType === "idle";
                const isCollapsed = seg.eventType === "collapsed";
                const isSelected =
                  !!selectedPeriod &&
                  selectedPeriod.startTime === seg.startTime &&
                  selectedPeriod.endTime === (seg.endTime ?? now) &&
                  selectedPeriod.label === seg.label;

                // R3: Only the latest running segment pulses
                const isLatestRunning = seg.id === latestRunningId;
                const shouldAnimate = isRunning && !isIdle && isLatestRunning;
                // R3: Orphaned running bars (not latest) get a dashed right edge
                const isOrphanedRunning = isRunning && !isLatestRunning && !isIdle;

                // R1: Duration label
                const durationMs = seg.endTime !== null && seg.endTime !== seg.startTime
                  ? seg.endTime - seg.startTime
                  : null;
                const durationLabel = durationMs !== null ? formatDuration(durationMs) : null;
                // Show duration label if bar is wide enough (>40px equivalent)
                const barWidthPx = (widthPct / 100) * barAreaWidth;
                const showDurationLabel = durationLabel && barWidthPx > 40 && !isPoint;

                // R2: Status icon
                const icon = statusIcon(seg, isLatestRunning);

                return (
                  <div
                    key={seg.id}
                    onMouseMove={(e) => handleMouseMove(seg, e)}
                    onMouseLeave={handleMouseLeave}
                    onClick={() => onSegmentSelect?.(seg, row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSegmentSelect?.(seg, row);
                      }
                    }}
                    tabIndex={0}
                    style={{
                      position: "absolute",
                      left: `${startPct}%`,
                      top: BAR_V_PADDING,
                      height: ROW_HEIGHT - BAR_V_PADDING * 2,
                      width: isPoint ? POINT_EVENT_WIDTH : `${widthPct}%`,
                      minWidth: isPoint ? POINT_EVENT_WIDTH : MIN_BAR_WIDTH,
                      background: isIdleGap
                        ? IDLE_GAP_GRADIENT
                        : barColor(seg),
                      borderRadius: isPoint ? "50%" : 4,
                      opacity: barOpacity(seg, isIdleGap, isOrphanedRunning, isRunning, !!isIdle),
                      cursor: "pointer",
                      transition: isRunning ? "none" : "width 0.3s ease",
                      animation: shouldAnimate
                        ? "gantt-pulse 1.5s ease-in-out infinite"
                        : "none",
                      // R3: Orphaned running bars get a dashed right border
                      borderRight: isOrphanedRunning ? "2px dashed rgba(255,255,255,0.3)" : "none",
                      outline: isSelected ? "2px solid #f8fafc" : "none",
                      outlineOffset: isSelected ? 1 : 0,
                      boxShadow: isSelected
                        ? "0 0 0 2px rgba(59, 130, 246, 0.5), 0 0 18px rgba(59, 130, 246, 0.35)"
                        : isRunning
                          ? undefined
                          : "none",
                      // R5: Collapsed bars get a striped pattern overlay
                      backgroundImage: isCollapsed
                        ? `repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.08) 3px, rgba(255,255,255,0.08) 6px)`
                        : undefined,
                      // R1/R2: Layout for text content
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 3,
                      overflow: "hidden",
                    }}
                    role="button"
                    aria-pressed={isSelected}
                    aria-label={`${seg.label}: ${seg.status}${
                      durationLabel ? ` (${durationLabel})` : ""
                    }`}
                  >
                    {/* R2: Status icon */}
                    {icon && barWidthPx > 20 && (
                      <span
                        style={{
                          fontSize: "0.6rem",
                          lineHeight: 1,
                          flexShrink: 0,
                          filter: seg.status === "failed" ? "none" : "drop-shadow(0 0 1px rgba(0,0,0,0.5))",
                        }}
                      >
                        {icon}
                      </span>
                    )}
                    {/* R1: Duration text label */}
                    {showDurationLabel && (
                      <span
                        style={{
                          fontSize: "0.6rem",
                          fontWeight: 600,
                          color: "#fff",
                          textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          lineHeight: 1,
                        }}
                      >
                        {durationLabel}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Bottom time axis for longer charts */}
        {rows.length > 4 && (
          <TimeAxis minTime={minTime} maxTime={maxTime} width={barAreaWidth} />
        )}
      </div>

      {/* Tooltip overlay */}
      {tooltip && <Tooltip data={tooltip} />}

      {/* Legend — updated to reflect R2 category-based colours */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          flexWrap: "wrap",
          marginTop: 10,
          fontSize: "0.75rem",
          color: "#94a3b8",
        }}
        aria-label="Gantt chart legend"
      >
        {([
          ["Session", "var(--gantt-session, #3b82f6)", undefined],
          ["Tool", "var(--gantt-tool-success, #22c55e)", undefined],
          ["Agent", "var(--gantt-subagent, #a855f7)", undefined],
          ["Prompt", "var(--gantt-prompt, #06b6d4)", undefined],
          ["Failed", "var(--gantt-tool-failed, #ef4444)", "✗"],
          ["Active", "var(--gantt-tool-success, #22c55e)", "⏳"],
          ["Idle", "var(--gantt-idle, #475569)", undefined],
        ] as const).map(([name, color, icon]) => (
          <span key={name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: icon ? 18 : 10,
                height: 10,
                borderRadius: 3,
                background: color,
                fontSize: "0.55rem",
              }}
            >
              {icon ?? ""}
            </span>
            {name}
          </span>
        ))}
      </div>
    </section>
  );
}
