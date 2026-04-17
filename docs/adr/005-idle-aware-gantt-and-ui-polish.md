# ADR-005: Idle-Aware Gantt Visualization and Live Board Polish

- Status: Accepted
- Date: 2026-04-14

## Context

The live board met its original LIVE-FR-02 requirement for idle/running/
succeeded/error status rendering, but several usability gaps became apparent
during real session observation:

1. **Gantt bars never stopped pulsing.** Open segments pulsed continuously
   even when the session was in an idle state (waiting between tool
   invocations). This made idle periods visually indistinguishable from
   active work.
2. **No idle gap representation.** The Gantt timeline showed tool and
   subagent bars but nothing between them. Long idle periods appeared as
   empty space with no visual indication that the session was paused.
3. **Session lane status was misleading.** After `sessionEnd`, the session
   lane still showed "Idle" because it derived status solely from the
   visualization state. A completed session should show "Succeeded" and a
   failed session should show "Error."
4. **Lane status dots were static.** Running and subagent-running lanes
   used colored dots but no animation, making active states harder to
   spot at a glance.
5. **Event list lacked auto-scroll.** During live sessions, users had to
   manually scroll to see new events arriving at the bottom.
6. **Filter controls lacked bulk actions.** Users filtering by event type
   had to toggle each checkbox individually with no way to select all or
   clear all at once.
7. **Replay mode had no header indicator.** When replay was active, there
   was no persistent visual cue distinguishing it from live mode.
8. **Inspector spacing was cramped.** The `dd` elements in the event
   inspector had no bottom margin, making adjacent key–value pairs hard to
   distinguish.

## Decision

Implement eight targeted UI improvements to the live board and Gantt chart.
All changes are confined to the `packages/web-ui/` package and `theme.css`.

### 1. Idle-aware Gantt animation

Pass an `isIdle` prop to `GanttChart`. When idle:
- Suppress the `now` tick timer so running segments stop growing.
- Reduce open-segment opacity from 0.9 to 0.5.
- Disable the pulse animation (`gantt-pulse`).

Resume normal animation when the visualization state returns to
`tool_running` or `subagent_running`.

### 2. Idle gap segments

Track idle periods in `buildGanttData`. When a tool or subagent completes
and no new activity starts, record the gap. When the next activity (or
`sessionEnd`) arrives, push an idle gap segment to the session row with:
- `status: "idle"` and `eventType: "idle"`
- A dashed repeating gradient (`IDLE_GAP_GRADIENT`) instead of a solid
  color
- Reduced opacity (0.35)

### 3. Session lane lifecycle override

Override the session lane's status in `mapStateToLanes`:
- `lifecycle === "completed"` → `succeeded`
- `lifecycle === "failed"` → `error`
- Otherwise, derive from the visualization state as before

### 4. Lane dot pulse animation

Add a `lane-dot-pulse` CSS keyframe that scales the status dot from 1×
to 1.3× with a glow effect. Apply it when the lane status is `running`
or `subagent_running`.

### 5. Event list auto-scroll

Use `useRef` to track the event list element. After each new event
batch, scroll the last element into view using `scrollIntoView`. Detect
user scroll-up via an `onScroll` handler and suppress auto-scroll until
the user returns to the bottom (within `AUTO_SCROLL_THRESHOLD` pixels).

### 6. Filter bulk actions

Add "Select All" and "Clear All" buttons above the event type checkboxes
in `FilterControls`.

### 7. Replay mode badge

Render a `🔄 Replay Mode` badge in the header when `replayMode` is
active.

### 8. Inspector spacing

Add `margin-bottom: 0.4rem` to `dd` elements in `theme.css`.

## Rationale

1. The improvements address real usability gaps observed during live
   sessions — they are not speculative enhancements.
2. All changes are scoped to presentation and layout logic. The state
   machine, event schema, hook emitter, and ingest service are untouched.
3. Idle gap visualization aligns with the PRD requirement (LIVE-FR-02)
   that the UI display visual states for idle, running, succeeded, and
   error.
4. The `prefers-reduced-motion` media query already covers all new
   animations, preserving accessibility.

## Consequences

### Positive

1. Idle and active periods are visually distinct in both the Gantt chart
   and the lane board.
2. Completed and failed sessions display correct terminal status instead
   of "Idle."
3. Live sessions auto-scroll events, reducing the need for manual
   interaction.
4. Filter bulk actions reduce clicks for common workflows.
5. Replay mode is clearly indicated at all times.

### Negative

1. Idle gap segments add entries to the session row's segment array,
   slightly increasing the data volume processed by the chart renderer.
2. The auto-scroll behavior introduces two refs (`eventListRef`,
   `userScrolledRef`) to `App.tsx`, adding a small amount of state
   tracking.

## Alternatives Considered

### A) Idle visualization via background shading instead of gap segments

Rejected because dashed gap segments integrate naturally into the Gantt
bar flow and are more informative than background color changes.

### B) Derive session terminal status in the state machine instead of the UI

Rejected because the state machine's `visualization` field intentionally
represents the *current activity* state, not the terminal outcome. The
override belongs in the presentation layer.

## Follow-Up Actions

1. Consider adding duration labels to idle gap segments in a future
   iteration.
2. Evaluate whether auto-scroll should resume automatically when the user
   scrolls back to the bottom (currently it does, via the scroll threshold).
