# Spec: Local Source Datastore

## Scope

The standalone datastore imports events directly from local source data instead
of relying on hook scripts or live visualization. The first adapter reads
Copilot `session-store.db` metadata plus per-session `session-state/*/events.jsonl`
source logs and writes normalized hybrid events to an append-only JSONL
datastore.

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

## Privacy defaults

Local redaction is enabled by default before datastore persistence. Raw source
payload copies are excluded by default. If `--include-raw-payload` is provided,
the stored `rawPayload` copy is still locally redacted and marked as opt-in.

## Stored event shape

Each direct source record is stored as `eventType: "sourceEvent"` with:

- stable envelope metadata (`eventId`, source, sourceVersion, user/machine/session
  IDs, repo/workspace identity, timestamp, privacy, schemaVersion)
- flexible source payload in `payload.data`
- original source type in `payload.sourceEventType`
- normalized facets for filtering

This lets the datastore accumulate events across machines and sessions before
any live visualization layer is built on top.
