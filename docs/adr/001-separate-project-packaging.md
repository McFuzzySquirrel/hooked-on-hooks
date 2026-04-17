# ADR-001: Separate Project Packaging for Agent Visualizer

- Status: Accepted
- Date: 2026-04-12

## Context

We need a live visualization capability for Copilot agent activity. The feature
should work with Agent Forge workflows but should not increase core framework
complexity for users who do not need visualization.

## Decision

Implement the visualizer as a separate repository/project and provide optional
integration guidance for Agent Forge users.

## Rationale

1. Keeps Agent Forge focused on PRD-to-agent-team generation.
2. Allows independent versioning and release cadence for visualizer runtime.
3. Reduces coupling and maintenance risk across unrelated concerns.
4. Enables adoption by users outside Agent Forge.

## Consequences

### Positive

1. Cleaner separation of responsibilities.
2. Easier experimentation with UI and telemetry internals.
3. Optional adoption path and lower default complexity.

### Negative

1. Additional repository and release management overhead.
2. Integration docs must be maintained across projects.

## Alternatives Considered

### A) Embed visualizer runtime in Agent Forge repository

Rejected due to increased core complexity and tighter coupling.

### B) Provide only static progress docs with no live runtime

Rejected because it does not meet the live observability goal.

## Follow-Up Actions

1. Publish setup docs for post-bootstrap integration.
2. Define stable event schema before UI expansion.
3. Add compatibility matrix for CLI-first and future IDE mode.