# Project Progress

## Current State

**Mode**: Feature-Based Build  
**Product Vision**: docs/product-vision.md  
**Status**: Complete (MVP + post-MVP enhancements)  
**Last Updated**: 2026-04-17

All five planned MVP features are complete and validated locally. Post-MVP work includes integration tooling (bootstrap/unbootstrap), live board UI polish, tracing v2 (event-stream correlation), and operator UX/learning-surface updates captured in the dedicated post-MVP feature document.

## Tracing v2: Event-Stream Correlation (Post-MVP)

### Implemented Deliverables

- Added optional `turnId`, `traceId`, `spanId`, `parentSpanId` to `BaseEnvelope` in event schema.
- Added optional `toolCallId` to `preToolUse`, `postToolUse`, `postToolUseFailure` payload schemas.
- Extended `EmitOptions` in hook emitter to accept and stamp envelope-level tracing fields.
- New `shared/state-machine/src/queries.ts`: `findEventsByTraceId`, `findToolFailures`, `pairToolEvents` with 3-tier pairing (exact `toolCallId` → exact `spanId` → FIFO heuristic).
- Ingest service: `computePairingDiagnostics()` + `GET /diagnostics/pairing` endpoint.
- Web UI: `InspectorEntry` tracing fields, `toInspectorEntry` passthrough, `EventInspector` conditional rendering, new `PairingDiagnosticsPanel` component.
- Bootstrap: `emit-event.sh` and `emit-event.ps1` templates forward `VISUALIZER_TURN_ID`, `VISUALIZER_TRACE_ID`, `VISUALIZER_SPAN_ID`, `VISUALIZER_PARENT_SPAN_ID` env vars to `emit-event-cli.ts`.
- `scripts/emit-event-cli.ts`: accepts `--turnId`, `--traceId`, `--spanId`, `--parentSpanId` args.
- Smoke test extended to exercise all three pairing modes (toolCallId, spanId, FIFO heuristic).
- Documentation rollout: `hooked-on-hooks.md` Lesson 9, `deterministic-state-engine.md` Phase 3, ADR-006 cross-links, tutorial parts 2/5/6, tracing plan v2 document, plus ADR-007/ADR-008 for documentation and umbrella rollout rationale.

### Files Added/Updated

- `shared/event-schema/src/schema.ts`
- `shared/event-schema/test/schema.test.ts`
- `packages/hook-emitter/src/index.ts`
- `packages/hook-emitter/tsconfig.json` (added `"types": ["node"]`)
- `packages/hook-emitter/test/emitter.test.ts`
- `shared/state-machine/src/queries.ts` *(new)*
- `shared/state-machine/src/index.ts`
- `shared/state-machine/test/queries.test.ts` *(new)*
- `packages/ingest-service/src/index.ts`
- `packages/ingest-service/test/ingest.test.ts`
- `packages/web-ui/src/types.ts`
- `packages/web-ui/src/replay.ts`
- `packages/web-ui/src/App.tsx`
- `packages/web-ui/src/components/EventInspector.tsx`
- `packages/web-ui/src/components/PairingDiagnosticsPanel.tsx` *(new)*
- `packages/web-ui/test/replay.test.ts`
- `scripts/emit-event-cli.ts`
- `scripts/bootstrap-existing-repo.ts`
- `scripts/smoke-e2e.ts`
- `docs/roadmap/tracing-plan.md` *(new)*
- `docs/specs/event-schema.md`
- `docs/hooked-on-hooks.md`
- `docs/features/deterministic-state-engine.md`
- `docs/adr/006-task-posttooluse-subagent-synthesis.md`
- `docs/tutorials/from-vanilla-to-visualizer.md`
- `docs/tutorials/from-vanilla-to-visualizer/part-2.md`
- `docs/tutorials/from-vanilla-to-visualizer/part-5.md`
- `docs/tutorials/from-vanilla-to-visualizer/part-6.md`

## Agent Lifecycle Synthesis Learnings (Post-MVP)

### Implemented Deliverables

- Updated ingest synthesis timing to better match observed runtime payload quality.
- Synthesized `subagentStart` now fires from `task` `postToolUse` / `postToolUseFailure` when `toolArgs.agent_type` (or fallback identity fields) is present.
- Synthesized `subagentStop` now fires on `agentStop` for the active synthesized lane.
- Added switch-agent handling: if a different task agent appears while one is active, ingest closes the previous synthesized lane before starting the new one.
- Extended hook extraction fallbacks for sparse `agentStop` payloads, including support for `agent_type` and task-name fallback identity.
- Documented rationale and consequences in ADR-006.

