#!/usr/bin/env node

/**
 * Emits a JSON configuration payload listing lifecycle hooks expected by the
 * foundation emitter. This script is intentionally transport-agnostic.
 *
 * During bootstrap, these hooks are also written to .github/hooks/visualizer/visualizer-hooks.json
 * in the target repo — that manifest is the canonical source of truth for which
 * events the visualizer captures at runtime.
 *
 * Only real Copilot CLI hook types are listed here. The following event types
 * are NOT Copilot CLI hooks and are instead synthesized internally:
 *   - subagentStart      — no CLI hook; no way to trigger it
 *   - postToolUseFailure — synthesized from postToolUse when toolResult.resultType
 *                          is "failure" or "denied"
 *   - notification       — no CLI hook; no way to trigger it
 *
 * See: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-hooks
 */
const hooks = [
  "sessionStart",
  "sessionEnd",
  "userPromptSubmitted",
  "preToolUse",
  "postToolUse",
  "subagentStop",
  "agentStop",
  "errorOccurred"
];

process.stdout.write(JSON.stringify({ hooks, manifest: "visualizer/visualizer-hooks.json" }, null, 2));
