# Product Vision: Copilot Activity Visualiser

## 1. Overview

**Product Name:** Copilot Activity Visualiser  
**Summary:** A standalone, local-first visualization product that captures Copilot CLI activity and renders live execution state, timeline replay, pairing confidence, and failure context so developers can understand agent workflows without manually parsing transcripts. The product also serves as a practical learning surface through guided tutorials, vanilla hook examples, and screenshot-backed operator documentation.  
**Target Platform:** Linux, macOS, and Windows developer laptops (MVP), local browser UI plus Copilot CLI hook integration.  
**Key Constraints:** Local-first operation, offline compatibility, strict redaction before persist/transmit, optional integration with Agent Forge and EJS metadata, event-to-render latency under 1 second, deterministic replay compatibility for historical logs, additive tracing rollout with backward compatibility, and separate project packaging from Agent Forge core.  
**Original PRD:** [docs/prd.md](prd.md)

---

## 2. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-12 | GitHub Copilot | Initial product vision decomposed from [docs/prd.md](prd.md) |
| 1.1 | 2026-04-14 | GitHub Copilot | Post-MVP alignment: updated TypeScript version to match installed 5.x, all five MVP features marked complete |
| 1.2 | 2026-04-17 | GitHub Copilot | Post-MVP direction update: tracing v2, pairing diagnostics, integration tooling, and quickstart/deep-doc split |

---

## 3. Goals and Non-Goals

### 3.1 Goals
- Deliver live execution state transitions for Copilot CLI sessions with minimal setup.
- Provide deterministic replay of completed sessions with scrubbing and failure jump.
- Improve debugging confidence with exact-vs-heuristic tool pairing visibility.
- Keep sensitive data local and redacted by default.
- Preserve optional integration posture: useful standalone, with optional Agent Forge and EJS overlays.
- Maintain schema-driven extensibility for future integrations and UI growth.
- Provide a fast path from clone to first visible signal through quickstart docs, demo commands, and guided tutorials.

### 3.2 Non-Goals
- Full parity with every Copilot interaction surface outside CLI for MVP.
- Multi-tenant cloud telemetry, identity, billing, or cross-organization analytics.
- Mandatory dependency on Agent Forge core.
- Full IDE bridge in MVP (explicitly post-MVP).

---

## 4. Personas

| Persona | Description | Key Needs |
|---------|-------------|-----------|
| Solo Developer | Individual running Copilot CLI workflows locally | Real-time visibility, quick setup, local privacy defaults |
| Platform Engineer | Team member building internal agent workflows | Deterministic event capture, debugging insights, replay traceability |
| Tech Lead / Demo Owner | Presents workflows to stakeholders | Understandable live visualization, clear state transitions, demo reliability |
| Workflow Reviewer | Reviews completed runs for quality and failures | Timeline replay, first-failure jump, scrub-by-event inspection |

---

## 5. Research Findings

- Architecture options assessed: plugin-only TUI, sidecar web app, and desktop app.
- Recommended architecture for MVP: sidecar web app + hook event stream (Option B).

| Option | Strengths | Weaknesses | Decision |
|--------|-----------|------------|----------|
| Plugin-only TUI | Low complexity, minimal runtime | Limited visual expressiveness, weaker replay ergonomics | Rejected for MVP visual goals |
| Sidecar Web App | Strong UI flexibility, timeline/replay support, familiar tooling | More moving parts, local process supervision | Selected |
| Desktop App | Polished packaging, unified ingestion/rendering | High build/distribution complexity, heavier runtime | Deferred |

- Event schema-first approach selected to reduce payload drift risk and support controlled evolution.
- Privacy design established early: redact-before-persist and export disabled by default.
- Packaging decision (ADR-001): keep visualizer as separate project to avoid Agent Forge core coupling.
- Tracing v2 direction selected as an additive event-stream correlation model: optional IDs (`turnId`, `traceId`, `spanId`, `parentSpanId`, `toolCallId`) improve fidelity without breaking replay of older logs.
- Operator-facing diagnostics are product features, not just internal tools: pairing confidence and inspector metadata are part of the intended debugging workflow.
- Documentation is intentionally split by depth: README as operator runbook, tutorials/showcase/specs as deep references (see ADR-007 and ADR-008).

