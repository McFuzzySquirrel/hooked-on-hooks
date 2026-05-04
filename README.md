# Copilot Activity Visualiser

[![Build Status](https://img.shields.io/github/actions/workflow/status/McFuzzySquirrel/hooked-on-hooks/ci.yml?style=flat-square)](https://github.com/McFuzzySquirrel/hooked-on-hooks/actions)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-3c873a?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

A toolkit for operational Copilot data capture and analysis across both command-line and editor workflows:

- capture and replay Copilot CLI hook events (`.jsonl`)
- import VS Code GitHub Copilot Chat activity into canonical events
- export dashboard-ready session JSON from canonical event logs
- visualize sessions and model/token usage in the web dashboard

## Core Data Workflows

### 1) Import VS Code Copilot Chat to canonical JSONL

Use this when you want to bring local Copilot Chat activity into the same event format used by the visualizer.

```bash
npm run import:vscode-chat -- \
	--workspaceStorageRoot /home/<user>/.config/Code/User/workspaceStorage/<workspace-id> \
	--jsonlPath /tmp/vscode-chat-events.jsonl \
	--mode auto
```

### 2) Export canonical JSONL to dashboard JSON

Use this to convert newline-delimited canonical events into a dashboard-loadable JSON document.

```bash
npm run export:jsonl-dashboard -- \
	--jsonlPath /tmp/vscode-chat-events.jsonl \
	--out ./vscode-chat-export.json
```

Load `./vscode-chat-export.json` in the Session Dashboard UI. Do not upload the
raw `.jsonl` file directly because the dashboard uploader expects one JSON
document, not newline-delimited JSON.

### One-command refresh (import + export)

Use this when you want to run the full VS Code Chat pipeline in one command.

```bash
npm run refresh:vscode-chat-dashboard -- \
	--workspaceStorageRoot /home/<user>/.config/Code/User/workspaceStorage/<workspace-id> \
	--mode auto
```

Portable default:

```bash
npm run refresh:vscode-chat-dashboard
```

This auto-detects the most recently updated workspace storage folder that contains Copilot chat data. You can always override with `--workspaceStorageRoot` for deterministic behavior.

Optional flags:
- `--jsonlPath /tmp/vscode-chat-events.jsonl` (default)
- `--out ./vscode-chat-export.json` (default)
- `--sessionIds id1,id2`
- `--storePrompts true`

Machine-local shortcut (repo-specific):

```bash
npm run refresh:vscode-chat-dashboard:local
```

### 3) Analyze local `.copilot` session-store data

Use this when you want fast retrospective analysis from existing sessions.

- no target-repo hook setup
- no ingest service required for the analysis workflow
- rich built-in session-store metadata

```bash
npm run session:list -- --json ./session-list.json
npm run session:export -- --ids <id1,id2> --out ./session-store-export.json --split --split-dir ./session-exports
```

One-command Copilot CLI refresh (session list + combined export):

```bash
npm run refresh:copilot-cli-dashboard
```

Optional flags:
- `--limit 10` (default; ignored if `--ids` is provided)
- `--ids <id1,id2>`
- `--listOut ./session-list.json` (default)
- `--out ./session-store-export.json` (default)
- `--dbPath ~/.copilot/session-store.db`
- `--redact true`

Start here: [docs/pathways/session-dashboard/README.md](docs/pathways/session-dashboard/README.md)

### 4) Capture live/custom events from Copilot CLI hooks

Use this when you need real-time or customized capture from a target repository.

- bootstrap/wire hooks into repo workflows
- emit structured events as actions happen
- replay JSONL logs when live ingest is unavailable

Start here: [docs/pathways/hook-pipeline/README.md](docs/pathways/hook-pipeline/README.md)

## Script Argument Separator

When passing arguments to npm scripts, include `--` before script-specific flags.

- Correct: `npm run session:list -- --json ./session-list.json`
- Incorrect: `npm run session:list --json ./session-list.json`

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

## VS Code Chat Import (Experimental)

Import local VS Code GitHub Copilot Chat workspace storage data into canonical visualizer JSONL:

```bash
npm run import:vscode-chat -- \
	--workspaceStorageRoot /home/<user>/.config/Code/User/workspaceStorage/<workspace-id> \
	--jsonlPath /tmp/vscode-chat-events.jsonl \
	--mode auto
```

Modes:
- `auto` - import from `chatSessions` and `GitHub.copilot-chat/chat-session-resources`
- `chatSessions` - import only session conversation JSONL files
- `chatResources` - import only chat session resource artifacts
- `extensionDebugLogs` - import `GitHub.copilot-chat/debug-logs` extension debug logs

Optional flags:
- `--repoPath /path/to/repo` (default: current working directory)
- `--sessionIds id1,id2` (filter specific session IDs)
- `--httpEndpoint http://127.0.0.1:7070/events` (live push during import)
- `--storePrompts true` (store prompts as `[REDACTED_PROMPT]` instead of dropping)

Convert imported canonical JSONL into a dashboard-loadable export JSON:

```bash
npm run export:jsonl-dashboard -- \
	--jsonlPath /tmp/vscode-chat-events.jsonl \
	--out ./vscode-chat-export.json
```

Replay imported output through ingest:

```bash
npm run replay:jsonl -- /tmp/vscode-chat-events.jsonl
```

## Project Structure

- `packages/hook-emitter`: validated event emission and persistence
- `packages/ingest-service`: ingest API and live stream plumbing
- `packages/web-ui`: selector + static dashboard UI
- `shared/event-schema`: canonical event envelope + parser
- `shared/state-machine`: deterministic reducer/query helpers
- `shared/redaction`: export redaction and retention logic

## Additional Documentation

- Tutorials (archived legacy content): [docs/tutorials/README.md](docs/tutorials/README.md)
- Product vision: [docs/product-vision.md](docs/product-vision.md)
- Progress tracker: [docs/PROGRESS.md](docs/PROGRESS.md)
