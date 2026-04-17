# Spec: Event Schema v1

## Scope

Define the canonical event format for live visualization and replay.

## Envelope

Each event record is a single JSON object.

```json
{
  "schemaVersion": "1.0.0",
  "eventId": "uuid",
  "eventType": "preToolUse",
  "timestamp": "2026-04-12T20:55:31.123Z",
  "sessionId": "string",
  "source": "copilot-cli",
  "repoPath": "/abs/path/to/repo",
  "turnId": "turn-optional",
  "traceId": "trace-optional",
  "spanId": "span-optional",
  "parentSpanId": "span-parent-optional",
  "payload": {}
}
```

## Required Fields

- `schemaVersion`
- `eventId`
- `eventType`
- `timestamp`
- `sessionId`
- `source`
- `repoPath`
- `payload`

## Optional Correlation Fields (Tracing v2 Phase A)

The following envelope fields are optional and additive:

- `turnId`: stable identifier for one prompt/response turn
- `traceId`: stable identifier for one top-level workflow within a session
- `spanId`: optional span identifier for the current event
- `parentSpanId`: optional parent span for nested execution

Backward compatibility rule:

1. Events without these fields remain valid.
2. Replay/rendering must behave identically for logs that do not include them.

## Event Types (MVP)

### Copilot CLI Hook Types (8)

These correspond to real Copilot CLI hooks that fire during agent sessions:

1. `sessionStart`
2. `sessionEnd`
3. `userPromptSubmitted`
4. `preToolUse`
5. `postToolUse`
6. `subagentStop`
7. `agentStop`
8. `errorOccurred`

### Internal / Synthesized Event Types (3)

These are valid event types in the schema but are NOT triggered directly by
Copilot CLI hooks. They are synthesized from other hooks or reserved for
future use:

9. `postToolUseFailure` — synthesized from `postToolUse` when
   `toolResult.resultType` is `"failure"` or `"denied"`
10. `subagentStart` — synthesized from `task` `postToolUse` / `postToolUseFailure`
  when `toolArgs.agent_type` (or fallback identity fields) is present
11. `notification` — reserved for future use; no CLI hook exists

See: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-hooks

## Payload Shapes

### `preToolUse`

```json
{
  "toolName": "bash",
  "toolArgs": {"command": "npm test"},
  "toolCallId": "call-optional"
}
```

`toolCallId` is optional and used for stronger pre/post correlation when available.

### `postToolUse`

```json
{
  "toolName": "bash",
  "status": "success",
  "durationMs": 742,
  "toolCallId": "call-optional"
}
```

### `postToolUseFailure`

```json
{
  "toolName": "bash",
  "status": "failure",
  "durationMs": 310,
  "errorSummary": "exit code 1",
  "toolCallId": "call-optional"
}
```

### `subagentStart`

```json
{
  "agentName": "Explore",
  "agentDisplayName": "Explore",
  "agentDescription": "Codebase exploration",
  "taskDescription": "Inspect subagent lifecycle",
  "message": "Starting Explore",
  "summary": "Starting Explore"
}
```

`taskDescription`, `message`, and `summary` are optional compatibility fields for integrations that can provide richer active-subagent context at start time.

Current ingest synthesis heuristic:

1. On `task` `postToolUse` / `postToolUseFailure`, if `toolArgs.agent_type` (or fallback fields like task name) is present, emit synthesized `subagentStart`.
2. On `agentStop`, emit synthesized `subagentStop` for the active synthesized subagent lane.
3. If a different task agent appears while one is active, close previous lane first, then start the new one.

### `notification`

```json
{
  "notificationType": "agent_completed",
  "title": "Agent completed",
  "message": "Explore finished"
}
```

## Renderer State Mapping

1. `sessionStart` -> `idle`
2. `preToolUse` -> `tool_running`
3. `postToolUse` -> `tool_succeeded`
4. `postToolUseFailure` or `errorOccurred` -> `error`
5. `subagentStart` -> `subagent_running`
6. `subagentStop` or `agentStop` -> `idle`

## Versioning Rules

1. Additive field changes: minor version bump.
2. Breaking payload changes: major version bump.
3. Deprecated fields: keep for one major release with fallback mapping.