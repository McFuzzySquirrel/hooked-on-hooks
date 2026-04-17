/**
 * Pure data-transformation module that converts EventEnvelope[] into Gantt chart
 * segments for visual rendering.
 *
 * Groups events into rows by actor (session, tools, subagents) and matches
 * start/end pairs (preToolUse→postToolUse/postToolUseFailure, etc.).
 */

import type { EventEnvelope } from "../../../shared/event-schema/src/index.js";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface GanttSegment {
  id: string;
  label: string;
  category: "session" | "tool" | "subagent" | "error" | "prompt";
  startTime: number;
  endTime: number | null;
  status: "running" | "succeeded" | "failed" | "idle";
  eventType: string;
  details: Record<string, unknown>;
  /**
   * When true, the segment was auto-closed because a newer invocation of the
   * same tool arrived before a postToolUse closed this one (R4 orphan fix).
   */
  autoClosed?: boolean;
}

/**
 * A collapsed group represents multiple consecutive completed segments for the
 * same tool that have been folded into a single summary bar (R5).
 */
export interface CollapsedGroup {
  id: string;
  label: string;
  count: number;
  totalDurationMs: number;
  startTime: number;
  endTime: number;
  category: GanttSegment["category"];
  /** The original segments hidden inside this group. */
  children: GanttSegment[];
}

