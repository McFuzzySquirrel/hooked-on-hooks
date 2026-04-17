# 🪝 Hooked on Hooks

> **A practical guide to GitHub Copilot CLI hooks — what they are, why they matter, and how we used them to build a full activity visualiser.**

---

## What Even Are Hooks?

If you've used Git, you've probably bumped into hooks before — those little scripts
in `.git/hooks/` that fire when you commit, push, or rebase. GitHub Copilot CLI hooks
follow the same philosophy but for **AI agent lifecycles**.

Think of hooks as tiny tripwires. An agent starts a session? *Trip.* A tool gets
invoked? *Trip.* Something blows up? *Trip.* Each time a hook fires, you get a
chance to do something useful with that moment — log it, visualize it, phone home,
or just quietly take notes.

The big idea: **hooks give you observability without modifying the thing you're observing.**

---

## The Hook Lifecycle (a.k.a. "The Circle of Agent Life")

Here are the lifecycle events that Copilot CLI hooks can capture. We used every
single one of these in this project:

| Event | When It Fires | What You Learn |
|-------|--------------|----------------|
| `sessionStart` | A Copilot CLI session begins | Who started what, and when |
| `sessionEnd` | The session wraps up | Duration, exit status |
| `userPromptSubmitted` | The user sends a prompt | What the human asked for |
| `preToolUse` | Right before a tool runs | Which tool, what arguments |
| `postToolUse` | Tool finishes (success or failure) | Duration, result status |
| `subagentStop` | A sub-agent finishes | Agent name, clean exit or not |
| `agentStop` | The main agent stops | Overall session conclusion |
| `errorOccurred` | Something goes wrong | Error details for debugging |

These are the **8 real Copilot CLI hook types**. The visualiser also supports
additional *internal* event types that are synthesized from the hooks above:

| Internal Event | How It's Produced | What It Represents |
|----------------|-------------------|--------------------|
| `postToolUseFailure` | Synthesized from `postToolUse` when `toolResult.resultType` is `"failure"` or `"denied"` | A tool that finished with an error |
| `subagentStart` | Synthesized from `task` tool completions (`postToolUse`/`postToolUseFailure`) when `toolArgs.agent_type` (or fallback task identity fields) is present | A sub-agent lane starting from task-dispatch metadata |
| `notification` | Not currently triggered by any CLI hook | Informational notifications (reserved for future use) |

In current integrations, we treat `agentStop` as the natural close signal for that synthesized sub-agent lane.

See [ADR-006](adr/006-task-posttooluse-subagent-synthesis.md) for the
heuristic change rationale and lifecycle timing details.

> **Pro tip:** You don't need all of these. Start with `sessionStart`, `preToolUse`,
> `postToolUse`, and `errorOccurred`. That alone gives you a surprisingly complete
> picture of what happened during a run.

---

## What We Built (And What We Learned)

If you want the step-by-step, hands-on path first:

- [Tutorial Index](./tutorials/README.md) — choose Bash/Linux or PowerShell and jump to any part.
- [From Vanilla to Visualizer (Bash/Linux)](./tutorials/from-vanilla-to-visualizer.md)
- [From Vanilla to Visualizer (PowerShell)](./tutorials/from-vanilla-to-visualizer-ps1.md)
- [Vanilla Hook Examples](./examples/vanilla-hooks/README.md)

