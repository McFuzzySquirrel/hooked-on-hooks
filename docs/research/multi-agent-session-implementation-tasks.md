# Implementation Tasks: Multi-Agent Session Analysis Findings

> **Source**: [Research: Multi-Agent Session Event Analysis](./multi-agent-session-event-analysis.md)
> **Created**: 2026-04-19
> **Data**: 319 real events from `docs/tutorials/experiment/events.jsonl`

---

## P0 — Correctness Gaps

### P0-1: Support Multiple Concurrent In-Flight Tools

**Problem**: The state machine tracks only a single tool via `currentTool: ToolInfo | null`
(`shared/state-machine/src/types.ts:18-24`). Real data shows 39 parallel batches per
session where 2–5 tools fire concurrently within <3s windows. The current reducer
overwrites `currentTool` on each `preToolUse`, losing concurrent state.

**Changes required**:

1. **`shared/state-machine/src/types.ts`** — Replace `currentTool: ToolInfo | null` with
   `activeTools: Map<string, ToolInfo>` (keyed by `eventId` or `toolCallId`). Keep
   `currentTool` as a computed getter for backward compat.

2. **`shared/state-machine/src/reducer.ts:63-94`** — Update `preToolUse` handler to
   **add** to `activeTools` map instead of overwriting. Update `postToolUse` handler to
   **remove** the matching tool from the map. Derive `visualization` state from
   `activeTools.size > 0`.

3. **`packages/web-ui/src/ganttData.ts`** — Gantt segment creation already handles
   per-tool rows (`tool:<toolName>`), but verify that overlapping segments on the same
   row render correctly when multiple `view` calls run in parallel.

4. **Tests** — Add test case to `shared/state-machine/test/state-machine.test.ts` for:
   - Two concurrent `preToolUse` events followed by two `postToolUse` events
   - Verify both tools tracked simultaneously
   - Verify state returns to `idle` only when all tools complete

**Acceptance**: State machine correctly tracks N concurrent tools; Gantt renders
overlapping tool segments without visual collision.

---

### P0-2: Synthesize Subagent Identity from `task` Tool Args

**Problem**: `subagentStop` payloads have empty `summary`, `result`, `message`,
`description` fields. `agentStop` always shows `agentName: "unknown"` for the main
agent. Subagent identity is only available from `task` preToolUse `toolArgs`.

**Current state**: `extractTaskAgentInfo` in `packages/ingest-service/src/index.ts:86-120`
already extracts `agent_type`, `name`, `description` from `task` tool args. The
`agentStop` reducer in `shared/state-machine/src/reducer.ts:113-118` falls back to
`state.lastAgentName`.

**Changes required**:

1. **`packages/ingest-service/src/index.ts:199-220`** — Verify the subagentStart
   synthesis populates `agentName` from `toolArgs.name` (not just `agent_type`). The
   real data shows `name: "f1-rocket-sprite"` and `agent_type: "ui-hud-developer"` —
   both should be preserved (type as category, name as instance label).

2. **`shared/state-machine/src/types.ts`** — Add `agentType` field alongside
   `agentName` in `SessionState` to distinguish agent category from instance name.

3. **`packages/web-ui/`** — Render subagent cards with both type badge and instance
   name (e.g., `[ui-hud-developer] f1-rocket-sprite`).

4. **Tests** — Add fixture using real data pattern: `task` with
   `{agent_type: "ui-hud-developer", name: "f1-rocket-sprite", description: "Create RocketSprite component"}`,
   verify synthesized `subagentStart` carries both fields.

**Acceptance**: Subagent cards in the UI show meaningful identity labels derived from
`task` tool args, not empty strings.

---

### P0-3: Handle Orphaned preToolUse Events

**Problem**: 2 orphaned `preToolUse` events (1 `create`, 1 `edit`) in real data never
received matching `postToolUse`. The pairing diagnostics endpoint
(`/diagnostics/pairing`) detects these, but the state machine and Gantt have no
timeout/auto-close strategy.

**Changes required**:

1. **`shared/state-machine/src/queries.ts:36-106`** — After `pairToolEvents` runs,
   emit diagnostic metadata for unpaired pre events. Include the orphan count and
   tool names in the pairing result.

2. **`shared/state-machine/src/reducer.ts`** — When `sessionEnd` fires, auto-close
   any remaining `activeTools` entries with a synthetic `status: "orphaned"`. This
   prevents tools from appearing permanently in-flight after session ends.

