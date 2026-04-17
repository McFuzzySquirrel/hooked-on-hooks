# 🪝 Vanilla Copilot CLI Hooks

> **These are the simplest possible hook scripts — they log the raw, unmodified
> payloads that Copilot CLI sends on stdin. No transformations, no enrichment,
> no dependencies.**

Use these examples to understand exactly what data Copilot CLI provides out of
the box, before layering on any customization.

For a guided walkthrough of how we transformed these vanilla hooks into the
full-featured visualiser, see the
[From Vanilla to Visualizer tutorial](../../tutorials/from-vanilla-to-visualizer.md).

---

## Quick Start

1. Copy these files into your repository:

```bash
mkdir -p .github/hooks/logs
cp docs/examples/vanilla-hooks/*.sh .github/hooks/
cp docs/examples/vanilla-hooks/*.ps1 .github/hooks/
cp docs/examples/vanilla-hooks/vanilla-hooks.json .github/hooks/
chmod +x .github/hooks/*.sh
```

2. Add the logs directory to `.gitignore`:

```bash
echo ".github/hooks/logs/" >> .gitignore
```

3. Run Copilot CLI in your repo — hooks fire automatically and log to
   `.github/hooks/logs/events.jsonl`.

---

## What Each Hook Receives

Copilot CLI passes a JSON object on **stdin** to each hook script. Here are
the exact shapes for each of the 8 supported hook types.

### `sessionStart`

Fires when a new Copilot CLI session begins or resumes.

**Stdin JSON:**

