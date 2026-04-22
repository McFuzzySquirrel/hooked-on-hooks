# Session Dashboard Workflow

This guide describes the default operator flow for analyzing Copilot sessions with the static dashboard.

## Prerequisites

- Node.js 24+
- sqlite3 CLI installed and available in PATH
- Local Copilot data at `~/.copilot/session-store.db`

## 1. Generate Session List

Create selector input JSON from your local session-store database:

```bash
npm run session:list -- --json ./session-list.json
```

The generated file contains session cards with:

- repository
- sessionId
- eventCount
- fileSizeBytes
- modifiedAt
- createdAt
- branch
- summary

## 2. Launch the Dashboard App

```bash
npm run dev --workspace=packages/web-ui
```

Open `http://127.0.0.1:5173`.

## 3. Use Session Selector

1. Load `session-list.json`.
2. Search by repository, session ID, event count, or size.
3. Sort by Recent First, Most Events, or Largest.
4. Select one or more sessions.
5. Copy the generated export command from the summary panel.

## 4. Export Selected Sessions

Combined export:

```bash
npm run session:export -- --ids <id1,id2> --out ./session-store-export.json
```

Split export:

```bash
npm run session:export -- --ids <id1,id2> --split --split-dir ./session-exports
```

Optional redaction:

```bash
npm run session:export -- --ids <id1,id2> --out ./session-store-export.json --redact
```

## 5. Inspect in Session Dashboard

1. Switch to Session Dashboard view.
2. Load combined export JSON or a single split session file.
3. Use the sidebar to filter/switch sessions.
4. Navigate tabs:
   - Overview
   - Checkpoints
   - Turns
   - Files
   - Models and Tokens
   - Search

## Notes

- If your sqlite build does not include FTS5, search/model/token extraction falls back to text from turns, checkpoints, files, and refs.
- Export mode is read-only; no write/delete operations are performed against session-store.db.
