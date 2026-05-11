# Feature: Standalone Source Datastore

## Traceability

| Feature ID | Description |
|-----------|-------------|
| SDS-US-01 | Import existing Copilot sessions without hooks |
| SDS-US-02 | Build a durable event corpus across sessions and machines |
| SDS-FR-01 | Read local Copilot session-store metadata |
| SDS-FR-02 | Read local Copilot source event JSONL files |
| SDS-FR-03 | Normalize source records into shared event envelopes |
| SDS-FR-04 | Extract facets for filtering and summaries |
| SDS-FR-05 | Apply local redaction before datastore persistence |
| SDS-FR-06 | Summarize datastore contents across sessions, machines, and sources |

**Product Vision:** [docs/product-vision.md](../product-vision.md)  
**ADR:** [ADR-013: Standalone Local Source Datastore](../adr/013-standalone-local-source-datastore.md)  
**Spec:** [Local Source Datastore](../specs/local-source-datastore.md)

---

## 1. Feature Overview

**Feature Name:** Standalone Source Datastore  
**ID Prefix:** SDS  
**Summary:** Imports events directly from locally stored Copilot source data into
an append-only datastore for filtering, summaries, and future multi-machine
analysis.  
**Dependencies:** Event Schema, Redaction  
**Priority:** Must

This feature intentionally does not require hook setup, a running ingest service,
or live visualization.

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| SDS-US-01 | Solo Developer | import existing Copilot sessions directly from local storage | I can analyze sessions that already happened without configuring hooks | Must |
| SDS-US-02 | Workflow Reviewer | combine many sessions into one datastore | I can filter and summarize work across runs | Must |
| SDS-US-03 | Team Operator | label imports by machine | I can later aggregate activity from multiple laptops or runners | Should |
| SDS-US-04 | Privacy-Conscious User | redact source payloads before persistence | sensitive content is not written into the datastore by default | Must |

---

## 3. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| SDS-FR-01 | The importer must read session metadata from a local Copilot `session-store.db`. | Must |
| SDS-FR-02 | The importer must read source event records from `session-state/<session-id>/events.jsonl`. | Must |
| SDS-FR-03 | Each valid source record must be normalized into a schema-compliant `sourceEvent` envelope. | Must |
| SDS-FR-04 | Each datastore record must include stable session, machine, source, timestamp, and privacy metadata. | Must |
| SDS-FR-05 | The importer must extract filtering facets for model usage, token usage, tool calls, subagent delegation, files, errors, and debug events when available. | Must |
| SDS-FR-06 | Local redaction must be enabled by default before writing datastore records. | Must |
| SDS-FR-07 | Raw payload persistence must be opt-in and still redacted. | Must |
| SDS-FR-08 | The datastore summary command must report event, session, machine, and source counts. | Must |
| SDS-FR-09 | Importing selected session IDs must be supported. | Should |
| SDS-FR-10 | The datastore format must remain append-only and inspectable with standard text tools. | Should |

---

## 4. Non-Goals

1. Live visualization over the datastore.
2. Cloud upload or centralized telemetry.
3. Cross-machine synchronization protocol.
4. Full query language or indexed analytics engine.
5. Replacement of hook tooling for custom/live capture experiments.

---

## 5. UX / Operator Flow

1. Choose a local Copilot session store.
2. Run datastore import with an output JSONL path.
3. Optionally provide `--machine-id` and selected `--ids`.
4. Run datastore summary to confirm imported scope.
5. Use future filtering/query commands over the normalized datastore.

---

## 6. Implementation Tasks

### Phase 1: Standalone Import

- [x] Add local datastore workspace package.
- [x] Read Copilot session metadata and source JSONL records.
- [x] Normalize imported source records to `sourceEvent` envelopes.
- [x] Apply local redaction by default.
- [x] Add import and summary CLI commands.
- [x] Add unit/integration tests for import, redaction, facets, and summary.

### Phase 2: Filtering and Scale

- [ ] Add CLI filtering by event type, session, machine, source event type, model, tool, agent, time range, and error presence.
- [ ] Add duplicate detection/skip reporting for repeated imports.
- [ ] Add optional compacted/indexed datastore sidecar for faster queries.
- [ ] Add multi-machine merge guidance and examples.

### Phase 3: Future Visualization

- [ ] Define a read-only adapter from datastore records to replay/session review inputs.
- [ ] Revisit live visualization once datastore semantics and filters are stable.

---

## 7. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit Tests | Argument parsing, facet extraction, stable metadata, summary counts | Vitest with synthetic fixtures |
| Integration Tests | SQLite session metadata + source JSONL import | Temporary local session-store fixture |
| Privacy Tests | Redaction and raw payload opt-in behavior | Assertions against serialized datastore output |
| Regression Tests | Event schema compatibility for `sourceEvent` | Shared schema tests |

Key test scenarios:

1. Valid source events are imported as schema-compliant `sourceEvent` records.
2. Invalid JSONL lines are skipped and counted.
3. Redaction removes sensitive strings before datastore persistence.
4. Summary counts sessions, machines, sources, and events.
5. Facets are extracted from model/token/tool/subagent fields.

---

## 8. Acceptance Criteria

1. A user can import local Copilot source data without installing hooks.
2. The datastore can contain records from multiple sessions and machines.
3. Records include enough normalized facets for filtering without re-parsing every
   source-specific payload shape.
4. Redaction is enabled by default and raw payload capture is opt-in.
5. The documentation routes users to standalone datastore workflow before live
   visualization work.

---

## 9. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should JSONL remain the long-term datastore format? | Keep JSONL now; add optional indexes before replacing it. |
| 2 | How should duplicate imports be represented? | Stable event IDs allow detection; future command should skip or report duplicates. |
| 3 | What is the first filtering command surface? | CLI filters over normalized facets before UI filters. |
| 4 | When should live visualization resume? | After datastore import, filtering, and replay semantics are stable. |
