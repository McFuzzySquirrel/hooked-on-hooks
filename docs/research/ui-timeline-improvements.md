# UI Timeline Visualization: Research, Findings & Recommendations

> **Date:** 2026-04-15
> **Author:** Research Agent
> **Status:** Draft — ready for review

---

## 1. Problem Statement

The current Gantt-chart timeline has two core pain points:

1. **Too many long-running orange bars** — when multiple tools or subagents fire in sequence, the timeline fills with pulsing amber segments that dominate the visual field, making it hard to see what actually matters.
2. **Bars never close for completed tools** — because the Copilot CLI does not send a dedicated "stop" event for some hook pairings (e.g. `preToolUse` inside a subagent that itself has no matching `postToolUse`), the segment stays `endTime: null` and renders as an ever-growing orange bar, even though the work has clearly finished.

### Root-cause analysis

| Symptom | Code location | Underlying cause |
|---|---|---|
| Orange bar grows forever | `GanttChart.tsx:342-346` — `const end = seg.endTime ?? now;` | `endTime` stays `null` because no closing event arrived. The `openTools` map in `ganttData.ts` is keyed by tool **name**, so a second invocation of the same tool silently replaces the still-open first invocation without closing it. |
| Too many orange bars | `ganttData.ts:152-171` — every `preToolUse` creates a new segment | Each pre/post pair becomes its own bar. There is no aggregation, folding, or threshold for hiding short-duration bars. A typical agent session can fire 30–80 tool calls, producing a wall of orange. |
| Bars don't stop even after session ends | `ganttData.ts:136-148` — session-end cleanup | Session-end auto-closes open segments, but if the session itself never ends (e.g. agent-stop without session-end), bars remain open indefinitely. |

---

## 2. Landscape Survey — What Others Do

We studied eight projects / platforms that solve the same or similar problem. Below we summarise their approach and the key UX patterns they use.

### 2.1 Agent Flow (patoles/agent-flow)

**What it is:** Real-time visualisation of Claude Code agent orchestration. Node-graph UI.

**Key patterns:**
- **Interactive node graph** instead of Gantt bars — agents and tools are nodes; edges show invocation flow. Avoids the "wall of bars" problem entirely.
- **Auto-detect sessions** — zero-config discovery of active sessions.
- **Timeline + transcript panels** — separate views for chronological event list vs. visual flow. Users don't need to decode bar lengths.
- **File attention heatmap** — shows which files were touched, giving context beyond tool names.

**Lessons for us:**
- A **node/flow graph** is a complementary view that solves the orange-bar problem at its root — duration becomes edge weight or node shading, not bar length.
- **Multi-view approach** — don't force one view to carry all information.

### 2.2 Mohano (hulryung/mohano)

**What it is:** Real-time visualiser for Claude Code multi-agent activity. Vanilla JS.

**Key patterns:**
- **Swim-lane timeline** per agent (not per tool) — reduces lane count dramatically.
- **Task Graph (Kanban)** — Pending / In Progress / Completed columns with dependency arrows. Gives a "status board" view that doesn't suffer from bar-length confusion.
- **Agent cards grouped by type** — team agents, subagents, main session each get their own visual group.
- **Collapsible event log** with filtering — keeps the detail available but out of the way.
- **WebSocket auto-reconnect** with no polling — real-time without 250ms timer ticks.

**Lessons for us:**
- **Group by agent, not by tool name** — dramatically reduces visual noise.
- **Kanban/status board** is a powerful complementary view for "what's happening now" that doesn't suffer from the growing-bar problem.
- **Collapsible sections** let advanced users drill in without cluttering the default view.

### 2.3 AgentPrism (evilmartians/agent-prism)

**What it is:** React component library for visualising AI agent traces. OpenTelemetry-native.

**Key patterns:**
- **Hierarchical tree view** — spans are nested (agent → tool → sub-tool). The tree naturally collapses completed work.
- **Search and expand/collapse controls** — users find the span they care about without scanning a horizontal timeline.
- **Details panel** — click any span to see attributes. Duration is shown as text, not bar length.
- **Status badges** on each span node — small coloured dots (green/red/yellow) replace full-width bars.
- **OpenTelemetry data model** — parent-child span relationships provide natural grouping and nesting.