---

## 6. Technical Architecture

### 6.1 Technology Stack

| Layer | Technology | Version Guidance | Rationale |
|------|------------|------------------|-----------|
| Runtime | Node.js | 24.x LTS baseline | Stability and active support window |
| Language | TypeScript | 5.x | Type-safe event contracts and state logic |
| CLI Hook Emitter | Shell + Node scripts | N/A | Direct compatibility with Copilot CLI hooks |
| Ingestion API | Fastify (locked) | 5.x | Lightweight, high-throughput local endpoint; selected as fixed MVP backend framework |
| Validation | Zod | 4.x | Runtime schema validation and inference |
| Storage | JSONL files (local) | N/A | Simple append-only persistence and replay source |
| UI Framework | React | 19.x | Component model and ecosystem maturity |
| Build Tool | Vite | 8.x | Fast local dev cycle and modern bundling |
| Unit/Integration Test | Vitest | 4.x | Native compatibility with Vite/TS stack |
| E2E / Cross-platform | Playwright Test | 1.59+ | Interaction and replay behavior verification |

### 6.2 Project Structure

```text
hooked-on-hooks/
	docs/
		prd.md
		product-vision.md
		features/
		adr/
		research/
		roadmap/
		specs/
	packages/
		hook-emitter/
		ingest-service/
		web-ui/
	shared/
		event-schema/
		redaction/
		state-machine/
```

### 6.3 Key APIs / Interfaces

| Interface | Direction | Purpose |
|-----------|-----------|---------|
| Copilot CLI Hook -> Emitter | Input | Capture lifecycle and tool execution events |
| Emitter -> JSONL Log | Output | Persist canonical event records |
| Emitter -> Localhost HTTP (optional) | Output | Stream events to ingest service in real-time |
| Ingest Service -> State Engine | Internal | Derive deterministic session and lane states |
| Ingest Service -> Pairing Diagnostics | Internal / HTTP | Report exact-id vs span vs heuristic tool pairing confidence |
| State Engine -> Web UI | Internal | Push normalized updates for rendering |
| Replay Engine -> Timeline UI | Internal | Drive playback, scrubbing, and event inspection |

---

## 7. Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NF-01 | End-to-end event-to-render latency must be less than 1 second on supported local environments. | Must |
| NF-02 | Event capture reliability must be 95% or greater for normal CLI runs. | Must |
| NF-03 | UI must remain responsive during replay of 10k+ event sessions. | Must |
| NF-04 | System must operate offline after installation. | Must |
| NF-05 | Components must expose structured logs suitable for local debugging. | Should |
| NF-06 | Historical logs without tracing fields must continue to replay without behavior regressions. | Must |
| NF-07 | Architecture must allow extension to optional IDE bridge and OpenTelemetry exporter post-MVP. | Could |

---

## 8. Security and Privacy

| ID | Requirement | Priority |
|----|-------------|----------|
| SP-01 | Sensitive token patterns (API keys, passwords, secret-like env values) must be redacted by default. | Must |
| SP-02 | Potentially sensitive command arguments must be suppressed or transformed before storage. | Must |
| SP-03 | Prompt truncation mode must be available for high-compliance environments. | Should |
| SP-08 | Prompt content storage must be opt-in only; default behavior must not persist prompt bodies (including redacted bodies) unless explicitly enabled. | Must |
| SP-04 | Event files must be created with permissions restricted to current user. | Must |
| SP-05 | No automatic cloud upload may occur in default configuration. | Must |
| SP-06 | Export, when enabled, must only transmit redacted payloads. | Must |
| SP-07 | Hook failures must fail safe without dumping raw unredacted payloads. | Must |

