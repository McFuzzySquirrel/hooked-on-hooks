# Copilot Activity Visualiser

[![Build Status](https://img.shields.io/github/actions/workflow/status/McFuzzySquirrel/hooked-on-hooks/ci.yml?style=flat-square)](https://github.com/McFuzzySquirrel/hooked-on-hooks/actions)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-3c873a?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

A toolkit for analyzing Copilot activity with three independent workflows:

- **Standalone Datastore Pathway**: direct ingestion from local Copilot source data into an append-only event datastore
- **Session Dashboard Pathway**: read-only static dashboard analysis from selected `.copilot` session-store exports
- **Hook Pipeline Pathway**: optional live/custom event capture via Copilot CLI hooks

## Choose Your Path

### 1) Standalone Datastore (.copilot source data + VS Code Copilot Chat, no hooks)

Use this when you want to collect events directly from local source data and
build a multi-session/multi-machine corpus before visualization. Covers both
Copilot CLI sessions and VS Code GitHub Copilot Chat IDE sessions.

- no target-repo hook setup
- no ingest service or browser required
- imports Copilot CLI sessions and VS Code Copilot Chat debug logs
- redacted append-only datastore records
- filtering-ready facets for future analysis

Start here: [docs/pathways/standalone-datastore/README.md](docs/pathways/standalone-datastore/README.md)

### 2) Session Dashboard (.copilot exports, no hooks)

Use this when you want fast retrospective analysis from existing sessions.

- no target-repo hook setup
- no ingest service required for the analysis workflow
- rich built-in session-store metadata

Start here: [docs/pathways/session-dashboard/README.md](docs/pathways/session-dashboard/README.md)

### 3) Hook Pipeline (optional live capture)

Use this when you need real-time or customized capture from a target repository.

- bootstrap/wire hooks into repo workflows
- emit structured events as actions happen
- replay JSONL logs when live ingest is unavailable

Start here: [docs/pathways/hook-pipeline/README.md](docs/pathways/hook-pipeline/README.md)

## Quick Setup

```bash
npm install
npm run typecheck
npm run test
```

For local dashboard work:

```bash
npm run session:list -- --json ./session-list.json
npm run dev --workspace=packages/web-ui
```

For standalone datastore work:

```bash
# Import from Copilot CLI session store
npm run datastore:import -- --db-path ~/.copilot/session-store.db --datastore ./datastore/events.jsonl

# Also include VS Code GitHub Copilot Chat debug logs
npm run datastore:import -- --db-path ~/.copilot/session-store.db --datastore ./datastore/events.jsonl --include-vscode-chat-debug

# IDE-only import (no Copilot CLI session store required)
npm run datastore:import -- --no-session-store --vscode-chat-debug-path ~/.config/Code/logs --datastore ./datastore/events.jsonl

npm run datastore:summary -- --datastore ./datastore/events.jsonl
```

## Project Structure

- `packages/local-datastore`: standalone direct source ingestion and datastore summaries
- `packages/hook-emitter`: optional validated hook event emission and persistence
- `packages/ingest-service`: ingest API and live stream plumbing
- `packages/web-ui`: selector + static dashboard UI
- `shared/event-schema`: canonical event envelope + parser
- `shared/state-machine`: deterministic reducer/query helpers
- `shared/redaction`: export redaction and retention logic

## Additional Documentation

- Tutorials index: [docs/tutorials/README.md](docs/tutorials/README.md)
- Standalone datastore spec: [docs/specs/local-source-datastore.md](docs/specs/local-source-datastore.md)
- Architecture decision records: [docs/adr/](docs/adr/)
- Product vision: [docs/product-vision.md](docs/product-vision.md)
- Progress tracker: [docs/PROGRESS.md](docs/PROGRESS.md)