**Lessons for us:**
- **Tree / waterfall view** (à la Chrome DevTools Network tab or Jaeger) is the gold standard for trace data. Each span shows its own mini-bar relative to its parent, avoiding the "everything is orange" problem.
- **Collapsible nesting** — completed spans auto-collapse, keeping the view focused on in-progress work.

### 2.4 Langfuse

**What it is:** Open-source LLM engineering platform. Full observability suite.

**Key patterns:**
- **Nested trace waterfall** — the trace detail view shows a waterfall of spans (generation, retrieval, tool-use) nested under their parent. Each span has its own proportional bar.
- **Colour by span type, not by status** — generations are one colour, tool calls another. Status is shown as an icon overlay (✓, ✗, ⏳).
- **Duration as numeric label** — each span row shows "1.2s" or "340ms" as text, removing the need to decode bar width.
- **Cost and token overlays** — the waterfall adds cost and token columns, giving the bar more purpose than just "how long."
- **Session timeline** — aggregates multiple traces into a session-level view where each trace is a single block. Drilling in shows the waterfall.

**Lessons for us:**
- **Numeric duration labels** on bars are essential — the user shouldn't have to estimate from bar width.
- **Colour by category, status as overlay** — avoids the "everything is orange" problem. Orange is only for the ⏳ spinner, not the entire bar.
- **Two-level zoom:** session-level summary → per-trace waterfall on click.

### 2.5 VoltAgent / VoltOps Console

**What it is:** AI Agent Engineering Platform with built-in observability console.

**Key patterns:**
- **Agent timeline with swim lanes** — similar to our Gantt, but with key differences:
  - Completed spans are green with fixed width.
  - Only the *currently active* span pulses/animates.
  - Completed spans show a duration badge.
- **Workflow step visualization** — shows each workflow step as a discrete card, not a bar. Cards have status icons.
- **Suspend/resume indicators** — when a workflow step is waiting for human input, it shows a distinct "paused" visual instead of an ever-growing bar.

**Lessons for us:**
- **Only animate the single active item** — stop pulsing everything that is merely "running."
- **Suspend/waiting state** is distinct from "running" — introduces a fourth visual state.

### 2.6 PepeClaw / Anima-3D (BitmapAsset/pepeclaw)

**What it is:** 3D isometric office visualisation for AI agents. Innovative but niche.

**Key patterns:**
- **Spatial metaphor** — agents are in "rooms" based on their current activity. No timelines at all.
- **Activity feed** — a scrolling text log replaces the timeline for temporal information.
- **Agent selection → detail panel** — click an agent to see its status, current task, and history.

**Lessons for us:**
- A **spatial/metaphorical view** can complement a timeline for "what is happening now." Less relevant for timeline improvements, but confirms that **multiple views** are the industry pattern.

### 2.7 CrewAI Control Plane

**What it is:** Enterprise multi-agent orchestration with built-in tracing and observability.

**Key patterns:**
- **Trace and span model** — OpenTelemetry-compatible. Spans are nested.
- **Per-agent dashboards** — each agent gets its own metrics view (latency, cost, error rate).
- **Actionable insights** — highlights slow or failed spans instead of showing everything equally.

**Lessons for us:**
- **Highlight anomalies** — instead of showing every bar equally, flag the ones that took unusually long or failed.

### 2.8 OpenTelemetry / Jaeger / Zipkin (distributed tracing)

**What it is:** The foundational trace visualisation model used by most observability platforms.

**Key patterns:**
- **Waterfall view** — the canonical trace UI. Each span is a horizontal bar, but:
  - Bars are **nested** under their parent span (indented).
  - **Completed bars have fixed width** — only the root or actively-running span stretches.
  - **Duration labels** are always visible (e.g., "1.23s").
  - **Colour encodes service/category**, not status.
  - **Status is an icon** (✓ green check, ✗ red cross, ⏳ clock).