---

## 9. Accessibility

| ID | Requirement | Priority |
|----|-------------|----------|
| ACC-01 | Web UI must meet WCAG 2.1 AA baseline for contrast, semantics, and interaction patterns. | Must |
| ACC-02 | Core controls (play/pause/scrub/filter/focus) must be keyboard-operable. | Must |
| ACC-03 | Timeline and state indicators must expose meaningful labels for screen readers. | Should |
| ACC-04 | UI must support reduced-motion mode for animated visualizations. | Should |
| ACC-05 | Text and inspector panels must remain usable at 200% zoom without loss of function. | Should |

---

## 10. System States / Lifecycle

### 10.1 Session Lifecycle States
- `not_started` -> `active` -> `completed` or `failed`.

### 10.2 Runtime Visualization States
- `idle`
- `tool_running`
- `tool_succeeded`
- `subagent_running`
- `error`

### 10.3 Primary Transition Rules
- `sessionStart` maps to `idle`.
- `preToolUse` maps to `tool_running`.
- `postToolUse` maps to `tool_succeeded` then resolves to `idle`.
- `postToolUseFailure` or `errorOccurred` maps to `error`.
- `subagentStart` maps to `subagent_running`.
- `subagentStop` or `agentStop` resolves to `idle`.

### 10.4 Correlation and Diagnostic Rules
- Tool lifecycle pairing prefers exact `toolCallId`, then exact `spanId`, then FIFO fallback.
- Correlation metadata is optional and additive; absence must not block render or replay.
- Pairing confidence must be inspectable so operators can distinguish exact correlation from heuristic fallback.

---

## 11. Analytics / Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Time to first live visualization | < 10 minutes | Scripted clean-clone setup trials |
| Time to first signal from quick demo flow | < 2 minutes after services start | Local demo command verification |
| Event-to-render latency | < 1 second | Timestamp delta from ingest to UI render event |
| Event capture reliability | >= 95% | Expected-vs-captured event ratio in controlled runs |
| Redaction effectiveness | 100% in policy test suite | Automated compliance tests for sensitive patterns |
| Replay usability | First failure jump in <= 2 interactions | Task-based manual evaluation |

---

## 12. Dependencies and Risks

### 12.1 Dependencies

| Dependency | Type | Risk if Unavailable | Mitigation |
|------------|------|---------------------|------------|
| Copilot CLI hook lifecycle support | External tool behavior | Event capture gaps | Maintain compatibility matrix and fallback parser modes |
| Local filesystem notifications | OS/runtime capability | Delayed ingestion updates | Polling fallback mode with bounded intervals |
| Web browser runtime | Local platform dependency | UI unavailable | Provide minimal console diagnostics path for troubleshooting |
| Optional EJS metadata sources | Optional integration | Missing enrichment overlays | Continue with base event-only visualization |
| Node ecosystem packages | npm dependencies | Security/compat breakage | Lockfiles, periodic updates, and dependency scanning |

### 12.2 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Hook payload drift across Copilot versions | Medium | High | Versioned schema adapters and compatibility tests |
| Sensitive leakage due incomplete redaction patterns | Medium | High | Defense-in-depth redaction rules and negative test corpus |
| Event loss on abrupt process termination | Medium | Medium | Append-only log writes with flush strategy and recovery replay |
| UI slowdown on large replay files | Medium | Medium | Virtualized timeline rendering and chunked parsing |
| Overcoupling to Agent Forge expectations | Low | Medium | Enforce standalone contract and optional integration boundaries |
| Correlation field sparsity in real integrations | Medium | Medium | Exact-id -> span -> FIFO fallback plus visible diagnostics |

---

## 13. Future Considerations

| Item | Description | Potential Version |
|------|-------------|-------------------|
| EJS enrichment overlay | Attach persistent journey metadata to timelines | v1.1+ |
| Optional local correlation cache | Non-authoritative accelerator for correlation lookups only | v1.1+ |
| IDE bridge | Integrate live board in editor surfaces | v2 |
| OpenTelemetry exporter | Optional standardized telemetry export | v2 |
| Desktop packaging | Unified distribution with embedded runtime | v3 |
| Collaborative session sharing | Multi-user review workflows | TBD |

