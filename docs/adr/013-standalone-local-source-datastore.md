# ADR-013: Standalone Local Source Datastore

- Status: Accepted
- Date: 2026-05-11

## Context

The project started with a hook-oriented capture model: hook scripts emitted
normalized events, an ingest service processed them, and the web UI rendered live
or replayed state. That model is useful for live observability and custom
experiments, but it is not the right default for retrospective analysis.

Copilot already stores source data locally:

1. Session metadata in `~/.copilot/session-store.db`.
2. Source event streams in `~/.copilot/session-state/<session-id>/events.jsonl`.
3. GitHub Copilot Chat debug logs in VS Code log directories for IDE chat sessions.

Those records contain the raw material needed for filtering, analysis, model and
token review, tool activity inspection, and eventual cross-machine aggregation.
Requiring hook setup before data exists adds unnecessary friction and can miss
sessions that have already completed.

The next product direction is standalone and datastore-first:

1. Import from local source data directly.
2. Normalize into a durable datastore.
3. Apply filtering and analysis over the datastore.
4. Defer live visualization until the event corpus and datastore contracts are
   stable.

## Decision

Adopt a standalone local source datastore as the primary ingestion direction.

### 1) Direct Source Ingestion

The first source adapter reads Copilot session-store data directly:

- `session-store.db` supplies session/repository/workspace context.
- `session-state/*/events.jsonl` supplies source event chronology.
- Hook registration is not required for this workflow.

An additional VS Code source adapter imports GitHub Copilot Chat debug log lines
as `source: "vscode"` records, so IDE chat sessions can be captured alongside
CLI sessions in the same append-only datastore.

### 2) Durable Append-Only Datastore

Imported events are written to an append-only local JSONL datastore. The datastore
is designed to accumulate:

- many sessions
- many source event types
- many machines
- repeated imports from different local environments

Each record uses the shared event envelope with `source: "copilot-session-store"`
and `eventType: "sourceEvent"` so downstream filtering can operate on stable
metadata and facets while preserving flexible source data.

### 3) Filtering Before Visualization

Filtering, summaries, and reporting are datastore concerns. Live visualization is
explicitly deferred until direct ingestion and datastore semantics are stable.

### 4) Privacy-Safe Defaults

Local redaction runs before persistence by default. Raw payload copies are
excluded by default and only stored when explicitly requested; even then, the
stored copy is redacted and marked as opt-in.

### 5) Hooks Become Optional / Legacy Integration Path

Hook tooling remains available for live/custom capture needs, but it is not the
default path for the standalone datastore solution.

## Rationale

1. Existing local data is richer and more complete than hook-only records for
   already-completed sessions.
2. Direct ingestion reduces setup friction and avoids target-repository mutation.
3. A datastore-first model is better suited for future multi-machine analysis.
4. Stable event/facet contracts can serve CLI summaries, filters, exports, and
   future UI layers without coupling to live rendering.
5. Privacy boundaries are easier to reason about when import, redaction, and
   persistence happen in one local workflow.

## Consequences

### Positive

1. Operators can analyze historical sessions without hook setup.
2. The project gets a standalone data layer independent of live services.
3. Multi-machine and multi-session aggregation has a clear storage target.
4. Filtering can be implemented over normalized facets instead of source-specific
   payload parsing in every consumer.
5. Live visualization can later consume a mature datastore instead of driving the
   ingestion design.

### Negative

1. Documentation must clearly distinguish standalone datastore, static dashboard,
   and hook pipeline workflows.
2. The source adapter must track Copilot local storage shape changes.
3. Append-only JSONL is simple but may eventually need indexing or compaction.
4. Duplicate imports need a future reconciliation policy beyond stable event IDs.

## Alternatives Considered

### A) Continue hooks as the primary ingestion path

Rejected for the standalone solution because hooks require setup, only observe
future activity, and prioritize live event flow over complete local source data.

### B) Extend the static dashboard exporter only

Rejected because exporter JSON is useful for viewing selected sessions but does
not provide a durable multi-session/multi-machine event datastore.

### C) Build live visualization directly on source data first

Rejected because live rendering should not drive datastore design. The data model
and filtering semantics should stabilize before a live UI is layered on top.

### D) Use SQLite as the first normalized datastore

Deferred. SQLite is attractive for querying and indexing, but JSONL keeps the
initial datastore append-only, inspectable, portable, and easy to merge across
machines.

## Follow-Up Actions

1. Add datastore filtering/query commands over normalized facets.
2. Add import deduplication and optional compaction/indexing.
3. Add additional source adapters if Copilot local storage shape evolves.
4. Revisit live visualization once the datastore contains enough events for
   replay, filtering, and cross-session analysis.
5. Update public docs to route new users to the standalone datastore workflow
   before hook-based workflows.

## References

- `docs/specs/local-source-datastore.md`
- `docs/pathways/standalone-datastore/README.md`
- `docs/features/standalone-source-datastore.md`
- `scripts/ingest-source-datastore.ts`
- `packages/local-datastore/src/index.ts`
- `shared/event-schema/src/schema.ts`
