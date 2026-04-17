# Roadmap: MVP Plan

## Milestone 0: Repo and Tooling Baseline ✅

### Deliverables

1. New repository initialized with docs and project scaffolding.
2. CI checks for linting and tests.

### Acceptance Criteria

1. Clean setup on Linux/macOS.
2. CI passes on default branch.

## Milestone 1: Event Capture Pipeline ✅

### Deliverables

1. Hook configuration for selected Copilot CLI events.
2. Hook scripts writing JSONL events with schema validation.

### Acceptance Criteria

1. All targeted events are emitted during test session.
2. No malformed records under normal flow.

## Milestone 2: Ingestion and Live State Engine ✅

### Deliverables

1. Event ingestion service (file watcher + parser).
2. Session and agent state machine.

### Acceptance Criteria

1. State transitions are deterministic and test-covered.
2. End-to-end event latency < 1 second on local machine.

## Milestone 3: Live Visualization UI ✅

### Deliverables

1. Live board showing session and agent/subagent lanes.
2. State rendering for running, idle, blocked, error.

### Acceptance Criteria

1. Visual states align with incoming events.
2. UI remains responsive for 10k+ event replay files.

## Milestone 4: Replay and Session Review ✅

### Deliverables

1. Replay controls (play, pause, scrub, speed).
2. Timeline and event inspector panel.

### Acceptance Criteria

1. Replay order matches recorded event chronology.
2. User can jump to first failure event in <= 2 interactions.

## Milestone 5: Hardening and Release ✅

### Deliverables

1. Redaction policy enforcement.
2. Retention and purge commands.
3. Packaging as installable plugin/tool.

### Acceptance Criteria

1. Security test suite passes redaction checks.
2. Install to first live view in < 10 minutes.

## Milestone 6: Integration Tooling ✅

### Deliverables

1. One-command bootstrap for existing repos (`npm run bootstrap:repo`).
2. Clean unbootstrap removal (`npm run unbootstrap:repo`).
3. Auto-wiring of hook scripts and JSON manifests.
4. Stub hook generation with `--create-hooks`.
5. Prefixed hook naming with `--prefix`.

### Acceptance Criteria

1. Bootstrap creates `.visualizer/` artifacts and wires hooks in a single command.
2. Unbootstrap cleanly removes all integration artifacts.
3. Generated hooks emit valid schema-compliant events.

## Post-MVP Backlog

1. Optional EJS enrichment overlay.
2. Optional IDE bridge.
3. Optional OpenTelemetry exporter.