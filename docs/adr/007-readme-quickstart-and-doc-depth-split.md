# ADR-007: README Quickstart and Documentation Depth Split

- Status: Accepted
- Date: 2026-04-17

## Context

Project onboarding now serves two distinct audiences:

1. Operators who need a fast local bring-up and sanity check.
2. Builders who need deeper implementation guidance across hooks, ingest,
   replay, tracing, and UI behavior.

As feature surface increased (bootstrap modes, replay, synthesis, tracing,
UI diagnostics), the top-level README risked becoming too dense for first-run
success while still being too shallow for advanced guidance.

Recent support friction also showed a recurring first-run pattern:

1. Ingest process fails to start (Node/port mismatch).
2. UI runs but appears empty because no events were emitted or endpoint wiring
   is inconsistent.

## Decision

Adopt a documentation split with explicit intent:

1. Keep README focused on fast success:
   - prerequisites
   - run commands
   - a minimal 2-minute local demo emit flow
   - troubleshooting for common startup and no-event scenarios
2. Keep tutorial and feature depth in dedicated docs:
   - tutorial index and part-by-part guides
   - UI showcase gallery
   - detailed architecture/spec/ADR references
3. Link from README to deep-dive docs instead of inlining long explanations.

## Rationale

1. Optimizes time-to-first-signal for new users.
2. Reduces cognitive load in the top-level entry point.
3. Preserves detailed guidance without sacrificing discoverability.
4. Creates a maintainable separation between operational quickstart and design
   rationale.

## Consequences

### Positive

1. Faster local verification path for contributors and evaluators.
2. Lower incidence of avoidable setup confusion.
3. Cleaner README change scope for future updates.
4. Better reuse of existing tutorial/showcase documentation.

### Negative

1. More cross-document links to maintain.
2. Potential drift if tutorial/docs evolve without README link checks.

## Alternatives Considered

### A) Keep all onboarding and deep technical detail in README

Rejected because it does not scale with feature growth and makes first-run
paths harder to follow.

### B) Move quickstart out of README and keep only high-level marketing copy

Rejected because operators need executable setup guidance at the repository
entry point.

## Follow-Up Actions

1. Keep the 2-minute demo commands aligned with emitter/ingest CLI changes.
2. Review README troubleshooting against observed failures during smoke/e2e
   updates.
3. Validate README links whenever tutorial structure changes.
4. Add ADR cross-links from tutorial index and progress docs if documentation
   architecture expands further.
