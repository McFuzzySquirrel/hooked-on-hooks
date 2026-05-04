import { useEffect, useMemo, useState } from "react";
import type {
  DashboardTab,
  SessionExportData,
  SessionListData,
  SortMode,
} from "./types.js";
import {
  classifySessionSource,
  formatBytes,
  formatDate,
  normalizeSessionExport,
  normalizeSessionList,
} from "./session-dashboard-helpers.js";

const EMPTY_LIST: SessionListData = {
  generatedAt: "",
  source: {
    type: "copilot-session-store-db",
    dbPath: "",
  },
  count: 0,
  sessions: [],
};

const EMPTY_EXPORT: SessionExportData = {
  exportedAt: "",
  source: {
    type: "copilot-session-store-db",
    dbPath: "",
  },
  sessions: [],
};

const TAB_LABELS: Array<{ id: DashboardTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "checkpoints", label: "Checkpoints" },
  { id: "turns", label: "Turns" },
  { id: "files", label: "Files" },
  { id: "models", label: "Models & Tokens" },
  { id: "search", label: "Search" },
];

type SourceFilter = "all" | "copilot-cli" | "vscode-chat" | "unknown";
const SOURCE_FILTERS: SourceFilter[] = ["all", "copilot-cli", "vscode-chat", "unknown"];

function readSourceFilterFromUrl(): SourceFilter {
  if (typeof window === "undefined") {
    return "all";
  }

  const value = new URLSearchParams(window.location.search).get("source");
  if (!value) {
    return "all";
  }

  return SOURCE_FILTERS.includes(value as SourceFilter) ? (value as SourceFilter) : "all";
}

function writeSourceFilterToUrl(filter: SourceFilter): void {
  if (typeof window === "undefined") {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  if (filter === "all") {
    params.delete("source");
  } else {
    params.set("source", filter);
  }

  const next = params.toString();
  const path = window.location.pathname;
  const hash = window.location.hash;
  const url = `${path}${next ? `?${next}` : ""}${hash}`;
  window.history.replaceState(null, "", url);
}

function readJsonFile(file: File): Promise<unknown> {
  return file.text().then((text) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      const looksLikeJsonl =
        lines.length > 1
        && lines.every((line) => line.startsWith("{") || line.startsWith("["));

      if (looksLikeJsonl) {
        throw new Error(
          "This file looks like JSONL (multiple JSON objects). The dashboard uploader expects a single export JSON file. Use npm run session:export to generate dashboard JSON.",
        );
      }

      throw new Error("Invalid JSON file");
    }
  });
}

