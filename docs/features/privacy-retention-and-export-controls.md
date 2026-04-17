# Feature: Privacy Retention and Export Controls

## Traceability

| Feature ID | Original PRD ID | Description |
|-----------|----------------|-------------|
| PRIV-US-01 | US-05 | Prevent sensitive leakage in stored and exported observability data |
| PRIV-FR-01 | FR-PR-01 | Redact before persist and export |
| PRIV-FR-02 | FR-PR-02 | Enforce retention modes with 7-day default |
| PRIV-FR-03 | FR-PR-03 | Support purge operation for local logs |
| PRIV-FR-04 | FR-PR-04 | Keep export disabled by default and require explicit configuration |
| PRIV-FR-05 | SP-08 | Prompt content storage opt-in enforcement |

**Product Vision:** [docs/product-vision.md](../product-vision.md)  
**Original PRD:** [docs/prd.md](../prd.md)

---

## 1. Feature Overview

**Feature Name:** Privacy Retention and Export Controls  
**ID Prefix:** PRIV  
**Summary:** Implements privacy-hardening controls for redaction, retention, purge, and explicit export enablement to keep observability safe by default.  
**Dependencies:** Foundation Event Capture  
**Priority:** Must

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| PRIV-US-01 | Privacy-Conscious User | ensure secrets are redacted before storage/export | no sensitive values are leaked by observability tooling | Must |

---

## 3. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| PRIV-FR-01 | Redaction rules must run before event persistence and before any export path. | Must |
| PRIV-FR-02 | Default retention must be 7 days with configurable 1 day, 30 days, and manual modes. | Must |
| PRIV-FR-03 | A purge command must delete all local event logs for targeted scope. | Must |
| PRIV-FR-04 | Export must be disabled by default and require explicit destination configuration. | Must |
| PRIV-FR-05 | Prompt content storage must be opt-in only; default behavior must not persist prompt bodies (including redacted bodies) unless explicitly enabled. | Must |

---

## 4. UI / Interaction Design

- Settings and CLI controls should make retention mode and export state explicit.
- Export controls must clearly indicate disabled-by-default behavior.
- Purge operations should include explicit confirmation steps.

---

## 5. Implementation Tasks

### Phase 1: Privacy Hardening
- [x] Enforce redaction middleware pre-persist and pre-export.
- [x] Implement retention modes and purge command.

### Phase 2: Packaging and Safe Defaults
- [x] Package and document install-to-first-live-flow under 10 minutes with export disabled by default.

---

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit Tests | Redaction patterns, retention selectors, purge logic | Vitest with sensitive token fixtures |
| Integration Tests | End-to-end persist/export behavior under redaction | Pipeline tests with export toggled on/off |

Key test scenarios:
1. Tokens in prompt and tool command fields are redacted before persistence.
2. Purge deletes all logs in targeted scope.
3. Export is blocked when not explicitly configured.
4. Prompt content remains non-persistent by default unless explicitly opted in.

---

## 7. Acceptance Criteria

1. Redaction is enforced pre-persist and pre-export for all event pathways.
2. Retention policy defaults and overrides function as documented.
3. Purge operation reliably removes targeted local logs.
4. Export remains disabled by default and requires explicit activation and destination configuration.
5. Prompt content is not persisted by default; opt-in configuration is required to enable storage.
6. Redaction, retention, and purge operations function correctly on Linux, macOS, and Windows.

---

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should retention and export controls be configured via UI only, CLI only, or both? | Both UI and CLI controls in MVP |
