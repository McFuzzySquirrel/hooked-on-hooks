# ADR-002: Preserve Rich Subagent Metadata with Backward-Compatible Hooks

- Status: Accepted
- Date: 2026-04-13

## Context

The visualizer showed incomplete data for active subagents during
`subagentStart`. In practice, some integrations only provided a subset of the
expected environment variables at start time, which caused generated hook stubs
to emit `agentName: "unknown"` and empty descriptive fields even when related
metadata was available.

At the same time, the event pipeline did not preserve richer subagent start
fields through the deterministic state machine into the live board. This made
the documented event contract weaker than the runtime behavior and reduced the
usefulness of the active-subagent lane.

## Decision

Treat subagent metadata as a backward-compatible, additive contract across the
entire pipeline.

1. Generated subagent hook stubs must prefer explicit agent-name variables, then
   fall back through related display-name and task-description variables before
   using `unknown`.
2. `subagentStart` must support optional descriptive fields such as
   `agentDisplayName`, `agentDescription`, `taskDescription`, `message`, and
   `summary`.
3. The deterministic state machine must preserve those optional fields for the
   active subagent.
4. The live board should render the best available descriptive detail for an
   active subagent without requiring a UI redesign.

## Rationale

1. Improves observability at the moment a subagent starts, which is when users
   most need identity and intent.
2. Keeps the contract resilient across different hook providers and host
   environments.
3. Maintains compatibility with older integrations because the new fields are
   optional and additive.
4. Aligns runtime behavior with the documented event schema and bootstrap
   guidance.

## Consequences

### Positive

1. Active subagent lanes can display meaningful context instead of empty or
   placeholder values.
2. Bootstrap-generated hooks are more robust when integrations expose different
   environment variables.
3. Event schema, reducer behavior, and UI rendering now agree on the intended
   payload shape.

### Negative

1. Existing repos bootstrapped before this change must refresh their generated
   hook stubs to benefit from the improved fallback chain.
2. The subagent payload contract is broader, which slightly increases ongoing
   documentation and compatibility maintenance.

## Alternatives Considered

### A) Leave hook payloads unchanged and fix only the UI

Rejected because the root cause was incomplete emission and dropped metadata,
not just rendering.

### B) Require a single mandatory environment variable for subagent identity

Rejected because existing integrations expose different variable names and the
visualizer should tolerate that variance.

## Follow-Up Actions

1. Document refresh guidance for repos with older generated hook stubs.
2. Keep schema examples and README integration notes aligned with the emitted
   payload shape.
3. Revisit whether future replay views should surface the same richer subagent
   details beyond the live lane.