export function App() {
  const [view, setView] = useState<"selector" | "dashboard">("selector");
  const [sessionList, setSessionList] = useState<SessionListData>(EMPTY_LIST);
  const [sessionSearch, setSessionSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectorError, setSelectorError] = useState("");

  const [exportData, setExportData] = useState<SessionExportData>(EMPTY_EXPORT);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [dashboardFilter, setDashboardFilter] = useState("");
  const [dashboardSourceFilter, setDashboardSourceFilter] = useState<SourceFilter>(() => readSourceFilterFromUrl());
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [contentSearch, setContentSearch] = useState("");
  const [dashboardError, setDashboardError] = useState("");

  const filteredCards = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    let cards = sessionList.sessions;
    if (q) {
      cards = cards.filter((card) => {
        return (
          card.repository.toLowerCase().includes(q) ||
          card.sessionId.toLowerCase().includes(q) ||
          String(card.eventCount).includes(q) ||
          formatBytes(card.fileSizeBytes).toLowerCase().includes(q)
        );
      });
    }

    cards = [...cards].sort((a, b) => {
      if (sortMode === "events") {
        return b.eventCount - a.eventCount;
      }
      if (sortMode === "size") {
        return b.fileSizeBytes - a.fileSizeBytes;
      }
      return Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt);
    });
    return cards;
  }, [sessionList.sessions, sessionSearch, sortMode]);

  const selectedSummary = useMemo(() => {
    const selected = sessionList.sessions.filter((card) => selectedIds.has(card.sessionId));
    return {
      count: selected.length,
      events: selected.reduce((sum, card) => sum + card.eventCount, 0),
      size: selected.reduce((sum, card) => sum + card.fileSizeBytes, 0),
      ids: selected.map((card) => card.sessionId),
    };
  }, [sessionList.sessions, selectedIds]);

  const generatedExportCommand = useMemo(() => {
    if (selectedSummary.ids.length === 0) {
      return "";
    }
    return `npm run session:export -- --ids ${selectedSummary.ids.join(",")} --out ./session-store-export.json --split --split-dir ./session-exports`;
  }, [selectedSummary.ids]);

  const dashboardSessions = useMemo(() => {
    const q = dashboardFilter.trim().toLowerCase();
    const sourceType = exportData.source.type;

    return exportData.sessions.filter((session) => {
      const source = classifySessionSource(session, sourceType);
      if (dashboardSourceFilter !== "all" && source !== dashboardSourceFilter) {
        return false;
      }

      if (!q) {
        return true;
      }

      return (
        session.summary.toLowerCase().includes(q) ||
        session.repository.toLowerCase().includes(q) ||
        session.branch.toLowerCase().includes(q) ||
        session.sessionId.toLowerCase().includes(q) ||
        source.includes(q)
      );
    });
  }, [dashboardFilter, dashboardSourceFilter, exportData.sessions, exportData.source.type]);

  const sourceBreakdown = useMemo(() => {
    const totals = {
      all: exportData.sessions.length,
      "copilot-cli": 0,
      "vscode-chat": 0,
      unknown: 0,
    };

    for (const session of exportData.sessions) {
      const source = classifySessionSource(session, exportData.source.type);
      totals[source] += 1;
    }

    return totals;
  }, [exportData.sessions, exportData.source.type]);

  useEffect(() => {
    writeSourceFilterToUrl(dashboardSourceFilter);
  }, [dashboardSourceFilter]);

  const activeSession = useMemo(() => {
    if (dashboardSessions.length === 0) {
      return null;
    }
    const byId = dashboardSessions.find((session) => session.sessionId === activeSessionId);
    return byId ?? dashboardSessions[0];
  }, [activeSessionId, dashboardSessions]);

  const searchMatches = useMemo(() => {
    if (!activeSession || !contentSearch.trim()) {
      return [] as string[];
    }
    const q = contentSearch.toLowerCase();
    const lines = [
      ...activeSession.searchBlob,
      ...activeSession.turns.map((turn) => JSON.stringify(turn)),
      ...activeSession.checkpoints.map((checkpoint) => JSON.stringify(checkpoint)),
      ...activeSession.files.map((file) => JSON.stringify(file)),
      ...activeSession.refs.map((ref) => JSON.stringify(ref)),
    ];

    return lines
      .filter((line) => line.toLowerCase().includes(q))
      .slice(0, 200);
  }, [activeSession, contentSearch]);

  async function handleLoadSessionList(file: File): Promise<void> {
    try {
      setSelectorError("");
      const raw = await readJsonFile(file);
      const normalized = normalizeSessionList(raw);
      setSessionList(normalized);
      setSelectedIds(new Set());
    } catch (error) {
      setSelectorError((error as Error).message);
    }
  }

  async function handleLoadExport(file: File): Promise<void> {
    try {
      setDashboardError("");
      const raw = await readJsonFile(file);
      const normalized = normalizeSessionExport(raw);
      setExportData(normalized);
      setActiveSessionId(normalized.sessions[0]?.sessionId ?? "");
      setView("dashboard");
      setTab("overview");
    } catch (error) {
      setDashboardError((error as Error).message);
    }
  }

  async function tryLoadDefaultSessionList(): Promise<void> {
    setSelectorError("");
    try {
      const response = await fetch("/session-list.json");
      if (!response.ok) {
        throw new Error("No default session-list.json found at web root");
      }
      const raw = (await response.json()) as unknown;
      const normalized = normalizeSessionList(raw);
      setSessionList(normalized);
      setSelectedIds(new Set());
    } catch (error) {
      setSelectorError((error as Error).message);
    }
  }

  function toggleSession(sessionId: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }

  function copyExportCommand(): void {
    if (!generatedExportCommand) {
      return;
    }
    void navigator.clipboard.writeText(generatedExportCommand);
  }

  function selectAllVisible(): void {
    setSelectedIds(new Set(filteredCards.map((card) => card.sessionId)));
  }

  function clearSelected(): void {
    setSelectedIds(new Set());
  }

  function sessionSourceLabel(session: SessionExportData["sessions"][number]): "copilot-cli" | "vscode-chat" | "unknown" {
    return classifySessionSource(session, exportData.source.type);
  }

  return (
    <main className="dashboard-shell">
      <header className="app-header">
        <h1>Copilot Session Explorer</h1>
        <div className="header-actions">
          <button type="button" onClick={() => setView("selector")} disabled={view === "selector"}>
            Session Selector
          </button>
          <button type="button" onClick={() => setView("dashboard")} disabled={view === "dashboard"}>
            Session Dashboard
          </button>
        </div>
      </header>

      {view === "selector" ? (
        <section>
          <div className="toolbar-row">
            <button type="button" onClick={() => void tryLoadDefaultSessionList()}>
              Load /session-list.json
            </button>
            <label className="file-input-label">
              Load Session List JSON
              <input
                type="file"
                accept="application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void handleLoadSessionList(file);
                  }
                }}
              />
            </label>
            <input
              type="text"
              value={sessionSearch}
              onChange={(event) => setSessionSearch(event.target.value)}
              placeholder="Search repository, session ID, event count, size"
              className="search-input"
            />
            <div className="sort-controls">
              <button type="button" onClick={() => setSortMode("recent")} disabled={sortMode === "recent"}>
                Recent First
              </button>
              <button type="button" onClick={() => setSortMode("events")} disabled={sortMode === "events"}>
                Most Events
              </button>
              <button type="button" onClick={() => setSortMode("size")} disabled={sortMode === "size"}>
                Largest
              </button>
            </div>
            <button type="button" onClick={selectAllVisible}>
              Select All
            </button>
            <button type="button" onClick={clearSelected}>
              Clear
            </button>
          </div>

          {selectorError ? <p className="error-text">{selectorError}</p> : null}

          <div className="card-grid">
            {filteredCards.map((card) => {
              const checked = selectedIds.has(card.sessionId);
              return (
                <article key={card.sessionId} className={`session-card${checked ? " selected" : ""}`}>
                  <label className="checkbox-wrap">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSession(card.sessionId)}
                    />
                    <span>{card.repository}</span>
                  </label>
                  <p className="mono">{card.sessionId}</p>
                  <dl>
                    <dt>Events</dt>
                    <dd>{card.eventCount.toLocaleString()}</dd>
                    <dt>Size</dt>
                    <dd>{formatBytes(card.fileSizeBytes)}</dd>
                    <dt>Modified</dt>
                    <dd>{formatDate(card.modifiedAt)}</dd>
                    <dt>Branch</dt>
                    <dd>{card.branch}</dd>
                  </dl>
                  <p>{card.summary}</p>
                </article>
              );
            })}
          </div>

          {selectedSummary.count > 0 ? (
            <aside className="summary-box">
              <p>
                Selected {selectedSummary.count} session(s) | {selectedSummary.events.toLocaleString()} events | {" "}
                {formatBytes(selectedSummary.size)}
              </p>
              <pre>{generatedExportCommand}</pre>
              <div className="summary-actions">
                <button type="button" onClick={copyExportCommand}>
                  Export Selected
                </button>
                <button type="button" onClick={() => setView("dashboard")}>
                  View in Dashboard
                </button>
              </div>
            </aside>
          ) : null}
        </section>
      ) : (
        <section className="dashboard-layout">
          <aside className="sidebar">
            <h2>Sessions</h2>
            <label className="file-input-label">
              Load Export JSON
              <input
                type="file"
                accept="application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void handleLoadExport(file);
                  }
                }}
              />
            </label>
            <input
              className="search-input"
              placeholder="Filter summary, repository, branch"
              value={dashboardFilter}
              onChange={(event) => setDashboardFilter(event.target.value)}
            />
            <div className="source-filter-row">
              <button
                type="button"
                onClick={() => setDashboardSourceFilter("all")}
                disabled={dashboardSourceFilter === "all"}
              >
                All ({sourceBreakdown.all})
              </button>
              <button
                type="button"
                onClick={() => setDashboardSourceFilter("copilot-cli")}
                disabled={dashboardSourceFilter === "copilot-cli"}
              >
                CLI ({sourceBreakdown["copilot-cli"]})
              </button>
              <button
                type="button"
                onClick={() => setDashboardSourceFilter("vscode-chat")}
                disabled={dashboardSourceFilter === "vscode-chat"}
              >
                VS Code Chat ({sourceBreakdown["vscode-chat"]})
              </button>
              <button
                type="button"
                onClick={() => setDashboardSourceFilter("unknown")}
                disabled={dashboardSourceFilter === "unknown"}
              >
                Unknown ({sourceBreakdown.unknown})
              </button>
            </div>
            {dashboardError ? <p className="error-text">{dashboardError}</p> : null}
            <ul className="session-list">
              {dashboardSessions.map((session) => (
                <li key={session.sessionId}>
                  <button
                    type="button"
                    className={session.sessionId === activeSession?.sessionId ? "session-item active" : "session-item"}
                    onClick={() => setActiveSessionId(session.sessionId)}
                  >
                    <strong>{session.repository}</strong>
                    <span className={`source-badge source-${sessionSourceLabel(session)}`}>{sessionSourceLabel(session)}</span>
                    <span>{session.branch}</span>
                    <small className="mono">{session.sessionId}</small>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <article className="content-panel">
            {!activeSession ? (
              <p>Load an export file to inspect sessions.</p>
            ) : (
              <>
                <header className="content-header">
                  <div>
                    <h2>{activeSession.summary}</h2>
                    <p>
                      {activeSession.repository} | {activeSession.branch} | {activeSession.sessionId}
                    </p>
                  </div>
                  <div className="tab-row">
                    {TAB_LABELS.map((tabItem) => (
                      <button
                        key={tabItem.id}
                        type="button"
                        onClick={() => setTab(tabItem.id)}
                        disabled={tabItem.id === tab}
                      >
                        {tabItem.label}
                      </button>
                    ))}
                  </div>
                </header>

                {tab === "overview" ? (
                  <section className="tab-panel">
                    <dl className="overview-grid">
                      <dt>Created</dt>
                      <dd>{formatDate(activeSession.createdAt)}</dd>
                      <dt>Updated</dt>
                      <dd>{formatDate(activeSession.updatedAt)}</dd>
                      <dt>Repository</dt>
                      <dd>{activeSession.repository}</dd>
                      <dt>Branch</dt>
                      <dd>{activeSession.branch}</dd>
                      <dt>Host Type</dt>
                      <dd>{activeSession.hostType}</dd>
                      <dt>Session Source</dt>
                      <dd>
                        <span className={`source-badge source-${sessionSourceLabel(activeSession)}`}>
                          {sessionSourceLabel(activeSession)}
                        </span>
                      </dd>
                      <dt>Working Dir</dt>
                      <dd className="mono">{activeSession.cwd || "n/a"}</dd>
                      <dt>Events</dt>
                      <dd>{activeSession.stats.eventCount.toLocaleString()}</dd>
                      <dt>Approx Size</dt>
                      <dd>{formatBytes(activeSession.stats.fileSizeBytes)}</dd>
                    </dl>
                  </section>
                ) : null}

                {tab === "checkpoints" ? (
                  <section className="tab-panel">
                    {activeSession.checkpoints.length === 0 ? <p>No checkpoints found.</p> : null}
                    {activeSession.checkpoints.map((checkpoint, index) => (
                      <article key={`${checkpoint.id ?? index}`} className="list-card">
                        <h3>
                          #{String(checkpoint.checkpoint_number ?? index + 1)} {String(checkpoint.title ?? "Untitled")}
                        </h3>
                        <p>{String(checkpoint.overview ?? "")}</p>
                        <p>{String(checkpoint.work_done ?? "")}</p>
                        <p>{String(checkpoint.next_steps ?? "")}</p>
                      </article>
                    ))}
                  </section>
                ) : null}

                {tab === "turns" ? (
                  <section className="tab-panel">
                    {activeSession.turns.length === 0 ? <p>No turns found.</p> : null}
                    {activeSession.turns.map((turn, index) => {
                      const enrichment = activeSession.turnEnrichments?.[index];
                      const hasActivity =
                        enrichment &&
                        (enrichment.tools.length > 0 ||
                          enrichment.skills.length > 0 ||
                          enrichment.agents.length > 0);
                      return (
                        <article key={`${turn.id ?? index}`} className="turn-card">
                          {/* ── Header ── */}
                          <div className="turn-header">
                            <strong>Turn #{String(turn.turn_index ?? index + 1)}</strong>
                            {enrichment?.model ? (
                              <span className="turn-model-badge">{enrichment.model}</span>
                            ) : null}
                            {enrichment?.outputTokens ? (
                              <span className="turn-token-badge">
                                {enrichment.outputTokens.toLocaleString()} out tokens
                              </span>
                            ) : null}
                            {hasActivity ? (
                              <span className="turn-token-badge">
                                {enrichment.tools.length > 0
                                  ? `${enrichment.tools.length} tool${enrichment.tools.length > 1 ? "s" : ""}`
                                  : null}
                                {enrichment.tools.length > 0 && enrichment.skills.length > 0 ? " · " : null}
                                {enrichment.skills.length > 0
                                  ? `${enrichment.skills.length} skill${enrichment.skills.length > 1 ? "s" : ""}`
                                  : null}
                                {(enrichment.tools.length > 0 || enrichment.skills.length > 0) &&
                                enrichment.agents.length > 0
                                  ? " · "
                                  : null}
                                {enrichment.agents.length > 0
                                  ? `${enrichment.agents.length} agent${enrichment.agents.length > 1 ? "s" : ""}`
                                  : null}
                              </span>
                            ) : null}
                            <span className="turn-token-badge" style={{ marginLeft: "auto" }}>
                              {formatDate(String(turn.timestamp ?? ""))}
                            </span>
                          </div>

                          <div className="turn-body">
                            {/* ── User message ── */}
                            {turn.user_message ? (
                              <div className="turn-section">
                                <div className="turn-section-label">User</div>
                                <p className="turn-message">{String(turn.user_message)}</p>
                              </div>
                            ) : null}

                            {/* ── Activity: tools, skills, agents ── */}
                            {hasActivity ? (
                              <div className="turn-section">
                                <div className="turn-section-label">Activity</div>
                                <div className="turn-activity">
                                  {enrichment.tools.map((tool, ti) => (
                                    <div key={ti} className="tool-item">
                                      <div className="tool-item-header">
                                        <span className="tool-name-badge">{tool.toolName}</span>
                                        {tool.success === true ? (
                                          <span className="tool-success">✓</span>
                                        ) : tool.success === false ? (
                                          <span className="tool-failure">✗</span>
                                        ) : null}
                                        {tool.intentionSummary ? (
                                          <span className="tool-intention">{tool.intentionSummary}</span>
                                        ) : null}
                                      </div>
                                      {tool.arguments && Object.keys(tool.arguments).length > 0 ? (
                                        <div className="tool-args">
                                          {Object.entries(tool.arguments)
                                            .filter(([, v]) => v.length <= 120)
                                            .slice(0, 5)
                                            .map(([k, v]) => (
                                              <span key={k} className="tool-arg-pair">
                                                <strong>{k}:</strong> {v}
                                              </span>
                                            ))}
                                        </div>
                                      ) : null}
                                      {tool.resultSummary ? (
                                        <pre className="tool-result">{tool.resultSummary}</pre>
                                      ) : null}
                                    </div>
                                  ))}
                                  {enrichment.agents.map((agent, ai) => (
                                    <div key={ai} className="agent-item">
                                      <span className="agent-pill">{agent.agentName}</span>
                                      {agent.task ? (
                                        <span className="agent-task">{agent.task}</span>
                                      ) : null}
                                    </div>
                                  ))}
                                  {enrichment.skills.map((skill, si) => (
                                    <div key={si} className="skill-item">
                                      <span className="skill-pill">{skill.name}</span>
                                      {skill.description ? (
                                        <span className="skill-description">{skill.description}</span>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            {/* ── Assistant response ── */}
                            {turn.assistant_response ? (
                              <div className="turn-section">
                                <div className="turn-section-label">Assistant</div>
                                <p className="turn-message">{String(turn.assistant_response)}</p>
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </section>
                ) : null}

                {tab === "files" ? (
                  <section className="tab-panel">
                    {activeSession.files.length === 0 ? <p>No file records found.</p> : null}
                    <ul className="files-list">
                      {activeSession.files.map((file, index) => (
                        <li key={`${file.id ?? index}`}>
                          <span className="mono">{String(file.file_path ?? "")}</span>
                          <span>{String(file.tool_name ?? "unknown")}</span>
                          <span>turn {String(file.turn_index ?? "n/a")}</span>
                          <span>{formatDate(String(file.first_seen_at ?? ""))}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {tab === "models" ? (
                  <section className="tab-panel">
                    <h3>Detected Models</h3>
                    {activeSession.modelsAndTokens.detectedModels.length === 0 ? (
                      <p>No model IDs detected for this session.</p>
                    ) : (
                      <ul>
                        {activeSession.modelsAndTokens.detectedModels.map((model) => (
                          <li key={model} className="mono">{model}</li>
                        ))}
                      </ul>
                    )}

                    <h3>Token Totals</h3>
                    {activeSession.modelsAndTokens.totals ? (
                      <ul>
                        <li>Input: {activeSession.modelsAndTokens.totals.inputTokens.toLocaleString()}</li>
                        <li>Output: {activeSession.modelsAndTokens.totals.outputTokens.toLocaleString()}</li>
                        <li>Total: {activeSession.modelsAndTokens.totals.totalTokens.toLocaleString()}</li>
                      </ul>
                    ) : (
                      <p>No aggregated token totals available.</p>
                    )}

                    <h3>Per-Model Usage</h3>
                    {activeSession.modelsAndTokens.modelUsage && activeSession.modelsAndTokens.modelUsage.length > 0 ? (
                      <ul>
                        {activeSession.modelsAndTokens.modelUsage.map((entry) => (
                          <li key={entry.model}>
                            <span className="mono">{entry.model}</span>
                            {" "}- events: {entry.eventCount.toLocaleString()}, input: {entry.inputTokens.toLocaleString()}, output: {entry.outputTokens.toLocaleString()}, total: {entry.totalTokens.toLocaleString()}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No per-model usage records available.</p>
                    )}

                    <h3>Model Change Timeline</h3>
                    {activeSession.modelsAndTokens.modelChanges && activeSession.modelsAndTokens.modelChanges.length > 0 ? (
                      <ol>
                        {activeSession.modelsAndTokens.modelChanges.map((change, index) => (
                          <li key={index}>
                            {change.timestamp ? <span className="mono">[{change.timestamp}]</span> : null}
                            {change.timestamp ? " " : null}
                            <span className="mono">{change.oldModel}</span>
                            {" \u2192 "}
                            <span className="mono">{change.newModel}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p>No model changes recorded.</p>
                    )}

                    <h3>Reasoning Events</h3>
                    {activeSession.modelsAndTokens.reasoningEvents && activeSession.modelsAndTokens.reasoningEvents.length > 0 ? (() => {
                      const events = activeSession.modelsAndTokens.reasoningEvents!;
                      const visible = events.slice(0, 50);
                      const overflow = events.length - visible.length;
                      return (
                        <>
                          {visible.map((event, index) => (
                            <div key={index} className="reasoning-event">
                              <div className="reasoning-event-meta">
                                <span className="event-type-badge">{event.eventType}</span>
                                {" "}
                                <span className="mono">{event.model}</span>
                                {" — "}
                                in: {event.inputTokens.toLocaleString()}, out: {event.outputTokens.toLocaleString()}, total: {event.totalTokens.toLocaleString()}
                                {event.timestamp ? <span className="reasoning-event-ts"> [{event.timestamp}]</span> : null}
                              </div>
                              {event.snippet ? (
                                <blockquote className="reasoning-snippet">{event.snippet}</blockquote>
                              ) : (
                                <p className="reasoning-snippet-empty">(no text snippet available)</p>
                              )}
                            </div>
                          ))}
                          {overflow > 0 ? <p className="overflow-note">&hellip; and {overflow.toLocaleString()} more reasoning events not shown.</p> : null}
                        </>
                      );
                    })() : (
                      <p>No reasoning events with token usage recorded.</p>
                    )}

                    <h3>Token Mentions</h3>
                    {activeSession.modelsAndTokens.tokenMentions.length === 0 ? (
                      <p>No token mentions detected.</p>
                    ) : (
                      <ul>
                        {activeSession.modelsAndTokens.tokenMentions.map((mention, index) => (
                          <li key={`${mention.value}-${index}`}>
                            {mention.value.toLocaleString()} tokens <span className="mono">{mention.source}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <h3>Notes</h3>
                    <ul>
                      {activeSession.modelsAndTokens.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {tab === "search" ? (
                  <section className="tab-panel">
                    <input
                      className="search-input"
                      placeholder="Search all session content"
                      value={contentSearch}
                      onChange={(event) => setContentSearch(event.target.value)}
                    />
                    {!contentSearch.trim() ? <p>Type a query to search across turns, checkpoints, files, and indexed text.</p> : null}
                    {contentSearch.trim() && searchMatches.length === 0 ? <p>No matches found.</p> : null}
                    <ul className="search-results">
                      {searchMatches.map((match, index) => (
                        <li key={`${index}-${match.slice(0, 12)}`} className="mono">
                          {match}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            )}
          </article>
        </section>
      )}
    </main>
  );
}
