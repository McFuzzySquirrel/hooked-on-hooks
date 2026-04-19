# ADR-011: Multi-Agent Session Improvements

- Status: Accepted
- Date: 2026-04-19

## Context

Analysis of 319 real events from a multi-agent Copilot CLI session revealed
several gaps between what the visualiser modelled and what actually happens
during complex, parallel agent workflows. Key observations:

1. **Concurrent tool execution is common.** 39 parallel batches were detected
   where 2–5 tools fire within a <3 s window. The state machine tracked only
   one tool at a time via `currentTool`, silently dropping concurrent state.

2. **Subagent identity is fragmented.** `subagentStop` payloads are always
   empty. `agentStop` reports `agentName: "unknown"` for the main agent.
   Useful identity (agent type, instance name, description) is available only
   in `task` `preToolUse` `toolArgs`.

3. **Orphaned pre-events occur.** 2 of 144 `preToolUse` events had no
   matching `postToolUse`. The reducer had no mechanism to detect or clean up
   these orphans.

4. **Intent progression is invisible.** 16 `report_intent` calls map to
   distinct workflow phases ("Exploring codebase" → "Implementing changes" →
   "Running tests"), but the state machine treated them as generic tool calls.

5. **Wait states are indistinguishable.** `ask_user` (122 s user wait),
   `read_agent` (30–70 s polling), and idle gaps all mapped to the same
   `"idle"` visualization state.

6. **Turn boundaries are unmarked.** `userPromptSubmitted` events were
   point-in-time markers with no grouping. Real turns ranged from 6 to 149
   events.

7. **No session-level analytics exist.** Tool distribution (42% `view`, 12%
   `edit`) and time breakdown (76% tool execution, 24% LLM thinking) are
   useful insights with no API surface.

## Decision

### State Machine Changes (`shared/state-machine/`)

#### P0-1: Concurrent Tool Tracking

Replace the single `currentTool: ToolInfo | null` with an `activeTools:
Record<string, ToolInfo>` keyed by `eventId`. The existing `currentTool`
field is retained as a concrete field (not a getter) because getters don't
survive `JSON.stringify()` or spread operators used in SSE broadcasting.

Tool pairing in the reducer mirrors `pairToolEvents()` in `queries.ts`:
match by `toolCallId` first, fall back to FIFO by `toolName`.

A new `removeMatchingTool()` helper encapsulates the matching and removal
logic.

#### P0-3: Orphaned Tool Cleanup

On `sessionEnd`, any remaining entries in `activeTools` are cleared and
`orphanedToolCount` (new `SessionState` field) is incremented by the count
of orphaned tools.

#### P0-4: Agent Name Fallback

`agentStop` events with empty or `"unknown"` `agentName` fall back to
`lastAgentName` (new field) — the most recent non-empty agent name seen.
The reducer never fabricates a synthetic name like "Main Agent"; the UI
layer can apply display-only labels.

#### P1-1: Intent Tracking

When `preToolUse` fires with `toolName === "report_intent"`, the reducer
extracts `toolArgs.intent` into `currentIntent: string | null` (new
`SessionState` field). The tool call is still tracked in `activeTools` for
pairing purposes but the intent text is surfaced separately.

#### P1-3: Wait State Visualization

Two new `VisualizationState` values:
- `"waiting_for_user"` — set when `preToolUse` fires with
  `toolName === "ask_user"`
- `"waiting_for_agent"` — set when `preToolUse` fires with
  `toolName === "read_agent"`

Both clear on the corresponding `postToolUse`.

#### P1-4: Turn Grouping

`userPromptSubmitted` increments `turnCount: number` and records
`currentTurnStartTime: string | null` (both new `SessionState` fields).
These are preserved across subsequent tool events.

### Ingest Service Changes (`packages/ingest-service/`)

#### P0-2: Subagent Identity

- `TaskAgentInfo` gains an `agentType` field extracted from
  `toolArgs.agent_type`.
- Agent display name preference changed from `agentType ?? taskName` to
  `taskName ?? agentType` so the instance name (e.g., "f1-rocket-sprite")
  is preferred over the category (e.g., "ui-engineer").
- Synthesized `subagentStart` events pass `agentType` through in the
  payload.

### Gantt / Analytics Changes (`packages/web-ui/`, `shared/state-machine/`)

#### P1-2: Parallel Batch Collapse

`collapseRepeatedSegments()` in `ganttData.ts` extended with a first pass
that detects **temporally overlapping** segments (start time of one falls
within the duration of the previous). These are collapsed into a single
summary segment with `details.parallel: true`. The existing R5 consecutive-
run collapse remains for non-overlapping sequences.

#### P2-1: Execution Time Breakdown

New `computeTimeBreakdown(events)` in `queries.ts` returns:
- `totalDurationMs` — wall-clock session duration
- `toolExecutionMs` — sum of paired tool durations
- `userWaitMs` — `ask_user` durations
- `agentWaitMs` — `read_agent` / `write_agent` durations
- `llmThinkingMs` — remainder (total − tools − waits)

#### P2-2: Tool Distribution

New `computeToolDistribution(events)` in `queries.ts` returns per-tool
`count`, `totalDurationMs`, and `avgDurationMs`, sorted by usage count
descending.

#### P2-3: Cross-Row Parallel Detection

New `detectParallelBatches(rows)` in `ganttData.ts` scans across rows for
segments that overlap temporally and returns `ParallelBatch` descriptors
with `concurrency`, `rowIds`, `segmentIds`, `startTime`, and `endTime`.
The UI can render bracket indicators or concurrency labels from these.

## Consequences

### Positive

- The state machine now accurately represents real multi-agent sessions with
  concurrent tools, meaningful intent phases, and wait-state differentiation.
- Analytics APIs provide session-level insights without needing external
  tooling.
- Orphaned tools are tracked rather than silently lost.
- Backward compatible — all new `SessionState` fields have defaults; old
  event logs replay without issues.

### Negative

- `SessionState` grew by 5 fields (`activeTools`, `currentIntent`,
  `turnCount`, `currentTurnStartTime`, `orphanedToolCount`). SSE payloads
  are slightly larger.
- `activeTools` is a `Record<string, ToolInfo>` keyed by `eventId`. If two
  events somehow share an `eventId`, the second silently overwrites the
  first. This is considered an acceptable risk given that `eventId` is a UUID.

### Risks

- `report_intent` is not part of the Copilot CLI event schema — it arrives
  as a regular `preToolUse`. If the CLI changes how intent is reported, the
  reducer's `toolName === "report_intent"` check will need updating.
- Wait state detection is tool-name-based (`ask_user`, `read_agent`). If
  new blocking tools appear, they won't automatically get wait state visuals.

## References

- Research: `docs/research/multi-agent-session-event-analysis.md`
- Implementation tasks: `docs/research/multi-agent-session-implementation-tasks.md`
- Source data: 319 events from real multi-agent session (local, gitignored)
