# Copilot Activity Visualiser PRD

## 1. Overview

**Product Name:** Copilot Activity Visualiser  
**Summary:** A standalone, local-first visualization product that captures Copilot CLI activity and renders live execution state, timeline replay, and failure context so developers can understand agent workflows without manually parsing transcripts.  
**Target Platform:** Linux, macOS, and Windows developer laptops (MVP), local browser UI plus Copilot CLI hook integration.  
**Key Constraints:** Local-first operation, offline compatibility, strict redaction before persist/transmit, optional integration with Agent Forge and EJS metadata, event-to-render latency under 1 second, and separate project packaging from Agent Forge core.

---

## 2. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-12 | GitHub Copilot | Initial PRD from product vision, architecture research, schema, privacy spec, roadmap, and ADR-001 |
| 1.1 | 2026-04-12 | GitHub Copilot | Finalized MVP decisions: include Windows support, prompt storage opt-in only, lock ingest service on Fastify |
| 1.2 | 2026-04-14 | GitHub Copilot | Post-MVP alignment: updated TypeScript version to match installed 5.x, replaced pixel-art UI references with accurate descriptions, marked all implementation phases complete, added bootstrap/unbootstrap tooling |
| 1.3 | 2026-04-17 | GitHub Copilot | Tracing v2 (Phase A/B): event-stream correlation fields, pairing diagnostics endpoint, UI inspector metadata, PairingDiagnosticsPanel, bootstrap tracing env var forwarding, smoke test extended, documentation rollout |
| 1.4 | 2026-04-17 | GitHub Copilot | Tutorial alignment: aligned Bash and PS1 tutorial code snippets with actual vanilla examples and bootstrap output, standardised on preToolUse as canonical example, brought PS1 tutorial depth to parity with Bash track |
| 1.5 | 2026-04-17 | GitHub Copilot | CSV session export and live feed pause/resume: client-side CSV download of session events, live feed pause/resume toggle with buffered updates, header toolbar layout |

---

## 3. Goals and Non-Goals

### 3.1 Goals
- Deliver live execution state transitions for Copilot CLI sessions with minimal setup.
- Provide deterministic replay of completed sessions with scrubbing and failure jump.
- Keep sensitive data local and redacted by default.
- Preserve optional integration posture: useful standalone, with optional Agent Forge and EJS overlays.
- Maintain schema-driven extensibility for future integrations and UI growth.

### 3.2 Non-Goals
- Full parity with every Copilot interaction surface outside CLI for MVP.
- Multi-tenant cloud telemetry, identity, billing, or cross-organization analytics.
- Mandatory dependency on Agent Forge core.
- Full IDE bridge in MVP (explicitly post-MVP).

---

## 4. User Stories / Personas

### 4.1 Personas

| Persona | Description | Key Needs |
|---------|-------------|-----------|
| Solo Developer | Individual running Copilot CLI workflows locally | Real-time visibility, quick setup, local privacy defaults |
| Platform Engineer | Team member building internal agent workflows | Deterministic event capture, debugging insights, replay traceability |
| Tech Lead / Demo Owner | Presents workflows to stakeholders | Understandable live visualization, clear state transitions, demo reliability |
| Workflow Reviewer | Reviews completed runs for quality and failures | Timeline replay, first-failure jump, scrub-by-event inspection |

### 4.2 User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| US-01 | Solo Developer | launch visualization quickly from a clean clone | I can monitor a live run in under 10 minutes | Must |
| US-02 | Platform Engineer | view active agent/subagent/tool state in real time | I can diagnose stalls and bottlenecks immediately | Must |
| US-03 | Workflow Reviewer | replay a completed run and scrub events | I can understand the exact sequence after failures | Must |
| US-04 | Tech Lead / Demo Owner | display distinct visual states for idle/running/error | non-technical audiences can follow workflow progress | Should |
| US-05 | Privacy-Conscious User | ensure secrets are redacted before storage/export | no sensitive values are leaked by observability tooling | Must |
| US-06 | Agent Forge User | optionally enrich sessions with EJS metadata | I get richer context without coupling requirements | Could |