This project — the **Copilot Activity Visualiser** — is a real-world example
of hooks in action. Here's the architecture in a nutshell:

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌────────────┐
│ Copilot CLI  │────▶│ Hook Emitter │────▶│ Ingest Service  │────▶│  Web UI    │
│  (hooks)     │     │ (JSONL +     │     │ (Fastify +      │     │ (React +   │
│              │     │  optional    │     │  state machine) │     │  Vite)     │
│              │     │  HTTP POST)  │     │                 │     │            │
└─────────────┘     └──────────────┘     └─────────────────┘     └────────────┘
```

**The flow:**
1. Copilot CLI fires a lifecycle hook (e.g., "I'm about to run `bash`").
2. Our **hook emitter** validates the event against a strict schema, redacts
   secrets, and writes it to a JSONL log file. Optionally, it also POSTs it
   to a local HTTP endpoint.
3. The **ingest service** picks up events and feeds them through a deterministic
   state machine that tracks session, tool, and sub-agent states.
4. The **web UI** renders the live state as a dark-themed dashboard featuring a
   Gantt chart timeline with idle gap visualization, lane-based activity board
   with pulsing status indicators, and event inspector with auto-scrolling event
   list — and supports replay with timeline scrubbing and a header mode badge.

### Lesson 1: Schema First, Always

We defined a canonical [event schema](specs/event-schema.md) before writing a
single line of hook code. Every event shares a common envelope:

```json
{
  "schemaVersion": "1.0.0",
  "eventId": "uuid",
  "eventType": "preToolUse",
  "timestamp": "2026-04-12T20:55:31.123Z",
  "sessionId": "abc-123",
  "source": "copilot-cli",
  "repoPath": "/path/to/repo",
  "payload": { }
}
```

**Why this matters:** Without a schema, every consumer of your events has to guess
what fields exist. With a schema, you get validation for free (we used Zod),
you catch bad events before they corrupt your state, and you can evolve the
format safely using semver rules.

### Lesson 2: Fail Safe, Not Loud

Hooks run *inside* your agent's lifecycle. If a hook crashes, it can take the
whole session with it. Our emitter wraps HTTP delivery in a try/catch that
silently swallows connection errors:

```typescript
// HTTP delivery is best-effort. The event is already written to JSONL.
// Suppress connection errors so the emitter never crashes hook scripts.
```

**The golden rule:** A hook should *never* break the thing it's observing.
Log the failure, sure. But don't throw. Don't exit. Don't panic.

### Lesson 3: JSONL Is Your Best Friend

We chose [JSONL](https://jsonlines.org/) (newline-delimited JSON) as the primary
persistence format. Why?

- **Append-only** — just slam lines onto the end of a file. No locking headaches.
- **Streamable** — you can tail the file and process events as they arrive.
- **Recoverable** — if the ingest service is down, events pile up in the file
  and you replay them later.
- **Human-readable** — open it in any text editor and you can see exactly what
  happened.

### Lesson 4: Redact Before You Persist

Hooks see *everything*. Tool arguments, file paths, environment variables — all of
it flows through. If you're persisting events, you need to strip secrets *before*
they hit the log file:

- API keys and tokens → `[REDACTED]`
- Prompt bodies → opt-in only (off by default)
- Sensitive command arguments → suppressed or transformed

**The default must be safe.** Operators should have to *opt in* to storing sensitive
data, never *opt out*.

### Lesson 5: Bootstrap Should Be One Command

We invested heavily in making integration painless. Running:

```bash
npm run bootstrap:repo -- /path/to/your-repo --create-hooks
```

... generates all the hook scripts, the emitter, the config file, and wires
everything together. No manual `chmod`, no manual plumbing, no "go read the
docs for 30 minutes" — just run the command and you're live.

**Lesson:** If your hook system requires a 15-step setup guide, nobody will use it.

### Lesson 6: Declare What You Need in a Manifest

Early on, our bootstrap relied entirely on shell-script discovery — scan
`.github/hooks/` for files named `session-start.sh`, `pre-tool-use.sh`, etc.,
and wire each one. This had two problems:

1. **Silent gaps.** If a script didn't exist and `--create-hooks` wasn't passed,
   the event type was silently uncovered. We shipped with only 7 of 11 event
   types in the `HOOK_MAP` for weeks before anyone noticed.
2. **No inspectable contract.** There was no single file that answered "which
  events does the visualiser capture?" You had to reverse-engineer it from
   individual scripts or source code.

We fixed both by introducing a **dedicated manifest** —
`.github/hooks/visualizer/visualizer-hooks.json` — that bootstrap always creates. It
declares every covered event type with its corresponding hook command:

```json
{
  "version": 1,
  "description": "Auto-generated by Copilot Activity Visualiser bootstrap.",
  "hooks": {
    "sessionStart": [{ "type": "command", "bash": "./.github/hooks/visualizer/session-start.sh", "cwd": ".", "timeoutSec": 15 }],
    "preToolUse":   [{ "type": "command", "bash": "./.github/hooks/visualizer/pre-tool-use.sh",  "cwd": ".", "timeoutSec": 10 }],
    "errorOccurred":[{ "type": "command", "bash": "./.github/hooks/visualizer/error-occurred.sh", "cwd": ".", "timeoutSec": 10 }]
  }
}
```

*(Truncated for brevity — the real manifest lists all 8 supported Copilot CLI hook types.)*

**Why this matters:**

- **Single source of truth.** Anyone — human or tool — can read one file to
  understand the visualiser's surface area.
- **Committable to version control.** The manifest shows up in code review,
  making the hook contract visible to the team.
- **Unbootstrap-safe.** Removing integration is as clean as deleting the
  `visualizer/` subdirectory. User-managed manifests (like `ejs-hooks.json`) are handled
  separately and never deleted — only patched.
- **Eliminates silent gaps.** The manifest is always generated for all covered
  events, even when no shell scripts exist yet.

**Lesson:** Manifests turn implicit wiring into an explicit, inspectable contract.
If you can `cat` one file to see everything your system hooks into, you've made
debugging and onboarding dramatically easier.

See [ADR-003](adr/003-manifest-first-hook-registration.md) for the full design
rationale.

### Lesson 7: Isolate Generated Hooks in a Subdirectory

Placing generated stubs directly in `.github/hooks/` led to ownership
confusion. User-authored hooks and visualiser-generated stubs lived side by
side with no obvious boundary. When a user already had a `session-start.sh`,
the bootstrap could shadow or skip it — both bad outcomes.

We solved this by putting everything the visualiser generates into
`.github/hooks/visualizer/`:

```
.github/hooks/
├── copilot/              # user-managed hooks (untouched)
│   └── session-start.sh
├── ejs-hooks.json        # third-party manifest (patched, not deleted)
└── visualizer/           # ← all visualiser-generated files
    ├── session-start.sh
    ├── pre-tool-use.sh
    ├── error-occurred.sh
    ├── ...
    └── visualizer-hooks.json