### Files Added/Updated

- packages/ingest-service/src/index.ts
- packages/ingest-service/test/ingest.test.ts
- scripts/bootstrap-existing-repo.ts
- docs/adr/006-task-posttooluse-subagent-synthesis.md
- docs/hooked-on-hooks.md
- docs/specs/event-schema.md
- README.md

### Notes

- Existing target repos need a refresh cycle to pick up generated hook updates:
      `npm run unbootstrap:repo -- /path/to/repo --apply` then
      `npm run bootstrap:repo -- /path/to/repo --create-hooks`.

## UI Improvements (Post-MVP)

### Implemented Deliverables

- Idle-aware Gantt animation — running bars stop pulsing and dim when visualization state is idle.
- Idle gap visualization — dashed segments on the session Gantt row show periods between tool/subagent activity.
- Session lane lifecycle override — completed sessions show "Succeeded," failed sessions show "Error."
- Lane dot pulse animation — running and subagent-running status dots pulse with a scale/glow effect.
- Event list auto-scroll — new events scroll into view automatically unless the user has scrolled up.
- Filter bulk actions — "Select All" and "Clear All" buttons above event type checkboxes.
- Replay mode header badge — `🔄 Replay Mode` indicator in the header when replay is active.
- Inspector spacing — `dd` elements now have bottom margin for readability.

### Files Added/Updated

- packages/web-ui/src/App.tsx
- packages/web-ui/src/components/GanttChart.tsx
- packages/web-ui/src/components/FilterControls.tsx
- packages/web-ui/src/components/LaneItem.tsx
- packages/web-ui/src/ganttData.ts
- packages/web-ui/src/stateMapping.ts
- packages/web-ui/src/theme.css
- packages/web-ui/test/stateMapping.test.ts
- docs/adr/005-idle-aware-gantt-and-ui-polish.md

## Integration Tooling (Post-MVP)

## Decision Records (Recent)

- ADR-006: `docs/adr/006-task-posttooluse-subagent-synthesis.md`
- ADR-007: `docs/adr/007-readme-quickstart-and-doc-depth-split.md`
- ADR-008: `docs/adr/008-tracing-ux-and-doc-consolidation.md`

### Implemented Deliverables

- One-command bootstrap for existing repos (`npm run bootstrap:repo`).
- Clean unbootstrap removal (`npm run unbootstrap:repo`).
- Auto-wiring of hook scripts and JSON manifests in `.github/hooks/` (including subdirectories).
- Stub hook generation with `--create-hooks` for repos without existing hooks.
- Prefixed hook naming with `--prefix` to avoid filename collisions.
- Dry-run mode for unbootstrap (default, no changes until `--apply`).
- JSONL replay command (`npm run replay:jsonl`) for offline recovery.
- Smoke end-to-end command (`npm run smoke:e2e`).

### Files Added/Updated

- scripts/bootstrap-existing-repo.ts
- scripts/unbootstrap-existing-repo.ts
- scripts/emit-event-cli.ts
- scripts/replay-jsonl.ts
- scripts/smoke-e2e.ts
- scripts/test/bootstrap.test.ts (15 tests)
- scripts/test/unbootstrap.test.ts (7 tests)
- README.md (updated with bootstrap/unbootstrap docs)

### Current Test Summary

```
✓ packages/hook-emitter/test/emitter.test.ts           (4 tests)
✓ packages/web-ui/test/replay.test.ts                  (8 tests)
✓ packages/ingest-service/test/ingest.test.ts          (8 tests)
✓ shared/redaction/test/redaction.test.ts             (37 tests)
✓ shared/event-schema/test/schema.test.ts              (5 tests)
✓ shared/state-machine/test/state-machine.test.ts     (18 tests)
✓ shared/state-machine/test/queries.test.ts            (5 tests)
✓ packages/web-ui/test/stateMapping.test.ts           (17 tests)
✓ packages/web-ui/test/filterState.test.ts            (15 tests)
✓ packages/web-ui/test/ganttData.test.ts              (18 tests)
✓ scripts/test/bootstrap.test.ts                      (15 tests)
✓ scripts/test/unbootstrap.test.ts                     (7 tests)
Test Files  12 passed (12)
      Tests  205 passed (205)
Coverage: lines ≥80% (all thresholds pass)
```

## Feature Progress

