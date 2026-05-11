# Spec: Event Schema v1

## Scope

Define the canonical event format for live visualization and replay. The schema
uses a stable envelope plus normalized filtering facets while keeping
source-specific payloads flexible.

## Envelope

Each event record is a single JSON object.

```json
{
  "schemaVersion": "1.0.0",
  "eventId": "uuid",
  "eventType": "preToolUse",
  "timestamp": "2026-04-12T20:55:31.123Z",
  "sessionId": "string",
  "userId": "unknown",
  "machineId": "unknown",
  "source": "copilot-cli",
  "sourceVersion": "unknown",
  "repoPath": "/abs/path/to/repo",
  "workspaceId": "workspace-or-repo-id",
  "workspacePath": "/abs/path/to/workspace",
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
  "rawPayload": {
    "redacted": true,
    "retainedFor": "debug",
    "payload": {}
  },
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
- `userId`
- `machineId`
- `source`
- `sourceVersion`
- `repoPath`
- `workspaceId`
- `privacy`
- `confidence`
- `facets`
- `payload`

Older `1.0.0` logs that do not contain the newer fields are normalized during
ingestion with safe defaults (`unknown` identity, `internal` classification,
empty facets). New emitters should always write the complete envelope.

## Source Adapters

`source` identifies the producer family. Supported values are:

- `copilot-cli`
- `vscode`
- `unknown`

`sourceVersion` identifies the source-side payload version. Payloads remain
source-specific and additive: unknown payload and envelope fields must be
retained by parsers and ignored by consumers that do not understand them.

## Privacy and Local Filtering

The emitter performs local redaction before JSONL persistence or HTTP delivery.
The `privacy` block records the classification and whether local redaction was
applied. Raw or semi-raw payload capture is opt-in only; when enabled,
`rawPayload.payload` must be locally redacted and retained only for replay/debug
use.

Central filtering and analytics may reclassify records later, but central
filtering is not a substitute for local filtering because payloads can contain
prompts, credentials, file paths, or other sensitive data.

## Facets

Facets are normalized indexes extracted from flexible payloads so downstream
filtering does not need to understand every source-specific payload shape:

- `toolCalls`
- `modelUsage`
- `tokenUsage`
- `contextWindow`
- `agentActivity`
- `subagentActivity`
- `debugEvents`
- `filesTouched`
- `errors`

Tool calls are classified rather than modeled as one rigid event shape. Valid
tool categories are:

- `shell_command`
- `editor_action`
- `mcp_tool_invocation`
- `agent_delegation`
- `subagent_task_launch`
- `debug_command`
- `file_mutation`
- `model_function_call`
- `unknown`

Every event and classified facet can carry confidence metadata:

- `exact`
- `inferred`
- `heuristic`
- `unknown`

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