```

**Why this matters:**

- **Clear ownership.** Everything in `visualizer/` is auto-generated. Don't
  manually edit it — it gets overwritten on re-bootstrap.
- **No collisions.** User hooks in `.github/hooks/` or its other subdirectories
  are discovered and wired but never overwritten.
- **Easy cleanup.** Unbootstrap deletes the `visualizer/` directory when empty.
  No per-file guesswork.

**Lesson:** If your tool generates files into a shared directory, carve out a
subdirectory. It makes ownership obvious and cleanup trivial.

See [ADR-004](adr/004-visualizer-hooks-subdirectory.md) for the full design
rationale.

### Lesson 8: Make Idle Visible

When we first built the Gantt chart, it pulsed every open bar continuously.
A session could be idle for 30 seconds between tool invocations and the
timeline looked the same as when it was actively running tools. This made it
impossible to distinguish "working hard" from "waiting for the next prompt."

We fixed this with three changes:

1. **Idle-aware animation.** The `GanttChart` accepts an `isIdle` prop. When
   true, running bars stop pulsing and dim to 50% opacity. When activity
   resumes, the pulse restarts. This means the chart *breathes* with the
   session — active periods pulse, quiet periods go still.

2. **Idle gap segments.** `buildGanttData` tracks the time between tool/subagent
   completions and the next activity. These gaps become dashed, dimmed segments
   on the session row, making idle periods visible at a glance:

   ```
   ┌───────┐╌╌╌╌┌───────┐╌╌╌╌╌╌╌╌╌╌╌╌┌───────┐
   │ Tool A│    │ Tool B│              │ Tool C│
   └───────┘    └───────┘              └───────┘
               idle gap              long idle gap
   ```

3. **Terminal session status.** A completed session's lane now shows "Succeeded"
   instead of the misleading "Idle" — the status is overridden in the
   presentation layer based on lifecycle state, not visualization state.

**Lesson:** Time between events matters as much as the events themselves. If
your visualization doesn't show idle periods, it hides half the story.

See [ADR-005](adr/005-idle-aware-gantt-and-ui-polish.md) for the full design
rationale.
### Lesson 9: Correlate Events Across Turns — Event-Stream First

Once you have a working event pipeline, the next question is: *how do I link a
`preToolUse` to its matching `postToolUse`?* It sounds obvious — just match them
by tool name. But in multi-agent sessions with parallel tool calls, names collide.

Our answer is **event-stream-first correlation**. Instead of reaching for a
database, we added four optional fields to every event envelope:

```json
{
  "eventId": "uuid",
  "eventType": "preToolUse",
  "turnId": "turn-abc",
  "traceId": "trace-xyz",
  "spanId": "span-001",
  "parentSpanId": "span-000",
  "payload": { "toolCallId": "call-42", "toolName": "bash" }
}
```

- **`turnId`** — groups all events within a single user-prompt turn.
- **`traceId`** — links all events that belong to one logical operation chain.
- **`spanId` / `parentSpanId`** — form a span tree within a trace.
- **`toolCallId`** — pairs a `preToolUse` to its exact `postToolUse` even when
  two concurrent calls use the same tool name.

All of these are **optional**. Existing logs without them still replay and
correlate, using a tiered fallback: exact `toolCallId` match → exact `spanId`
match → FIFO heuristic by tool name. This means you can adopt correlation IDs
gradually — emit them from your hooks when you have them; the state machine
handles both cases.

The pairing logic lives in `shared/state-machine/src/queries.ts`
(`pairToolEvents`, `findEventsByTraceId`, `findToolFailures`). The ingest
service exposes a live diagnostic breakdown at `GET /diagnostics/pairing`
that shows how many pairs resolved each way — useful for measuring how much
your hooks are helping.

**The golden rule for correlation:** Keep the IDs in the event stream, not in a
sidecar database. That way, replaying a JSONL log is still all you need to
reconstruct full session context — no external store required.

See [Tracing Plan v2](roadmap/tracing-plan.md) for the full design rationale
and phased rollout plan.
---

## Vanilla vs. Enhanced: What the Visualiser Adds

If you've read this far, you might be wondering: *what do the hooks look like
before all these enhancements?*

We provide a complete set of **vanilla hook examples** that show the raw,
unmodified payloads Copilot CLI sends — no transformations, no enrichment,
no dependencies:

👉 **[Vanilla Hook Examples](examples/vanilla-hooks/README.md)** — 8 minimal
scripts (`.sh` + `.ps1`) that log exactly what the CLI provides.

Here's how the vanilla and enhanced versions compare:

| Feature | Vanilla | Enhanced (Visualiser) |
|---------|---------|----------------------|
| Raw payload logging | ✅ | ✅ |
| Event schema envelope | ❌ | ✅ |
| Zod validation | ❌ | ✅ |
| Stdin field extraction (25+ fields) | ❌ | ✅ |
| Enriched payloads (agent, skill, task context) | ❌ | ✅ |
| Event type synthesis (postToolUseFailure, subagentStart) | ❌ | ✅ |
| Secret redaction | ❌ | ✅ |
| HTTP forwarding to ingest service | ❌ | ✅ |
| Deterministic state rebuild from JSONL | ❌ | ✅ |
| Optional turn/trace/span correlation IDs | ❌ | ✅ |
| Tool-call pairing diagnostics endpoint | ❌ | ✅ |

To understand exactly how we got from vanilla to enhanced, step by step, see
the **[From Vanilla to Visualizer tutorial](tutorials/from-vanilla-to-visualizer.md)**.

You can also generate vanilla hooks directly with the bootstrap command:

```bash
npm run bootstrap:repo -- /path/to/repo --create-hooks --vanilla
```

---

## Best Practices: The Hook Hygiene Checklist

Here's what we wish we knew on Day 1:

### ✅ Do

- **Define your event schema first.** Your schema is the contract between
  producers and consumers. Get it right early.
- **Use a validation layer.** Parse and validate every event before trusting it.
  Malformed events should be rejected gracefully, not silently swallowed.
- **Keep hooks lightweight.** A hook should capture a moment, not *process* it.
  Move heavy logic to downstream services.
- **Write to a local file first.** Network calls fail. Disk usually doesn't.
  Make HTTP delivery a bonus, not a requirement.
- **Make state deterministic.** If you can replay a JSONL log and arrive at the
  exact same state every time, you've won debugging forever.
- **Version your events.** Use semver for your schema. Additive changes are minor
  bumps. Breaking changes are major bumps.
- **Declare your hooks in a manifest.** A single JSON file that lists every event
  type your system captures is easier to review, diff, and automate than a bag of
  scripts.
- **Make idle time visible.** Gaps between events carry information. If your
  visualization skips idle periods, you're hiding half the session's story.
- **Test your hooks in isolation.** Hook logic should be unit-testable without
  spinning up the whole agent runtime.

### ❌ Don't

- **Don't let hooks crash the host.** Your hook is a guest in someone else's
  process. Be polite. Catch your exceptions.
- **Don't log secrets.** If you're not actively redacting, you're actively leaking.
- **Don't assume the network is up.** Design for offline-first. The ingest service
  might be down, and that's fine.
- **Don't block the main process.** If your hook does I/O, make it async. Nobody
  wants their `git commit` to hang because a hook is phoning home.
- **Don't couple tightly to event consumers.** The hook emitter shouldn't know or
  care what the web UI looks like. Schema in, schema out.

---

## Patterns That Worked Well

### The "Emit and Forget" Pattern

```
Hook fires → Validate → Redact → Append to JSONL → (optional) POST to HTTP
```

The key insight: the JSONL file is the source of truth. HTTP delivery is
best-effort. If it fails, the event is still safely persisted. The ingest
service can catch up later by replaying the log.

### The "State Machine Over Event Stream" Pattern

Instead of having the UI query a database, we feed events through a
deterministic state machine:

```
sessionStart → idle
preToolUse   → tool_running
postToolUse  → tool_succeeded → idle
errorOccurred → error
```

This means you can rebuild the entire session state by replaying the event
log from scratch. No database. No cache. Just a pure function from events
to state.

### The "Bootstrap, Don't Configure" Pattern

Rather than asking users to edit config files and wire up hooks manually,
we scan their repo, detect existing hook scripts, and auto-wire integration.
The `--create-hooks` flag generates stub scripts for every lifecycle event.
The `--prefix` flag avoids filename collisions. And bootstrap always creates
a `visualizer-hooks.json` manifest as the canonical declaration of what the
visualiser captures. All generated files live in the `.github/hooks/visualizer/`
subdirectory — no implicit wiring, no silent gaps, no collisions with user hooks.

---

## Hook Integration: A Real Example

Here's what a generated hook script actually does (simplified):

```bash
#!/usr/bin/env bash
# session-start.sh — generated by the visualiser bootstrap

