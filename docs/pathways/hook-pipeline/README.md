# Hook Pipeline Pathway (Live Capture)

Use this pathway when you want real-time event capture from a target repository using Copilot CLI hooks.

## What This Pathway Is For

The hook pipeline is the integration-oriented path:

- capture custom hook events as work happens
- enrich payloads at source
- stream or replay event logs into visual analysis
- validate schema and state transitions end-to-end

This is the right choice when you need live observability or when local session-store fields are not enough for your use case.

## Core Capabilities

- Bootstrap and wire hook scripts into an existing repo
- Canonical hook manifest under `.github/hooks/visualizer/visualizer-hooks.json`
- Structured event emission with validation
- Replay from JSONL when ingest is offline
- Optional generated hook stubs (`--create-hooks`)

## Quickstart

1. Bootstrap a target repo:

```bash
npm run bootstrap:repo -- /absolute/path/to/target-repo --create-hooks
```

2. Start ingest service (if using live path):

```bash
npm run serve:ingest
```

3. Run your target repo workflow so hooks emit events.

4. If needed, replay captured JSONL later:

```bash
npm run replay:jsonl -- /path/to/target-repo/.visualizer/logs/events.jsonl
```

## Detailed Guides

- Vanilla examples: [docs/examples/vanilla-hooks/README.md](../../examples/vanilla-hooks/README.md)
- End-to-end tutorial: [docs/tutorials/from-vanilla-to-visualizer.md](../../tutorials/from-vanilla-to-visualizer.md)
- PowerShell variant: [docs/tutorials/from-vanilla-to-visualizer-ps1.md](../../tutorials/from-vanilla-to-visualizer-ps1.md)
- Integration notes: [docs/integrations/hooked-on-hooks-ejs-overlay.md](../../integrations/hooked-on-hooks-ejs-overlay.md)

## When To Choose This Path

Choose Hook Pipeline when you need:

- live operational visibility while sessions are running
- event fields beyond what session-store exports provide
- per-repository hook customization and experimentation

Use the Session Dashboard path if you want immediate analysis with no hook setup.
