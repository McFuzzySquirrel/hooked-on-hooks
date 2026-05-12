# Standalone Datastore Pathway

Use this pathway when you want to ingest Copilot activity directly from local
source data and build a durable event corpus before thinking about live
visualization.

## Why This Pathway Exists

The local Copilot store already contains source data for sessions that have
happened:

- `~/.copilot/session-store.db` for session metadata
- `~/.copilot/session-state/<session-id>/events.jsonl` for source events
- VS Code GitHub Copilot Chat debug logs from `logs` roots and `User/workspaceStorage/**/GitHub.copilot-chat/**/main.jsonl` for IDE chat sessions

The standalone datastore pathway imports that data directly. It does not require:

- hook bootstrap
- target-repository modification
- a running ingest service
- a browser or live visualization board

## What You Get

- Append-only datastore JSONL containing normalized `sourceEvent` records
- Multi-session and multi-machine metadata fields
- Redacted-by-default persistence
- Optional redacted raw payload retention
- Filtering-ready facets for models, tokens, tools, subagents, files, errors, and debug signals
- Summary command for imported datastore scope

## Quickstart

1. Install dependencies:

```bash
npm install
```

2. Import local Copilot source data:

```bash
npm run datastore:import -- \
  --db-path ~/.copilot/session-store.db \
  --datastore ./datastore/events.jsonl \
  --machine-id "$(hostname)"
```

3. Optionally include VS Code GitHub Copilot Chat debug events:

```bash
npm run datastore:import -- \
  --db-path ~/.copilot/session-store.db \
  --datastore ./datastore/events.jsonl \
  --include-vscode-chat-debug
```

For IDE-only imports that do not use the Copilot CLI session store, provide a
VS Code Copilot Chat log file or directory and skip the session store:

```bash
npm run datastore:import -- \
  --no-session-store \
  --vscode-chat-debug-path ~/.config/Code/User/workspaceStorage \
  --datastore ./datastore/events.jsonl
```

4. Inspect the datastore summary:

```bash
npm run datastore:summary -- \
  --datastore ./datastore/events.jsonl
```

For provenance-oriented analysis, include verbose summary output to see VS Code
path-pattern coverage (for example `logs` vs `workspaceStorage`) and top source
paths by event volume:

```bash
npm run datastore:summary -- \
  --datastore ./datastore/events.jsonl \
  --verbose
```

5. Import selected sessions only:

```bash
npm run datastore:import -- \
  --db-path ~/.copilot/session-store.db \
  --datastore ./datastore/events.jsonl \
  --ids <session-id-1,session-id-2> \
  --machine-id laptop-a
```

## Privacy Defaults

Redaction is on by default. To include source payload copies for debugging, opt in
explicitly:

```bash
npm run datastore:import -- \
  --datastore ./datastore/events.jsonl \
  --include-raw-payload
```

The raw payload copy is still redacted and marked as opt-in in the event privacy
metadata. Use `--no-redact` only for private local debugging when you understand
the sensitivity of the source data.

## Datastore Shape

Each line is one schema-compliant event envelope:

- `eventType`: `sourceEvent`
- `source`: `copilot-session-store` or `vscode`
- `sourceVersion`: adapter/source format label
- `sessionId`: Copilot session ID or stable VS Code Copilot Chat log identifier
- `machineId`: importer-provided or local hostname
- `payload.sourceEventType`: original source event type
- `payload.data`: flexible source event payload
- `facets`: normalized filtering fields

See [Local Source Datastore Spec](../../specs/local-source-datastore.md) and
[Event Schema v1](../../specs/event-schema.md).

## Working Across Machines

Use a stable `--machine-id` for each device or runner. Each machine can import to
its own JSONL file, then files can be concatenated or copied into a shared local
analysis folder because each record carries machine, session, source, and event
identity metadata.

Future work will add duplicate detection, compaction, and indexed sidecars for
larger corpora.

## When To Choose This Path

Choose Standalone Datastore when you need:

- analysis from sessions that already happened
- a durable event corpus across many sessions
- eventual aggregation from many machines
- filtering and reporting before visualization
- no hook setup

Use the Session Dashboard pathway if you only need selected-session JSON exports
for the existing static UI. Use the Hook Pipeline pathway only when you need live
or custom capture.

## Reference Documents

- ADR: [ADR-013: Standalone Local Source Datastore](../../adr/013-standalone-local-source-datastore.md)
- Feature: [Standalone Source Datastore](../../features/standalone-source-datastore.md)
- Spec: [Local Source Datastore](../../specs/local-source-datastore.md)
