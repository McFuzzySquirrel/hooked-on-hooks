# Feature: Post-MVP Operator UX and Learning Surface

## 1. Feature Overview

**Feature Name:** Post-MVP Operator UX and Learning Surface
**Parent Document:** docs/prd.md
**Status:** Implemented
**Summary:** Adds post-MVP operator-focused improvements spanning live/replay UX, tracing diagnostics visibility, CSV export, live feed pause/resume, and tutorial/documentation alignment so users can investigate sessions faster and onboard with copy-paste-accurate guidance.
**Scope:** UI diagnostic affordances, replay/live workflow polish, tutorial parity across Bash/PowerShell, screenshot-backed showcase docs, and export/control tooling for active sessions.
**Dependencies:**
- docs/features/live-visualization-board.md
- docs/features/replay-and-session-review.md
- docs/features/deterministic-state-engine.md

---

## 2. Context: Existing System State

**Completed PRD Phases:**
- Foundation Event Capture complete
- Deterministic State Engine complete
- Live Visualization Board complete
- Replay and Session Review complete
- Privacy, Retention and Export Controls complete

**Relevant Existing Components:**
- `packages/web-ui/src/App.tsx`
- `packages/web-ui/src/components/EventInspector.tsx`
- `packages/web-ui/src/components/GanttChart.tsx`
- `packages/web-ui/src/components/PairingDiagnosticsPanel.tsx`
- `packages/web-ui/src/csvExport.ts`
- `packages/web-ui/src/ganttData.ts`
- `packages/web-ui/src/replay.ts`
- `packages/web-ui/src/theme.css`
- `docs/tutorials/*`
- `docs/tutorials/ui-feature-showcase.md`
- `docs/examples/vanilla-hooks/*`
- `docs/adr/008-tracing-ux-and-doc-consolidation.md`
- `docs/adr/009-tutorial-alignment-and-pretooluse-examples.md`
- `docs/adr/010-csv-export-and-live-feed-pause.md`

**Existing Agents Involved:**
- `ui-engineer`
- `qa-engineer`
- `ingestion-state-engineer`
- `project-architect`
- `project-orchestrator`

**Established Conventions:**
- Additive enhancements only; no breaking changes to event pipeline required.
- Replay/live diagnostic behavior must remain deterministic and test-backed.
- Tutorials must match executable source examples (no pseudo-code drift).

---

## 3. Feature Goals and Non-Goals

### 3.1 Goals
- Improve operator confidence by surfacing tool-pairing confidence and tracing details in the UI.
- Reduce investigation interruption with live feed pause/resume while preserving incoming data.
- Enable one-click CSV export of session events for external analysis.
- Align Bash and PowerShell tutorial tracks with real generated scripts and payload behavior.
- Provide stable screenshot-backed UI documentation for walkthroughs and support.

### 3.2 Non-Goals
- No migration to cloud analytics or server-side export services.
- No replacement of JSONL as canonical persistence format.
- No mandatory tracing IDs for all integrations (optional fields remain optional).
- No redesign of core session/state machine semantics.

---

## 4. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| FT-US-01 | Workflow Reviewer | see pairing confidence classes (`by ID`, `by Span`, `Heuristic`) | I can trust or question tool-event correlation quickly | Must |
| FT-US-02 | Operator | pause live UI updates during inspection | I can investigate without losing context while data keeps arriving | Must |
| FT-US-03 | Platform Engineer | export a session as CSV | I can analyze/share data outside the UI | Must |
| FT-US-04 | Tutorial user (Bash/PS1) | copy tutorial snippets that match real scripts | examples run correctly without manual patching | Must |
| FT-US-05 | Demo owner | use screenshot-backed feature docs | stakeholders can follow UI capabilities consistently | Should |

---

## 5. Technical Approach

### 5.1 Impact on Existing Architecture
- Extends existing web UI components with diagnostic and control affordances.
- Consumes existing ingest/state diagnostics output; no new storage model introduced.
- Keeps export client-side (`Blob` download), avoiding server API expansion.
- Updates tutorials and examples to reflect actual bootstrap and vanilla hook behavior.