SESSION_ID="${SESSION_ID:-$(uuidgen)}"
REPO_PATH="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

.visualizer/emit-event.sh sessionStart \
  "{\"startedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
  "$SESSION_ID"
```

That's it. Three lines of real logic. The `emit-event.sh` script handles
validation, redaction, JSONL persistence, and optional HTTP forwarding.

---

## When Should You Use Hooks?

Hooks aren't just for building visualisers. Here are some real-world use cases:

| Use Case | What Hooks Enable |
|----------|-------------------|
| **Debugging agent runs** | See exactly which tools were called, in what order, and what failed |
| **Performance monitoring** | Track tool execution durations across sessions |
| **Audit trails** | Keep a tamper-evident log of everything an agent did |
| **Custom dashboards** | Feed events into Grafana, Datadog, or your own UI |
| **Team visibility** | Share session replays with teammates for review |
| **CI/CD integration** | Trigger downstream workflows when agents complete tasks |
| **Cost tracking** | Correlate tool invocations with resource usage |

---

## Official Resources & Further Reading

Want to go deeper? Here are the official sources:

- **[GitHub Copilot documentation](https://docs.github.com/en/copilot)** — the
  comprehensive docs for all things Copilot, including CLI setup and configuration.

- **[GitHub Copilot in the CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli)** —
  official guide to using Copilot from your terminal.

- **[Customizing Copilot coding agent](https://docs.github.com/en/copilot/customizing-copilot/customizing-the-development-environment-for-copilot-coding-agent)** —
  documentation on customizing the Copilot coding agent environment, including
  `copilot-setup-steps.yml` and pre-installed tools.

- **[GitHub Copilot extensibility](https://docs.github.com/en/copilot/building-copilot-extensions)** —
  building extensions and integrations with Copilot.

- **[Git hooks documentation](https://git-scm.com/docs/githooks)** — the OG hook
  system. Understanding Git hooks helps you understand the mental model behind
  agent lifecycle hooks.

- **[JSONL format](https://jsonlines.org/)** — the spec for newline-delimited JSON,
  our persistence format of choice.

- **[Zod documentation](https://zod.dev/)** — the schema validation library we
  used for runtime event validation.

- **[Fastify documentation](https://fastify.dev/)** — the web framework powering
  our local ingest service.

---

## TL;DR

| # | Takeaway |
|---|----------|
| 1 | Hooks give you observability into agent lifecycles without modifying the agent |
| 2 | Define your event schema before you write hook code |
| 3 | Always redact secrets before persisting — defaults must be safe |
| 4 | Never let a hook crash the host process |
| 5 | JSONL is simple, append-only, and recoverable — use it |
| 6 | Deterministic state machines over event streams make replay trivial |
| 7 | One-command bootstrap beats a 15-step setup guide every time |
| 8 | A manifest makes hook wiring explicit, inspectable, and version-controllable |
| 9 | Isolate generated files in a subdirectory — clear ownership, no collisions |
| 10 | Make idle time visible — gaps between events tell as much as the events themselves |
| 11 | Keep hooks lightweight — capture the moment, process it elsewhere |
| 12 | Correlate events in the stream, not in a sidecar DB — replay stays the source of truth |

---

## About This Project

The **Copilot Activity Visualiser** is an open-source project that
demonstrates these patterns in production-quality code. It captures Copilot CLI
activity and renders it as a live dashboard with a Gantt chart timeline,
lane-based activity board, and full session replay.

Check out the [README](../README.md) to get started, or dive into the
[product vision](product-vision.md) for the full story.

---

*Built with 🪝 hooks, ☕ caffeine, and a healthy respect for redaction.*
