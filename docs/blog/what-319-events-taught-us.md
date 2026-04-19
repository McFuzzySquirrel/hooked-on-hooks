# What 319 Events Taught Us About Multi-Agent Sessions

*A deep dive into real-world Copilot CLI multi-agent behavior — and how we rebuilt our visualizer to match reality.*

---

## The Experiment

We set out to build a visualizer for GitHub Copilot CLI agent activity. We
modelled sessions as linear sequences: one tool runs, it finishes, the next
one starts. It made sense. It tested well. It was wrong.

To find out *how* wrong, we captured every event from a real 84-minute
multi-agent session — 319 events across 6 user turns, 3 subagent launches,
and 153 tool calls. Then we fed them into our state machine and watched what
broke.

This post is about what we found and what we changed.

---

## Finding 1: Tools Run in Parallel (A Lot)

Our state machine tracked `currentTool: ToolInfo | null`. One tool at a time.
Clean, simple, and completely wrong.

In reality, 39 separate batches of 2–5 tools fired within 3-second windows:

```
15:45:12.100  preToolUse → report_intent
15:45:12.200  preToolUse → glob
15:45:12.300  preToolUse → glob
15:45:12.400  preToolUse → glob
15:45:12.500  preToolUse → glob
```

Five concurrent tools. Our reducer kept only the last one. Four vanished.

**The fix:** Replace the single `currentTool` with `activeTools: Record<string,
ToolInfo>` keyed by `eventId`. Tool pairing in the reducer now mirrors our
query layer: match by `toolCallId` first, fall back to FIFO by tool name.

---

## Finding 2: Subagent Metadata Is (Mostly) Empty

We expected `subagentStop` events to carry summaries, results, and agent
names. Here's what we actually got:

```json
{
  "eventType": "subagentStop",
  "payload": {
    "summary": "",
    "result": "",
    "message": "",
    "description": ""
  }
}
```

Every field empty. And `agentStop` events? `agentName: "unknown"`. Every time.

The *only* place with useful identity was the `task` `preToolUse` payload:

```json
{
  "toolName": "task",
  "toolArgs": {
    "agent_type": "ui-engineer",
    "name": "f1-rocket-sprite",
    "description": "Implement the rocket sprite..."
  }
}
```

**The fix:** The ingest service now extracts `agentType` from `toolArgs` and
prefers the instance `name` over the category `agent_type` for display. Our
existing `subagentStart` synthesis (from `task` `postToolUse`) turned out to
be the right approach all along — the real data confirmed it.

---

## Finding 3: Intent Tells the Story

We almost overlooked `report_intent`. It's not in the event schema — it
arrives as a regular `preToolUse` with `toolName: "report_intent"`. But the
16 intent calls in our session traced the entire workflow arc:

```
Building feature PRD →
Analyzing project context →
Drafting feature PRD →
Invoking agent team builder →
Updating affected agent files →
Executing Phase F1 tasks →
Committing and pushing F1
```

This is the session's narrative. Without it, you see 319 events. With it, you
see seven phases.

**The fix:** When the reducer sees `toolName === "report_intent"`, it extracts
`toolArgs.intent` into a new `currentIntent` field. The UI can render this as
a breadcrumb, phase label, or timeline annotation.

---

## Finding 4: Not All Waiting Is Idle

Our visualizer had two modes: "running" and "idle." But the real session had
at least three distinct wait states:

| Wait Type | Example Tool | Duration | What's Happening |
|-----------|-------------|----------|-----------------|
| User input | `ask_user` | 122s | Human is reading and typing |
| Agent poll | `read_agent` | 30–70s | Subagent is working, main agent is polling |
| True idle | *(gap)* | 37 min | User walked away |

These feel completely different to a human watching the dashboard, but they
all showed up as the same blank "idle" state.

**The fix:** Two new visualization states — `waiting_for_user` and
`waiting_for_agent` — with distinct visual treatment. True idle remains idle.

---

## Finding 5: Turns Tell You Where to Look

Six user prompts created six turns. Their sizes:

| Turn | Events | Character |
|------|--------|-----------|
| 1 | 77 | Heavy exploration (27 views, 4 globs) |
| 2 | 6 | Quick show |
| 3 | 64 | Bulk edits (14 edits, 3 bash) |
| 4 | 10 | Commit |
| 5 | 149 | Multi-agent orchestration (3 tasks, 8 reads) |
| 6 | 13 | Cleanup |

Turn 5 is where the interesting multi-agent coordination lives. Without turn
boundaries, it's buried in a flat list of 319 events.

**The fix:** `userPromptSubmitted` now increments `turnCount` and records
`currentTurnStartTime` in the state. The UI can group and label by turn.

---

## Finding 6: Two Tools Never Came Home

153 `preToolUse` events. 151 `postToolUse` events. Two orphans — a `create`
and an `edit` that started but never finished (no error event either).

Our state machine had no concept of orphaned tools. They'd sit in
`currentTool` forever, blocking any further state transitions.

**The fix:** On `sessionEnd`, the reducer clears all remaining `activeTools`
and increments `orphanedToolCount`. The UI can flag these as "status unknown"
rather than pretending they succeeded.

---

## The Numbers After

All changes validated against the real dataset and synthetic fixtures:

| Metric | Before | After |
|--------|--------|-------|
| Tests | 205 | 258 |
| Test files | 12 | 13 |
| Reducer coverage | ~80% | 96.29% |
| Active tool slots | 1 | N (concurrent) |
| Visualization states | 5 | 7 |
| Analytics APIs | 0 | 3 |

---

## What We Learned

The meta-lesson isn't about any specific fix. It's about methodology:

> **Capture real sessions early. Feed them into your pipeline. Let the data
> tell you what your model is missing.**

Our synthetic test fixtures modelled what we *thought* happened during a
Copilot CLI session. The real data showed us what *actually* happens. Every
gap we found — concurrent tools, empty metadata, orphaned events, wait state
ambiguity — was invisible in our hand-crafted test events.

A single 84-minute recording exposed 11 implementation gaps. That's a better
ROI than any amount of spec-reading or assumption-based testing.

If you're building tools that process agent event streams, start with real
data. You'll be surprised how wrong your model is.

---

## Try It Yourself

The Copilot Activity Visualiser is open-source. To capture your own session
data:

```bash
# Clone and bootstrap
git clone https://github.com/McFuzzySquirrel/hooked-on-hooks
cd hooked-on-hooks && npm install

# Bootstrap your target repo
npm run bootstrap:repo -- /path/to/your-repo --create-hooks

# Run a Copilot CLI session in your repo — events are captured automatically
# View the live dashboard
npm run dev
```

See the [README](../README.md) for the full quickstart, or read
[Hooked on Hooks](hooked-on-hooks.md) for the complete guide from first
principles to production patterns.

---

## References

- [ADR-011: Multi-Agent Session Improvements](adr/011-multi-agent-session-improvements.md)
- [Multi-Agent Session Event Analysis](research/multi-agent-session-event-analysis.md)
- [Implementation Tasks](research/multi-agent-session-implementation-tasks.md)
- [Hooked on Hooks Guide — Lesson 10](hooked-on-hooks.md)

---

*Built with 🪝 hooks, 📊 real data, and the humility to admit our tests were lying to us.*
