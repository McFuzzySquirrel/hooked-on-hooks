# Feature: Live Visualization Board

## Traceability

| Feature ID | Original PRD ID | Description |
|-----------|----------------|-------------|
| LIVE-US-01 | US-04 | Display clear visual states for demos and operator comprehension |
| LIVE-FR-01 | FR-UI-01 | Show session and activity lanes in real time |
| LIVE-FR-02 | FR-UI-02 | Render idle/running/succeeded/error state visuals |
| LIVE-FR-03 | FR-UI-03 | Update UI within 1 second under normal local conditions |
| LIVE-FR-04 | FR-UI-04 | Provide event inspector details for timeline entries |
| LIVE-FR-05 | FR-UI-05 | Support filtering by event type and agent/tool name |

**Product Vision:** [docs/product-vision.md](../product-vision.md)  
**Original PRD:** [docs/prd.md](../prd.md)

---

## 1. Feature Overview

**Feature Name:** Live Visualization Board  
**ID Prefix:** LIVE  
**Summary:** Delivers the real-time operations board that visualizes active sessions, lanes, and state transitions with low-latency updates.  
**Dependencies:** Foundation Event Capture, Deterministic State Engine  
**Priority:** Must

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| LIVE-US-01 | Tech Lead / Demo Owner | display distinct visual states for idle/running/error | non-technical audiences can follow workflow progress | Should |

---

## 3. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| LIVE-FR-01 | UI must show session lane plus agent/subagent/tool activity lanes in real time. | Must |
| LIVE-FR-02 | UI must display visual states for idle, running, succeeded, blocked/error. | Must |
| LIVE-FR-03 | UI must update within 1 second of event arrival under normal local conditions. | Must |
| LIVE-FR-04 | UI must include event inspector details for selected timeline entries. | Should |
| LIVE-FR-05 | UI should support filtering by event type and agent/tool name. | Could |

---

## 4. UI / Interaction Design

- Live board with session, agent, subagent, and tool lanes.
- Status language:
  - Idle: neutral tile
  - Running: animated pulse/scan
  - Success: resolved state
  - Error/Blocked: alert state with visible emphasis
- Event inspector panel shows details for selected entries.
- Filters allow narrowing by event type and actor.

---

## 5. Implementation Tasks

### Phase 1: Live Board Core
- [x] Implement live board with state lanes and status mapping.
- [x] Add event inspector and base filtering controls.

### Phase 2: Performance Validation
- [x] Validate responsiveness under sustained event volume.

---

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit Tests | Rendering state mapping and filtering logic | Vitest component tests |
| Integration Tests | State engine feed into live UI updates | Browser integration tests with fixture event streams |

Key test scenarios:
1. Incoming state changes are rendered correctly in each lane.
2. Alert/error visuals activate on failure events and clear on recovery transitions.
3. Filter controls correctly scope visible events without breaking live updates.

---

## 7. Acceptance Criteria

1. Live board reflects real-time activity with event-to-render latency under 1 second.
2. Visual status semantics are consistent with defined lifecycle mapping.
3. Event inspector and filters operate reliably during active sessions.
4. Live board renders and updates correctly on Linux, macOS, and Windows.

---

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should live filters be persisted across sessions or reset per launch? | Reset per launch in MVP |
