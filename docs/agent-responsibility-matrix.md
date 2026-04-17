# Agent Responsibility Matrix

## Scope

Validation basis:
- Product vision: docs/product-vision.md
- Features: docs/features/foundation-event-capture.md, docs/features/deterministic-state-engine.md, docs/features/live-visualization-board.md, docs/features/replay-and-session-review.md, docs/features/privacy-retention-and-export-controls.md
- Agent team: .github/agents/project-architect.md, .github/agents/event-capture-engineer.md, .github/agents/ingestion-state-engineer.md, .github/agents/privacy-engineer.md, .github/agents/ui-engineer.md, .github/agents/qa-engineer.md

Validation rule:
- Each feature functional requirement maps to exactly one primary owner agent.
- Supporting agents may collaborate, but do not own implementation of that requirement.

## Primary Ownership Matrix

| Feature | Requirement ID | Requirement Summary | Primary Owner Agent | Supporting Agents | Ownership Notes |
|---|---|---|---|---|---|
| Foundation Event Capture | FND-FR-01 | Capture all MVP event types | event-capture-engineer | qa-engineer | Owned in hook emitter and event schema responsibilities |
| Foundation Event Capture | FND-FR-02 | Enforce required envelope fields and schemaVersion | event-capture-engineer | qa-engineer | Owned in shared event schema definition and parse utilities |
| Foundation Event Capture | FND-FR-03 | Reject malformed events without capture crash | event-capture-engineer | qa-engineer | Owned in emitter fail-safe behavior |
| Foundation Event Capture | FND-FR-04 | Ensure unique event IDs per session | event-capture-engineer | qa-engineer | Owned in UUID generation requirements |
| Foundation Event Capture | FND-FR-05 | Support additive minor schema compatibility | event-capture-engineer | ingestion-state-engineer, qa-engineer | Owned in schema compatibility mode and validation logic |
| Foundation Event Capture | FND-FR-06 | Accept JSONL logs and optional localhost stream input | ingestion-state-engineer | event-capture-engineer, qa-engineer | Owned in ingest service input endpoints and watcher pipeline |
| Deterministic State Engine | STAT-FR-01 | Map transitions to renderer state mapping | ingestion-state-engineer | ui-engineer, qa-engineer | Owned in deterministic reducer transition rules |
| Deterministic State Engine | STAT-FR-02 | Deterministic outputs for identical event sequences | ingestion-state-engineer | qa-engineer | Owned in pure reducer design and deterministic guarantees |
| Deterministic State Engine | STAT-FR-03 | Restart recovery from persisted logs | ingestion-state-engineer | qa-engineer | Owned in rebuildState and recovery workflow |
| Live Visualization Board | LIVE-FR-01 | Real-time session and activity lanes | ui-engineer | ingestion-state-engineer, qa-engineer | Owned in live board components |
| Live Visualization Board | LIVE-FR-02 | Visual states for idle, running, succeeded, error | ui-engineer | ingestion-state-engineer, qa-engineer | Owned in state tile rendering |
| Live Visualization Board | LIVE-FR-03 | Update UI within 1 second of event arrival | ui-engineer | ingestion-state-engineer, qa-engineer | Owned in UI subscription and render performance behavior |
| Live Visualization Board | LIVE-FR-04 | Event inspector details for selected entries | ui-engineer | qa-engineer | Owned in event inspector component |
| Live Visualization Board | LIVE-FR-05 | Filtering by event type and agent/tool name | ui-engineer | qa-engineer | Owned in filter controls and state scoping |
| Replay and Session Review | RPLY-FR-01 | Play, pause, scrub, variable speed controls | ui-engineer | qa-engineer | Owned in replay controls and interaction flow |
| Replay and Session Review | RPLY-FR-02 | Chronology integrity with timestamp and fallback | ui-engineer | ingestion-state-engineer, qa-engineer | Owned in playback clock and replay ordering behavior |
| Replay and Session Review | RPLY-FR-03 | Jump to first failure in two interactions or fewer | ui-engineer | qa-engineer | Owned in first-failure jump control |
| Replay and Session Review | RPLY-FR-04 | Replay responsiveness for 10k+ events | ui-engineer | qa-engineer | Owned in virtualized timeline rendering |
| Privacy Retention and Export Controls | PRIV-FR-01 | Redact before persist and export | privacy-engineer | event-capture-engineer, qa-engineer | Owned in shared redaction middleware and API |
| Privacy Retention and Export Controls | PRIV-FR-02 | Retention modes with 7-day default | privacy-engineer | ingestion-state-engineer, ui-engineer, qa-engineer | Owned in retention policy engine and config model |
| Privacy Retention and Export Controls | PRIV-FR-03 | Purge command for targeted local logs | privacy-engineer | ingestion-state-engineer, qa-engineer | Owned in purge policy and command semantics |
| Privacy Retention and Export Controls | PRIV-FR-04 | Export disabled by default and explicit config required | privacy-engineer | ui-engineer, project-architect, qa-engineer | Owned in export gating logic; UI and docs are supporting surfaces |
| Privacy Retention and Export Controls | PRIV-FR-05 | Prompt content storage is opt-in only | privacy-engineer | ui-engineer, event-capture-engineer, qa-engineer | Owned in backend enforcement logic; UI toggle is support only |

## Cross-Cutting Primary Owners

| Requirement Group | Primary Owner Agent | Supporting Agents |
|---|---|---|
| Security and Privacy (SP-01 to SP-08) | privacy-engineer | event-capture-engineer, ingestion-state-engineer, ui-engineer, qa-engineer |
| Accessibility (ACC-01 to ACC-05) | ui-engineer | qa-engineer |
| Performance and Runtime NFRs (NF-01 to NF-03) | ingestion-state-engineer and ui-engineer by runtime boundary | qa-engineer |
| Offline and local-first NFRs (NF-04, SP-05) | privacy-engineer and ingestion-state-engineer by control boundary | project-architect, qa-engineer |
| Build and delivery baseline | project-architect | qa-engineer |
| Test strategy and acceptance verification | qa-engineer | all implementation agents |

## Validation Result

- Ownership gaps: none found for feature functional requirements.
- Conflicting primary ownership: none found after boundary clarification.
- Boundary clarification applied: project-architect now wires CI to enforce coverage values defined by qa-engineer, eliminating duplicate ownership of coverage-threshold policy.

## Notes

- Primary owner means implementation authority for the requirement itself.
- Supporting agents may implement integration surfaces, tests, or documentation but do not own requirement semantics.
- This matrix follows Vision + Features decomposition and is the canonical ownership baseline for orchestration.