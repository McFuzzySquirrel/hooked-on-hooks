# ADR-008: Tracing, UX, and Documentation Consolidation

- Status: Accepted
- Date: 2026-04-17

## Context

Over the last two days, the project shipped a tightly related set of changes
across runtime behavior, web UI operability, and documentation:

1. Tracing v2 event-stream correlation was implemented end-to-end.
2. Tool lifecycle pairing confidence became observable in ingest and UI.
3. Live/replay investigation UX was refined for faster failure analysis.
4. Tutorial and README guidance were expanded with screenshot-backed workflows.

While several narrower ADRs already exist, this release-sized change set
introduced a single operator-facing outcome: higher-confidence debugging with a
faster path from raw event to actionable explanation.

## Decision

Adopt a consolidated observability model that combines correlation fidelity,
state synthesis clarity, and operator-first documentation.

### 1) Correlation Fidelity First

Use optional tracing identifiers (`turnId`, `traceId`, `spanId`,
`parentSpanId`, `toolCallId`) without breaking compatibility for sparse
integrations.

### 2) Deterministic Pairing with Explicit Precedence

Pair tool lifecycle events using a fixed order:
1. exact `toolCallId`
2. exact `spanId`
3. FIFO fallback by tool/arrival

Expose pairing diagnostics so users can see confidence and fallback rates.

### 3) Lifecycle Synthesis Aligned to Runtime Reality

Synthesize subagent lifecycle from task completion metadata and `agentStop`
boundaries (as formalized in ADR-006), favoring observed payload quality over
idealized hook timing assumptions.

### 4) UI as a Diagnostic Surface (Not Just a Dashboard)

Keep timeline selection, replay controls, filtering, inspector tracing fields,
and pairing diagnostics as first-class debugging affordances.

### 5) Documentation as Operational Runbook + Deep Links

Treat README as a quickstart runbook (bring-up, 2-minute demo,
troubleshooting), and keep deep implementation detail in tutorials/showcase/
spec docs. Keep Bash/Linux and PowerShell tutorial tracks visually and
structurally aligned.

## Rationale

1. Operators need trustable correlation and visible confidence classes to debug
   effectively.
2. Deterministic precedence and replay parity reduce ambiguity in incident
   reconstruction.
3. Documentation quality directly impacts mean-time-to-first-signal and support
   load.
4. Consolidating these changes clarifies product direction for future
   contributions.

## Consequences

### Positive

1. Faster transition from emitted event to root-cause hypothesis.
2. Better replay fidelity and clearer failure attribution.
3. Reduced onboarding friction via executable quickstart/demo guidance.
4. Shared screenshot-backed language across tutorials and README.

### Negative

1. More documentation assets and links to maintain.
2. Pairing/UX behavior now depends on keeping diagnostics and docs synchronized.
3. Sparse integrations still rely on fallback heuristics in some sessions.

## Alternatives Considered

### A) Ship tracing/runtime changes without coordinated UX and docs updates

Rejected because operational value is reduced when confidence logic is not
visible and explained.

### B) Capture only narrow ADRs per component, no umbrella decision

Rejected because it obscures the release-level intent and cross-cutting
rationale.

### C) Delay documentation parity until later

Rejected because user workflows changed immediately with tracing and pairing
features, and docs needed to reflect current behavior.

## Cross-links

- ADR-005: `005-idle-aware-gantt-and-ui-polish.md`
- ADR-006: `006-task-posttooluse-subagent-synthesis.md`
- ADR-007: `007-readme-quickstart-and-doc-depth-split.md`
- Tracing Plan: `../roadmap/tracing-plan.md`
- Progress summary: `../PROGRESS.md`

## Follow-Up Actions

1. Keep pairing diagnostics semantics stable as new event classes are added.
2. Revalidate tutorial/README screenshots when UI layout changes.
3. Preserve replay/live behavior parity tests for selection, filtering, and
   inspector mapping.
4. Consider a future ADR if optional persistent trace indexing (SQLite phase)
   is activated.
