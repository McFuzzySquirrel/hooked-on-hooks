# Optional Agent Forge / EJS Overlay Integration

This integration is optional and does not affect the base event capture path.

## Fast Start For Existing Multi-Agent Repos

Bootstrap your target repository from this visualizer workspace:

```bash
npm run bootstrap:repo -- /absolute/path/to/target-repo
```

In the target repository:

```bash
chmod +x .visualizer/emit-event.sh
```

Use `.visualizer/emit-event.sh` at lifecycle hook points (session start/end,
tool start/success/failure, subagent start/stop, notifications, errors).

The generated `.visualizer/HOOK_INTEGRATION.md` includes copy/paste examples.

## What It Adds

- Extra context fields in event payloads (for example, journey metadata)
- Better correlation across sessions in downstream analysis

## How It Works

1. Base hook emitter captures canonical events first.
2. If overlay metadata is available, it is merged as optional `ejsMetadata`.
3. If overlay metadata is unavailable, events are emitted normally.

### Overlay Example

When EJS data is available in your orchestrator, include it in payload:

```json
{
	"ejsMetadata": {
		"journeyId": "journey-123",
		"template": "research-and-build"
	}
}
```

## Stability Rule

The canonical event schema remains valid with or without `ejsMetadata`.
