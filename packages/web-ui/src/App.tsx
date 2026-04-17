import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { SessionState } from "../../../shared/state-machine/src/index.js";
import type { EventEnvelope } from "../../../shared/event-schema/src/index.js";
import { initialSessionState } from "../../../shared/state-machine/src/index.js";
import { mapStateToLanes } from "./stateMapping.js";
import { applyFilter } from "./filterState.js";
import {
  buildReplayFrames,
  findFirstFailureIndex,
  getPlaybackIntervalMs,
  getReplayEventAt,
  getReplayStateAt,
  stepReplayIndex,
  toInspectorEntry
} from "./replay.js";
import { buildGanttData } from "./ganttData.js";
import type { GanttSegment } from "./ganttData.js";
import { LiveBoard } from "./components/LiveBoard.js";
import { GanttChart } from "./components/GanttChart.js";
import { EventInspector } from "./components/EventInspector.js";
import { FilterControls } from "./components/FilterControls.js";
import { ReplayControls } from "./components/ReplayControls.js";
import { PairingDiagnosticsPanel } from "./components/PairingDiagnosticsPanel.js";
import { exportSessionToCsv } from "./csvExport.js";
import type { FilterConfig, InspectorEntry, ReplaySpeed } from "./types.js";

/** Pixel threshold below which the event list is considered "scrolled to bottom". */
const AUTO_SCROLL_THRESHOLD = 40;

/** Ingest service base URL — matches the default Fastify server binding. */
const INGEST_BASE = "http://127.0.0.1:7070";

/** Color mapping for event type indicator dots in the timeline list. */
const EVENT_TYPE_COLORS: Record<string, string> = {
  errorOccurred: "#ef4444",
  postToolUseFailure: "#ef4444",
  preToolUse: "#f59e0b",
  postToolUse: "#22c55e",
  subagentStart: "#a855f7",
  subagentStop: "#a855f7",
  userPromptSubmitted: "#06b6d4",
};
const DEFAULT_EVENT_COLOR = "#3b82f6";

function formatRangeTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

