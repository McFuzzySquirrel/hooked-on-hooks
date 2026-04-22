# Session Dashboard Walkthrough Screenshots

These screenshots document the `.copilot` session-dashboard workflow from session selection to deep inspection.

## Public-Safe Default

The screenshot script now defaults to synthetic demo fixtures:

- `tests/fixtures/screenshot-demo/session-list.demo.json`
- `tests/fixtures/screenshot-demo/session-export.demo.json`

This avoids publishing real session IDs, repository names, local paths, and prompt content.

## Capture Command

Run from the repository root:

```bash
UI_BASE_URL=http://127.0.0.1:5175 npx playwright test scripts/capture-screenshots.ts
```

If your Vite dev server is on a different port, change `UI_BASE_URL` accordingly.

## Optional: Redacted Real Data

If you need to capture from real local sessions, export with redaction and explicitly pass those files:

```bash
npm run session:list -- --json ./session-list.redacted.json
npm run session:export -- --ids <id1,id2> --out ./session-store-export.redacted.json --redact
UI_BASE_URL=http://127.0.0.1:5175 \
SESSION_LIST_JSON=./session-list.redacted.json \
SESSION_EXPORT_JSON=./session-store-export.redacted.json \
npx playwright test scripts/capture-screenshots.ts
```

The script also applies a lightweight DOM masking pass before each screenshot. You can disable that only when needed:

```bash
SANITIZE_SCREENSHOTS=false npx playwright test scripts/capture-screenshots.ts
```

## Image Sequence

1. `01-selector-loaded.png` — Session Selector after loading `session-list.json`
2. `02-selector-selection-and-export-command.png` — Selected session with generated export command
3. `03-dashboard-overview.png` — Session Dashboard overview tab after loading export JSON
4. `04-dashboard-turns-with-tools-skills-agents.png` — Turns tab with enriched tools/skills/agent details
5. `05-dashboard-models-and-tokens.png` — Models and Tokens tab
6. `06-dashboard-search.png` — Search tab with query results
