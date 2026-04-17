# Feature: Foundation Event Capture

## Traceability

| Feature ID | Original PRD ID | Description |
|-----------|----------------|-------------|
| FND-US-01 | US-01 | Launch visualization quickly from a clean clone |
| FND-US-02 | US-06 | Optional enrichment with EJS metadata |
| FND-FR-01 | FR-EV-01 | Capture all MVP event types |
| FND-FR-02 | FR-EV-02 | Enforce required event envelope fields |
| FND-FR-03 | FR-EV-03 | Reject malformed events without crash |
| FND-FR-04 | FR-EV-04 | Ensure unique event IDs per session |
| FND-FR-05 | FR-EV-05 | Support additive minor schema compatibility |
| FND-FR-06 | FR-ST-01 | Parse JSONL logs and optional localhost stream input |

**Product Vision:** [docs/product-vision.md](../product-vision.md)  
**Original PRD:** [docs/prd.md](../prd.md)

---

## 1. Feature Overview

**Feature Name:** Foundation Event Capture  
**ID Prefix:** FND  
**Summary:** Establishes project baseline, hook integration, canonical event emission, and schema validation so all downstream features receive reliable event streams.  
**Dependencies:** None  
**Priority:** Must

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| FND-US-01 | Solo Developer | launch visualization quickly from a clean clone | I can monitor a live run in under 10 minutes | Must |
| FND-US-02 | Agent Forge User | optionally enrich sessions with EJS metadata | I get richer context without coupling requirements | Could |

---

## 3. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FND-FR-01 | The system must capture all MVP event types defined in Event Schema v1. | Must |
| FND-FR-02 | Every event must include required envelope fields and a valid schemaVersion. | Must |
| FND-FR-03 | Malformed events must be rejected with error telemetry and must not crash capture. | Must |
| FND-FR-04 | Event IDs must be unique per session. | Must |
| FND-FR-05 | Schema compatibility mode must support additive minor-version fields. | Should |
| FND-FR-06 | Ingestion entry points must accept append-only JSONL logs and optional localhost stream input. | Must |

---

## 4. UI / Interaction Design

This feature has no end-user screen ownership. It provides foundational event plumbing consumed by the live board and replay interfaces.

---

## 5. Implementation Tasks

### Phase 1: Foundation and Event Capture
- [x] Initialize workspace scaffolding and CI baseline.
- [x] Implement hook configuration for targeted Copilot CLI lifecycle events.
- [x] Emit schema-compliant JSONL events.
- [x] Add schema validation and malformed-record handling.

### Phase 2: Integration Readiness
- [x] Publish optional integration guide for Agent Forge and EJS metadata overlays.

---

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit Tests | Event envelope validation, schema version handling, ID generation | Vitest table-driven tests |
| Integration Tests | Hook -> emitter -> JSONL/HTTP pipeline | Fixture runs with simulated hook events |

Key test scenarios:
1. All MVP event types are emitted during a normal test session.
2. Malformed records are rejected and logged without terminating capture.
3. JSONL and localhost transport modes both produce valid canonical event envelopes.
4. EJS metadata overlay remains optional and does not break base capture path.

---

## 7. Acceptance Criteria

1. Hook-based capture produces schema-compliant events for all MVP event types.
2. Event emission remains stable across Linux, macOS, and Windows shell environments in MVP matrix.
3. Ingestion inputs (JSONL and optional localhost stream) are both supported and validated.
4. Foundation setup supports a first live visualization path under 10 minutes.

---

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should localhost streaming be enabled by default or only via explicit configuration? | Disabled by default, configurable per session |
