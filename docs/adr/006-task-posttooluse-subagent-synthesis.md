# ADR-006: Synthesize Subagent Lifecycle from Task Completion Metadata

- Status: Accepted
- Date: 2026-04-14

## Context

The visualizer originally treated `task` `preToolUse` events as the best signal
for synthesized subagent start, and `task` `postToolUse` events as the stop
signal. This heuristic worked structurally but produced weaker attribution in
real sessions.

During live observation, richer routing metadata (for example
`toolArgs.agent_type`, task name, and task description) consistently appeared on
`task` completion events (`postToolUse`) and not reliably on `preToolUse`.

At the same time, `agentStop` events were observed as the natural boundary that
marks the end of an agent/subagent lane in the session timeline.

This created a mismatch:

1. Start-at-pre heuristic could miss or degrade agent identity.
2. Stop-at-post heuristic ended lanes too early for long-running agent work.
3. UI interpretation and operator expectation aligned more closely with
   "task completion dispatches agent work" and "agentStop closes that work".

## Decision

Update ingest synthesis rules for task-driven subagent lifecycle:

1. Synthesize `subagentStart` on `task` `postToolUse` or
   `postToolUseFailure` when `toolArgs.agent_type` (or fallback identity
   fields such as task name) is present.
2. Synthesize `subagentStop` on `agentStop` for the currently active
   synthesized subagent lane.
3. If a different task agent identity appears while another synthesized lane is
   active, synthesize a stop for the previous lane before starting the new one.

These synthesized events are inserted into the ingest event stream immediately
before the triggering source event so state transitions are deterministic and
timeline ordering remains explicit.

## Rationale

1. Aligns synthesis with observed runtime payload quality.
2. Produces more accurate lane identity and continuity in live UI and replay.
3. Preserves deterministic state reconstruction from the accepted event stream.
4. Keeps hook surface unchanged (no new CLI hooks required).

## Consequences

### Positive

1. Subagent lanes now start with stronger identity data in typical task-dispatch
   workflows.
2. Lane lifetime better matches operator mental model: dispatch completion starts
   work, `agentStop` ends it.
3. Existing schema and renderer states continue to work without breaking changes.

### Negative

1. Heuristic remains integration-dependent: environments that omit
   `toolArgs.agent_type` still require fallback naming.
2. `agentStop` payload quality can vary; lane closure identity relies on active
   state when stop payload is sparse.
3. Historical logs created with prior synthesis timing will replay according to
   their existing event records.

### Cross-links

- **Tracing v2 (Phase A/B):** The optional `toolCallId` on `preToolUse` /
  `postToolUse` provides an exact pairing key that supersedes the FIFO heuristic
  when present. See [Tracing Plan v2](../roadmap/tracing-plan.md) and
  `shared/state-machine/src/queries.ts` (`pairToolEvents`).
- The `task` tool's `postToolUse` payload may carry `toolCallId` when emitted
  by the enhanced hook emitter, improving synthesis attribution further.

## Alternatives Considered

### A) Keep start-on-pre and stop-on-post

Rejected because it provided weaker identity attribution in observed sessions and
closed lanes prematurely relative to expected agent lifecycle.

### B) Synthesize from `preToolUse` only, close on timeout

Rejected due to nondeterministic timeout behavior and poorer replay semantics.

### C) Wait for a dedicated `subagentStart` CLI hook

Rejected as a short-term strategy because no such hook exists today and the
visualizer needs robust live attribution now.

## Follow-Up Actions

1. Keep extraction fallback chains current as new host payload shapes appear.
2. Consider optional debug payload fields (gated by env var) for unresolved
   identity cases.
3. Document synthesis timing in user-facing guides and schema references.
