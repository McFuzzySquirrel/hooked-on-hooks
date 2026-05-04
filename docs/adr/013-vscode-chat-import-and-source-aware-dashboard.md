# ADR-013: VS Code Chat Import and Source-Aware Dashboard Filtering

- Status: Accepted
- Date: 2026-05-04

## Context

The project now supports static analysis of Copilot session data from local exports,
but an additional operator need emerged:

1. Bring VS Code GitHub Copilot Chat artifacts into the same analysis pipeline.
2. Replay imported VS Code chat events through ingest for deterministic validation.
3. Distinguish session origin in dashboard views (CLI vs VS Code chat).
4. Load imported VS Code chat sessions in the static dashboard without requiring
   `session-store.db` participation.

Before this decision:

1. `extensionDebugLogs` import mode existed as a placeholder but did not parse
   extension debug logs into canonical events.
2. Source filtering in the dashboard did not persist in URL query state.
3. Integration coverage did not include the full fixture path from VS Code import
   through replay and export validation.
4. Imported canonical JSONL could not be loaded directly in the dashboard because
   the dashboard expects a single export JSON document rather than JSONL.

## Decision

Adopt VS Code chat interoperability as a first-class static workflow extension,
with source-aware dashboard behavior and fixture-driven validation.

### 1) Implement Concrete `extensionDebugLogs` Parsing

Add parser behavior in the VS Code chat importer to transform extension debug log
records into canonical event schema entries.

Implementation characteristics:

1. Parse both pure JSON lines and prefixed log lines that contain JSON payloads.
2. Infer session identity from direct and nested fields.
3. Map message/tool/artifact/session lifecycle records to canonical events:
   `chatSessionStart`, `chatMessage`, `chatToolCall`,
   `chatArtifactImported`, `chatSessionEnd`.
4. Emit source as `vscode-chat-debug` for provenance.

### 2) Add End-to-End Fixture Test Coverage

Introduce a fixture-driven test that validates import to replay to export behavior.

Implementation characteristics:

1. Build temporary workspaceStorage fixture input.
2. Import fixtures to canonical JSONL.
3. Replay JSONL into ingest service endpoint.
4. Export session-store shape for dashboard consumption.
5. Assert source-classification outcomes used by source filters.

### 3) Persist Dashboard Source Filter in URL State

Make source selection durable and shareable via query parameters.

Implementation characteristics:

1. Initialize source filter from `source` query parameter.
2. Persist user filter changes via `history.replaceState`.
3. Keep source breakdown and badges consistent with classified session origin.

### 4) Add Canonical JSONL to Dashboard Export Bridge

Provide a user-facing conversion step from canonical JSONL into the dashboard
export shape.

Implementation characteristics:

1. Read canonical JSONL and validate each line against the shared event schema.
2. Reconstruct per-session state and minimal turn/file/model summaries from the
   event stream.
3. Emit dashboard-compatible combined export JSON that the static UI can load
   directly.

## Rationale

1. Aligns VS Code chat activity with existing canonical event workflows.
2. Improves reproducibility by validating complete fixture-to-dashboard flow.
3. Makes filtered dashboard views bookmarkable/shareable.
4. Reduces ambiguity when mixed session sources are present.
5. Closes the operator gap between imported VS Code chat JSONL and the static
   dashboard workflow.

## Consequences

### Positive

1. VS Code chat data can be imported without ad-hoc manual transforms.
2. Source-aware filtering is clearer and survives refresh/navigation.
3. Integration behavior is covered by deterministic automated tests.
4. Imported VS Code chat sessions can now be inspected in the dashboard without
   synthesizing SQLite state manually.

### Negative

1. Import parser logic is more heuristic and must evolve with log format drift.
2. Additional source classification paths increase test and maintenance scope.
3. Partial test runs may require coverage disabling when repository thresholds are
   enforced globally.
4. The JSONL bridge produces a lightweight dashboard export and may contain less
   enrichment than native session-store exports.

## Alternatives Considered

### A) Keep `extensionDebugLogs` as documented placeholder only

Rejected because users need practical import support for extension log artifacts.

### B) Infer source only from export-level metadata

Rejected because per-session host/source traits provide more accurate filtering in
mixed datasets.

### C) Keep source filter as local transient UI state

Rejected because URL persistence improves operator workflows and reproducibility.

### D) Require users to build temporary SQLite state manually for imported logs

Rejected because a direct JSONL-to-dashboard bridge is simpler, faster, and more
aligned with the static export workflow.

## Follow-Up Actions

1. Add fixture variants for additional real-world debug-log shapes.
2. Reassess source classification heuristics as new host/source values appear.
3. Optionally run full-suite coverage validation after major importer changes.
4. Revisit whether the JSONL bridge should grow richer turn/model/token
   enrichment over time.

## References

- `scripts/lib/vscode-chat-import.ts`
- `scripts/replay-jsonl.ts`
- `scripts/export-jsonl-dashboard.ts`
- `scripts/test/import-vscode-chat.test.ts`
- `scripts/test/export-jsonl-dashboard.test.ts`
- `scripts/test/vscode-chat-e2e.test.ts`
- `packages/web-ui/src/App.tsx`
- `packages/web-ui/src/session-dashboard-helpers.ts`
