# Research: Architecture Options

## Objective

Choose an implementation architecture that delivers reliable live visualization
for Copilot CLI with low setup friction and strong privacy defaults.

## Option A: Plugin-Only (Hooks + Local Logs + TUI)

### Description

Use Copilot CLI hooks to write JSONL events and render directly in terminal.

### Pros

- Fastest MVP path
- No browser stack required
- Low memory footprint

### Cons

- Limited visual expressiveness for pixel-art UI
- Harder timeline interactions and replay ergonomics

## Option B: Sidecar Web App + Hook Event Stream

### Description

Hooks emit events to JSONL or localhost HTTP endpoint. A local web app renders
live state and timeline.

### Pros

- Strong visual flexibility (pixel canvas, animations, timeline)
- Easy replay and filtering
- Familiar frontend tooling

### Cons

- More moving parts than plugin-only mode
- Requires process supervision for sidecar app

## Option C: Electron/Desktop App + Embedded Ingestion

### Description

Desktop app handles ingestion, rendering, storage, and replay in one package.

### Pros

- Polished end-user packaging
- Unified install experience

### Cons

- Higher build/distribution complexity
- Heavier runtime and update surface

## Recommendation

Adopt **Option B** for MVP, with a thin CLI plugin for hook packaging and a
local web sidecar for rendering.

Rationale:

1. Better visual UX than plugin-only approach.
2. Lower complexity than full desktop packaging.
3. Clean migration path to desktop app later if needed.

## Proposed System Components

1. Hook emitter scripts (repo-level, CLI lifecycle events)
2. Event transport (JSONL and optional localhost HTTP)
3. Ingestion service (normalization, buffering, redaction checks)
4. Renderer (pixel-style live board + timeline)
5. Replay engine (session playback and event scrubbing)

## Risk Register

1. Hook payload drift across Copilot versions
Mitigation: strict schema versioning and compatibility tests.

2. Sensitive data exposure in logs
Mitigation: redaction middleware plus denylist patterns.

3. Event loss during abrupt termination
Mitigation: append-only local log and restart recovery.