3. **`packages/web-ui/src/ganttData.ts`** — Orphaned segments already render with
   dashed style. Verify they get a proper end time (session end or last event
   timestamp) rather than extending infinitely.

4. **Tests** — Add test for: `preToolUse` → `sessionEnd` (no matching post). Verify
   tool transitions to orphaned state and Gantt segment gets bounded end time.

**Acceptance**: Orphaned tools auto-close on session end with visual indicator; no
infinitely-extending Gantt bars.

---

### P0-4: Improve Main Agent Name Fallback

**Problem**: All 4 `agentStop` events in real data have `agentName: "unknown"`. The
reducer falls back to `state.lastAgentName`, which may also be empty at session start.

**Changes required**:

1. **`shared/state-machine/src/reducer.ts:113-118`** — Add cascading fallback:
   `event.payload.agentName → state.lastAgentName → "Main Agent"`.

2. **`packages/web-ui/`** — When rendering `agentStop` with "Main Agent" fallback,
   use distinct styling (e.g., muted label) to indicate it's inferred, not reported.

**Acceptance**: Main agent row never shows "unknown" — displays "Main Agent" with
visual indicator that the name is inferred.

---

## P1 — High-Value UX Improvements

### P1-1: Elevate `report_intent` to First-Class Phase Marker

**Problem**: `report_intent` is not in the event schema
(`shared/event-schema/src/schema.ts:5-17`). If encountered in real data, it would be
treated as a generic `preToolUse`/`postToolUse` pair for tool name "report_intent".
But real data shows 16 intent changes that map perfectly to workflow phases.

**Changes required**:

1. **`shared/state-machine/src/types.ts`** — Add `currentIntent: string | null` to
   `SessionState`.

2. **`shared/state-machine/src/reducer.ts`** — When processing `preToolUse` with
   `toolName === "report_intent"`, extract `toolArgs.intent` and set
   `state.currentIntent`. Don't treat it as a regular tool execution (no tool card).

3. **`packages/web-ui/`** — Add intent breadcrumb/phase indicator:
   - Render current intent as a persistent header/banner above the Gantt chart
   - In replay mode, show intent transitions as phase markers on the timeline
   - Optional: intent history sidebar showing all phase transitions with timestamps

4. **Tests** — Add test with `preToolUse` for `report_intent` with
   `toolArgs: {intent: "Building feature PRD"}`. Verify `currentIntent` updated
   and no tool card created.

**Acceptance**: Intent text appears as a phase label in the UI; intent changes create
visible phase boundaries in the timeline.

---

### P1-2: Collapse Repetitive Tool Batches

**Problem**: 65 `view` events create visual noise. The existing R5 collapse feature
(`packages/web-ui/src/ganttData.ts:89-161`, `collapseRepeatedSegments`) collapses 3+
consecutive completed segments, but doesn't account for parallel batches of the same
tool within a <3s window.

**Changes required**:

1. **`packages/web-ui/src/ganttData.ts:89-161`** — Extend `collapseRepeatedSegments`
   to detect **parallel batches**: multiple segments on the same row that overlap
   temporally (start times within 3s). Collapse these into a single summary segment:
   `"4× view (3.2s)"`.

2. **Expand-on-click** — Ensure collapsed groups can be expanded to show individual
   segments (already implemented via `CollapsedGroup`).

3. **Tests** — Add test with 4 overlapping `view` segments (parallel batch). Verify
   they collapse into a single summary with correct count and total duration.

**Acceptance**: Parallel tool batches collapse into summary segments; individual
segments accessible on expand.

---

### P1-3: Distinguish Wait States Visually

**Problem**: `ask_user` (122s user wait), `read_agent` (30–70s polling loops), and
idle gaps (37 min user away) all map to the same `"idle"` visualization state
(`shared/state-machine/src/types.ts:11-16`).

**Changes required**:

1. **`shared/state-machine/src/types.ts:11-16`** — Add new visualization states:
   ```typescript
   type VisualizationState =
     | "idle"
     | "tool_running"
     | "tool_succeeded"
     | "subagent_running"
     | "waiting_for_user"    // NEW: ask_user in-flight
     | "waiting_for_agent"   // NEW: read_agent in-flight
     | "error";
   ```

2. **`shared/state-machine/src/reducer.ts`** — When `preToolUse` fires with
   `toolName === "ask_user"`, set `visualization: "waiting_for_user"`. Same for
   `toolName === "read_agent"` → `"waiting_for_agent"`.

