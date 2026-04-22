# Copilot Activity Visualiser

[![Build Status](https://img.shields.io/github/actions/workflow/status/McFuzzySquirrel/hooked-on-hooks/ci.yml?style=flat-square)](https://github.com/McFuzzySquirrel/hooked-on-hooks/actions)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-3c873a?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

A toolkit for analyzing Copilot activity with two independent workflows:

- **Session Dashboard Pathway**: read-only analysis from local `.copilot` session-store data
- **Hook Pipeline Pathway**: live/custom event capture via Copilot CLI hooks

## Choose Your Path

### 1) Session Dashboard (.copilot, no hooks)

Use this when you want fast retrospective analysis from existing sessions.

- no target-repo hook setup
- no ingest service required for the analysis workflow
- rich built-in session-store metadata

Start here: [docs/pathways/session-dashboard/README.md](docs/pathways/session-dashboard/README.md)

### 2) Hook Pipeline (live capture)

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

## Project Structure

- `packages/hook-emitter`: validated event emission and persistence
- `packages/ingest-service`: ingest API and live stream plumbing
- `packages/web-ui`: selector + static dashboard UI
- `shared/event-schema`: canonical event envelope + parser
- `shared/state-machine`: deterministic reducer/query helpers
- `shared/redaction`: export redaction and retention logic

## Additional Documentation

- Tutorials index: [docs/tutorials/README.md](docs/tutorials/README.md)
- Product vision: [docs/product-vision.md](docs/product-vision.md)
- Progress tracker: [docs/PROGRESS.md](docs/PROGRESS.md)