- **Critical path highlighting** — some tools highlight the longest path through the trace.
- **Span detail on click** — full metadata and tags.
- **Collapsible span groups** — identical repeated spans (e.g., 50 DB queries) collapse into "50× db.query (total 2.3s)".

**Lessons for us:**
- This is the model that **every successful trace UI converges on**. Our Gantt chart should evolve toward this pattern.
- **Collapsible repeated spans** is the single most impactful pattern for reducing noise.

---

## 3. Summary of Common Patterns

Across all surveyed tools, these patterns recur:

| Pattern | Used by | Impact |
|---|---|---|
| **Nested/hierarchical waterfall** | AgentPrism, Langfuse, Jaeger, CrewAI | High — eliminates flat bar noise |
| **Duration as numeric text label** | Langfuse, Jaeger, AgentPrism | High — removes guesswork |
| **Colour = category, icon = status** | Langfuse, Jaeger, VoltAgent | High — stops "all orange" problem |
| **Collapse completed / repeated spans** | Jaeger, AgentPrism, Mohano | High — reduces visual clutter |
| **Multiple complementary views** | Agent Flow, Mohano, PepeClaw | Medium — different mental models |
| **Only animate the active item** | VoltAgent | Medium — reduces visual noise |
| **Timeout/auto-close for orphaned spans** | Jaeger (span TTL), Langfuse | Medium — prevents infinite bars |
| **Summary → drill-down two-level zoom** | Langfuse, CrewAI | Medium — progressive disclosure |
| **Kanban / status board view** | Mohano | Medium — "what's happening now" |
| **Node/flow graph view** | Agent Flow | Medium — alternative to timeline |

---

## 4. Recommendations

### 4.1 Quick Wins (low effort, high impact)

These can be implemented in the existing Gantt chart with minimal changes:

#### R1: Add duration text labels to completed bars
Show "1.2s" or "340ms" as a text overlay or adjacent label on each completed segment. Jaeger and Langfuse both do this. Users should never have to estimate duration from bar width alone.

**Where to change:** `GanttChart.tsx` segment rendering — add a `<span>` with `formatDuration(seg.endTime - seg.startTime)` inside or next to the bar div.

#### R2: Change colour semantics — colour = category, status = icon overlay
Instead of painting all running bars orange, use the category colour (green for tools, purple for agents) and add a small animated spinner icon overlay for running status. Use a ✓ icon for succeeded and ✗ for failed.

**Where to change:** `barColor()` in `GanttChart.tsx` — stop overriding category colour for running status. Add icon overlays.

#### R3: Only pulse the *currently active* segment
Right now every `endTime === null` segment pulses. Instead, only pulse the segment that started most recently (the one the user cares about). Completed-but-unclosed segments should show as a static bar with a subtle "unknown end" indicator (e.g., a fade-out gradient or dashed right edge).

**Where to change:** `GanttChart.tsx` animation logic — add a `isLatestRunning` check.

#### R4: Auto-close orphaned segments with a timeout heuristic
If a `preToolUse` segment has been open for longer than 2× the median tool duration for that tool name (or a fallback of 120 seconds), visually transition it to a "presumed complete" state: stop animating, add a dashed right edge, and show "~Xs (estimated)" duration.

**Where to change:** `ganttData.ts` — add a post-processing pass over segments with `endTime === null`.

#### R5: Collapse repeated tool invocations
If the same tool name has more than 3 completed segments in a row, collapse them into a summary bar: "5× bash (total 4.2s)" with a toggle to expand. This alone would eliminate most of the visual clutter.

**Where to change:** `ganttData.ts` `buildGanttData()` — add a collapsing post-processing step. `GanttChart.tsx` — add expand/collapse toggle.

### 4.2 Medium-Term Improvements (moderate effort)

#### R6: Add a waterfall/tree view as an alternative to the flat Gantt
Introduce a nested waterfall view (like Jaeger/AgentPrism) where tool calls are nested under their parent agent/session. This is the single most impactful improvement for readability. The existing Gantt can remain as a "timeline" tab.