export function App() {
  const [sessionState, setSessionState] = useState<SessionState>(
    initialSessionState("unknown")
  );
  const [allEvents, setAllEvents] = useState<EventEnvelope[]>([]);
  const [filter, setFilter] = useState<FilterConfig>({});
  const [selected, setSelected] = useState<InspectorEntry | null>(null);
  const [connected, setConnected] = useState(false);
  const [replayMode, setReplayMode] = useState(false);
  const [replayIndex, setReplayIndex] = useState(-1);
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>(() => {
    if (typeof localStorage === "undefined") {
      return 1;
    }
    const raw = localStorage.getItem("visualizer.replay.speed");
    const parsed = Number(raw);
    return parsed === 0.5 || parsed === 1 || parsed === 2 || parsed === 4 ? parsed : 1;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<{
    startTime: number;
    endTime: number;
    label: string;
  } | null>(null);
  const eventListRef = useRef<HTMLUListElement>(null);
  const userScrolledRef = useRef(false);

  // --- Live feed pause/resume state ---
  const [livePaused, setLivePaused] = useState(false);
  const pausedStateRef = useRef<SessionState | null>(null);
  const pausedEventsRef = useRef<EventEnvelope[] | null>(null);

  // --- SSE connection for real-time state updates (LIVE-FR-03) ---
  useEffect(() => {
    const es = new EventSource(`${INGEST_BASE}/state/stream`);
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      const state = JSON.parse(e.data as string) as SessionState;
      if (livePaused) {
        pausedStateRef.current = state;
      } else {
        setSessionState(state);
      }
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [livePaused]);

  // --- Periodic event list refresh for the inspector timeline ---
  useEffect(() => {
    async function fetchEvents(): Promise<void> {
      try {
        const res = await fetch(`${INGEST_BASE}/events`);
        const body = (await res.json()) as { events: EventEnvelope[] };
        if (livePaused) {
          pausedEventsRef.current = body.events;
        } else {
          setAllEvents(body.events);
        }
      } catch {
        // Ingest service may not be reachable — silently skip
      }
    }
    void fetchEvents();
    const id = setInterval(() => void fetchEvents(), 2000);
    return () => clearInterval(id);
  }, [livePaused]);

  const replayFrames = useMemo(() => buildReplayFrames(allEvents), [allEvents]);
  const replayEvents = replayFrames.map((frame) => frame.event);
  const firstFailureIndex = findFirstFailureIndex(replayFrames);

  useEffect(() => {
    if (replayFrames.length === 0) {
      setReplayIndex(-1);
      setIsPlaying(false);
      return;
    }
    setReplayIndex((current) => {
      if (current < 0 || current >= replayFrames.length) {
        return replayFrames.length - 1;
      }
      return current;
    });
  }, [replayFrames.length]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("visualizer.replay.speed", String(replaySpeed));
    }
  }, [replaySpeed]);

  useEffect(() => {
    if (!replayMode || !isPlaying || replayFrames.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setReplayIndex((current) => {
        const next = stepReplayIndex(current, replayFrames.length);
        if (next >= replayFrames.length - 1) {
          setIsPlaying(false);
        }
        return next;
      });
    }, getPlaybackIntervalMs(replaySpeed));

    return () => window.clearTimeout(timeoutId);
  }, [isPlaying, replayFrames.length, replayMode, replaySpeed, replayIndex]);

  useEffect(() => {
    if (!replayMode) {
      return;
    }
    setSelected(toInspectorEntry(getReplayEventAt(replayFrames, replayIndex)));
  }, [replayFrames, replayIndex, replayMode]);

  const displayedState = replayMode ? getReplayStateAt(replayFrames, replayIndex) : sessionState;
  const lanes = mapStateToLanes(displayedState);
  const timelineSource = replayMode ? replayEvents : allEvents;
  const filteredEvents = applyFilter(timelineSource, filter);
  const ganttRows = useMemo(() => buildGanttData(filteredEvents), [filteredEvents]);
  const periodEvents = useMemo(() => {
    if (!selectedPeriod) {
      return filteredEvents;
    }
    return timelineSource.filter((ev) => {
      const t = Date.parse(ev.timestamp);
      return Number.isFinite(t) && t >= selectedPeriod.startTime && t <= selectedPeriod.endTime;
    });
  }, [filteredEvents, selectedPeriod, timelineSource]);
  const sessionCompleted = displayedState.lifecycle === "completed";
  const isIdle = displayedState.visualization === "idle" && !sessionCompleted;

  // Auto-scroll event list to bottom when new events arrive (skip if user scrolled up)
  useEffect(() => {
    if (replayMode || userScrolledRef.current) return;
    const ul = eventListRef.current;
    if (ul) {
      ul.scrollTop = ul.scrollHeight;
    }
  }, [periodEvents.length, replayMode]);

  const handleSelectEvent = useCallback((event: EventEnvelope) => {
    setSelected({
      eventId: event.eventId,
      eventType: event.eventType,
      timestamp: event.timestamp,
      sessionId: event.sessionId,
      turnId: event.turnId,
      traceId: event.traceId,
      spanId: event.spanId,
      parentSpanId: event.parentSpanId,
      payload: event.payload as Record<string, unknown>
    });

    if (replayMode) {
      const index = replayFrames.findIndex((frame) => frame.event.eventId === event.eventId);
      if (index >= 0) {
        setReplayIndex(index);
        setIsPlaying(false);
      }
    }
  }, [replayFrames, replayMode]);

  const handleReplayModeChange = useCallback((enabled: boolean) => {
    setReplayMode(enabled);
    setIsPlaying(false);
    if (enabled && replayFrames.length > 0 && replayIndex < 0) {
      setReplayIndex(0);
    }
  }, [replayFrames.length, replayIndex]);

  const handlePlayPause = useCallback(() => {
    setIsPlaying((current) => !current);
  }, []);

  const handleScrub = useCallback((index: number) => {
    setReplayIndex(index);
    setIsPlaying(false);
  }, []);

  const handleJumpToFailure = useCallback(() => {
    if (firstFailureIndex >= 0) {
      setReplayIndex(firstFailureIndex);
      setIsPlaying(false);
    }
  }, [firstFailureIndex]);

  const handleTogglePause = useCallback(() => {
    setLivePaused((current) => {
      if (current) {
        // Resuming — flush any buffered state/events that arrived while paused
        if (pausedStateRef.current) {
          setSessionState(pausedStateRef.current);
          pausedStateRef.current = null;
        }
        if (pausedEventsRef.current) {
          setAllEvents(pausedEventsRef.current);
          pausedEventsRef.current = null;
        }
      }
      return !current;
    });
  }, []);

  const handleExportCsv = useCallback(() => {
    exportSessionToCsv(allEvents);
  }, [allEvents]);

  const handleSelectGanttSegment = useCallback((segment: GanttSegment) => {
    const endTime = segment.endTime ?? Date.now();
    setSelectedPeriod((current) => {
      if (
        current &&
        current.startTime === segment.startTime &&
        current.endTime === endTime &&
        current.label === segment.label
      ) {
        return null;
      }
      return {
        startTime: segment.startTime,
        endTime,
        label: segment.label,
      };
    });
  }, []);

  return (
    <main style={{ maxWidth: 1440, margin: "0 auto", padding: "1.5rem 2rem" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
          paddingBottom: "1rem",
          borderBottom: "1px solid #334155",
        }}
      >
        <h1 style={{ fontSize: "1.4rem", margin: 0, letterSpacing: "-0.01em" }}>
          Copilot Activity Visualiser
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {replayMode && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "#f59e0b",
                background: "rgba(245, 158, 11, 0.12)",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                borderRadius: 6,
                padding: "0.2rem 0.6rem",
              }}
            >
              🔄 Replay Mode
            </span>
          )}
          {livePaused && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "#f59e0b",
                background: "rgba(245, 158, 11, 0.12)",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                borderRadius: 6,
                padding: "0.2rem 0.6rem",
              }}
            >
              ⏸ Paused
            </span>
          )}
          <button
            onClick={handleTogglePause}
            disabled={replayMode}
            aria-label={livePaused ? "Resume live feed" : "Pause live feed"}
            title={livePaused ? "Resume live feed (catch up on missed events)" : "Pause live feed"}
            style={{
              background: livePaused ? "#22c55e" : "#334155",
              color: "#f1f5f9",
              border: `1px solid ${livePaused ? "#22c55e" : "#475569"}`,
              borderRadius: 6,
              padding: "0.3rem 0.75rem",
              fontSize: "0.82rem",
              cursor: replayMode ? "not-allowed" : "pointer",
              opacity: replayMode ? 0.5 : 1,
            }}
          >
            {livePaused ? "▶ Resume" : "⏸ Pause"}
          </button>
          <button
            onClick={handleExportCsv}
            disabled={allEvents.length === 0}
            aria-label="Export session data to CSV"
            title="Export all session events to a CSV file"
            style={{
              background: "#334155",
              color: "#f1f5f9",
              border: "1px solid #475569",
              borderRadius: 6,
              padding: "0.3rem 0.75rem",
              fontSize: "0.82rem",
              cursor: allEvents.length === 0 ? "not-allowed" : "pointer",
              opacity: allEvents.length === 0 ? 0.5 : 1,
            }}
          >
            📥 Export CSV
          </button>
          <span
            aria-live="polite"
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: "0.85rem",
              color: connected ? "#22c55e" : "#f59e0b",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: connected ? "#22c55e" : "#f59e0b",
              }}
            />
            {connected ? "Connected" : "Connecting…"}
          </span>
        </div>
      </header>

      {/* Gantt Chart - visual centerpiece */}
      <div style={{ marginBottom: "1rem" }}>
        <PairingDiagnosticsPanel ingestBase={INGEST_BASE} />
      </div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem", color: "#94a3b8", fontWeight: 500 }}>
          Timeline
        </h2>
        <GanttChart
          rows={ganttRows}
          sessionCompleted={sessionCompleted}
          isIdle={isIdle}
          onSegmentSelect={handleSelectGanttSegment}
          selectedPeriod={selectedPeriod}
        />
      </div>

      <div style={{ display: "flex", gap: "1.5rem" }}>
        {/* Left column */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Live Board */}
          <div
            style={{
              background: "#1e293b",
              borderRadius: 10,
              border: "1px solid #475569",
              padding: "1rem 1.25rem",
              marginBottom: "1rem",
            }}
          >
            <LiveBoard lanes={lanes} />
          </div>

          {/* Replay Controls */}
          <div
            style={{
              background: "#1e293b",
              borderRadius: 10,
              border: "1px solid #475569",
              padding: "1rem 1.25rem",
              marginBottom: "1rem",
            }}
          >
            <ReplayControls
              canReplay={replayFrames.length > 0}
              isReplayMode={replayMode}
              isPlaying={isPlaying}
              currentIndex={replayIndex}
              maxIndex={replayFrames.length - 1}
              speed={replaySpeed}
              firstFailureIndex={firstFailureIndex}
              onReplayModeChange={handleReplayModeChange}
              onPlayPause={handlePlayPause}
              onScrub={handleScrub}
              onSpeedChange={setReplaySpeed}
              onJumpToFailure={handleJumpToFailure}
            />
          </div>

          {/* Filter Controls */}
          <div
            style={{
              background: "#1e293b",
              borderRadius: 10,
              border: "1px solid #475569",
              padding: "1rem 1.25rem",
              marginBottom: "1rem",
            }}
          >
            <FilterControls filter={filter} onChange={setFilter} />
          </div>

          {/* Event list */}
          <section
            aria-label="Event timeline"
            style={{
              background: "#1e293b",
              borderRadius: 10,
              border: "1px solid #475569",
              padding: "1rem 1.25rem",
            }}
          >
            <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
              Events ({periodEvents.length})
            </h2>
            {selectedPeriod && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
                  Related to selected bar: {selectedPeriod.label}
                  {" "}
                  <span style={{ color: "#64748b" }}>
                    ({formatRangeTime(selectedPeriod.startTime)} - {formatRangeTime(selectedPeriod.endTime)})
                  </span>
                </span>
                <button
                  onClick={() => setSelectedPeriod(null)}
                  style={{
                    background: "#334155",
                    color: "#e2e8f0",
                    border: "1px solid #475569",
                    borderRadius: 6,
                    padding: "0.15rem 0.45rem",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>
              </div>
            )}
            <ul
              ref={eventListRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                // User has scrolled up if not near the bottom
                userScrolledRef.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight > AUTO_SCROLL_THRESHOLD;
              }}
              style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 400, overflowY: "auto" }}
            >
              {periodEvents.map((ev) => (
                <li key={ev.eventId}>
                  <button
                    onClick={() => handleSelectEvent(ev)}
                    aria-label={`Inspect ${ev.eventType} event at ${ev.timestamp}`}
                    style={{
                      background: "none",
                      border: "none",
                      borderBottom: "1px solid #334155",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                      padding: "0.5rem 0.25rem",
                      color: "#f1f5f9",
                      display: "flex",
                      gap: "0.5rem",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: EVENT_TYPE_COLORS[ev.eventType] ?? DEFAULT_EVENT_COLOR,
                      }}
                    />
                    <strong style={{ fontSize: "0.85rem" }}>{ev.eventType}</strong>
                    <span style={{ color: "#94a3b8", fontSize: "0.8rem", marginLeft: "auto" }}>
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Right column - Inspector */}
        <div style={{ width: 340, flexShrink: 0 }}>
          <EventInspector entry={selected} />
        </div>
      </div>
    </main>
  );
}
