# Tracing Plan: Recommended Path (v2)

This file now has two parts:

1. **Recommended Path (v2)**: the implementation direction aligned with the current event-stream architecture.
2. **Original Draft (Archived)**: the earlier proposal, preserved for reference.

## Recommended Path (v2)

### Why this update

The original draft has strong tracing goals, but several parts conflict with the current
deterministic replay model and cross-platform hook constraints.

Key adjustments in v2:

- Keep JSONL event stream as source of truth for replay.
- Treat local correlation DB as optional and deferred.
- Keep hook scripts fail-safe and lightweight.
- Add tracing metadata incrementally with backward compatibility.

### Design principles

1. **Deterministic first**: identical event sequences must produce identical replay results.
2. **Portable first**: tracing must work across Linux, macOS, and Windows.
3. **Fail-safe hooks**: hook failures must never break host workflows.
4. **Additive rollout**: tracing fields are optional until data quality stabilizes.

### Phase A (Now): Event-Stream Correlation

1. Add optional correlation fields to event schema (for example `traceId`, `spanId`, `parentSpanId`, `toolCallId`).
2. Pass these fields through the emitter when available from hook context/stdin.
3. Keep backward compatibility with historical logs that do not contain these fields.

### Phase B (Next): Ingest Pairing + Deterministic Replay

1. Improve pre/post pairing in ingest and state-machine selectors using deterministic rules.
2. Preserve synthesis ordering guarantees from ADR-006.
3. Add replay diagnostics to show exact-id match vs heuristic pairing.

### Phase C (Later, Optional): Local Correlation Cache

1. Introduce a local SQLite cache only as an optional accelerator.
2. Do not require cache for capture, replay, export, or UI rendering.
3. Keep cache explicitly non-authoritative and regenerable.

### UI rollout plan

1. **Stage 1**: show correlation metadata in inspector when present.
2. **Stage 1**: keep timeline behavior unchanged when metadata is absent.
3. **Stage 2**: add pre/post link affordances and pairing confidence indicators.
4. **Stage 3**: consider advanced trace views only after data quality/performance validation.

### Documentation rollout plan

Update tracing guidance consistently across:

- `docs/tutorials/from-vanilla-to-visualizer.md`
- `docs/tutorials/from-vanilla-to-visualizer/part-1.md`
- `docs/tutorials/from-vanilla-to-visualizer/part-2.md`
- `docs/tutorials/from-vanilla-to-visualizer/part-3.md`
- `docs/tutorials/from-vanilla-to-visualizer/part-4.md`
- `docs/tutorials/from-vanilla-to-visualizer/part-5.md`
- `docs/tutorials/from-vanilla-to-visualizer/part-6.md`
- `docs/hooked-on-hooks.md`
- `docs/specs/event-schema.md`

### UI acceptance criteria

1. Historical logs without trace fields render identically to current behavior.
2. Trace fields are optional; missing fields never block timeline/inspector rendering.
3. Correlation enhancements do not reorder accepted event stream ordering.
4. Replay remains deterministic with and without correlation metadata.
5. New UI cues remain accessible and understandable.

### Documentation acceptance criteria

1. Tutorials, roadmap, specs, and practitioner docs use one consistent tracing stance.
2. Optional/deferred cache is clearly labeled and never presented as required baseline.
3. Runnable examples remain valid in current lab flow.
4. Backward-compatibility messaging is explicit for older logs.

### Not in scope right now

1. Mandatory SQLite-in-hooks implementation.
2. Dependence on unreleased CLI echo-back span semantics.
3. Replacing deterministic ingest synthesis with DB-only lifecycle logic.

### Related ADRs

- [ADR-006: Task postToolUse subagent synthesis](../adr/006-task-posttooluse-subagent-synthesis.md)
- [ADR-007: README quickstart and documentation depth split](../adr/007-readme-quickstart-and-doc-depth-split.md)
- [ADR-008: Tracing, UX, and documentation consolidation](../adr/008-tracing-ux-and-doc-consolidation.md)

### File touch list (implementation)

**Now**

- `shared/event-schema/src/schema.ts`
- `packages/hook-emitter/src/index.ts`
- `shared/state-machine/src` (pairing selectors)
- `docs/specs/event-schema.md`

**Next**

- `packages/web-ui/src` (inspector metadata + correlation cues)
- `docs/features/deterministic-state-engine.md`
- `docs/adr/006-task-posttooluse-subagent-synthesis.md` (cross-links/clarifications)

**Later**

- Optional local cache utilities and related docs

### Verification checklist

1. Replay determinism tests pass for fixtures with and without trace metadata.
2. Historical session fixtures remain compatible.
3. Cross-platform hook behavior remains intact.
4. UI output is stable for old logs and additive for new fields.