**New components:** `WaterfallView.tsx`, `WaterfallRow.tsx`. Leverage existing `buildGanttData()` output but add parent-child relationships using the event ordering.

#### R7: Two-level zoom — session summary → per-agent drill-down
At the top level, show one bar per agent/session. Clicking a bar drills into the waterfall of tool calls for that agent. This prevents the initial view from being overwhelming.

**Where to change:** `App.tsx` — add drill-down state. `GanttChart.tsx` — accept a "zoom level" prop.

#### R8: Status board / "what's happening now" panel
Add a compact panel (like Mohano's Kanban or VoltAgent's active-step view) that shows only currently-running and recently-completed items. This gives at-a-glance status without timeline complexity.

**Where to change:** Enhance existing `LiveBoard` / `LaneItem` components.

### 4.3 Longer-Term Enhancements (higher effort)

#### R9: Node/flow graph view
Add an interactive node graph (like Agent Flow) as a third visualisation mode. Nodes are agents/tools, edges are invocations. This provides a structural view that timelines cannot.

#### R10: Anomaly highlighting
Automatically flag spans that took >2× the average for that tool, or that are still running past their expected duration. Show these with a warning badge or different border style.

#### R11: OpenTelemetry span model adoption
Migrate the internal data model from flat event pairs to parent-child spans (like OTEL). This enables nesting, critical-path analysis, and compatibility with standard trace UIs.

---

## 5. Recommended Implementation Order

| Priority | Recommendation | Effort | Impact on "orange bar" problem |
|---|---|---|---|
| 🔴 P0 | R2 — Colour = category, status = icon | Small | Eliminates "all orange" directly |
| 🔴 P0 | R3 — Only pulse the active segment | Small | Reduces animation noise by ~90% |
| 🔴 P0 | R1 — Duration text labels | Small | Users stop decoding bar widths |
| 🟡 P1 | R4 — Auto-close orphaned segments | Small | Stops bars from running forever |
| 🟡 P1 | R5 — Collapse repeated tool calls | Medium | Eliminates "wall of bars" |
| 🟢 P2 | R6 — Waterfall/tree view | Medium | Fundamentally better trace UI |
| 🟢 P2 | R7 — Two-level zoom | Medium | Progressive disclosure |
| 🔵 P3 | R8 — Status board panel | Medium | Better "right now" view |
| 🔵 P3 | R10 — Anomaly highlighting | Medium | Highlights what matters |
| ⚪ P4 | R9 — Node/flow graph | Large | Alternative mental model |
| ⚪ P4 | R11 — OTEL span model | Large | Architecture improvement |

---

## 6. Key Takeaway

The fundamental insight from studying these tools is: **the Gantt chart is not the right primary visualisation for trace data**. Every mature tool in this space has converged on a **nested waterfall** (Jaeger-style) as the primary view, with complementary views (flow graph, status board, Kanban) for different mental models.

In the short term, the three P0 recommendations (R1–R3) can be implemented in a few hours and will dramatically reduce the orange-bar problem. The medium-term waterfall view (R6) would bring the visualiser in line with industry best practice.

---

## Appendix: Tools Surveyed

| Tool | URL | Approach |
|---|---|---|
| Agent Flow | github.com/patoles/agent-flow | Node graph + timeline |
| Mohano | github.com/hulryung/mohano | Swim-lane + Kanban + agent cards |
| AgentPrism | github.com/evilmartians/agent-prism | Hierarchical tree/waterfall |
| Langfuse | github.com/langfuse/langfuse | Nested trace waterfall |
| VoltAgent | github.com/VoltAgent/voltagent | Agent timeline + workflow cards |
| PepeClaw | github.com/BitmapAsset/pepeclaw | 3D spatial office metaphor |
| CrewAI | github.com/crewAIInc/crewAI | OpenTelemetry trace + per-agent dashboards |
| Jaeger/Zipkin | OpenTelemetry ecosystem | Canonical nested waterfall |
