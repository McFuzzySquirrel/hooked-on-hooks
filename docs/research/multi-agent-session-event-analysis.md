# Research: Real-World Multi-Agent Session Event Analysis

> **Date**: 2026-04-19
> **Source Data**: `docs/tutorials/experiment/events.jsonl` — 319 events from a live Copilot CLI multi-agent session
> **Session Duration**: ~84 minutes (15:41–17:05 UTC)
> **Repository Under Observation**: `viben` (Vib'N singing game)

## Dataset Summary

A real multi-agent session was captured during Feature PRD creation and Phase F1 execution. The session involved the main agent, a rubber-duck critique, and two ui-hud-developer subagent invocations across 6 user prompt turns.

---

## 1. Event Distribution

| Event Type | Count | % of Total |
|---|---|---|
| preToolUse | 153 | 48% |
| postToolUse | 151 | 47% |
| userPromptSubmitted | 6 | 2% |
| agentStop | 4 | 1% |
| subagentStop | 3 | 1% |
| sessionStart | 1 | <1% |
| sessionEnd | 1 | <1% |

**Finding**: 95% of events are tool-use events. Session lifecycle events are rare bookends. The visualizer's primary rendering workload is tool state changes.

## 2. Tool Usage Distribution

| Tool | Count | % of Tools |
|---|---|---|
| view | 65 | 42% |
| edit | 18 | 12% |
| bash | 18 | 12% |
| report_intent | 16 | 10% |
| read_agent | 8 | 5% |
| glob | 6 | 4% |
| sql | 5 | 3% |
| create | 3 | 2% |
| grep | 3 | 2% |
| task | 3 | 2% |
| skill | 2 | 1% |
| task_complete | 2 | 1% |
| ask_user | 1 | <1% |
| show_file | 1 | <1% |
| extensions_reload | 1 | <1% |
| read_bash | 1 | <1% |

**Finding**: `view` dominates at 42%. The agent is overwhelmingly read-heavy. Sequential `view` batches create visual noise if rendered individually.

## 3. Parallel Tool Batching

39 parallel batches detected (multiple `preToolUse` within <3s windows):

```
[15:41:35] 2x: [report_intent, skill]
[15:41:50] 5x: [report_intent, glob, glob, glob, glob]
[15:42:16] 3x: [view, view, view]
[15:42:32] 4x: [view, view, view, view]
[15:42:50] 4x: [view, view, view, view]
[15:43:08] 4x: [view, view, view, view]
[15:43:32] 4x: [view, view, view, view]
[15:46:49] 5x: [report_intent, view, view, view, view]
...
```

**Finding**: Parallel execution is the norm, not the exception. 39 batches in a single session means the state machine and UI must support multiple concurrent in-flight tools as a first-class concept.

## 4. Pre/Post Tool Pairing Gaps

- 153 `preToolUse` vs 151 `postToolUse` = **2 orphaned pre events**
- Orphaned tools: `create` (1 unpaired), `edit` (1 unpaired)
- All 151 post events have `status: "success"` — zero failures

**Finding**: Orphaned pre events happen in real sessions. The state machine needs a timeout/cleanup strategy. Also, no `errorOccurred` or failure statuses exist in this dataset — error paths need synthetic test data.

## 5. Multi-Agent Hierarchy

### Agent Lifecycle Observed

```
[15:41:25] === USER PROMPT ===
[15:50:06] agentStop: agent=unknown reason=end_turn
[15:53:37] === USER PROMPT ===
[15:54:02] agentStop: agent=unknown reason=end_turn
[15:54:49] === USER PROMPT ===
[16:01:03] agentStop: agent=unknown reason=end_turn
[16:03:41] === USER PROMPT ===
[16:04:24] agentStop: agent=unknown reason=end_turn
[16:06:02] === USER PROMPT ===
[16:11:00] LAUNCH subagent: rubber-duck (f1-plan-critique)
[16:13:08] subagentStop: rubber-duck
[16:14:13] LAUNCH subagent: ui-hud-developer (f1-rocket-sprite)
[16:14:27] READ agent → [16:18:42] subagentStop: ui-hud-developer
[16:20:00] LAUNCH subagent: ui-hud-developer (f1-gamescreen-refactor)
[16:20:13] READ agent → [16:24:10] subagentStop: ui-hud-developer
[17:04:24] === USER PROMPT ===
```

### Metadata Quality Issues

- `agentStop.agentName` is always `"unknown"` for the main agent
- `subagentStop` payloads have **empty** `summary`, `result`, `message`, `description` fields
- Subagent identity is only available from `task` preToolUse `toolArgs`:
  ```json
  {"agent_type": "rubber-duck", "name": "f1-plan-critique", "description": "Critique F1 execution plan"}
  ```

**Finding**: Subagent identity and context must be synthesized from `task` tool args, not from lifecycle events. Our existing `subagentStart` synthesis approach is validated.

## 6. Intent Progression

16 `report_intent` calls trace the session's workflow phases:

```
[15:41:35] Building feature PRD
[15:41:50] Analyzing project context
[15:46:49] Drafting feature PRD
[15:53:48] Showing agent impact section
[15:54:57] Invoking agent team builder
[15:55:17] Analyzing existing agent team
[15:56:45] Updating affected agent files
[15:59:59] Validating agent changes
[16:03:50] Committing and pushing changes
[16:06:12] Analyzing Feature PRD and agents
[16:10:27] Building F1 execution plan
[16:14:11] Executing Phase F1 tasks
[16:24:54] Verifying F1 deliverables
[16:25:38] Committing Phase F1 work
[16:27:22] Committing and pushing F1
[17:04:44] Updating session state
```

**Finding**: `report_intent` provides human-readable phase labels that are a natural fit for a progress timeline or breadcrumb in the UI. Currently treated as a generic tool — deserves elevation to first-class phase marker.

## 7. Timing Analysis

### Overall Breakdown

| Category | Duration | % |
|---|---|---|
| Total session | 84.2 min | 100% |
| Tool execution | 64.2 min | 76.3% |
| LLM thinking | 19.9 min | 23.7% |

### Notable Durations

| Category | Duration | Context |
|---|---|---|
| `ask_user` | 122.6s | User input wait |
| `read_agent` polling | 30–70s per call | Subagent result wait |
| `report_intent` gap | 2218s (37 min) | User away / idle |
| `task` (rubber-duck) | 129.6s | Subagent execution |
| `view` range | 3.5–15s | File reading |
| `edit` range | 2–18.6s | File editing |

**Finding**: Fundamentally different "wait" categories exist:
1. **Active tool execution** — short, predictable (2–15s)
2. **User input waits** — `ask_user` (minutes)
3. **Subagent polling** — `read_agent` loops (30–70s each)
4. **Idle gaps** — user away (37 min gap)

All look the same in current events but need visual distinction.

## 8. Turn Structure

6 user prompts created turns of wildly different sizes:

| Turn | Events | Duration | Dominant Activity |
|---|---|---|---|
| 1 | 77 | ~9 min | Heavy exploration (27 views, 4 globs) |
| 2 | 6 | ~1 min | Quick show |
| 3 | 64 | ~6 min | Agent config updates (14 edits) |
| 4 | 10 | ~1 min | Commit (3 bash) |
| 5 | 149 | ~58 min | Multi-agent execution (3 tasks, 8 read_agents) |
| 6 | 13 | ~1 min | Cleanup |

**Finding**: Turns vary from 6 to 149 events. The UI should group by turn with expandable detail. Turn 5 is the "interesting" one with multi-agent coordination — the visualizer should make these visually prominent.

## 9. Schema Compatibility

### Present in Real Data

All required envelope fields: `schemaVersion`, `eventId`, `eventType`, `timestamp`, `sessionId`, `source`, `repoPath`, `payload` ✅

### Absent from Real Data

- Optional tracing fields (`turnId`, `traceId`, `spanId`, `parentSpanId`) — NOT present
- `errorOccurred` event type — NOT observed
- `postToolUseFailure` — NOT observed (all successes)

**Finding**: Our backward compatibility story for optional tracing fields is validated. Error/failure paths need synthetic test fixtures.

---

## Prioritized Recommendations

### P0 — Must Have (correctness gaps)

| ID | Finding | Recommendation |
|---|---|---|
| P0-1 | 39 parallel tool batches per session | State machine and UI must support multiple concurrent in-flight tools |
| P0-2 | Subagent metadata is empty | Synthesize subagent identity from `task` preToolUse `toolArgs` (name, agent_type, description) |
| P0-3 | 2 orphaned preToolUse events | State machine needs timeout/cleanup for unmatched pre events |
| P0-4 | Main agent name always "unknown" | Use fallback labeling strategy for agentStop with unknown name |

### P1 — Should Have (high-value UX)

| ID | Finding | Recommendation |
|---|---|---|
| P1-1 | 16 intent changes map to workflow phases | Elevate `report_intent` to first-class phase marker in UI (timeline/breadcrumb) |
| P1-2 | 65 view events = visual noise | Collapse parallel `view` batches into "Reading N files" summaries |
| P1-3 | ask_user, read_agent, idle gaps are distinct | Visually distinguish active execution vs user-wait vs agent-polling vs idle states |
| P1-4 | 6 turns with 6–149 events each | Add turn-level grouping using `userPromptSubmitted` as delimiter |

### P2 — Nice to Have (analytics/insights)

| ID | Finding | Recommendation |
|---|---|---|
| P2-1 | 76% time in tools vs 24% thinking | Show execution time breakdown visualization |
| P2-2 | Tool usage heavily skewed to view | Per-session tool distribution chart |
| P2-3 | Parallel batches have clear timing | Gantt-style or lane-based parallel execution visualization |