### Tracing v2 FAQ

**Do I need SQLite?**
No. Baseline Tracing v2 works from JSONL event streams.

**Will old logs break?**
No. Old logs without correlation fields remain supported.

**Does this require the visualizer app running?**
No. Core validation can be done via JSONL + replay.

**Are trace fields required on every event?**
No. They are optional in early phases.

**Will this change event ordering?**
No. Deterministic accepted-event ordering remains unchanged.

---

## Original Draft (Archived)

### Agent/Tool/Skill Tracing Implementation Strategy

## Problem Statement
Current hooks cannot accurately correlate pre/post tool events or track nested agent/skill lifecycles. Session IDs are unstable, there's no way to match pre→post pairs reliably, and synthetic events (like `subagentStart`) fire at wrong lifecycle points.

## Core Solution: Distributed Tracing Model

### IDs & Hierarchy
```
session_id (stable across entire CLI session)
  ├─ turn_id (stable across one user prompt/response)
  │   ├─ trace_id (one per top-level workflow)
  │   │   ├─ span_id (tool execution)
  │   │   ├─ span_id (agent lifecycle)
  │   │   └─ span_id (skill execution)
  │   └─ ...more spans
```

### Unique Span Model
- **Tool span**: `preToolUse` → `postToolUse` (includes failures)
- **Agent span**: `agentStart` → `agentStop` (or synthetic from task tool launch)
- **Skill span**: `skillStart` → `skillEnd` (distinct from tool span)

---

## Phase 1: Foundation (Must Do First)

### 1.1 Establish Stable Session/Turn/Trace Identity

**Hook: `sessionStart`**
- Generate and persist `session_id` once at start
- Store in `.github/hooks/.session-state` (JSON)
- Capture: `repo_path`, `cwd`, `platform`, `schema_version`

```bash
SESSION_ID="copilot-$(uuidgen)"
echo "{
  \"session_id\": \"$SESSION_ID\",
  \"started_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
  \"repo_path\": \"$REPO_PATH\",
  \"cwd\": \"$CWD\",
  \"schema_version\": \"1.0\"
}" > .github/hooks/.session-state
```

**Hook: `userPromptSubmitted`**
- Generate and persist `turn_id` + `trace_id`
- Store in `.github/hooks/.turn-state` (updated per prompt)

```bash
TURN_ID="turn-$(uuidgen)"
TRACE_ID="trace-$(uuidgen)"
echo "{
  \"turn_id\": \"$TURN_ID\",
  \"trace_id\": \"$TRACE_ID\",
  \"started_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
}" > .github/hooks/.turn-state
```

### 1.2 Create Shared State Database

File: `.github/hooks/.correlation-store.db` (SQLite)

**Tables:**
```sql
-- Static session context (once per session)
CREATE TABLE session_context (
  session_id TEXT PRIMARY KEY,
  started_at TEXT,
  repo_path TEXT,
  cwd TEXT,
  platform TEXT,
  schema_version TEXT
);

-- Per-turn state
CREATE TABLE turn_context (
  turn_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  started_at TEXT,
  FOREIGN KEY (session_id) REFERENCES session_context(session_id)
);

-- Open span tracking (pre → post matching)
CREATE TABLE open_spans (
  span_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  parent_span_id TEXT,
  entity_kind TEXT NOT NULL,  -- 'tool', 'agent', 'skill'
  entity_type TEXT NOT NULL,  -- 'bash', 'task', 'explore', etc.
  entity_id TEXT,             -- agent-42, skill-name, etc.
  tool_name TEXT,
  tool_args_json TEXT,
  task_description TEXT,
  agent_type TEXT,
  started_at TEXT,
  process_id INTEGER,
  status TEXT DEFAULT 'open'
);

-- Completed spans (for analytics after close)
CREATE TABLE closed_spans (
  span_id TEXT PRIMARY KEY,
  session_id TEXT,
  turn_id TEXT,
  trace_id TEXT,
  parent_span_id TEXT,
  entity_kind TEXT,
  entity_type TEXT,
  entity_id TEXT,
  status TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_ms INTEGER,
  error_summary TEXT
);

-- Agent links (for task tool → child agent correlation)
CREATE TABLE agent_links (
  task_span_id TEXT NOT NULL,
  agent_span_id TEXT NOT NULL,
  link_type TEXT,  -- 'launch', 'wait', etc.
  created_at TEXT,
  PRIMARY KEY (task_span_id, agent_span_id)
);
```

---

## Phase 2: Hook Updates