---

## 5. Research Findings

- Architecture options assessed: plugin-only TUI, sidecar web app, and desktop app.
- Recommended architecture for MVP: sidecar web app + hook event stream (Option B).
- Key tradeoff decision:

| Option | Strengths | Weaknesses | Decision |
|--------|-----------|------------|----------|
| Plugin-only TUI | Low complexity, minimal runtime | Limited visual expressiveness, weaker replay ergonomics | Rejected for MVP visual goals |
| Sidecar Web App | Strong UI flexibility, timeline/replay support, familiar tooling | More moving parts, local process supervision | Selected |
| Desktop App | Polished packaging, unified ingestion/rendering | High build/distribution complexity, heavier runtime | Deferred |

- Event schema-first approach selected to reduce payload drift risk and support controlled evolution.
- Privacy design established early: redact-before-persist and export disabled by default.
- Packaging decision (ADR-001): keep visualizer as separate project to avoid Agent Forge core coupling.

### Technology Currency Check (as of 2026-04-12)

| Technology | Observed Stable Version | Status | Notes for PRD |
|------------|-------------------------|--------|---------------|
| Node.js | 24.14.1 (Latest LTS), 25.9.0 (Current) | Active | Use Node 24 LTS baseline for production stability |
| TypeScript | 5.9.3 | Active | TS 5.x strict mode enabled across all workspace packages |
| React | 19.2.5 | Active | React 19 APIs should be baseline for UI |
| Vite | 8.0.8 | Active | Verify plugin compatibility if upgrading from earlier major versions |
| Fastify | 5.8.4 | Active | Fastify v3 and lower are EOL; do not target legacy versions |
| Zod | 4.3.6 | Active | Keep schema parsing aligned with Zod v4 API |
| Vitest | 4.1.4 | Active | Use for unit/integration tests in TS/Vite stack |
| Playwright Test | 1.59.1 | Active | Use for browser E2E and replay interaction validation |

---

## 6. Concept

### 6.1 Core Loop / Workflow

1. User starts Copilot CLI session with configured hooks.
2. Hook emitter captures lifecycle/tool/subagent events.
3. Events are validated against schema and redacted.
4. Events are persisted to append-only local JSONL stream.
5. Ingestion service watches stream, normalizes records, and updates state machine.
6. Web sidecar renders live board and timeline updates.
7. On completion, user replays timeline, scrubs events, and jumps to failure points.

### 6.2 Success / Completion Criteria

- A user reaches first live visualization in less than 10 minutes.
- Live state transitions correctly reflect incoming events.
- Replay order strictly matches event chronology.
- Security tests confirm no raw sensitive token leakage in logs/exports.

---

## 7. Technical Architecture

### 7.1 Technology Stack

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
| E2E / Cross-browser | Playwright Test | 1.59+ | Interaction and replay behavior verification |

### 7.2 Project Structure

Proposed structure:

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
      src/
      test/
    ingest-service/
      src/
      test/
    web-ui/
      src/
      test/
  shared/
    event-schema/
    redaction/
    state-machine/
  scripts/
    bootstrap-existing-repo.ts
    unbootstrap-existing-repo.ts
    emit-event-cli.ts
    replay-jsonl.ts
    smoke-e2e.ts
    configure-hooks.ts
    test/
  .github/
