# Feature: Replay and Session Review

## Traceability

| Feature ID | Original PRD ID | Description |
|-----------|----------------|-------------|
| RPLY-US-01 | US-03 | Replay completed sessions and inspect event chronology |
| RPLY-FR-01 | FR-RP-01 | Support play/pause/scrub/speed controls |
| RPLY-FR-02 | FR-RP-02 | Ensure replay chronology integrity |
| RPLY-FR-03 | FR-RP-03 | Jump to first failure in two interactions or fewer |
| RPLY-FR-04 | FR-RP-04 | Keep replay responsive for 10k+ events |

**Product Vision:** [docs/product-vision.md](../product-vision.md)  
**Original PRD:** [docs/prd.md](../prd.md)

---

## 1. Feature Overview

**Feature Name:** Replay and Session Review  
**ID Prefix:** RPLY  
**Summary:** Provides timeline playback and inspection controls for completed runs to support debugging, learning, and post-run analysis.  
**Dependencies:** Foundation Event Capture, Deterministic State Engine, Live Visualization Board  
**Priority:** Must

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| RPLY-US-01 | Workflow Reviewer | replay a completed run and scrub events | I can understand the exact sequence after failures | Must |

---

## 3. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| RPLY-FR-01 | Replay must support play, pause, scrub, and variable speed controls. | Must |
| RPLY-FR-02 | Replay ordering must match event chronological order by timestamp and log position fallback. | Must |
| RPLY-FR-03 | User must be able to jump to first failure event in two interactions or fewer. | Must |
| RPLY-FR-04 | Replay must remain responsive with session files of 10k+ events. | Should |

---

## 4. UI / Interaction Design

- Replay mode includes timeline scrubber, speed selector, and play/pause controls.
- Inspector follows selected event and displays payload details.
- Failure-first shortcut is always visible during replay sessions.

---

## 5. Implementation Tasks

### Phase 1: Replay Controls
- [x] Implement replay controls (play, pause, scrub, speed).
- [x] Implement timeline inspector and first-failure quick jump.

### Phase 2: Ordering and Scale
- [x] Verify replay chronology parity with persisted logs.

---

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit Tests | Timeline indexing, playback clock, failure locator logic | Vitest with synthetic event fixtures |
| Integration Tests | End-to-end replay interactions in browser | Playwright scenarios on recorded sessions |

Key test scenarios:
1. Scrubbing to arbitrary positions always yields the same state as chronological playback.
2. Failure jump reaches first failure event in two interactions or fewer.
3. Replay remains responsive for sessions with 10k+ events.

---

## 7. Acceptance Criteria

1. Replay controls are functional and stable on Linux, macOS, and Windows.
2. Replay ordering always matches stored chronology.
3. First-failure jump and inspector workflows are efficient and predictable.

---

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should replay persist user playback speed preference across sessions? | Persist in local user settings |