### 2.1 Pre-Tool-Use Hook
```bash
#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)

# Load session/turn/trace context
source .github/hooks/load-context.sh

# Parse input
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName // empty')
TOOL_ARGS=$(echo "$INPUT" | jq -r '.toolArgs // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Extract agent/skill metadata if present
AGENT_NAME=$(echo "$INPUT" | jq -r '.agent_name // .agentName // empty')
TASK_DESC=$(echo "$INPUT" | jq -r '.task_description // .taskDescription // empty')
AGENT_TYPE=$(echo "$INPUT" | jq -r '.toolArgs.agent_type // empty')

# Generate span ID
SPAN_ID="span-$(uuidgen)"

# Determine entity kind (tool vs agent launcher vs skill wrapper)
ENTITY_KIND="tool"
ENTITY_TYPE="$TOOL_NAME"
if [ "$TOOL_NAME" = "task" ]; then
  ENTITY_KIND="agent_launcher"
  ENTITY_TYPE="$AGENT_TYPE"
elif [ "$TOOL_NAME" = "skill" ]; then
  ENTITY_KIND="skill"
  ENTITY_TYPE=$(echo "$INPUT" | jq -r '.toolArgs.skill_name // unknown')
fi

# Store open span
sqlite3 .github/hooks/.correlation-store.db \
  "INSERT INTO open_spans (span_id, session_id, turn_id, trace_id, parent_span_id, entity_kind, entity_type, tool_name, tool_args_json, task_description, agent_type, started_at, process_id, status)
   VALUES ('$SPAN_ID', '$SESSION_ID', '$TURN_ID', '$TRACE_ID', '$PARENT_SPAN_ID', '$ENTITY_KIND', '$ENTITY_TYPE', '$TOOL_NAME', '$TOOL_ARGS', '$TASK_DESC', '$AGENT_TYPE', datetime('now'), $$, 'open');"

# Emit event
PAYLOAD_JSON=$(jq -nc \
  --arg tool "$TOOL_NAME" \
  --arg span "$SPAN_ID" \
  --arg agent "$AGENT_NAME" \
  --arg task "$TASK_DESC" \
  '{toolName:$tool, spanId:$span, agentName:$agent, taskDescription:$task}')

.visualizer/emit-event.sh preToolUse "$PAYLOAD_JSON" "$SESSION_ID"

exit 0
```

### 2.2 Post-Tool-Use Hook
```bash
#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)

# Load session/turn/trace context
source .github/hooks/load-context.sh

TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName // empty')
RESULT_TYPE=$(echo "$INPUT" | jq -r '.toolResult.resultType // empty')
SPAN_ID=$(echo "$INPUT" | jq -r '.spanId // empty')  # Copilot CLI must echo this back

# Fetch open span and compute duration
SPAN_ROW=$(sqlite3 .github/hooks/.correlation-store.db \
  "SELECT span_id, started_at, tool_args_json FROM open_spans WHERE span_id = '$SPAN_ID' AND session_id = '$SESSION_ID'")

if [ -z "$SPAN_ROW" ]; then
  echo "ERROR: No matching open span for $SPAN_ID" >&2
  exit 1
fi

STARTED_AT=$(echo "$SPAN_ROW" | cut -d'|' -f2)
STARTED_TS=$(date -d "$STARTED_AT" +%s)
NOW_TS=$(date +%s)
DURATION_MS=$(( (NOW_TS - STARTED_TS) * 1000 ))

# Move span to closed_spans
sqlite3 .github/hooks/.correlation-store.db \
  "INSERT INTO closed_spans SELECT *, '$RESULT_TYPE' AS status, datetime('now') AS ended_at, $DURATION_MS AS duration_ms, NULL FROM open_spans WHERE span_id = '$SPAN_ID';
   DELETE FROM open_spans WHERE span_id = '$SPAN_ID';"

# Handle task tool → agent correlation
if [ "$TOOL_NAME" = "task" ] && [ "$RESULT_TYPE" = "success" ]; then
  # If Copilot CLI provides child agent_id, link them
  CHILD_AGENT_ID=$(echo "$INPUT" | jq -r '.toolResult.agentId // empty')
  if [ -n "$CHILD_AGENT_ID" ]; then
    sqlite3 .github/hooks/.correlation-store.db \
      "INSERT INTO agent_links VALUES ('$SPAN_ID', '$CHILD_AGENT_ID', 'launch', datetime('now'))"
  fi
fi

# Emit event
PAYLOAD_JSON=$(jq -nc \
  --arg tool "$TOOL_NAME" \
  --arg status "$RESULT_TYPE" \
  --arg span "$SPAN_ID" \
  --arg duration "$DURATION_MS" \
  '{toolName:$tool, status:$status, spanId:$span, durationMs:$duration}')

.visualizer/emit-event.sh postToolUse "$PAYLOAD_JSON" "$SESSION_ID"

exit 0
```

