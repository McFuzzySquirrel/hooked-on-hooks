# Session Dashboard Pathway (.copilot Session Store)

Use this pathway when you want fast, read-only analysis of existing Copilot sessions with no hook setup.

## Why This Pathway Exists

We intentionally support a `.copilot`-first workflow because the local session store already contains rich, structured metadata:

- session identity and lifecycle context
- turns, checkpoints, and file references
- model and token usage signals
- searchable text for summaries and diagnostics

That gives you immediate value with lower setup overhead:

- no hook bootstrap required
- no target-repo modification required
- no live ingest dependency required
- ideal for retrospective analysis and reporting

## What You Get

- Session selector from `~/.copilot/session-store.db`
- Multi-session export (`combined` and `split` modes)
- Static dashboard with tabs:
  - Overview
  - Checkpoints
  - Turns (including tools, skills, and subagents when available)
  - Files
  - Models and Tokens
  - Search
- Optional redaction during export

## Quickstart

1. Install and verify:

```bash
npm install
npm run typecheck
npm run test
```

2. Build session list JSON:

```bash
npm run session:list -- --json ./session-list.json
```

3. Start the web UI:

```bash
npm run dev --workspace=packages/web-ui
```

4. Export selected sessions:

```bash
npm run session:export -- --ids <id1,id2> --out ./session-store-export.json --split --split-dir ./session-exports
```

5. In the app, load `session-list.json` in Session Selector and `session-store-export.json` in Session Dashboard.

## Detailed Guides

- Full workflow: [docs/tutorials/session-dashboard-workflow.md](../../tutorials/session-dashboard-workflow.md)
- UI walkthrough images: [docs/tutorials/assets/tutorial-screenshots/session-dashboard](../../tutorials/assets/tutorial-screenshots/session-dashboard)
- Tutorial index: [docs/tutorials/README.md](../../tutorials/README.md)

## Safe Screenshots

For documentation screenshots, prefer synthetic fixture data (default in `scripts/capture-screenshots.ts`) instead of real session exports.

If you must capture from real sessions, use `--redact` during export and pass the redacted files into the screenshot command. See the screenshot walkthrough README for exact commands.

## When To Choose This Path

Choose Session Dashboard when you need:

- quick insights from sessions that already happened
- reproducible exports for review/sharing
- low-friction setup on a new machine

Use the hook pipeline path if you need live, custom event capture from a target repository.