```json
{
  "timestamp": 1704614400000,
  "cwd": "/path/to/project",
  "source": "new",
  "initialPrompt": "Create a new feature"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | number | Unix timestamp in milliseconds |
| `cwd` | string | Current working directory |
| `source` | string | `"new"`, `"resume"`, or `"startup"` |
| `initialPrompt` | string | The user's initial prompt (if provided) |

**Output:** Ignored.

**Script:** [`session-start.sh`](session-start.sh) /
[`session-start.ps1`](session-start.ps1)

---

### `sessionEnd`

Fires when the session completes or is terminated.

**Stdin JSON:**

```json
{
  "timestamp": 1704618000000,
  "cwd": "/path/to/project",
  "reason": "complete"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | number | Unix timestamp in milliseconds |
| `cwd` | string | Current working directory |
| `reason` | string | `"complete"`, `"error"`, `"abort"`, `"timeout"`, or `"user_exit"` |

**Output:** Ignored.

**Script:** [`session-end.sh`](session-end.sh) /
[`session-end.ps1`](session-end.ps1)

---

### `userPromptSubmitted`

Fires when the user submits a prompt to the agent.

**Stdin JSON:**

```json
{
  "timestamp": 1704614500000,
  "cwd": "/path/to/project",
  "prompt": "Fix the authentication bug"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | number | Unix timestamp in milliseconds |
| `cwd` | string | Current working directory |
| `prompt` | string | The exact text the user submitted |

> ⚠️ **Privacy note:** Prompts may contain sensitive data. Consider redacting
> tokens, credentials, or personal information before persisting.

**Output:** Ignored.

**Script:** [`log-prompt.sh`](log-prompt.sh) /
[`log-prompt.ps1`](log-prompt.ps1)

---

### `preToolUse`

Fires before the agent uses any tool (`bash`, `edit`, `view`, etc.).
This is the most powerful hook — it can **approve or deny** tool execution.

**Stdin JSON:**

```json
{
  "timestamp": 1704614600000,
  "cwd": "/path/to/project",
  "toolName": "bash",
  "toolArgs": "{\"command\":\"rm -rf dist\",\"description\":\"Clean build directory\"}"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | number | Unix timestamp in milliseconds |
| `cwd` | string | Current working directory |
| `toolName` | string | Name of the tool (`"bash"`, `"edit"`, `"view"`, `"create"`, etc.) |
| `toolArgs` | string | JSON string with the tool's arguments |

**Output (optional):**

```json
{
  "permissionDecision": "deny",
  "permissionDecisionReason": "Destructive operations require approval"
}
```

Only `"deny"` is currently processed as a `permissionDecision`. Omit output or
return `"allow"` to let the tool run.

**Script:** [`pre-tool-use.sh`](pre-tool-use.sh) /
[`pre-tool-use.ps1`](pre-tool-use.ps1)

---

### `postToolUse`

Fires after a tool completes — whether it succeeded or failed.

**Stdin JSON:**

```json
{
  "timestamp": 1704614700000,
  "cwd": "/path/to/project",
  "toolName": "bash",
  "toolArgs": "{\"command\":\"npm test\"}",
  "toolResult": {
    "resultType": "success",
    "textResultForLlm": "All tests passed (15/15)"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | number | Unix timestamp in milliseconds |
| `cwd` | string | Current working directory |
| `toolName` | string | Name of the tool that was executed |
| `toolArgs` | string | JSON string with the tool's arguments |
| `toolResult.resultType` | string | `"success"`, `"failure"`, or `"denied"` |
| `toolResult.textResultForLlm` | string | Result text shown to the agent |

**Output:** Ignored.

> **Key insight:** Copilot CLI fires a single `postToolUse` hook for both
> success and failure. Use `toolResult.resultType` to distinguish. The
> visualiser splits this into separate `postToolUse` and `postToolUseFailure`
> events — see the
> [tutorial](../../tutorials/from-vanilla-to-visualizer.md#part-4-synthesizing-events)
> for how and why.

**Script:** [`post-tool-use.sh`](post-tool-use.sh) /
[`post-tool-use.ps1`](post-tool-use.ps1)

---

### `agentStop`

Fires when the main agent has finished responding to your prompt.

**Stdin JSON:**

```json
{
  "timestamp": 1704614800000,
  "cwd": "/path/to/project"
}
```

> ⚠️ **Note:** The `agentStop` payload is **not fully documented** by GitHub.
> The fields shown above are the minimum observed. The raw input is logged in
> the example script so you can inspect whatever additional fields the CLI
> sends in practice.

**Output:** Ignored.

**Script:** [`agent-stop.sh`](agent-stop.sh) /
[`agent-stop.ps1`](agent-stop.ps1)

---

### `subagentStop`

Fires when a sub-agent completes, before returning results to the parent agent.

**Stdin JSON:**

```json
{
  "timestamp": 1704614900000,
  "cwd": "/path/to/project"
}
```

> ⚠️ **Note:** The `subagentStop` payload is **not fully documented** by
> GitHub. The raw input is logged in the example script so you can inspect
> whatever additional fields the CLI sends in practice.

**Output:** Ignored.

**Script:** [`subagent-stop.sh`](subagent-stop.sh) /
[`subagent-stop.ps1`](subagent-stop.ps1)

---

### `errorOccurred`

Fires when an error occurs during agent execution.

**Stdin JSON:**

```json
{
  "timestamp": 1704614800000,
  "cwd": "/path/to/project",
  "error": {
    "message": "Network timeout",
    "name": "TimeoutError",
    "stack": "TimeoutError: Network timeout\n    at ..."
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | number | Unix timestamp in milliseconds |
| `cwd` | string | Current working directory |
| `error.message` | string | Error message |
| `error.name` | string | Error type/name |
| `error.stack` | string | Stack trace (if available) |

**Output:** Ignored.

**Script:** [`error-occurred.sh`](error-occurred.sh) /
[`error-occurred.ps1`](error-occurred.ps1)

---

## Manifest

The [`vanilla-hooks.json`](vanilla-hooks.json) manifest registers all 8 hook
scripts. Place it in `.github/hooks/` and Copilot CLI will discover it
automatically.

---

## What's NOT Here

These vanilla scripts intentionally omit everything the visualiser adds on top:

| Feature | Vanilla | Visualiser |
|---------|---------|------------|
| Raw payload logging | ✅ | ✅ |
| Event schema envelope | ❌ | ✅ — wraps every event in `{ schemaVersion, eventId, eventType, timestamp, sessionId, source, repoPath, payload }` |
| Zod validation | ❌ | ✅ — rejects malformed events |
| Stdin field extraction | ❌ | ✅ — 35-line block extracting 25+ fields with multi-path fallbacks |
| Enriched payloads | ❌ | ✅ — `agentName`, `agentDisplayName`, `taskDescription`, `skillName`, etc. |
| Event type synthesis | ❌ | ✅ — splits `postToolUse` into success/failure; synthesizes `subagentStart` |
| Secret redaction | ❌ | ✅ — API keys, tokens → `[REDACTED]` |
| HTTP forwarding | ❌ | ✅ — optional POST to local ingest service |
| JSONL + replay | Append-only log | ✅ — deterministic state rebuild from log |

To see how each of these features was built on top of the vanilla foundation,
read the [From Vanilla to Visualizer tutorial](../../tutorials/from-vanilla-to-visualizer.md).

---

## Official References

- [Hooks configuration reference](https://docs.github.com/en/copilot/reference/hooks-configuration)
  — complete field definitions and advanced patterns
- [About hooks](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-hooks)
  — hook types, configuration format, and security considerations
- [Using hooks with Copilot CLI](https://docs.github.com/en/copilot/tutorials/copilot-cli-hooks)
  — official tutorial for creating hooks