### 2.3 Session-Start Hook
```bash
#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)

SESSION_ID="copilot-$(uuidgen)"
REPO_PATH=$(echo "$INPUT" | jq -r '.repoPath // "."')
CWD=$(echo "$INPUT" | jq -r '.cwd // "."')
TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')

# Initialize correlation DB
sqlite3 .github/hooks/.correlation-store.db < .github/hooks/schema.sql

# Store session context
sqlite3 .github/hooks/.correlation-store.db \
  "INSERT INTO session_context (session_id, started_at, repo_path, cwd, platform, schema_version)
   VALUES ('$SESSION_ID', '$TIMESTAMP', '$REPO_PATH', '$CWD', '$(uname -s)', '1.0');"

# Persist session ID for child hooks
echo "SESSION_ID=$SESSION_ID" > .github/hooks/.session-state
echo "STARTED_AT=$TIMESTAMP" >> .github/hooks/.session-state

export COPILOT_SESSION_ID="$SESSION_ID"

# Emit event
PAYLOAD_JSON=$(jq -nc \
  --arg session "$SESSION_ID" \
  '{sessionId:$session}')

.visualizer/emit-event.sh sessionStart "$PAYLOAD_JSON" "$SESSION_ID"

exit 0
```

---

## Phase 3: Analytics Layer

### 3.1 Query: All Tools in an Agent Trace
```sql
SELECT 
  cs.span_id,
  cs.entity_type AS tool_name,
  cs.started_at,
  cs.duration_ms,
  cs.status
FROM closed_spans cs
WHERE cs.trace_id = 'trace-123'
  AND cs.entity_kind = 'tool'
ORDER BY cs.started_at;
```

### 3.2 Query: Tool Failure with Full Args
```sql
SELECT 
  cs.span_id,
  cs.entity_type,
  cs.status,
  json_extract(cs.tool_args_json, '$') AS tool_args
FROM closed_spans cs
WHERE cs.session_id = 'session-456'
  AND cs.entity_kind = 'tool'
  AND cs.status IN ('failure', 'denied')
ORDER BY cs.ended_at DESC;
```

### 3.3 Query: Agent Launcher → Child Agent Correlation
```sql
SELECT 
  cs.span_id AS task_span,
  al.agent_span_id,
  cs.duration_ms AS task_duration_ms
FROM closed_spans cs
LEFT JOIN agent_links al ON cs.span_id = al.task_span_id
WHERE cs.entity_kind = 'agent_launcher'
  AND cs.trace_id = 'trace-789';
```

### 3.4 Query: Find Orphaned Spans (Missing Start or End)
```sql
SELECT span_id, entity_kind, entity_type, status
FROM open_spans
WHERE (julianday('now') - julianday(started_at)) > 1  -- > 1 day old
ORDER BY started_at DESC;
```

---

## Phase 4: Copilot CLI Changes (Out of Scope)

For full correlation, Copilot CLI should:
- Accept and echo back `span_id` in `postToolUse` payload
- Expose `agentId` when `task` tool creates child agent
- Propagate `COPILOT_TRACE_ID` / `COPILOT_PARENT_SPAN_ID` environment variables into child agents

Until then, we correlate by strict pre→post ordering + SQLite state.

---

## Implementation Checklist

- [ ] Create `schema.sql` (SQL table definitions)
- [ ] Create `load-context.sh` (load session/turn IDs from persistent state)
- [ ] Update `sessionStart.sh` to initialize DB and persist session ID
- [ ] Update `userPromptSubmitted.sh` to create turn/trace context
- [ ] Update `preToolUse.sh` to generate spans and store in DB
- [ ] Update `postToolUse.sh` to close spans and compute duration
- [ ] Add `.github/hooks/.session-state` to `.gitignore`
- [ ] Add `.github/hooks/.correlation-store.db` to `.gitignore`
- [ ] Create analytics queries reference doc
- [ ] Test with parallel tool execution
- [ ] Test with nested agent (task → subagent) execution
- [ ] Add orphan cleanup on `sessionEnd`

---

## Testing Scenarios

1. **Simple tool execution**: bash echo, verify pre→post pairing and duration
2. **Nested agents**: task tool spawns explore agent, verify agent_links table
3. **Tool failure**: verify tool_args preserved in closed_spans via open_spans lookup
4. **Concurrent tools**: run multiple parallel tools, verify no span ID collisions
5. **Session timeout**: kill CLI mid-execution, verify orphan spans detected
6. **Query validation**: run all analytics queries, verify results match expected tree
