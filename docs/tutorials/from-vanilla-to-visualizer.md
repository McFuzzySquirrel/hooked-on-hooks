# From Vanilla to Visualizer

> **Split tutorial format:** this page is now the landing page for the step-by-step parts.

> **A step-by-step guide showing how we transformed simple Copilot CLI hook
> scripts into a full-featured activity visualiser — and how you can do the
> same.**

This tutorial walks through the transformation journey from bare-minimum
"vanilla" hooks that log raw payloads, all the way to the enriched, validated,
synthesized event pipeline that powers the Copilot Activity Visualiser.

Each part builds on the previous one. By the end, you'll understand every
layer the visualiser adds and *why* it was added, plus exactly what the
default GitHub Copilot hooks capture so you can build your own custom
automation or even create your own visualiser.

Think of this as a hands-on visual learning journey: start with raw hook
payloads, then incrementally shape them into a complete observability
experience.

**Prerequisites:** Familiarity with shell scripting and basic understanding
of how Copilot CLI hooks work. If you're new to hooks, start with the
[vanilla hook examples](../examples/vanilla-hooks/README.md) and the
[official hooks documentation](https://docs.github.com/en/copilot/reference/hooks-configuration).

Using PowerShell instead of bash? See the companion guide:
[From Vanilla to Visualizer (PowerShell)](./from-vanilla-to-visualizer-ps1.md).

Browse all tutorial tracks and parts:
[Tutorial Index](./README.md).

---

## Parts

- [Part 1: Starting from Vanilla](./from-vanilla-to-visualizer/part-1.md)
- [Part 2: Adding Schema & Validation](./from-vanilla-to-visualizer/part-2.md)
- [Part 3: Enriching Payloads](./from-vanilla-to-visualizer/part-3.md)
- [Part 4: Synthesizing Events](./from-vanilla-to-visualizer/part-4.md)
- [Part 5: The Emit Pattern](./from-vanilla-to-visualizer/part-5.md)
- [Part 6: Putting It Together](./from-vanilla-to-visualizer/part-6.md)

## Navigation

- Start here: [Part 1](./from-vanilla-to-visualizer/part-1.md)
- Jump to finale: [Part 6](./from-vanilla-to-visualizer/part-6.md)

## Optional Visualizer Checkpoint (After Any Part)

You can run the visualizer UI after each part to see how your changes affect
live rendering. This is optional; the tutorial itself can be completed with
CLI + JSONL checks only.

1. In the `hooked-on-hooks` repo, start ingest:

  ```bash
  npm run serve:ingest
  ```

2. In a second terminal, start the web UI:

  ```bash
  npm run dev --workspace=packages/web-ui
  ```

3. In `/tmp/copilot-hooks-lab`, run a short Copilot CLI session.

4. Open `http://127.0.0.1:5173` and inspect the latest session.

What you should expect by part:

- **Part 1:** mostly vanilla logs only (`.github/hooks/logs/events.jsonl`), so UI may be sparse
- **Part 2:** envelope-based `preToolUse` events start appearing in `.visualizer/logs/events.jsonl`
- **Part 3:** `preToolUse` payloads include richer context fields when available
- **Part 4:** synthesized `postToolUseFailure` and `subagentStart` can appear
- **Part 5:** JSONL still grows even when HTTP delivery is unavailable
- **Part 6:** full enhanced pipeline is in place end-to-end
- **After Part 6:** the **Tool Pairing** bar in the UI shows how many `preToolUse`→`postToolUse` pairs resolved exactly vs. by heuristic — emit optional `turnId`/`traceId`/`spanId` fields to improve the score

Visual reference for the finished interface:

![Full UI overview after the completed tutorial flow](./assets/tutorial-screenshots/ui-features/ui-overview.png)

If you want a focused tour of each panel, use the
[UI Feature Showcase](./ui-feature-showcase.md).

## Next Steps

- **Explore the codebase:**
  - [`shared/event-schema/`](../../shared/event-schema/) — Zod schemas and event types
  - [`packages/hook-emitter/`](../../packages/hook-emitter/) — emit + persist logic
  - [`scripts/bootstrap-existing-repo.ts`](../../scripts/bootstrap-existing-repo.ts) — bootstrap script with STDIN_EXTRACTION_BLOCK
  - [`shared/state-machine/`](../../shared/state-machine/) — deterministic reducer
  - [`packages/web-ui/`](../../packages/web-ui/) — React live board and replay UI

- **Read the architecture decisions:**
  - [ADR-003: Manifest-first hook registration](../adr/003-manifest-first-hook-registration.md)
  - [ADR-004: Visualiser hooks subdirectory](../adr/004-visualizer-hooks-subdirectory.md)
  - [ADR-006: Task postToolUse subagent synthesis](../adr/006-task-posttooluse-subagent-synthesis.md)
  - [ADR-007: README quickstart and documentation depth split](../adr/007-readme-quickstart-and-doc-depth-split.md)
  - [ADR-008: Tracing, UX, and documentation consolidation](../adr/008-tracing-ux-and-doc-consolidation.md)

- **Read the practitioner guide:** [Hooked on Hooks](../hooked-on-hooks.md) —
  lessons learned, best practices, and patterns from building the visualiser
  (including Lesson 9 on event-stream-first correlation).

- **Go deeper on tracing:** [Tracing Plan v2](../roadmap/tracing-plan.md) —
  how to emit `turnId`/`traceId`/`spanId`/`toolCallId` for exact tool-call
  pairing, and what the ingest diagnostics endpoint tells you about your session.

- **Official GitHub docs:**
  - [Hooks configuration reference](https://docs.github.com/en/copilot/reference/hooks-configuration)
  - [About hooks](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-hooks)
  - [Using hooks with Copilot CLI](https://docs.github.com/en/copilot/tutorials/copilot-cli-hooks)
