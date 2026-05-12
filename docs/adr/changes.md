# ADR Change Notes

## 2026-05-11 - Standalone Local Source Datastore

This branch pivots the next standalone solution away from hook-first ingestion
toward direct local source ingestion and datastore-first filtering.

### Implemented

1. Added ADR-013:
- `docs/adr/013-standalone-local-source-datastore.md`
- Establishes direct Copilot source ingestion as the primary standalone path
- Defers live visualization until datastore and filtering semantics stabilize
- Repositions hooks as optional/live-custom tooling rather than the default

2. Added standalone documentation suite:
- `docs/pathways/standalone-datastore/README.md`
- `docs/features/standalone-source-datastore.md`
- Expanded `docs/specs/local-source-datastore.md`

3. Updated routing docs:
- `README.md`
- Session dashboard pathway
- Hook pipeline pathway

### Next

1. Add datastore filtering/query commands over normalized facets.
2. Add duplicate detection and compaction/indexing guidance.
3. Revisit live visualization once the datastore event corpus is established.

## 2026-04-22 - Static Session Dashboard Pivot (Implementation Start)

This branch starts the migration away from the live ingest visualizer model toward a static, export-driven session explorer based on `~/.copilot/session-store.db`.

### Implemented

1. Added new exporter CLI:
- `scripts/export-session-store.ts`
- Reads `session-store.db` directly (default path `~/.copilot/session-store.db`)
- Supports selector list generation and selected-session export
- Supports both combined export JSON and split per-session JSON files
- Supports optional `--redact` toggle for pattern-based string redaction
- Handles environments where SQLite FTS5 is unavailable by falling back to text assembled from turns/checkpoints/files/refs

2. Added root npm scripts:
- `npm run session:list`
- `npm run session:export`

3. Replaced web UI app shell with static workflow in `packages/web-ui`:
- Session Selector view:
  - Load session list JSON
  - Search by repository/session ID/event count/size
  - Sort by recent, most events, largest
  - Select all/clear selection
  - Selected summary with generated export command
- Session Dashboard view:
  - Load exported JSON
  - Sidebar session filter/switcher
  - Tabs: Overview, Checkpoints, Turns, Files, Models & Tokens, Search

4. Updated UI theme/layout styles for the new selector + dashboard experience.

### Verified

1. Workspace typecheck passes after the migration scaffold changes.
2. `session:list` successfully emits selector-ready JSON from real local session-store data.
3. `session:export` successfully emits combined and split outputs from selected sessions.

### Next

1. Add stricter runtime validation for imported JSON shapes.
2. Add automated tests for exporter and selector/dashboard UI behavior.
3. Update README/tutorial docs to replace live-ingest quickstart with the static workflow.