```

### 7.3 Key APIs / Interfaces

| Interface | Direction | Purpose |
|-----------|-----------|---------|
| Copilot CLI Hook -> Emitter | Input | Capture lifecycle and tool execution events |
| Emitter -> JSONL Log | Output | Persist canonical event records |
| Emitter -> Localhost HTTP (optional) | Output | Stream events to ingest service in real-time |
| Ingest Service -> State Engine | Internal | Derive deterministic session and lane states |
| State Engine -> Web UI | Internal | Push normalized updates for rendering |
| Replay Engine -> Timeline UI | Internal | Drive playback, scrubbing, and event inspection |

---

## 8. Functional Requirements

### 8.1 Event Capture and Validation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-EV-01 | The system must capture all MVP event types defined in Event Schema v1. | Must |
| FR-EV-02 | Every event must include required envelope fields and a valid schemaVersion. | Must |
| FR-EV-03 | Malformed events must be rejected with error telemetry and must not crash capture. | Must |
| FR-EV-04 | Event IDs must be unique per session. | Must |
| FR-EV-05 | Schema compatibility mode must support additive minor-version fields. | Should |
| FR-EV-06 | Event envelopes may optionally carry `turnId`, `traceId`, `spanId`, `parentSpanId` correlation fields; tool payloads may carry `toolCallId`. All are backward-compatible additions. | Should |

### 8.2 Ingestion and State Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ST-01 | Ingestion service must parse append-only JSONL logs and optional localhost stream input. | Must |
| FR-ST-02 | State transitions must map to the renderer state mapping defined in schema spec. | Must |
| FR-ST-03 | State machine outputs must be deterministic for identical event sequences. | Must |
| FR-ST-04 | Restart recovery must rebuild current session state from persisted logs. | Should |
| FR-ST-05 | Ingestion service must expose a pairing diagnostics endpoint (`GET /diagnostics/pairing`) reporting exact-match vs. heuristic pair counts. | Should |
| FR-ST-06 | Tool event pairing must use a 3-tier strategy: exact `toolCallId` match → exact `spanId` match → FIFO heuristic by tool name. | Should |

### 8.3 Live Visualization UI

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-UI-01 | UI must show session lane plus agent/subagent/tool activity lanes in real time. | Must |
| FR-UI-02 | UI must display visual states for idle, running, succeeded, blocked/error. | Must |
| FR-UI-03 | UI must update within 1 second of event arrival under normal local conditions. | Must |
| FR-UI-04 | UI must include event inspector details for selected timeline entries. | Should |
| FR-UI-05 | UI should support filtering by event type and agent/tool name. | Could |

### 8.4 Replay and Review

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-RP-01 | Replay must support play, pause, scrub, and variable speed controls. | Must |
| FR-RP-02 | Replay ordering must match event chronological order by timestamp and log position fallback. | Must |
| FR-RP-03 | User must be able to jump to first failure event in two interactions or fewer. | Must |
| FR-RP-04 | Replay must remain responsive with session files of 10k+ events. | Should |

### 8.5 Privacy, Retention, and Operations

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-PR-01 | Redaction rules must run before event persistence and before any export path. | Must |
| FR-PR-02 | Default retention must be 7 days with configurable 1 day, 30 days, and manual modes. | Must |
| FR-PR-03 | A purge command must delete all local event logs for targeted scope. | Must |
| FR-PR-04 | Export must be disabled by default and require explicit destination configuration. | Must |

---

## 9. Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NF-01 | End-to-end event-to-render latency must be less than 1 second on supported local environments. | Must |
| NF-02 | Event capture reliability must be 95% or greater for normal CLI runs. | Must |
| NF-03 | UI must remain responsive during replay of 10k+ event sessions. | Must |
| NF-04 | System must operate offline after installation. | Must |
| NF-05 | Components must expose structured logs suitable for local debugging. | Should |
| NF-06 | Architecture must allow extension to optional IDE bridge and OpenTelemetry exporter post-MVP. | Could |

---

## 10. Security and Privacy

Data handling posture: local-first observability with minimum-necessary collection and redact-before-persist/transmit.

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

Compliance position (MVP): no explicit regulated domain target is declared yet; baseline controls should still align with GDPR/CCPA-friendly minimization principles. Formal compliance mapping is an open question.

---

## 11. Accessibility

| ID | Requirement | Priority |
|----|-------------|----------|
| ACC-01 | Web UI must meet WCAG 2.1 AA baseline for contrast, semantics, and interaction patterns. | Must |
| ACC-02 | Core controls (play/pause/scrub/filter/focus) must be keyboard-operable. | Must |
| ACC-03 | Timeline and state indicators must expose meaningful labels for screen readers. | Should |
| ACC-04 | UI must support reduced-motion mode for animated visualizations. | Should |
| ACC-05 | Text and inspector panels must remain usable at 200% zoom without loss of function. | Should |

---

## 12. User Interface / Interaction Design

- Operations board with distinct lanes for session, agent, subagent, and tool states.
- Two primary modes: Live mode and Replay mode.
- Live mode focuses on currently running steps, latest events, and immediate failures.
- Replay mode provides timeline scrubbing, speed controls, and event inspector details.
- Visual status semantics:
  - Idle: neutral state tile
  - Running: animated pulse/scan state
  - Success: resolved/steady state
  - Error/Blocked: alert state with quick-jump affordance
- Interaction priorities:
  - First failure jump within two actions.
  - Fast filtering by event type and actor.
  - Stable layout preserving context when new events arrive.

---

## 13. System States / Lifecycle

### 13.1 Session Lifecycle States
- `not_started` -> `active` -> `completed` or `failed`.

### 13.2 Runtime Visualization States
- `idle`
- `tool_running`
- `tool_succeeded`
- `subagent_running`
- `error`

### 13.3 Primary Transition Rules
- `sessionStart` maps to `idle`.
- `preToolUse` maps to `tool_running`.
- `postToolUse` maps to `tool_succeeded` then resolves to `idle`.
- `postToolUseFailure` or `errorOccurred` maps to `error`.
- `subagentStart` maps to `subagent_running`.
- `subagentStop` or `agentStop` resolves to `idle`.

---

## 14. Implementation Phases

### Phase 1: Foundation and Event Capture
- [x] Initialize workspace scaffolding and CI baseline.
- [x] Implement hook configuration for targeted Copilot CLI lifecycle events.
- [x] Emit schema-compliant JSONL events.
- [x] Add schema validation and malformed-record handling.

### Phase 2: Ingestion and Deterministic State Engine
- [x] Build ingestion service (file watcher plus parser).
- [x] Implement deterministic session/agent/subagent/tool state machine.
- [x] Add restart recovery from persisted logs.
- [x] Validate latency and reliability on representative local runs.

### Phase 3: Live Visualization UI
- [x] Implement live board with state lanes and status mapping.
- [x] Add event inspector and base filtering controls.
- [x] Validate responsiveness under sustained event volume.

### Phase 4: Replay and Session Review
- [x] Implement replay controls (play, pause, scrub, speed).
- [x] Implement timeline inspector and first-failure quick jump.
- [x] Verify replay chronology parity with persisted logs.

### Phase 5: Privacy Hardening and Packaging
- [x] Enforce redaction middleware pre-persist and pre-export.
- [x] Implement retention modes and purge command.
- [x] Package and document install-to-first-live-flow under 10 minutes.
- [x] Publish optional integration guide for Agent Forge and EJS metadata overlays.

### Phase 6: Integration Tooling (Post-MVP)
- [x] Bootstrap command for one-step existing-repo integration.
- [x] Unbootstrap command for clean removal of integration artifacts.
- [x] Auto-wiring of hook scripts and JSON manifests.
- [x] Stub hook generation with `--create-hooks` flag.
- [x] Prefixed hook naming with `--prefix` flag.

### Phase 7: Tracing v2 — Event-Stream Correlation (Post-MVP)
- [x] Add optional `turnId`, `traceId`, `spanId`, `parentSpanId` to `BaseEnvelope`.
- [x] Add optional `toolCallId` to `preToolUse`, `postToolUse`, `postToolUseFailure` payloads.
- [x] Extend `EmitOptions` and `emit-event-cli.ts` to stamp and forward tracing fields.
- [x] Implement `pairToolEvents` with 3-tier pairing in `shared/state-machine/src/queries.ts`.
- [x] Expose `GET /diagnostics/pairing` in ingest service.
- [x] Surface pairing mode counts in web UI (`PairingDiagnosticsPanel`).
- [x] Conditionally render tracing fields in `EventInspector`.
- [x] Forward `VISUALIZER_TURN_ID`/`TRACE_ID`/`SPAN_ID`/`PARENT_SPAN_ID` from generated emitter scripts.
- [x] Extend smoke test to verify all three pairing modes end-to-end.
- [x] Documentation rollout across hooked-on-hooks, tutorials, state-engine feature doc, ADR-006.

### Phase 8: Tutorial Alignment and preToolUse Standardisation (Post-MVP)
- [x] Align Bash Part 1 and Part 6 vanilla code snippets with `docs/examples/vanilla-hooks/pre-tool-use.sh`.
- [x] Rewrite PS1 Parts 1–6 to match Bash tutorial structure and depth.
- [x] Replace incorrect `Get-VizValue`/`-AsHashtable` pattern with actual `_vizField`/`_vizNested` helpers.
- [x] Standardise on `preToolUse` as the canonical worked example across both tracks.
- [x] Add step-by-step "Try it yourself" blocks with expected output to all PS1 parts.
- [x] Add optional visualiser checkpoints at each part boundary.
- [x] Add Tracing v2 coverage to PS1 Parts 2 and 5.
- [x] Add Next Steps links and ADR cross-references to PS1 Part 6.
- [x] Record ADR-009 for tutorial alignment decision.

### Phase 9: CSV Export and Live Feed Pause/Resume (Post-MVP)
- [x] Add `csvExport.ts` with RFC 4180 escaping, envelope-to-row mapping, and Blob download.
- [x] Add `📥 Export CSV` button in header toolbar, disabled when no events are loaded.
- [x] Add live feed pause/resume toggle with buffered SSE state and event refs.
- [x] Show `⏸ Paused` badge in header when feed is paused.
- [x] Flush buffered state and events on resume in a single React update.
- [x] Disable pause button during replay mode.
- [x] Add unit tests for `escapeCsvValue`, `eventToCsvRow`, and `buildCsv`.
- [x] Record ADR-010 for CSV export and live feed pause decision.

---

## 15. Testing Strategy

| Level | Scope | Tools / Approach |
|-------|-------|------------------|
| Unit Tests | Schema validation, redaction matchers, transition reducer logic | Vitest with table-driven cases |
| Integration Tests | Hook emitter -> JSONL -> ingestion -> state engine pipelines | Vitest + fixture sessions + file watcher harness |
| Manual / Exploratory | Live run UX, replay ergonomics, failure inspection usability | Scenario walkthroughs on Linux/macOS |
| Performance | Event throughput, parse/render latency, 10k+ replay responsiveness | Synthetic event generators + profiling traces |
| Cross-Platform | Browser behavior and key interactions in supported engines | Playwright Test matrix (Chromium/Firefox/WebKit where feasible) |

Key test scenarios:

1. Full happy-path session captures all MVP event types with valid envelopes.
2. Malformed event does not crash pipeline and emits diagnostics.
3. Redaction removes token-like values in prompts and tool commands.
4. State transitions match spec mapping for normal and failure paths.
5. Replay order is stable and consistent with persisted chronology.
6. First-failure jump lands on expected event in two interactions or fewer.
7. Purge command removes all targeted local logs.
8. Export path transmits only redacted payloads when explicitly enabled.
9. Linux, macOS, and Windows installation and live-view workflows complete successfully.
10. Prompt content is not stored by default and is only persisted after explicit opt-in.

---

## 16. Analytics / Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Time to first live visualization | < 10 minutes | Scripted clean-clone setup trials |
| Event-to-render latency | < 1 second | Timestamp delta from ingest to UI render event |
| Event capture reliability | >= 95% | Expected-vs-captured event ratio in controlled runs |
| Redaction effectiveness | 100% in policy test suite | Automated compliance tests for sensitive patterns |
| Replay usability | First failure jump in <= 2 interactions | Task-based manual evaluation |

Telemetry policy: default to local metrics only; no cloud telemetry in MVP default mode.

---

## 17. Acceptance Criteria

1. A new user can install and see live session visualization in under 10 minutes on supported OS.
2. All MVP event types are captured, validated, and rendered with deterministic state behavior.
3. Replay controls support play, pause, scrub, and speed adjustments with chronology integrity.
4. User can jump to first failure in two interactions or fewer.
5. Redaction policy passes all compliance test cases in privacy spec.
6. Retention modes and purge command function as documented.
7. No default cloud export or upload occurs without explicit opt-in.
8. Architecture remains decoupled from Agent Forge core and usable standalone.
9. MVP support is verified on Linux, macOS, and Windows.
10. Prompt content persistence is disabled by default and requires explicit opt-in.
11. Tool event pairing diagnostics endpoint returns accurate mode counts (toolCallId / spanId / heuristic) for any ingested session.
12. Events with optional correlation IDs (`turnId`, `traceId`, `spanId`, `toolCallId`) receive exact pairing; events without fall back gracefully to FIFO heuristic with no data loss.

---

## 18. Dependencies and Risks

### 18.1 Dependencies

| Dependency | Type | Risk if Unavailable | Mitigation |
|------------|------|---------------------|------------|
| Copilot CLI hook lifecycle support | External tool behavior | Event capture gaps | Maintain compatibility matrix and fallback parser modes |
| Local filesystem notifications | OS/runtime capability | Delayed ingestion updates | Polling fallback mode with bounded intervals |
| Web browser runtime | Local platform dependency | UI unavailable | Provide minimal console diagnostics path for troubleshooting |
| Optional EJS metadata sources | Optional integration | Missing enrichment overlays | Continue with base event-only visualization |
| Node ecosystem packages | npm dependencies | Security/compat breakage | Lockfiles, periodic updates, and dependency scanning |

### 18.2 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Hook payload drift across Copilot versions | Medium | High | Versioned schema adapters and compatibility tests |
| Sensitive leakage due incomplete redaction patterns | Medium | High | Defense-in-depth redaction rules and negative test corpus |
| Event loss on abrupt process termination | Medium | Medium | Append-only log writes with flush strategy and recovery replay |
| UI slowdown on large replay files | Medium | Medium | Virtualized timeline rendering and chunked parsing |
| Overcoupling to Agent Forge expectations | Low | Medium | Enforce standalone contract and optional integration boundaries |

---

## 19. Future Considerations

| Item | Description | Potential Version |
|------|-------------|-------------------|
| EJS enrichment overlay | Attach persistent journey metadata to timelines | v1.1+ |
| IDE bridge | Integrate live board in editor surfaces | v2 |
| OpenTelemetry exporter | Optional standardized telemetry export | v2 |
| Desktop packaging | Unified distribution with embedded runtime | v3 |
| Collaborative session sharing | Multi-user review workflows | TBD |

---

## 20. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Which Windows versions and shell environments must be supported in MVP test matrix? | Windows 11 with PowerShell and Git Bash required; older Windows versions best-effort |
| 2 | Should localhost HTTP streaming be required in MVP or remain optional behind JSONL-first mode? | JSONL-first required, localhost stream optional |
| 3 | What exact retention configuration surface is preferred (CLI flags, config file, or UI settings)? | Config file + CLI override |
| 4 | Is any formal regulatory target required at launch (GDPR/CCPA attestation artifacts)? | Best-practice baseline controls only, formal mapping deferred |
| 5 | If prompt storage is enabled, what is the default truncation/max length policy? | Default max 512 characters with configurable override |
| 6 | Is Fastify preferred for ingest service, or should ingest remain framework-minimal HTTP server? | Resolved: Fastify 5.x is locked for MVP |
| 7 | What minimum test coverage threshold is required for merge gates? | 80% line coverage on core packages |

---

## 21. Glossary

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