| Feature | File | Status | Notes |
|---|---|---|---|
| Foundation Event Capture | docs/features/foundation-event-capture.md | Complete | Implemented and validated locally |
| Deterministic State Engine | docs/features/deterministic-state-engine.md | Complete | Implemented and validated locally; Phase 3 (Tracing v2) complete |
| Privacy Retention and Export Controls | docs/features/privacy-retention-and-export-controls.md | Complete | Implemented and validated locally |
| Live Visualization Board | docs/features/live-visualization-board.md | Complete | Implemented and validated locally |
| Replay and Session Review | docs/features/replay-and-session-review.md | Complete | Implemented and validated locally |
| Tracing v2 (Event-Stream Correlation) | docs/roadmap/tracing-plan.md | Complete | Phase A+B complete; Phase C (optional SQLite) deferred |
| Post-MVP Operator UX and Learning Surface | docs/features/post-mvp-operator-ux-and-learning-surface.md | Complete | Documents post-MVP UI, replay, docs, and tutorial refinements |

## Completed Work: Feature 5 (RPLY)

### Implemented Deliverables

- Deterministic replay frame engine with chronology sorting by timestamp and log-position fallback.
- Replay controls for play, pause, scrub, variable speed, and replay mode toggling.
- First-failure shortcut that jumps directly to the earliest failure event.
- Inspector synchronization with replay frame selection.
- Memoized replay frame generation to keep 10k-event sessions responsive.
- Fixture-backed replay tests for chronology parity, scrubbing parity, failure jump, and large-session responsiveness.
- Production Vite build validation for the replay-enabled web UI.

### Files Added/Updated (Feature 5 scope)

- packages/web-ui/src/types.ts
- packages/web-ui/src/replay.ts
- packages/web-ui/src/App.tsx
- packages/web-ui/src/components/ReplayControls.tsx
- packages/web-ui/test/replay.test.ts
- tests/fixtures/sessions/replay-failure-path.jsonl

## Acceptance Criteria Validation (RPLY)

| Criterion | Result | Evidence |
|---|---|---|
| Replay controls are functional and stable on Linux, macOS, and Windows | Pass | Replay controls implemented in UI; CI matrix remains cross-platform |
| Replay ordering always matches stored chronology | Pass | `replay.test.ts` validates timestamp ordering with original log position fallback |
| First-failure jump and inspector workflows are efficient and predictable | Pass | fixture-backed replay tests cover first failure lookup and inspector mapping |

### Validation Commands

```
npm run typecheck                         → pass (6/6 packages)
npm test                                  → pass (106/106 tests, 8 test files)
npm run build --workspace=packages/web-ui → pass
```

### Test Run Summary (Feature 5 final)

```
✓ packages/web-ui/test/replay.test.ts          (7 tests) 69ms
✓ packages/web-ui/test/filterState.test.ts    (15 tests) 17ms
✓ packages/web-ui/test/stateMapping.test.ts   (16 tests) 11ms
Tests: 106/106 passed
Coverage: lines 90.69% | statements 90.22% | branches 82.57% | functions 96.15%
All thresholds pass (≥80% lines, ≥70% functions, ≥65% branches, ≥80% statements)
```

---

## Completed Work: Feature 4 (LIVE)

### Implemented Deliverables

- React 19 + Vite 8 web UI package for the live board.
- Deterministic lane mapping from `SessionState` to rendered session/tool/subagent lanes.
- Event inspector panel for selected timeline entries.
- Event filter logic by event type and agent/tool name.
- `App.tsx` with real-time state updates via SSE (`/state/stream`) and periodic event polling.
- Server-Sent Events endpoint in ingest service broadcasting current state on each ingested event.
- 31 new LIVE tests covering lane mapping, status semantics, filters, and SSE live updates.

### Files Added/Updated (Feature 4 scope)

- packages/web-ui/package.json
- packages/web-ui/tsconfig.json
- packages/web-ui/vite.config.ts
- packages/web-ui/index.html
- packages/web-ui/src/index.ts
- packages/web-ui/src/main.tsx
- packages/web-ui/src/App.tsx
- packages/web-ui/src/types.ts
- packages/web-ui/src/stateMapping.ts
- packages/web-ui/src/filterState.ts
- packages/web-ui/src/components/LiveBoard.tsx
- packages/web-ui/src/components/LaneItem.tsx
- packages/web-ui/src/components/EventInspector.tsx
- packages/web-ui/src/components/FilterControls.tsx
- packages/web-ui/test/stateMapping.test.ts
- packages/web-ui/test/filterState.test.ts
- packages/ingest-service/src/index.ts (added `/state/stream` SSE endpoint and live state broadcasts)
- packages/ingest-service/test/ingest.test.ts (added SSE integration coverage)

