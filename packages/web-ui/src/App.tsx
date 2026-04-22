import { useMemo, useState } from "react";
import type {
  DashboardTab,
  SessionExportData,
  SessionListData,
  SortMode,
} from "./types.js";
import {
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

function readJsonFile(file: File): Promise<unknown> {
  return file.text().then((text) => JSON.parse(text) as unknown);
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
    const base = exportData.sessions;
    if (!q) {
      return base;
    }
    return base.filter((session) => {
      return (
        session.summary.toLowerCase().includes(q) ||
        session.repository.toLowerCase().includes(q) ||
        session.branch.toLowerCase().includes(q) ||
        session.sessionId.toLowerCase().includes(q)
      );
    });
  }, [dashboardFilter, exportData.sessions]);

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
                    {activeSession.turns.map((turn, index) => (
                      <article key={`${turn.id ?? index}`} className="list-card">
                        <h3>Turn #{String(turn.turn_index ?? index + 1)}</h3>
                        <p><strong>User:</strong> {String(turn.user_message ?? "")}</p>
                        <p><strong>Assistant:</strong> {String(turn.assistant_response ?? "")}</p>
                        <small>{formatDate(String(turn.timestamp ?? ""))}</small>
                      </article>
                    ))}
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