3. **`packages/web-ui/`** — Add distinct visual styling:
   - `waiting_for_user`: pulsing indicator with "Waiting for user input" label
   - `waiting_for_agent`: spinning indicator with subagent name
   - Long idle gaps (>5 min between events): dim/grey timeline section

4. **Tests** — Add tests for `ask_user` and `read_agent` preToolUse → verify correct
   visualization state; verify postToolUse returns to previous state.

**Acceptance**: Three visually distinct wait states; idle gaps dimmed in timeline.

---

### P1-4: Add Turn-Level Grouping

**Problem**: `turnId` is captured in the schema but not used for UI grouping.
`userPromptSubmitted` events render as point-in-time markers in the Gantt
(`ganttData.ts:360-373`) but don't group subsequent events. Real data shows turns
ranging from 6 to 149 events.

**Changes required**:

1. **`packages/web-ui/src/ganttData.ts`** — Add turn boundary detection: use
   `userPromptSubmitted` events as delimiters. Create `TurnGroup` objects that
   contain all events between consecutive prompts.

2. **`packages/web-ui/`** — Render turn boundaries as:
   - Horizontal divider lines across the Gantt chart
   - Collapsible turn sections with summary header:
     `"Turn 3: 64 events, 6 min — 14 edits, 3 bash"`
   - Turn numbering in left gutter

3. **`shared/state-machine/src/types.ts`** — Add `turnCount: number` and
   `currentTurnStartTime: string | null` to `SessionState`.

4. **Tests** — Add test with 3 `userPromptSubmitted` events interleaved with tool
   events. Verify correct turn boundaries and event counts per turn.

**Acceptance**: Gantt chart shows clear turn boundaries with collapsible sections and
summary headers.

---

## P2 — Analytics & Insights

### P2-1: Execution Time Breakdown

**Problem**: Real data shows 76% tool execution, 24% LLM thinking. This insight
isn't surfaced in the UI.

**Changes required**:

1. **`shared/state-machine/src/queries.ts`** — Add `computeTimeBreakdown(events)`
   function that calculates:
   - Total session duration
   - Time in tool execution (sum of pre→post durations)
   - Time in LLM thinking (gaps between postToolUse and next preToolUse)
   - Time in user waits (ask_user durations)
   - Time in subagent waits (read_agent durations)

2. **`packages/web-ui/`** — Add session summary panel showing pie chart or bar of
   time breakdown.

**Acceptance**: Session summary shows time distribution across execution categories.

---

### P2-2: Tool Usage Distribution

**Problem**: Tool usage is heavily skewed (42% view, 12% edit, etc.) but not
visualized.

**Changes required**:

1. **`shared/state-machine/src/queries.ts`** — Add `computeToolDistribution(events)`
   returning tool name → count mapping.

2. **`packages/web-ui/`** — Add tool usage bar chart in session summary panel.

**Acceptance**: Session summary includes tool distribution visualization.

---

### P2-3: Parallel Execution Visualization (Gantt Lanes)

**Problem**: Parallel tool batches are common but the Gantt chart doesn't visually
emphasize concurrency.

**Changes required**:

1. **`packages/web-ui/src/ganttData.ts`** — Detect overlapping segments across rows
   and add visual indicators:
   - Vertical "batch bracket" connecting concurrent tools
   - Concurrency count label: `"⫽ 4 parallel"`
   - Optional lane-stacking within a single row for same-tool parallelism

2. **Tests** — Verify concurrent segments get batch indicators.

**Acceptance**: Parallel tool execution is visually emphasized in the Gantt chart.

---

## Dependency Graph

```
P0-1 (concurrent tools) ← P1-2 (collapse batches) ← P2-3 (Gantt lanes)
P0-2 (subagent identity) ← P1-3 (wait states)
P0-3 (orphaned events)
P0-4 (agent name fallback)
P1-1 (report_intent) — independent
P1-4 (turn grouping) — independent
P2-1 (time breakdown) ← P1-3 (wait states)
P2-2 (tool distribution) — independent
```

## Cross-References

- **Event Schema**: `docs/specs/event-schema.md`
- **State Machine**: `shared/state-machine/src/`
- **Ingest Service**: `packages/ingest-service/src/`
- **Web UI**: `packages/web-ui/src/`
- **Research Data**: `docs/tutorials/experiment/events.jsonl`
- **Analysis**: `docs/research/multi-agent-session-event-analysis.md`