export interface GanttRow {
  rowId: string;
  label: string;
  segments: GanttSegment[];
  /** Collapsed groups of repeated tool calls (R5). */
  collapsedGroups?: CollapsedGroup[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function tsMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function toolNameFrom(payload: Record<string, unknown>): string {
  return typeof payload.toolName === "string" ? payload.toolName : "unknown";
}

/**
 * Returns a copy of `payload` with all `undefined` values removed.
 * Used when merging stop-event payloads into pre-existing start-event details
 * so that undefined stop fields don't silently clear values captured at start.
 */
function withoutUndefined(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
}

function agentNameFrom(payload: Record<string, unknown>): string {
  if (typeof payload.agentDisplayName === "string") return payload.agentDisplayName;
  if (typeof payload.agentName === "string") return payload.agentName;
  return "unknown";
}

/**
 * R5: Collapse consecutive completed segments into summary groups when there
 * are more than COLLAPSE_THRESHOLD in a row. The returned `visible` array
 * contains only the segments that should render as individual bars; collapsed
 * runs are replaced by a single summary segment and collected in `groups`.
 */
const COLLAPSE_THRESHOLD = 3;

function collapseRepeatedSegments(segments: GanttSegment[]): {
  visible: GanttSegment[];
  groups: CollapsedGroup[];
} {
  if (segments.length <= COLLAPSE_THRESHOLD) {
    return { visible: segments, groups: [] };
  }

  const visible: GanttSegment[] = [];
  const groups: CollapsedGroup[] = [];
  let runStart = 0;

  while (runStart < segments.length) {
    // Find the end of a consecutive run of completed (non-running) segments
    let runEnd = runStart;
    while (
      runEnd < segments.length &&
      segments[runEnd].endTime !== null &&
      segments[runEnd].status !== "running"
    ) {
      runEnd++;
    }

    const runLength = runEnd - runStart;
    if (runLength > COLLAPSE_THRESHOLD) {
      // Collapse this run into a summary
      const children = segments.slice(runStart, runEnd);
      const totalMs = children.reduce((sum, s) => {
        const dur = (s.endTime ?? s.startTime) - s.startTime;
        return sum + dur;
      }, 0);
      const group: CollapsedGroup = {
        id: `collapsed-${children[0].id}`,
        label: `${runLength}× ${children[0].label} (${formatDurationShort(totalMs)})`,
        count: runLength,
        totalDurationMs: totalMs,
        startTime: children[0].startTime,
        endTime: children[children.length - 1].endTime ?? children[children.length - 1].startTime,
        category: children[0].category,
        children,
      };
      groups.push(group);
      // Add a single summary segment to visible
      visible.push({
        id: group.id,
        label: group.label,
        category: group.category,
        startTime: group.startTime,
        endTime: group.endTime,
        status: "succeeded",
        eventType: "collapsed",
        details: { count: runLength, totalDurationMs: totalMs },
      });
    } else {
      // Not enough to collapse — keep individual segments
      for (let i = runStart; i < runEnd; i++) {
        visible.push(segments[i]);
      }
    }

    // Push any running/non-completed segments that broke the run.
    // Check endTime === null (the canonical "still open" indicator).
    if (runEnd < segments.length && segments[runEnd].endTime === null) {
      visible.push(segments[runEnd]);
      runEnd++;
    }
    runStart = runEnd;
  }

  return { visible, groups };
}

/** Compact duration format for collapse labels. */
function formatDurationShort(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

/* ------------------------------------------------------------------ */
/*  Core transform                                                     */
/* ------------------------------------------------------------------ */

export function buildGanttData(events: EventEnvelope[]): GanttRow[] {
  const sessionSegments: GanttSegment[] = [];
  const toolRows = new Map<string, GanttSegment[]>();
  const subagentRows = new Map<string, GanttSegment[]>();

  // Track open segments so we can match end-events to them
  let openSession: GanttSegment | null = null;
  const openTools = new Map<string, GanttSegment>();
  const openSubagents = new Map<string, GanttSegment>();

  // Track idle gap starts for session-level idle visualization
  let idleGapStart: number | null = null;
  let idleGapSeq = 0;

  // Sort by timestamp then original index (stable)
  const sorted = [...events]
    .map((ev, idx) => ({ ev, idx }))
    .sort((a, b) => {
      const ta = tsMs(a.ev.timestamp);
      const tb = tsMs(b.ev.timestamp);
      return ta !== tb ? ta - tb : a.idx - b.idx;
    });

  /**
   * Close any open idle gap segment up to `endTime`, pushing it to session
   * segments with a dimmed "idle" status.
   */
  function closeIdleGap(endTime: number): void {
    if (idleGapStart !== null && endTime > idleGapStart) {
      sessionSegments.push({
        id: `idle-gap-${++idleGapSeq}`,
        label: "Idle",
        category: "session",
        startTime: idleGapStart,
        endTime,
        status: "idle",
        eventType: "idle",
        details: {},
      });
    }
    idleGapStart = null;
  }

  for (const { ev } of sorted) {
    const payload = ev.payload as Record<string, unknown>;
    const t = tsMs(ev.timestamp);

    switch (ev.eventType) {
      /* ---- Session ---- */
      case "sessionStart": {
        const seg: GanttSegment = {
          id: ev.eventId,
          label: "Session",
          category: "session",
          startTime: t,
          endTime: null,
          status: "running",
          eventType: ev.eventType,
          details: payload,
        };
        openSession = seg;
        sessionSegments.push(seg);
        // Session starts in idle until first activity
        idleGapStart = t;
        break;
      }
      case "sessionEnd": {
        closeIdleGap(t);
        if (openSession) {
          openSession.endTime = t;
          openSession.status = "succeeded";
          openSession = null;
        }
        // Auto-close any still-open tools and subagents when session ends
        for (const [key, seg] of openTools) {
          seg.endTime = t;
          seg.status = seg.status === "running" ? "succeeded" : seg.status;
          openTools.delete(key);
        }
        for (const [key, seg] of openSubagents) {
          seg.endTime = t;
          seg.status = seg.status === "running" ? "succeeded" : seg.status;
          openSubagents.delete(key);
        }
        break;
      }

      /* ---- Tools ---- */
      case "preToolUse": {
        closeIdleGap(t);
        const name = toolNameFrom(payload);
        const rowKey = `tool:${name}`;

        // R4: Auto-close any still-open segment for the same tool name.
        // This prevents orphaned bars when a postToolUse never arrives.
        const prevOpen = openTools.get(rowKey);
        if (prevOpen && prevOpen.endTime === null) {
          prevOpen.endTime = t;
          prevOpen.status = "succeeded";
          prevOpen.autoClosed = true;
        }

        const seg: GanttSegment = {
          id: ev.eventId,
          label: `Tool: ${name}`,
          category: "tool",
          startTime: t,
          endTime: null,
          status: "running",
          eventType: ev.eventType,
          details: payload,
        };
        openTools.set(rowKey, seg);
        if (!toolRows.has(rowKey)) {
          toolRows.set(rowKey, []);
        }
        toolRows.get(rowKey)!.push(seg);
        break;
      }
      case "postToolUse": {
        const name = toolNameFrom(payload);
        const rowKey = `tool:${name}`;
        const open = openTools.get(rowKey);
        if (open) {
          open.endTime = t;
          open.status = "succeeded";
            open.details = { ...open.details, ...withoutUndefined(payload) };
          openTools.delete(rowKey);
        }
        // Start idle gap after tool completes
        idleGapStart = t;
        break;
      }
      case "postToolUseFailure": {
        const name = toolNameFrom(payload);
        const rowKey = `tool:${name}`;
        const open = openTools.get(rowKey);
        if (open) {
          open.endTime = t;
          open.status = "failed";
            open.details = { ...open.details, ...withoutUndefined(payload) };
          openTools.delete(rowKey);
        }
        // Start idle gap after tool failure
        idleGapStart = t;
        break;
      }

      /* ---- Subagents ---- */
      case "subagentStart": {
        closeIdleGap(t);
        const name = agentNameFrom(payload);
        const rowKey = `subagent:${name}`;
        const seg: GanttSegment = {
          id: ev.eventId,
          label: `Agent: ${name}`,
          category: "subagent",
          startTime: t,
          endTime: null,
          status: "running",
          eventType: ev.eventType,
          details: payload,
        };
        openSubagents.set(rowKey, seg);
        if (!subagentRows.has(rowKey)) {
          subagentRows.set(rowKey, []);
        }
        subagentRows.get(rowKey)!.push(seg);
        break;
      }
      case "subagentStop": {
        const name = agentNameFrom(payload);
        const rowKey = `subagent:${name}`;
        const open = openSubagents.get(rowKey);
        if (open) {
          open.endTime = t;
          open.status = "succeeded";
            open.details = { ...open.details, ...withoutUndefined(payload) };
          openSubagents.delete(rowKey);
        }
        // Start idle gap after subagent stops
        idleGapStart = t;
        break;
      }

      /* ---- Prompts ---- */
      case "userPromptSubmitted": {
        const seg: GanttSegment = {
          id: ev.eventId,
          label: "Prompt",
          category: "prompt",
          startTime: t,
          endTime: t, // point-in-time event
          status: "succeeded",
          eventType: ev.eventType,
          details: payload,
        };
        sessionSegments.push(seg);
        break;
      }

      /* ---- Errors ---- */
      case "errorOccurred": {
        const seg: GanttSegment = {
          id: ev.eventId,
          label: "Error",
          category: "error",
          startTime: t,
          endTime: t, // point-in-time event
          status: "failed",
          eventType: ev.eventType,
          details: payload,
        };
        sessionSegments.push(seg);
        break;
      }

      /* ---- agentStop: session-level marker that transitions to idle ---- */
      case "agentStop": {
        const agentLabel = payload?.agentName
          ? `Agent Stop: ${payload.agentName as string}`
          : "Agent Stop";
        const seg: GanttSegment = {
          id: ev.eventId,
          label: agentLabel,
          category: "session",
          startTime: t,
          endTime: t,
          status: "idle",
          eventType: ev.eventType,
          details: payload,
        };
        sessionSegments.push(seg);
        idleGapStart = t;
        break;
      }

      /* ---- notification: session-level marker (no state change) ---- */
      case "notification": {
        const seg: GanttSegment = {
          id: ev.eventId,
          label: "Notification",
          category: "session",
          startTime: t,
          endTime: t,
          status: "idle",
          eventType: ev.eventType,
          details: payload,
        };
        sessionSegments.push(seg);
        break;
      }
    }
  }

  /* ---- Assemble rows ---- */
  const rows: GanttRow[] = [];

  // Session row always first
  if (sessionSegments.length > 0) {
    rows.push({
      rowId: "session",
      label: "Session",
      segments: sessionSegments,
    });
  }

  // Tool rows (sorted alphabetically by name)
  const toolEntries = [...toolRows.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  for (const [rowKey, segments] of toolEntries) {
    const name = rowKey.replace(/^tool:/, "");
    const { visible, groups } = collapseRepeatedSegments(segments);
    rows.push({
      rowId: rowKey,
      label: `Tool: ${name}`,
      segments: visible,
      collapsedGroups: groups.length > 0 ? groups : undefined,
    });
  }

  // Subagent rows (sorted alphabetically by name)
  const subEntries = [...subagentRows.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  for (const [rowKey, segments] of subEntries) {
    const name = rowKey.replace(/^subagent:/, "");
    rows.push({
      rowId: rowKey,
      label: `Agent: ${name}`,
      segments,
    });
  }

  return rows;
}

/**
 * Compute the overall time range across all rows / segments.
 * Returns [minTime, maxTime] in ms. If there are no segments returns [0, 0].
 */
export function computeTimeRange(rows: GanttRow[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;

  for (const row of rows) {
    for (const seg of row.segments) {
      if (seg.startTime < min) min = seg.startTime;
      const end = seg.endTime ?? Date.now();
      if (end > max) max = end;
      if (seg.startTime > max) max = seg.startTime;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 0];
  }

  return [min, max];
}

/**
 * R3: Find the ID of the most recently started running segment across all rows.
 * Only this segment should receive the pulse animation — all other open segments
 * are considered orphaned and rendered with a static dashed-edge style.
 */
export function findLatestRunningSegmentId(rows: GanttRow[]): string | null {
  let latestId: string | null = null;
  let latestStart = -Infinity;

  for (const row of rows) {
    for (const seg of row.segments) {
      if (seg.endTime === null && seg.status === "running" && seg.startTime > latestStart) {
        latestStart = seg.startTime;
        latestId = seg.id;
      }
    }
  }

  return latestId;
}