### 5.2 New Components
- `packages/web-ui/src/components/PairingDiagnosticsPanel.tsx`
- `packages/web-ui/src/csvExport.ts`
- `packages/web-ui/test/csvExport.test.ts`
- `docs/tutorials/ui-feature-showcase.md`
- `docs/tutorials/assets/tutorial-screenshots/ui-features/*`

### 5.3 Technology Additions
- No new runtime libraries required.
- Uses existing React/Vite/Vitest stack and browser APIs (`Blob`, anchor download).

---

## 6. Functional Requirements

| ID | Requirement | Affects Existing | Priority |
|----|-------------|-----------------|----------|
| FT-FR-01 | UI must display pairing diagnostics with explicit mode breakdown (`toolCallId`, `spanId`, heuristic fallback). | Yes (`packages/web-ui/src/App.tsx`, `PairingDiagnosticsPanel.tsx`) | Must |
| FT-FR-02 | Event inspector must show tracing/correlation fields when present without breaking sparse payload rendering. | Yes (`EventInspector.tsx`, `types.ts`) | Must |
| FT-FR-03 | Live view must support pause/resume that freezes display updates while buffering incoming state/events. | Yes (`App.tsx`) | Must |
| FT-FR-04 | Resume action must flush buffered state/events in order and return UI to current live state. | Yes (`App.tsx`) | Must |
| FT-FR-05 | Session CSV export must include envelope metadata + payload column with RFC-4180 escaping. | Yes (`csvExport.ts`) | Must |
| FT-FR-06 | Export action must be disabled for empty sessions and produce deterministic filename format. | Yes (`App.tsx`, `csvExport.ts`) | Should |
| FT-FR-07 | Tutorial Bash and PS1 tracks must align snippet logic with actual vanilla examples and bootstrap output. | Yes (`docs/tutorials/*`, `docs/examples/vanilla-hooks/*`) | Must |
| FT-FR-08 | Tutorial tracks must standardize `preToolUse` as canonical worked example with parity in structure/depth. | Yes (`docs/tutorials/from-vanilla-to-visualizer*`) | Must |
| FT-FR-09 | UI feature docs must include screenshot-backed walkthroughs for pairing, replay, filters, timeline, and inspector surfaces. | Yes (`docs/tutorials/ui-feature-showcase.md`) | Should |

---

## 7. Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FT-NF-01 | Live/replay UI remains responsive under high event volume while pause/resume and replay controls are active. | Must |
| FT-NF-02 | Additions preserve backward compatibility with sessions lacking optional tracing identifiers. | Must |
| FT-NF-03 | Documentation examples remain executable and synchronized with source generators/examples. | Must |
| FT-NF-04 | Export operates on already-redacted event data and does not bypass privacy controls. | Must |

---

## 8. Agent Impact Assessment

### 8.1 Existing Agents - Extended Responsibilities

| Agent | New Responsibilities | Modified Boundaries |
|-------|----------------------|-------------------|
| `ui-engineer` | Implement pause/resume UX, CSV export controls, pairing diagnostics panel, and inspector tracing presentation | Expanded from baseline board/replay UI into diagnostic/operator controls and export workflows |
| `qa-engineer` | Add tests for csv export, replay/selection behavior, and compatibility with tracing-present/tracing-absent sessions | Expanded to include docs-driven correctness checks and operator-flow regressions |
| `ingestion-state-engineer` | Expose and stabilize pairing diagnostics consumed by UI | Expanded from state transitions into diagnostic observability surface |
| `project-architect` | Maintain runbook/tutorial/docs coherence and onboarding flow for new UX controls | Expanded documentation governance responsibilities |

### 8.2 New Agents Required

| Agent | Role | Why Existing Agents Can't Cover This |
|-------|------|--------------------------------------|
| None | N/A | Existing agent set sufficiently covers UI, ingestion diagnostics, QA, and docs |

### 8.3 Existing Agents - No Changes

