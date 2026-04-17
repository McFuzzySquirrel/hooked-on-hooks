# ADR-010: CSV Session Export and Live Feed Pause/Resume

- Status: Accepted
- Date: 2026-04-17

## Context

Operators watching live Copilot sessions need two capabilities that the
existing UI did not provide:

1. **Data export** — After observing a session (live or replay), operators
   have no way to extract event data for external analysis, sharing, or
   archival. The only persistence format is JSONL, which is an internal
   pipeline format not designed for human consumption or spreadsheet import.

2. **Live feed control** — During high-throughput sessions, the live board
   updates every SSE push and every 2-second event poll. When an operator
   is inspecting a specific event or reviewing lane state, incoming updates
   can shift context and disrupt investigation. There is no way to
   temporarily freeze the display while still accumulating events
   server-side.

Both features were requested as lightweight operator controls that do not
change the underlying event pipeline or state machine.

## Decision

### 1) CSV Session Export

Add a client-side CSV export that converts the current session's
`EventEnvelope[]` to a downloadable `.csv` file.

Implementation details:

- **Column mapping**: Envelope-level fields first (`eventId`, `eventType`,
  `timestamp`, `sessionId`, `schemaVersion`, `source`, `repoPath`,
  `turnId`, `traceId`, `spanId`, `parentSpanId`), followed by a
  JSON-serialised `payload` column.
- **RFC 4180 escaping**: Values containing commas, double-quotes, or
  newlines are wrapped in double-quotes with inner quotes doubled.
- **Client-side only**: The export uses `Blob` + temporary anchor download.
  No server round-trip or new API endpoint is required.
- **Filename convention**: `session-{sessionId}-{YYYY-MM-DD}.csv` for easy
  identification.
- **Redaction posture**: The export operates on the same `allEvents` array
  the UI already holds. Since events are redacted before persistence
  (FR-PR-01), the CSV inherits the same redaction guarantees. No additional
  redaction pass is needed.
- **Empty-state guard**: The Export CSV button is disabled when no events
  are loaded.

### 2) Live Feed Pause/Resume

Add a pause toggle that freezes the displayed session state and event list
without disconnecting the SSE stream or stopping event polling.

Implementation details:

- **Buffered updates**: While paused, incoming SSE state pushes and polled
  event arrays are captured in refs (`pausedStateRef`, `pausedEventsRef`)
  instead of updating React state. The UI remains frozen at the moment of
  pause.
- **Resume flush**: On resume, the latest buffered state and events are
  flushed into React state in a single update, bringing the display
  current.
- **Visual indicator**: A `⏸ Paused` badge appears in the header when the
  feed is paused, matching the existing `🔄 Replay Mode` badge style.
- **Button states**: The pause button shows `⏸ Pause` / `▶ Resume` and
  changes background colour to green when paused. It is disabled during
  replay mode (which has its own play/pause controls).
- **No data loss**: Events continue to accumulate server-side and in the
  polled response. Pausing only affects the display, not ingestion.

### 3) Header Toolbar Layout

Both controls are placed in the header bar alongside the existing
connection indicator and replay mode badge. The layout order is:
mode badges → Pause button → Export CSV button → connection dot.

## Rationale

1. CSV is the lowest-friction export format for spreadsheet tools, data
   pipelines, and ad-hoc analysis. It avoids adding library dependencies
   (no XLSX/Parquet) while covering the primary use case.
2. Client-side export avoids new server endpoints and keeps the ingest
   service stateless with respect to export concerns.
3. Pause/resume is a display-only concern. Buffering in refs (not
   disconnecting SSE) preserves the guarantee that resume always shows the
   latest state without requiring a full re-fetch.
4. Both features are additive — they do not modify the event schema, state
   machine, or ingestion pipeline.

## Consequences

### Positive

1. Operators can extract session data for post-hoc analysis without parsing
   JSONL manually.
2. Operators can freeze the live display to inspect events without losing
   incoming data.
3. No new server endpoints or dependencies — purely client-side additions.
4. The CSV column set includes tracing correlation fields, enabling external
   tools to perform their own pairing analysis.

### Negative

1. CSV export is all-or-nothing for the current session; per-filter or
   per-period export is not yet supported.
2. Large sessions (10k+ events) may produce large CSV files; no streaming
   or chunked download is implemented.
3. Pause/resume state is ephemeral — refreshing the browser resets it.

## Alternatives Considered

### A) Server-side CSV endpoint

Rejected because it adds API surface and couples the ingest service to
export formatting. Client-side export keeps concerns separated.

### B) JSON export instead of CSV

Considered but deferred. JSONL is already the persistence format; CSV
targets a different audience (spreadsheet/BI tools). JSON export can be
added later as a complementary option.

### C) SSE disconnect on pause

Rejected because reconnecting SSE requires re-establishing the stream and
may miss events during the reconnection window. Ref-buffering is simpler
and lossless.

### D) Full download dialog with format picker

Rejected for MVP scope. A single-click CSV download covers the primary use
case. Format selection can be added if demand materialises.

## Cross-links

- ADR-008: `008-tracing-ux-and-doc-consolidation.md` (tracing fields in
  export columns)
- CSV module: `packages/web-ui/src/csvExport.ts`
- CSV tests: `packages/web-ui/test/csvExport.test.ts`
- App integration: `packages/web-ui/src/App.tsx` (pause/resume + export
  button handlers)

## Follow-Up Actions

1. Consider adding per-filter or per-period CSV export if operators need
   scoped exports.
2. Evaluate JSON and JSONL export options as complementary formats.
3. Monitor large-session performance and add streaming download if needed.
4. Consider persisting pause preference across browser refreshes if
   requested.
