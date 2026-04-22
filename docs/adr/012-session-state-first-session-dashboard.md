# ADR-012: Session-State-First Session Dashboard Workflow

- Status: Accepted
- Date: 2026-04-23

## Context

The project now supports two independent operational paths:

1. Hook pipeline mode for live capture from target repositories.
2. Session dashboard mode for static analysis from local Copilot session data.

As usage expanded, a recurring operator need became clear: quickly inspect
recent sessions without bootstrap, hook wiring, or a running ingest service.

Local Copilot data already provides rich material for retrospective analysis:

1. Session metadata in `~/.copilot/session-store.db`.
2. Event streams in `~/.copilot/session-state/<session-id>/events.jsonl`.

This data includes turn structure, model usage, token totals, tool activity,
and searchable text that can power a useful dashboard without live plumbing.

## Decision

Adopt a session-state-first static workflow as a first-class, default-friendly
operator path.

### 1) First-Class Session Dashboard Path

Treat local session-store plus session-state as a supported analysis source,
not a fallback.

Implementation characteristics:

1. Session listing from local session-store database.
2. Session export in combined or split JSON files.
3. Static UI loading from exported JSON with no ingest dependency.

### 2) Event Enrichment at Export Time

Compute additional turn-level and model/token insights in the exporter,
including:

1. Per-turn tool, skill, and subagent activity grouping.
2. Model transitions and token usage aggregates.
3. Reasoning/event snippets for audit and review context.

### 3) Documentation Architecture Split

Document the two modes as independent pathways:

1. Session dashboard pathway for local retrospective analysis.
2. Hook pipeline pathway for live/custom event capture.

Top-level documentation acts as an overview router into these paths.

### 4) Public Screenshot Safety Defaults

For published UI walkthrough assets:

1. Default screenshot capture to synthetic demo fixtures.
2. Keep optional redacted real-data flow behind explicit overrides.
3. Enforce safety invariants with a CI screenshot-safety check.

## Rationale

1. Reduces setup friction for read-only analysis.
2. Uses existing rich local data instead of requiring new capture.
3. Improves reproducibility for reviews by using exported JSON artifacts.
4. Preserves hook pipeline flexibility for live/custom requirements.
5. Lowers accidental disclosure risk for tutorial screenshots.

## Consequences

### Positive

1. Faster time-to-insight for operators and reviewers.
2. Clear separation between live observability and retrospective analytics.
3. Better portability of session analysis via export files.
4. Safer default behavior for documentation assets.

### Negative

1. Two workflows increase documentation and maintenance surface.
2. Export enrichment adds parser/mapping complexity in scripts.
3. Some live-only diagnostics still require hook pipeline mode.

## Alternatives Considered

### A) Keep hook pipeline as the only supported path

Rejected because it requires setup overhead for use cases that only need
retrospective inspection.

### B) Build session dashboard directly on live SQLite access in the browser

Rejected because exporting JSON is simpler, safer, and easier to share.

### C) Keep real-session screenshot capture as default

Rejected due to elevated risk of exposing session identifiers, paths, and
content in public docs.

## Follow-Up Actions

1. Continue extending screenshot-safety checks to legacy image sets.
2. Add leak-pattern scanning for tutorial sidecar snapshot files.
3. Keep session-dashboard and hook-pipeline pathway docs in sync with CLI
   and UI behavior changes.
4. Reassess whether additional redaction rules are needed as enrichment
   fields evolve.

## References

- `docs/pathways/session-dashboard/README.md`
- `docs/pathways/hook-pipeline/README.md`
- `scripts/export-session-store.ts`
- `scripts/capture-screenshots.ts`
- `scripts/check-screenshot-safety.ts`
- `docs/tutorials/assets/tutorial-screenshots/session-dashboard/README.md`
