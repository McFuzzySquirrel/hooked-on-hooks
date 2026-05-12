# Spec: Local Source Datastore

## Scope

The standalone datastore imports events directly from local source data instead
of relying on hook scripts or live visualization. The first adapter reads
Copilot `session-store.db` metadata plus per-session `session-state/*/events.jsonl`
source logs and writes normalized hybrid events to an append-only JSONL
datastore.

This spec is the data-contract reference for the standalone solution. It is
deliberately independent from live visualization, hook bootstrap, and web UI
runtime assumptions.

## Design Goals

1. **No hooks required** — source data is read after it has already been written
   by Copilot.
2. **Standalone operation** — import, redaction, persistence, and summary work
   from CLI commands without services.
3. **Multi-session and multi-machine ready** — every record carries session,
   machine, source, and event identity metadata.
4. **Filtering-first** — normalized facets support filtering before a UI layer
   exists.
5. **Local privacy defaults** — redaction happens before datastore writes.

## Non-Goals

1. Live visualization over the datastore.
2. Hook script installation.
3. Cloud upload or remote sync.
4. Long-term query/index design.
5. Strong import de-duplication beyond stable event IDs.

## Architecture

```text
┌──────────────────────────────┐
│ ~/.copilot/session-store.db  │
└──────────────┬───────────────┘
               │ session metadata
               ▼
┌─────────────────────────────────────────────┐
│ ~/.copilot/session-state/<id>/events.jsonl  │
└──────────────┬──────────────────────────────┘
               │ source event lines
               ▼
┌─────────────────────────────────────────────┐
│ @visualizer/local-datastore importer        │
│ - parse source line                         │
│ - attach session/machine/source metadata    │
│ - extract normalized facets                 │
│ - redact locally                            │
└──────────────┬──────────────────────────────┘
               │ normalized sourceEvent JSONL
               ▼
┌──────────────────────────────┐
│ ./datastore/events.jsonl     │
└──────────────────────────────┘
```

## Source Adapter: Copilot Session Store

The first adapter reads:

| Source | Purpose |
|--------|---------|
| `session-store.db` | Session ID, repository/workspace context, timestamps |
| `session-state/<session-id>/events.jsonl` | Source event chronology and source payloads |

The importer resolves the source JSONL path relative to the database directory:

```text
dirname(<db-path>)/session-state/<session-id>/events.jsonl
```

## Commands

```bash
npm run datastore:import -- \
  --db-path ~/.copilot/session-store.db \
  --datastore ./datastore/events.jsonl

npm run datastore:summary -- \
  --datastore ./datastore/events.jsonl
```

Use `--ids <session-a,session-b>` to import selected sessions. Use
`--machine-id` and `--user-id` when importing from multiple machines so records
can be grouped later.

### Import Options

| Option | Default | Purpose |
|--------|---------|---------|
| `--db-path <path>` | `~/.copilot/session-store.db` | Local Copilot session database |
| `--datastore <path>` | `./datastore/events.jsonl` | Append-only normalized datastore |
| `--ids <csv>` | all sessions | Limit import to selected session IDs |
| `--machine-id <id>` | local hostname | Stable machine label for aggregation |
| `--user-id <id>` | local username or `unknown` | Optional local user label |
| `--include-raw-payload` | false | Store redacted raw source payload copy |
| `--no-redact` | false | Disable default redaction for private local debugging |

### Summary Output

The summary command reports:

- datastore path
- event count
- session count and IDs
- machine count and IDs
- source count and names
- earliest and latest timestamps

## Privacy defaults

Local redaction is enabled by default before datastore persistence. Raw source
payload copies are excluded by default. If `--include-raw-payload` is provided,
the stored `rawPayload` copy is still locally redacted and marked as opt-in.

Privacy metadata is set on every record:

```json
{
  "classification": "internal",
  "locallyRedacted": true,
  "rawPayloadOptIn": false,
  "retention": "standard"
}
```

If `--include-raw-payload` is used, `rawPayloadOptIn` is true and `rawPayload`
contains only a redacted copy.

## Stored event shape

Each direct source record is stored as `eventType: "sourceEvent"` with:

- stable envelope metadata (`eventId`, source, sourceVersion, user/machine/session
  IDs, repo/workspace identity, timestamp, privacy, schemaVersion)
- flexible source payload in `payload.data`
- original source type in `payload.sourceEventType`
- normalized facets for filtering

This lets the datastore accumulate events across machines and sessions before
any live visualization layer is built on top.

### Example Record

```json
{
  "schemaVersion": "1.0.0",
  "eventId": "stable-uuid",
  "eventType": "sourceEvent",
  "timestamp": "2026-04-20T10:01:00.000Z",
  "sessionId": "session-id",
  "userId": "local-user",
  "machineId": "laptop-a",
  "source": "copilot-session-store",
  "sourceVersion": "session-store-v1",
  "repoPath": "/path/to/repo",
  "workspaceId": "owner/repo",
  "workspacePath": "/path/to/repo",
  "privacy": {
    "classification": "internal",
    "locallyRedacted": true,
    "rawPayloadOptIn": false,
    "retention": "standard"
  },
  "confidence": "exact",
  "facets": {
    "toolCalls": [],
    "modelUsage": [],
    "tokenUsage": [],
    "contextWindow": [],
    "agentActivity": [],
    "subagentActivity": [],
    "debugEvents": [],
    "filesTouched": [],
    "errors": []
  },
  "payload": {
    "sourceEventType": "assistant.message",
    "sourceLine": 12,
    "sourcePath": "/home/user/.copilot/session-state/session-id/events.jsonl",
    "data": {}
  }
}
```

## Facets and Filtering Contract

The importer extracts normalized facets when source fields are available:

| Facet | Source signals |
|-------|----------------|
| `modelUsage` | `data.model`, `data.newModel`, `data.modelMetrics` |
| `tokenUsage` | input/output/total token fields and nested `usage` fields |
| `toolCalls` | `data.toolRequests[]`, `data.toolName`, `data.toolCallId`, `data.success` |
| `subagentActivity` | `toolRequests[].arguments.agentName`, `agent_name`, `name`, or delegation summaries |
| `filesTouched` | `data.filePath` or `data.path` |
| `errors` | source event types containing `error` plus message/code fields |
| `debugEvents` | source event types containing `debug` |

Filtering consumers should prefer facets and envelope metadata over
source-specific `payload.data` parsing.

## Multi-Machine Guidance

Every importer run should use a stable machine label:

```bash
npm run datastore:import -- \
  --machine-id laptop-a \
  --datastore ./datastore/laptop-a.events.jsonl
```

For early aggregation, datastore files can be concatenated because each line is a
self-contained event envelope. Future work will add duplicate detection,
compaction, and optional indexes.

## Error Handling

1. Missing per-session `events.jsonl` files are skipped.
2. Invalid JSONL lines are skipped and counted.
3. Source records that cannot be normalized into schema-compliant events are
   skipped and counted.
4. The summary command ignores malformed datastore lines.

## Related Documents

- [ADR-013: Standalone Local Source Datastore](../adr/013-standalone-local-source-datastore.md)
- [Standalone Datastore Pathway](../pathways/standalone-datastore/README.md)
- [Standalone Source Datastore Feature](../features/standalone-source-datastore.md)
- [Event Schema v1](event-schema.md)