---

## 14. Features

| # | Feature | File | Dependencies | Priority |
|---|---------|------|--------------|----------|
| 1 | Foundation Event Capture | [docs/features/foundation-event-capture.md](features/foundation-event-capture.md) | None | Must |
| 2 | Deterministic State Engine | [docs/features/deterministic-state-engine.md](features/deterministic-state-engine.md) | Foundation Event Capture | Must |
| 3 | Live Visualization Board | [docs/features/live-visualization-board.md](features/live-visualization-board.md) | Foundation Event Capture, Deterministic State Engine | Must |
| 4 | Replay and Session Review | [docs/features/replay-and-session-review.md](features/replay-and-session-review.md) | Foundation Event Capture, Deterministic State Engine, Live Visualization Board | Must |
| 5 | Privacy Retention and Export Controls | [docs/features/privacy-retention-and-export-controls.md](features/privacy-retention-and-export-controls.md) | Foundation Event Capture | Must |

### Post-MVP Capability Themes

| Theme | Current Status | Primary References |
|-------|----------------|--------------------|
| Tracing v2 / event-stream correlation | Implemented | [docs/roadmap/tracing-plan.md](roadmap/tracing-plan.md), [docs/adr/008-tracing-ux-and-doc-consolidation.md](adr/008-tracing-ux-and-doc-consolidation.md) |
| Subagent synthesis refinement | Implemented | [docs/adr/006-task-posttooluse-subagent-synthesis.md](adr/006-task-posttooluse-subagent-synthesis.md) |
| UI diagnostics and idle-aware polish | Implemented | [docs/adr/005-idle-aware-gantt-and-ui-polish.md](adr/005-idle-aware-gantt-and-ui-polish.md) |
| Quickstart and documentation depth split | Implemented | [docs/adr/007-readme-quickstart-and-doc-depth-split.md](adr/007-readme-quickstart-and-doc-depth-split.md) |

### Feature Dependency Graph

```text
Feature 1: Foundation Event Capture
|- Feature 2: Deterministic State Engine
|  |- Feature 3: Live Visualization Board
|  |  \- Feature 4: Replay and Session Review
\- Feature 5: Privacy Retention and Export Controls
```

---

## 15. Glossary

| Term | Definition |
|------|------------|
| Copilot CLI Hook | Lifecycle callback integration point used to capture workflow events |
| Event Envelope | Required top-level schema fields shared by all events |
| JSONL | Newline-delimited JSON records used for append-only local logs |
| Ingestion Service | Local process that parses events and feeds normalized state |
| State Engine | Deterministic reducer mapping event sequences to visual states |
| Replay Engine | Component that replays session history with timeline controls |
| Redaction | Transformation that removes or masks sensitive data before storage/export |
| EJS Overlay | Optional enrichment metadata from external journey artifacts |
| Standalone Packaging | Deployment approach keeping this visualizer separate from Agent Forge core |

---

## 16. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Which Windows versions and shell environments must be supported in MVP test matrix? | Windows 11 with PowerShell and Git Bash required; older Windows versions best-effort |
| 2 | Should localhost HTTP streaming be required in MVP or remain optional behind JSONL-first mode? | JSONL-first required, localhost stream optional |
| 3 | What exact retention configuration surface is preferred (CLI flags, config file, or UI settings)? | Config file + CLI override |
| 4 | Is any formal regulatory target required at launch (GDPR/CCPA attestation artifacts)? | Best-practice baseline controls only, formal mapping deferred |
| 5 | If prompt storage is enabled, what is the default truncation/max length policy? | Default max 512 characters with configurable override |
| 6 | What minimum test coverage threshold is required for merge gates? | 80% line coverage on core packages |