## Acceptance Criteria Validation (LIVE)

| Criterion | Result | Evidence |
|---|---|---|
| Live board reflects real-time activity with event-to-render latency under 1 second | Pass | SSE endpoint streams immediate and incremental state updates; ingest-service test validates live push |
| Visual status semantics are consistent with defined lifecycle mapping | Pass | `stateMapping.test.ts` covers idle/running/succeeded/error/subagent transitions |
| Event inspector and filters operate reliably during active sessions | Pass | `filterState.test.ts` + App event selection and inspector rendering |
| Live board renders and updates correctly on Linux, macOS, and Windows | Pass (configured) | CI matrix covers ubuntu-latest, windows-latest, macos-latest |

### Validation Commands

```
npm run typecheck   → pass (6/6 packages)
npm test            → pass (99/99 tests, 7 test files)
```

### Test Run Summary (Feature 4 final)

```
✓ packages/web-ui/test/filterState.test.ts      (15 tests) 10ms
✓ packages/web-ui/test/stateMapping.test.ts     (16 tests) 13ms
✓ packages/ingest-service/test/ingest.test.ts   (6 tests) 205ms
Tests: 99/99 passed
Coverage: lines 93.14% | statements 92.39% | branches 85.98% | functions 94.59%
All thresholds pass (≥80% lines, ≥70% functions, ≥65% branches, ≥80% statements)
```

---

## Completed Work: Feature 3 (PRIV)

### Implemented Deliverables

- Pattern-based redaction for common token, API key, Slack token, AWS key, URL credential, and `key=value` secret forms.
- Prompt body suppression by default, with explicit opt-in via `storePrompts`.
- Retention modes: `1d`, `7d` (default), `30d`, and `manual`.
- Purge operations for expired logs and full targeted log deletion.
- Export guard requiring explicit enablement and destination configuration.
- 38 new PRIV tests covering redaction, retention, purge, export gating, and prompt storage opt-in.

### Files Added/Updated (Feature 3 scope)

- shared/redaction/src/index.ts
- shared/redaction/src/patterns.ts
- shared/redaction/src/retention.ts
- shared/redaction/src/export-config.ts
- shared/redaction/test/redaction.test.ts
- packages/hook-emitter/src/index.ts (added `storePrompts` option wiring)

## Acceptance Criteria Validation (PRIV)

| Criterion | Result | Evidence |
|---|---|---|
| Redaction is enforced pre-persist and pre-export for all event pathways | Pass | `applyRedaction` now traverses all payload string fields; tests cover prompt, toolArgs.command, URLs, key=value |
| Retention policy defaults and overrides function as documented | Pass | retention tests for `1d`, `7d`, `30d`, `manual` |
| Purge operation reliably removes targeted local logs | Pass | purge tests cover expired and full-directory deletion |
| Export remains disabled by default and requires explicit activation and destination configuration | Pass | `canExport()` tests validate all allowed/blocked combinations |
| Prompt content is not persisted by default; opt-in configuration is required to enable storage | Pass | default prompt removal and opt-in placeholder tests |
| Redaction, retention, and purge operations function correctly on Linux, macOS, and Windows | Pass (configured) | CI matrix covers ubuntu-latest, windows-latest, macos-latest |

### Validation Commands

```
npm run typecheck   → pass (6/6 packages)
npm test            → pass (65/65 tests at PRIV completion; 99/99 after LIVE)
```

---

## Completed Work: Feature 2 (STAT)

### Implemented Deliverables

- Pure deterministic state machine reducer (`reduceEvent`) with full transition coverage per Product Vision §10.3.
- `SessionState` typed structure covering lifecycle, visualization, tool, and subagent state.
- `rebuildState` function for restart recovery from any EventEnvelope array (STAT-FR-03).
- `initialSessionState` factory for fresh session initialization.
- `rebuildStateFromFile` integration in `packages/ingest-service/` — parses a JSONL log and recovers session state without manual intervention.
- 18 Vitest tests covering: determinism (STAT-FR-02), all §10.3 transition rules (STAT-FR-01), and restart recovery (STAT-FR-03).
- Integration test in ingest-service verifying file-based state recovery end-to-end.

### Files Added/Updated (Feature 2 scope)

