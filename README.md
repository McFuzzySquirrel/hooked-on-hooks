# Copilot Activity Visualiser

[![Build Status](https://img.shields.io/github/actions/workflow/status/McFuzzySquirrel/hooked-on-hooks/ci.yml?style=flat-square)](https://github.com/McFuzzySquirrel/hooked-on-hooks/actions)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-3c873a?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

Explore Copilot session history from local session-store data with a static selector and multi-session analysis dashboard.

> **🎓 This project is also an interactive, hands-on learning experience.**
> Beyond the visualiser itself, the repo includes guided tutorials and vanilla hook examples that walk you through Copilot CLI hooks from the ground up — starting with raw payloads and progressively adding schema validation, payload enrichment, event synthesis, and the emit pipeline.

![UI overview of the session explorer workflow](docs/tutorials/assets/tutorial-screenshots/ui-features/ui-overview.png)

> [!TIP]
> The current default flow is selector-based analysis:
> list sessions from `~/.copilot/session-store.db`, export one or more sessions to JSON, then load that export in the dashboard.

See the [Session Dashboard Workflow](docs/tutorials/session-dashboard-workflow.md) for a step-by-step operator guide.

## 🎓 Learning & Tutorials

Start here if you want the practical, step-by-step learning path:

- **[Tutorial Index](docs/tutorials/README.md)** — choose your track (Bash/Linux or PowerShell) and jump to any tutorial part.
- **[From Vanilla to Visualizer (Bash/Linux)](docs/tutorials/from-vanilla-to-visualizer.md)** — six-part walkthrough from raw hooks to full pipeline.
- **[From Vanilla to Visualizer (PowerShell)](docs/tutorials/from-vanilla-to-visualizer-ps1.md)** — PowerShell-focused version of the same journey.
- **[Session Dashboard Workflow](docs/tutorials/session-dashboard-workflow.md)** — selector, export, and dashboard analysis flow.
- **[UI Feature Showcase](docs/tutorials/ui-feature-showcase.md)** — screenshot tour of the visualizer interface.
- **[Multi-Agent Build Visualization](docs/tutorials/multi-agent-build-visualization.md)** — short recording that shows a full multi-agent build and live visualizer feedback.
- **[Vanilla Hook Examples](docs/examples/vanilla-hooks/)** — minimal `.sh` + `.ps1` scripts for all 8 hook types.
- **[Hooked on Hooks](docs/hooked-on-hooks.md)** — practical patterns and lessons learned building this visualiser.

The project is complete for the planned MVP scope:
- Foundation Event Capture
- Deterministic State Engine
- Privacy Retention and Export Controls
- Static Session Selector and Dashboard
- Multi-Session Export and Session Review

## Features

- Session-store export CLI for listing and exporting selected sessions
- Session selector UI with search, sort, bulk selection, and export command generation
- Static dashboard UI with tabs for overview, checkpoints, turns, files, models/tokens, and full-text search
- Combined and per-session JSON export modes
- Optional export redaction toggle using shared pattern redaction rules
- FTS5-safe fallback behavior for environments where SQLite FTS5 is unavailable
- Existing-repo bootstrap/unbootstrap tooling for hook capture workflows
- JSONL replay tooling for ingest-service and legacy event-stream workflows

## Getting Started

### Prerequisites

- Node.js 24+

### Install and Verify

```bash
npm install
npm run typecheck
npm run test
```

### Session Dashboard Quickstart

```bash
# 1) List available sessions from ~/.copilot/session-store.db
npm run session:list -- --json ./session-list.json

# 2) Start the web UI
npm run dev --workspace=packages/web-ui

# 3) Optional: export specific sessions for dashboard loading
npm run session:export -- --ids <session-id-1,session-id-2> --out ./session-store-export.json --split --split-dir ./session-exports
```

Open `http://127.0.0.1:5173`.

In the app:

1. Use Session Selector to load `session-list.json`.
2. Select one or more sessions and copy the generated export command.
3. Use Session Dashboard to load `session-store-export.json` (combined) or a single split file.

### Export Modes

Combined export:

```bash
npm run session:export -- --ids <session-id-1,session-id-2> --out ./session-store-export.json
```

Split per-session export:

```bash
npm run session:export -- --ids <session-id-1,session-id-2> --split --split-dir ./session-exports
```

Optional redaction:

```bash
npm run session:export -- --ids <session-id-1,session-id-2> --out ./session-store-export.json --redact
```

### Troubleshooting Session Explorer

- If `session:list` fails, verify `sqlite3` is installed and `~/.copilot/session-store.db` exists.
- If `session:export` fails with unknown session IDs, regenerate `session-list.json` and copy IDs directly from that file.
- If model/token extraction is sparse, your local sqlite build may not include FTS5; exporter fallback still works using turns/checkpoints/files/refs text.

## Integrate an Existing Repo

Bootstrap integration in one command:

```bash
npm run bootstrap:repo -- /absolute/path/to/target-repo
```

This creates:
- `.visualizer/emit-event.sh`
- `.visualizer/visualizer.config.json`
- `.visualizer/HOOK_INTEGRATION.md`
- `.visualizer/logs/`
- `.github/hooks/visualizer/visualizer-hooks.json` (canonical hook manifest)

And it auto-wires known hook scripts in `.github/hooks/` (including subdirectories) when present.

### No Existing Hooks?

Use `--create-hooks` to generate stub hook scripts automatically:

```bash
npm run bootstrap:repo -- /path/to/target-repo --create-hooks
```

This creates `.github/hooks/visualizer/` with scripts for every Copilot CLI hook (session start/end, tool use, subagent stop, agent stop, error, etc.), each pre-wired to emit visualiser events. A `visualizer-hooks.json` manifest is also created inside the same subdirectory as the canonical registry of all captured event types.

Generated subagent hooks now capture richer start metadata when the host integration provides it, including display name, description, task text, and summary/message fields. The generated stubs prefer `AGENT_NAME` and `SUBAGENT_NAME`, then fall back through display-name and task-description style variables before using `unknown`.

### Naming Prefix

Use `--prefix` to avoid filename collisions with existing hooks:

```bash
npm run bootstrap:repo -- /path/to/target-repo --create-hooks --prefix viz
```

This generates `viz-session-start.sh`, `viz-pre-tool-use.sh`, etc. instead of bare names. When wiring existing hooks, prefixed filenames like `viz-session-start.sh` are matched automatically.

### Vanilla Mode

Use `--vanilla` to generate minimal hooks that log raw Copilot CLI payloads with no transformations:

```bash
npm run bootstrap:repo -- /path/to/target-repo --create-hooks --vanilla
```

This creates simple scripts that read stdin and append the raw JSON to `.github/hooks/logs/events.jsonl` — no enrichment, no emit-event dependency, no fallback cascades. Use this to understand the default payloads before layering on customizations. See the [vanilla examples](docs/examples/vanilla-hooks/README.md) and [tutorial](docs/tutorials/from-vanilla-to-visualizer.md) for details.

When bootstrapping, the tool also scans `.github/hooks/` for JSON hook manifests and updates any compatible manifest that contains a `hooks` object (for example `ejs-hooks.json` or other manifest names). Missing mapped lifecycle entries are added automatically based on discovered/generated hook scripts.

### Refresh Existing Generated Hooks

If you already bootstrapped another repo before this metadata update, its existing generated hook stubs will keep their old payload logic until you refresh them.

Recommended refresh flow:

```bash
npm run unbootstrap:repo -- /absolute/path/to/target-repo --apply
npm run bootstrap:repo -- /absolute/path/to/target-repo --create-hooks
```

If you use prefixed hook names, include the same prefix in both commands.

## Unbootstrap Target Repo

To remove visualiser integration from a target repo, use the unbootstrap command.

Dry-run (default, no file changes):

```bash
npm run unbootstrap:repo -- /absolute/path/to/target-repo
```

Apply changes (actually remove wiring/artifacts):

```bash
npm run unbootstrap:repo -- /absolute/path/to/target-repo --apply
```

If bootstrap used prefixed hook names, include the same prefix:

```bash
npm run unbootstrap:repo -- /absolute/path/to/target-repo --prefix viz --apply
```

Unbootstrap behavior:
- Removes auto-wired visualiser emit blocks from hook scripts.
- Deletes the dedicated `visualizer-hooks.json` manifest and the `visualizer/` subdirectory.
- Updates compatible JSON hook manifests under `.github/hooks/` recursively by removing bootstrap-managed entries.
- Deletes safe auto-generated stub hooks (boilerplate-only).
- Removes `.visualizer/` in apply mode.

> [!IMPORTANT]
> For standard hook filenames (with or without prefix), no manual `chmod` and no manual wiring are required.

If your repo uses non-standard hook filenames, call the generated emitter manually from your hook script:

```bash
.visualizer/emit-event.sh <eventType> '<payload-json>' <sessionId>
```

## Offline / JSONL Recovery

If the ingest service is down, events are still appended to `.visualizer/logs/events.jsonl` by the generated script.

Replay them after the service is up:

```bash
npm run replay:jsonl -- /path/to/target-repo/.visualizer/logs/events.jsonl
```

## Hook Configuration

Print the supported hook event types from this repo:

```bash
npx tsx scripts/configure-hooks.ts
```

The `visualizer-hooks.json` manifest created during bootstrap is the canonical source of truth for which events the visualiser captures. It covers all 8 Copilot CLI hook types (3 additional event types — `subagentStart`, `postToolUseFailure`, and `notification` — are synthesized internally and do not have corresponding hooks).

## Package Layout

- `packages/hook-emitter`: emit + persist validated events
- `packages/ingest-service`: Fastify ingest API + SSE state stream (legacy/live path)
- `packages/web-ui`: React/Vite static session selector and dashboard UI
- `shared/event-schema`: canonical event envelope + parser
- `shared/state-machine`: deterministic reducer and state rebuild
- `shared/redaction`: redaction, retention, and export controls

## Useful Commands

```bash
npm run test
npm run test:watch
npm run session:list -- --json ./session-list.json
npm run session:export -- --ids <session-id-1,session-id-2> --out ./session-store-export.json
npm run smoke:e2e
npm run bootstrap:repo -- /absolute/path/to/target-repo
npm run unbootstrap:repo -- /absolute/path/to/target-repo
npm run replay:jsonl -- /path/to/events.jsonl
```

## Documentation

- Product vision: `docs/product-vision.md`
- Progress tracker: `docs/PROGRESS.md`
- UI showcase: `docs/tutorials/ui-feature-showcase.md`
- Integration notes: `docs/integrations/hooked-on-hooks-ejs-overlay.md`
- Architecture decisions: `docs/adr/` — ADRs covering packaging, metadata, manifests, hook isolation, and UI polish
- ADR-006: `docs/adr/006-task-posttooluse-subagent-synthesis.md` — synthesis timing and lane lifecycle rationale
- ADR-007: `docs/adr/007-readme-quickstart-and-doc-depth-split.md` — README/runbook vs deep-doc split
- ADR-008: `docs/adr/008-tracing-ux-and-doc-consolidation.md` — umbrella decision for tracing + UX + docs rollout
- ADR-009: `docs/adr/009-tutorial-alignment-and-pretooluse-examples.md` — tutorial code snippet accuracy and preToolUse standardisation
- ADR-010: `docs/adr/010-csv-export-and-live-feed-pause.md` — CSV session export and live feed pause/resume
- ADR-011: `docs/adr/011-multi-agent-session-improvements.md` — concurrent tools, intent tracking, wait states, and analytics
- Blog: `docs/blog/what-319-events-taught-us.md` — what 319 real events taught us about multi-agent sessions