| Agent | Reason |
|-------|--------|
| `event-capture-engineer` | No new hook event types required for this feature set |
| `privacy-engineer` | Existing redaction-before-persist guarantees were reused; no new privacy subsystem introduced |
| `forge-team-builder` | No team topology changes needed |

---

## 9. Implementation Phases

### Phase F1: Tracing Diagnostics and Investigation UX
- [x] Surface pairing diagnostics in web UI
- [x] Extend event inspector rendering for tracing metadata
- [x] Align replay/live investigation controls with operator debugging flow

### Phase F2: Live Control and Export Operations
- [x] Implement live feed pause/resume with buffering + flush behavior
- [x] Implement client-side CSV export with standards-compliant escaping
- [x] Add UI control states/badges for pause/export workflows

### Phase F3: Tutorial and Documentation Alignment
- [x] Align Bash/PS1 tutorial snippets to source-of-truth examples/bootstrap output
- [x] Standardize canonical `preToolUse` worked examples across tracks
- [x] Add screenshot-backed UI feature showcase and tutorial assets
- [x] Record decisions in ADR-008/009/010

---

## 10. Testing Strategy

How this feature will be tested:

| Level | Scope | Approach |
|-------|-------|----------|
| Unit Tests | CSV escaping, replay frame behavior, Gantt/inspector mapping | Vitest (`csvExport.test.ts`, `replay.test.ts`, `ganttData.test.ts`) |
| Integration Tests | UI + ingest diagnostics + state updates | Ingest-service diagnostics tests and web-ui integration scenarios |
| Regression Tests | Existing live/replay flows and tutorial validity assumptions | Full workspace `typecheck` + `test`, tutorial/source diff review |

Key test scenarios:
1. CSV export produces escaped rows for commas/quotes/newlines and stable columns.
2. Pause/resume buffers incoming events and flushes correctly on resume.
3. Pairing diagnostics panel renders exact-vs-heuristic counts from ingest diagnostics.
4. Inspector remains stable with and without tracing IDs.
5. Replay remains responsive for large sessions while enhanced controls are active.
6. Tutorial snippets align with actual vanilla examples/bootstrap output patterns.

---

## 11. Rollback Considerations

If rollback is needed:
- Existing files modified include:
  - `packages/web-ui/src/App.tsx`
  - `packages/web-ui/src/components/EventInspector.tsx`
  - `packages/web-ui/src/components/GanttChart.tsx`
  - `packages/web-ui/src/ganttData.ts`
  - `packages/web-ui/src/replay.ts`
  - `packages/web-ui/src/theme.css`
  - `docs/tutorials/from-vanilla-to-visualizer*`
  - `docs/examples/vanilla-hooks/*`
- New files that can be removed cleanly:
  - `packages/web-ui/src/components/PairingDiagnosticsPanel.tsx`
  - `packages/web-ui/src/csvExport.ts`
  - `packages/web-ui/test/csvExport.test.ts`
  - `docs/tutorials/ui-feature-showcase.md`
  - tutorial screenshot assets under `docs/tutorials/assets/tutorial-screenshots/ui-features/`
- No DB migrations required.
- Validate rollback by rerunning UI/replay/export tests and docs link checks.

---

## 12. Acceptance Criteria

1. Pairing diagnostics are visible in UI and communicate exact-vs-fallback correlation confidence.
2. Live feed pause/resume allows investigation without losing incoming updates.
3. CSV export is available for non-empty sessions and produces standards-compliant output.
4. Replay/live inspector workflows support tracing metadata while remaining backward compatible.
5. Bash and PowerShell tutorial tracks are aligned, copy-paste-accurate, and structurally equivalent.
6. UI feature showcase documentation exists with screenshot-backed explanations of primary operator surfaces.

---

## 13. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should CSV export add scoped export modes (filtered window / selected period) in a follow-up? | Current implementation exports full current session only. |
| 2 | Should tutorial snippet extraction be automated from source to prevent future drift? | Manual synchronization with ADR guardrails remains in place for now. |
| 3 | Should pause/resume state be persisted across refreshes? | It remains session-local and ephemeral. |