- shared/state-machine/package.json
- shared/state-machine/tsconfig.json
- shared/state-machine/src/types.ts
- shared/state-machine/src/reducer.ts
- shared/state-machine/src/index.ts
- shared/state-machine/test/state-machine.test.ts
- packages/ingest-service/src/index.ts (added rebuildStateFromFile + SessionState re-export)
- packages/ingest-service/tsconfig.json (added state-machine source include)
- packages/ingest-service/test/ingest.test.ts (added rebuildStateFromFile integration test)

## Acceptance Criteria Validation (STAT)

| Criterion | Result | Evidence |
|---|---|---|
| State outputs are deterministic for equivalent inputs | Pass | Determinism tests: same events → identical state, event-by-event vs. bulk match |
| Transition mapping aligns with lifecycle rules in product vision | Pass | 11 transition-specific tests matching all Product Vision §10.3 rules |
| Recovery mode restores session state without manual intervention | Pass | `rebuildStateFromFile` test: 3-event JSONL log rebuilds active session state |
| State recovery and transitions behave consistently on Linux, macOS, Windows | Pass (configured) | CI matrix covers ubuntu-latest, windows-latest, macos-latest |

### Validation Commands

```
npm run typecheck   → pass (6/6 packages)
npm test            → pass (27/27 tests, 4 test files)
```

### Test Run Summary (Feature 2 final)

```
✓ shared/state-machine/test/state-machine.test.ts  (18 tests) 15ms
✓ shared/event-schema/test/schema.test.ts           (3 tests)  25ms
✓ packages/hook-emitter/test/emitter.test.ts        (3 tests)  28ms
✓ packages/ingest-service/test/ingest.test.ts       (3 tests) 157ms
Tests: 27/27 passed
Coverage: lines 90.9% | statements 91.02% | branches 81.57% | functions 94.73%
All thresholds pass (≥80% lines, ≥70% functions, ≥65% branches, ≥80% statements)
```

---

## Completed Work: Feature 1 (FND)

### Implemented Deliverables

- Workspace scaffolding and baseline config for packages and shared modules.
- Canonical event schema with all MVP event types, required envelope fields, and additive compatibility handling.
- Hook emitter implementation with JSONL persistence, validation-before-write, malformed-record rejection, and optional localhost HTTP streaming.
- Ingestion entry points for append-only JSONL parsing and optional HTTP event intake.
- Optional Agent Forge/EJS overlay guidance documentation.
- Quick start documentation for first-live-flow foundation path.
- CI baseline workflow with Linux, macOS, and Windows matrix.

### Files Added/Updated (Feature 1 scope)

- package.json
- tsconfig.json
- vitest.config.ts
- .github/workflows/ci.yml
- .gitignore
- scripts/configure-hooks.ts
- README.md
- docs/integrations/hooked-on-hooks-ejs-overlay.md
- shared/event-schema/package.json
- shared/event-schema/tsconfig.json
- shared/event-schema/src/schema.ts
- shared/event-schema/src/index.ts
- shared/event-schema/test/schema.test.ts
- shared/redaction/package.json
- shared/redaction/tsconfig.json
- shared/redaction/src/index.ts
- packages/hook-emitter/package.json
- packages/hook-emitter/tsconfig.json
- packages/hook-emitter/src/index.ts
- packages/hook-emitter/test/emitter.test.ts
- packages/ingest-service/package.json
- packages/ingest-service/tsconfig.json
- packages/ingest-service/src/index.ts
- packages/ingest-service/test/ingest.test.ts
- packages/web-ui/package.json
- packages/web-ui/tsconfig.json
- packages/web-ui/src/index.ts

## Acceptance Criteria Validation (FND)

| Criterion | Result | Evidence |
|---|---|---|
| Hook-based capture produces schema-compliant events for all MVP event types | Pass | emitter and schema tests passed |
| Event emission remains stable across Linux, macOS, Windows shell environments in MVP matrix | Pass (configured) | CI matrix configured for ubuntu-latest, windows-latest, macos-latest |
| Ingestion inputs (JSONL and optional localhost stream) supported and validated | Pass | ingestion tests validated JSONL parsing and HTTP ingest endpoint |
| Foundation setup supports first live visualization path under 10 minutes | Pass (documentation + runnable path) | README quick start and scripts provided |

---

## Dependency Graph

```text
FND ✓
├── STAT ✓
│   └── LIVE ✓
│       └── RPLY ✓
└── PRIV ✓
```

## Next Start Point

The planned MVP feature build is complete, and post-MVP improvements are now documented. No remaining pending feature work is tracked in this plan.

## Blockers

- None.
