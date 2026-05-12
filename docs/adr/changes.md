# ADR Change Notes

## 2026-05-12 - VS Code GitHub Copilot Chat Debug Log Import

Extends the standalone datastore pathway to also ingest VS Code GitHub Copilot
Chat debug log files. This covers users working from the IDE rather than the
Copilot CLI, so both sources end up in the same append-only datastore.

### Implemented

1. VS Code source adapter in `packages/local-datastore/src/index.ts`:
   - Auto-discovers Copilot Chat logs from default VS Code/Code-Insiders log
     directories on Linux, macOS, and Windows.
   - Auto-discovers Copilot Chat logs from default VS Code/Code-Insiders
     `User/workspaceStorage` roots on Linux, macOS, and Windows.
   - Supports both `.log` and `.jsonl` debug sources so IDE workspaceStorage
     `main.jsonl` traces are imported.
   - Accepts an explicit `--vscode-chat-debug-path <file-or-dir>` argument.
   - Normalizes each log line into a `sourceEvent` envelope with
     `source: "vscode"` and `sourceVersion: "copilot-chat-debug-log-v1"`.
   - Parses log-line timestamps and level prefixes; maps debug-level lines to
     the `debugEvents` facet.
   - Applies standard redaction and opt-in raw payload retention.
   - Generates a stable `sessionId` from the machine ID and log path so
     repeated imports are idempotent.

2. New CLI flags in `scripts/ingest-source-datastore.ts`:
   - `--include-vscode-chat-debug` — discover and import from default VS Code
     log locations.
   - `--vscode-chat-debug-path <path>` — import a specific file or directory
     (repeatable).
   - `--no-session-store` — skip `session-store.db` for IDE-only imports.

3. Updated documentation suite:
   - `docs/pathways/standalone-datastore/README.md` — IDE-only quickstart steps
   - `docs/specs/local-source-datastore.md` — VS Code source table row,
     `sourceVersion`, CLI flag table, facet description
   - `docs/features/standalone-source-datastore.md` — SDS-FR-02 updated,
     Phase 1 checklist item added
   - `docs/adr/013-standalone-local-source-datastore.md` — VS Code source
     listed in context; VS Code adapter paragraph added to Decision section
   - `README.md` — standalone section description and quickstart updated
   - `docs/PROGRESS.md` — VS Code chat bullets and test summary updated

### Next

1. Add datastore filtering/query commands over normalized facets.
2. Add duplicate detection and compaction/indexing guidance.
3. Revisit live visualization once the datastore event corpus is established.

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
