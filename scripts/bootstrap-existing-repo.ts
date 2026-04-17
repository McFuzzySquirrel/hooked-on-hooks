#!/usr/bin/env node
import { mkdir, access, writeFile, readFile, readdir, chmod, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join, basename, relative } from "node:path";

function fail(message: string): never {
  console.error(`bootstrap-existing-repo error: ${message}`);
  process.exit(1);
}

function usage(): string {
  return [
    "Usage:",
    "  npm run bootstrap:repo -- /absolute/path/to/target-repo [options]",
    "",
    "Options:",
    "  --prefix <name>    Prefix for hook filenames (e.g. --prefix viz creates viz-session-start.sh)",
    "  --create-hooks     Generate stub hook scripts in .github/hooks/ when none exist",
    "  --vanilla          Generate minimal vanilla hooks that log raw stdin JSON",
    "                     (no transformations, no emit-event dependency, no enrichment)",
    "",
    "What this creates in target repo:",
    "  .visualizer/emit-event.sh   (bash / macOS / Linux)",
    "  .visualizer/emit-event.ps1  (PowerShell / Windows)",
    "  .visualizer/visualizer.config.json",
    "  .visualizer/HOOK_INTEGRATION.md",
    "",
    "With --create-hooks, also creates stub scripts (.sh and .ps1) in",
    ".github/hooks/ that call the visualizer emitter for each lifecycle event.",
    "",
    "With --vanilla --create-hooks, creates minimal scripts that log the raw",
    "Copilot CLI stdin JSON to .github/hooks/logs/events.jsonl with no",
    "transformations or enrichment."
  ].join("\n");
}

interface CliOptions {
  targetRepo: string;
  prefix?: string;
  createHooks: boolean;
  vanilla: boolean;
}

function parseCliArgs(argv: string[]): CliOptions | null {
  const positional: string[] = [];
  let prefix: string | undefined;
  let createHooks = false;
  let vanilla = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prefix") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        fail("--prefix requires a value (e.g. --prefix viz)");
      }
      prefix = value;
      i += 1;
    } else if (arg === "--create-hooks") {
      createHooks = true;
    } else if (arg === "--vanilla") {
      vanilla = true;
    } else if (arg === "-h" || arg === "--help") {
      console.log(usage());
      process.exit(0);
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  if (positional.length === 0) {
    return null;
  }

  return { targetRepo: positional[0], prefix, createHooks, vanilla };
}

async function ensureExists(path: string): Promise<void> {
  try {
    await access(path, constants.F_OK);
  } catch {
    fail(`target repo does not exist: ${path}`);
  }
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (!options) {
    console.log(usage());
    process.exit(1);
  }

  const visualizerRoot = resolve(process.cwd());
  const targetRepo = resolve(options.targetRepo);

  await ensureExists(targetRepo);

  const vizDir = join(targetRepo, ".visualizer");
  const logsDir = join(vizDir, "logs");
  await mkdir(logsDir, { recursive: true });

  const configPath = join(vizDir, "visualizer.config.json");
  const emitScriptPath = join(vizDir, "emit-event.sh");
  const emitScriptPs1Path = join(vizDir, "emit-event.ps1");
  const guidePath = join(vizDir, "HOOK_INTEGRATION.md");

  const config = {
    visualizerRoot,
    repoPath: targetRepo,
    jsonlPath: ".visualizer/logs/events.jsonl",
    httpEndpoint: "http://127.0.0.1:7070/events",
    source: "copilot-cli",
    storePrompts: false
  };

  const emitScript = `#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: .visualizer/emit-event.sh <eventType> <payload-json> <sessionId>" >&2
  exit 1
fi

EVENT_TYPE="$1"
PAYLOAD_JSON="$2"
SESSION_ID="$3"

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VISUALIZER_ROOT="${visualizerRoot}"
JSONL_PATH="$REPO_ROOT/.visualizer/logs/events.jsonl"
HTTP_ENDPOINT="\${VISUALIZER_HTTP_ENDPOINT:-http://127.0.0.1:7070/events}"
STORE_PROMPTS="\${VISUALIZER_STORE_PROMPTS:-false}"

# Optional Tracing v2 envelope fields — set VISUALIZER_TURN_ID / VISUALIZER_TRACE_ID /
# VISUALIZER_SPAN_ID / VISUALIZER_PARENT_SPAN_ID in your hook environment to enable
# exact tool-call pairing. All fields are optional; the ingest service falls back to
# a FIFO heuristic when they are absent.
_viz_extra_args=()
if [ -n "\${VISUALIZER_TURN_ID:-}" ];       then _viz_extra_args+=(--turnId       "\${VISUALIZER_TURN_ID}");       fi
if [ -n "\${VISUALIZER_TRACE_ID:-}" ];      then _viz_extra_args+=(--traceId      "\${VISUALIZER_TRACE_ID}");      fi
if [ -n "\${VISUALIZER_SPAN_ID:-}" ];       then _viz_extra_args+=(--spanId       "\${VISUALIZER_SPAN_ID}");       fi
if [ -n "\${VISUALIZER_PARENT_SPAN_ID:-}" ]; then _viz_extra_args+=(--parentSpanId "\${VISUALIZER_PARENT_SPAN_ID}"); fi

npx tsx "$VISUALIZER_ROOT/scripts/emit-event-cli.ts" \
  --eventType "$EVENT_TYPE" \
  --payload "$PAYLOAD_JSON" \
  --sessionId "$SESSION_ID" \
  --repoPath "$REPO_ROOT" \
  --jsonlPath "$JSONL_PATH" \
  --httpEndpoint "$HTTP_ENDPOINT" \
  --storePrompts "$STORE_PROMPTS" \
  "\${_viz_extra_args[@]:-}"
`;

  const emitScriptPs1 = `# PowerShell emit-event script generated by bootstrap-existing-repo.
param(
  [Parameter(Mandatory)][string]$EventType,
  [Parameter(Mandatory)][string]$Payload,
  [Parameter(Mandatory)][string]$SessionId
)
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$VisualizerRoot = "${visualizerRoot}"
$JsonlPath = Join-Path $RepoRoot ".visualizer" "logs" "events.jsonl"
$HttpEndpoint = "http://127.0.0.1:7070/events"
if ($env:VISUALIZER_HTTP_ENDPOINT) { $HttpEndpoint = $env:VISUALIZER_HTTP_ENDPOINT }
$StorePrompts = "false"
if ($env:VISUALIZER_STORE_PROMPTS) { $StorePrompts = $env:VISUALIZER_STORE_PROMPTS }

# Optional Tracing v2 envelope fields — set VISUALIZER_TURN_ID / VISUALIZER_TRACE_ID /
# VISUALIZER_SPAN_ID / VISUALIZER_PARENT_SPAN_ID in your hook environment to enable
# exact tool-call pairing. All fields are optional; the ingest service falls back to
# a FIFO heuristic when they are absent.
$_vizExtraArgs = @()
if ($env:VISUALIZER_TURN_ID)        { $_vizExtraArgs += '--turnId';        $_vizExtraArgs += $env:VISUALIZER_TURN_ID }
if ($env:VISUALIZER_TRACE_ID)       { $_vizExtraArgs += '--traceId';       $_vizExtraArgs += $env:VISUALIZER_TRACE_ID }
if ($env:VISUALIZER_SPAN_ID)        { $_vizExtraArgs += '--spanId';        $_vizExtraArgs += $env:VISUALIZER_SPAN_ID }
if ($env:VISUALIZER_PARENT_SPAN_ID) { $_vizExtraArgs += '--parentSpanId';  $_vizExtraArgs += $env:VISUALIZER_PARENT_SPAN_ID }

npx tsx "$VisualizerRoot/scripts/emit-event-cli.ts" \`
  --eventType $EventType \`
  --payload $Payload \`
  --sessionId $SessionId \`
  --repoPath $RepoRoot \`
  --jsonlPath $JsonlPath \`
  --httpEndpoint $HttpEndpoint \`
  --storePrompts $StorePrompts \`
  @_vizExtraArgs
`;

  const prefixNote = options.prefix
    ? `\n## Naming Prefix\nHook scripts use the prefix \`${options.prefix}-\` (e.g. \`${options.prefix}-session-start.sh\`).\n`
    : "";

  const guide = `# Visualizer Hook Integration

This repo was bootstrapped for Copilot Activity Visualiser.

## Generated Files
- .visualizer/emit-event.sh (bash / macOS / Linux)
- .visualizer/emit-event.ps1 (PowerShell / Windows)
- .visualizer/visualizer.config.json
- .visualizer/logs/events.jsonl (created on first emit)
- .github/hooks/visualizer/visualizer-hooks.json (canonical hook manifest)
${prefixNote}
## Visualizer Manifest

The file \`.github/hooks/visualizer/visualizer-hooks.json\` is the single source of truth
for which lifecycle events the visualizer captures. It is auto-generated during
bootstrap and lists every event type with its corresponding hook command.

All visualizer-generated stub hooks live in \`.github/hooks/visualizer/\` to keep
them isolated from user-managed hooks.

When unbootstrapping, this manifest is deleted automatically.

## Emit Command

### Bash (macOS / Linux)

\`\`\`bash
.visualizer/emit-event.sh <eventType> '<payload-json>' <sessionId>
\`\`\`

Example:

\`\`\`bash
SESSION_ID="run-$(date +%s)"
.visualizer/emit-event.sh sessionStart '{}' "$SESSION_ID"
.visualizer/emit-event.sh preToolUse '{"toolName":"bash","toolArgs":{"command":"npm test"}}' "$SESSION_ID"
.visualizer/emit-event.sh postToolUse '{"toolName":"bash","status":"success","durationMs":1200}' "$SESSION_ID"
.visualizer/emit-event.sh postToolUseFailure '{"toolName":"bash","status":"failure","errorSummary":"exit code 1"}' "$SESSION_ID"
.visualizer/emit-event.sh sessionEnd '{}' "$SESSION_ID"
\`\`\`

### PowerShell (Windows)

\`\`\`powershell
.visualizer\\emit-event.ps1 -EventType <eventType> -Payload '<payload-json>' -SessionId <sessionId>
\`\`\`

Example:

\`\`\`powershell
$SessionId = "run-" + [int](Get-Date -UFormat %s)
.visualizer\\emit-event.ps1 -EventType sessionStart -Payload '{}' -SessionId $SessionId
.visualizer\\emit-event.ps1 -EventType preToolUse -Payload '{"toolName":"bash"}' -SessionId $SessionId
.visualizer\\emit-event.ps1 -EventType sessionEnd -Payload '{}' -SessionId $SessionId
\`\`\`

## Event Types
sessionStart, sessionEnd, userPromptSubmitted, preToolUse, postToolUse,
postToolUseFailure, subagentStart, subagentStop, agentStop, notification,
errorOccurred

## Hook Discovery
The bootstrap script scans \`.github/hooks/\` and its subdirectories for hook
scripts (\`.sh\` and \`.ps1\`) that match known lifecycle names. If your hooks live
in a subfolder (e.g. \`.github/hooks/copilot/session-start.sh\`) they are
discovered automatically.

When \`--create-hooks\` is used, stub scripts are placed in
\`.github/hooks/visualizer/\` to keep them separate from user-managed hooks.
Both \`.sh\` (bash) and \`.ps1\` (PowerShell) stubs are generated.

When a \`--prefix\` is used, filenames like \`<prefix>-session-start.sh\` are also
matched (e.g. \`viz-session-start.sh\` with \`--prefix viz\`).

## Live Viewing
1. Start the ingest service from the visualizer repo:
   npm run serve:ingest   (from ${visualizerRoot})
2. Start the web UI from the visualizer repo:
   npm run dev --workspace=packages/web-ui
3. Run your multi-agent workflow with hook emits enabled.
4. Open http://127.0.0.1:5173 to observe live activity.

## Offline / JSONL-Only Mode
If the ingest service is NOT running, the emit scripts still write all events to
.visualizer/logs/events.jsonl and exit cleanly — no lost events.
Start the ingest service later and replay from the JSONL file.
`;

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await writeFile(emitScriptPath, emitScript, "utf8");
  await writeFile(emitScriptPs1Path, emitScriptPs1, "utf8");
  await writeFile(guidePath, guide, "utf8");

  // chmod +x the emit script automatically (no-op on Windows)
  await chmod(emitScriptPath, 0o755);
  console.log(`\nBootstrapped visualizer integration in: ${vizDir}`);

  // Auto-detect and wire hooks in .github/hooks/
  await wireHooks(targetRepo, options.prefix, options.createHooks, options.vanilla);
}

/**
 * Maps canonical hook base filenames to their visualizer event type and a
 * function that builds the JSON payload from parsed input.
 *
 * The matcher supports:
 *   1. Exact match (case-insensitive) — e.g. session-start.sh
 *   2. Prefix match — e.g. viz-session-start.sh with --prefix viz
 *   3. Hooks in subdirectories — e.g. .github/hooks/copilot/session-start.sh
 *
 * The emit block is idempotent — skipped if ".visualizer/emit-event.sh"
 * already appears in the file.
 */

interface HookMapping {
  eventType: string;
  payloadSnippet: string;
  sessionSnippet: string;
}

interface HookCommand {
  type: string;
  bash: string;
  powershell?: string;
  cwd?: string;
  timeoutSec?: number;
  [key: string]: unknown;
}

const SUBAGENT_NAME_FALLBACK = "\${AGENT_NAME:-\${SUBAGENT_NAME:-\${AGENT_TYPE:-\${AGENT_TASK_NAME:-\${AGENT_DISPLAY_NAME:-\${SUBAGENT_DISPLAY_NAME:-\${TASK_DESC:-unknown}}}}}}}";
const SUBAGENT_DISPLAY_NAME_FALLBACK = "\${AGENT_DISPLAY_NAME:-\${SUBAGENT_DISPLAY_NAME:-\${AGENT_NAME:-\${SUBAGENT_NAME:-\${TASK_DESC:-unknown}}}}}";
const SUBAGENT_DETAIL_FALLBACK = "\${AGENT_DESCRIPTION:-\${SUBAGENT_DESCRIPTION:-\${TASK_DESC:-\${AGENT_MESSAGE:-\${MESSAGE:-\${SUMMARY:-}}}}}}";
const SUBAGENT_MESSAGE_FALLBACK = "\${AGENT_MESSAGE:-\${MESSAGE:-\${SUMMARY:-\${TASK_DESC:-}}}}";
const TOOL_CONTEXT_AGENT_FALLBACK = "\${AGENT_NAME:-\${SUBAGENT_NAME:-\${AGENT_DISPLAY_NAME:-\${SUBAGENT_DISPLAY_NAME:-}}}}";
const TOOL_CONTEXT_DISPLAY_NAME_FALLBACK = "\${AGENT_DISPLAY_NAME:-\${SUBAGENT_DISPLAY_NAME:-}}";
const AGENT_ID_FALLBACK = "\${AGENT_ID:-\${SUBAGENT_ID:-}}";
const AGENT_STOP_DETAIL_FALLBACK = "\${TASK_DESC:-\${AGENT_DESCRIPTION:-\${SUBAGENT_DESCRIPTION:-\${AGENT_MESSAGE:-\${MESSAGE:-\${SUMMARY:-\${RESULT:-\${REASON:-}}}}}}}}";

/**
 * Copilot CLI only supports 8 hook types. The following 3 event types are NOT
 * Copilot CLI hooks and must NOT be registered in hook manifests or have stub
 * scripts generated for them:
 *
 *   - subagentStart      — no CLI hook exists; there is no way to trigger it
 *   - postToolUseFailure — synthesized from postToolUse when toolResult.resultType
 *                          is "failure" or "denied" (handled by the conditional
 *                          emit block in post-tool-use.sh/ps1)
 *   - notification       — no CLI hook exists; there is no way to trigger it
 *
 * These event types are kept in the event schema and state machine as valid
 * *internal* event types that can be produced by synthesizing or replaying.
 *
 * See: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-hooks
 */
const HOOK_MAP: Record<string, HookMapping> = {
  // ── .sh (bash) entries — only real Copilot CLI hook types ──────────────
  "session-start.sh": {
    eventType: "sessionStart",
    payloadSnippet: `$(jq -nc --arg source "\${SOURCE:-unknown}" '{"source":$source}' 2>/dev/null || echo '{}')`,
    sessionSnippet: `"\${SESSION_ID:-run-$$}"`,
  },
  "sessionstart.sh": {
    eventType: "sessionStart",
    payloadSnippet: `$(jq -nc --arg source "\${SOURCE:-unknown}" '{"source":$source}' 2>/dev/null || echo '{}')`,
    sessionSnippet: `"\${SESSION_ID:-run-$$}"`,
  },
  "session-end.sh": {
    eventType: "sessionEnd",
    payloadSnippet: `$(jq -nc --arg reason "\${REASON:-unknown}" '{"reason":$reason}' 2>/dev/null || echo '{}')`,
    sessionSnippet: `"\${SESSION_ID:-run-$$}"`,
  },
  "sessionend.sh": {
    eventType: "sessionEnd",
    payloadSnippet: `$(jq -nc --arg reason "\${REASON:-unknown}" '{"reason":$reason}' 2>/dev/null || echo '{}')`,
    sessionSnippet: `"\${SESSION_ID:-run-$$}"`,
  },
  "subagent-stop.sh": {
    eventType: "subagentStop",
    payloadSnippet: `$(jq -nc --arg agent "${SUBAGENT_NAME_FALLBACK}" --arg task "\${TASK_DESC:-}" --arg message "\${AGENT_MESSAGE:-\${MESSAGE:-\${SUMMARY:-\${RESULT:-\${TASK_DESC:-}}}}}" '{"agentName":$agent,"taskDescription":$task,"description":$task,"message":$message,"summary":$message,"result":$message}' 2>/dev/null || echo '{}')`,
    sessionSnippet: `"\${SESSION_ID:-run-$$}"`,
  },
  "log-prompt.sh": {
    eventType: "userPromptSubmitted",
    payloadSnippet: `$(jq -nc --arg prompt "\${PROMPT:-}" '{"prompt":$prompt}' 2>/dev/null || echo '{}')`,
    sessionSnippet: `"\${SESSION_ID:-run-$$}"`,
  },
  "pre-tool-use.sh": {
    eventType: "preToolUse",
    payloadSnippet: `$(jq -nc --arg tool "\${TOOL_NAME:-unknown}" --arg agent "${TOOL_CONTEXT_AGENT_FALLBACK}" --arg agentDisplay "${TOOL_CONTEXT_DISPLAY_NAME_FALLBACK}" --arg task "\${TASK_DESC:-}" --arg message "\${AGENT_MESSAGE:-\${MESSAGE:-\${SUMMARY:-}}}" --arg skill "\${SKILL_NAME:-}" --arg skillId "\${SKILL_ID:-}" --arg callId "\${TOOL_CALL_ID:-}" --arg toolArgsRaw "\${TOOL_ARGS:-}" '{"toolName":$tool} + (if ($toolArgsRaw|length)>0 then (try (($toolArgsRaw|fromjson) as $args | {"toolArgs":$args}) catch {"toolArgsText":$toolArgsRaw}) else {} end) + (if ($agent|length)>0 then {"agentName":$agent} else {} end) + (if ($agentDisplay|length)>0 then {"agentDisplayName":$agentDisplay} else {} end) + (if ($task|length)>0 then {"taskDescription":$task} else {} end) + (if ($message|length)>0 then {"message":$message} else {} end) + (if ($skill|length)>0 then {"skillName":$skill} else {} end) + (if ($skillId|length)>0 then {"skillId":$skillId} else {} end) + (if ($callId|length)>0 then {"toolCallId":$callId} else {} end)' 2>/dev/null || echo '{}')`,
    sessionSnippet: `"\${SESSION_ID:-run-$$}"`,
  },
  // NOTE: This payloadSnippet is only used by buildStubScript and buildEmitBlock
  // for the default (non-conditional) path. For postToolUse, the conditional
  // variants (buildStubScriptPostToolUse / buildEmitBlockPostToolUse) override
  // this with proper success/failure routing based on toolResult.resultType.
  "post-tool-use.sh": {
    eventType: "postToolUse",
    payloadSnippet: `$(jq -nc --arg tool "\${TOOL_NAME:-unknown}" --arg agent "${TOOL_CONTEXT_AGENT_FALLBACK}" --arg agentDisplay "${TOOL_CONTEXT_DISPLAY_NAME_FALLBACK}" --arg task "\${TASK_DESC:-}" --arg message "\${AGENT_MESSAGE:-\${MESSAGE:-\${SUMMARY:-}}}" --arg skill "\${SKILL_NAME:-}" --arg skillId "\${SKILL_ID:-}" --arg callId "\${TOOL_CALL_ID:-}" --arg toolArgsRaw "\${TOOL_ARGS:-}" '{"toolName":$tool,"status":"success"} + (if ($toolArgsRaw|length)>0 then (try (($toolArgsRaw|fromjson) as $args | {"toolArgs":$args}) catch {"toolArgsText":$toolArgsRaw}) else {} end) + (if ($agent|length)>0 then {"agentName":$agent} else {} end) + (if ($agentDisplay|length)>0 then {"agentDisplayName":$agentDisplay} else {} end) + (if ($task|length)>0 then {"taskDescription":$task} else {} end) + (if ($message|length)>0 then {"message":$message} else {} end) + (if ($skill|length)>0 then {"skillName":$skill} else {} end) + (if ($skillId|length)>0 then {"skillId":$skillId} else {} end) + (if ($callId|length)>0 then {"toolCallId":$callId} else {} end)' 2>/dev/null || echo '{}')`,
    sessionSnippet: `"\${SESSION_ID:-run-$$}"`,
  },
  "agent-stop.sh": {
    eventType: "agentStop",
    payloadSnippet: `$(jq -nc --arg agent "${SUBAGENT_NAME_FALLBACK}" --arg task "\${TASK_DESC:-}" --arg detail "${AGENT_STOP_DETAIL_FALLBACK}" --arg agentType "\${AGENT_TYPE:-}" --arg agentId "${AGENT_ID_FALLBACK}" --arg reason "\${REASON:-}" --arg message "\${AGENT_MESSAGE:-\${MESSAGE:-\${SUMMARY:-\${RESULT:-\${TASK_DESC:-\${REASON:-}}}}}}" '{"agentName":$agent,"taskDescription":$task,"description":$detail,"reason":$reason,"message":$message,"summary":$message} + (if ($agentType|length)>0 then {"agentType":$agentType} else {} end) + (if ($agentId|length)>0 then {"agentId":$agentId} else {} end)' 2>/dev/null || echo '{}')`,
    sessionSnippet: `"\${SESSION_ID:-run-$$}"`,
  },
  "error-occurred.sh": {
    eventType: "errorOccurred",
    payloadSnippet: `$(jq -nc --arg message "\${MESSAGE:-unknown error}" --arg code "\${CODE:-}" '{"message":$message,"code":$code}' 2>/dev/null || echo '{}')`,
    sessionSnippet: `"\${SESSION_ID:-run-$$}"`,
  },

  // ── .ps1 (PowerShell) entries — only real Copilot CLI hook types ──────
  "session-start.ps1": { eventType: "sessionStart", payloadSnippet: "", sessionSnippet: "" },
  "sessionstart.ps1":  { eventType: "sessionStart", payloadSnippet: "", sessionSnippet: "" },
  "session-end.ps1":   { eventType: "sessionEnd", payloadSnippet: "", sessionSnippet: "" },
  "sessionend.ps1":    { eventType: "sessionEnd", payloadSnippet: "", sessionSnippet: "" },
  "subagent-stop.ps1": { eventType: "subagentStop", payloadSnippet: "", sessionSnippet: "" },
  "log-prompt.ps1":    { eventType: "userPromptSubmitted", payloadSnippet: "", sessionSnippet: "" },
  "pre-tool-use.ps1":  { eventType: "preToolUse", payloadSnippet: "", sessionSnippet: "" },
  "post-tool-use.ps1": { eventType: "postToolUse", payloadSnippet: "", sessionSnippet: "" },
  "agent-stop.ps1":    { eventType: "agentStop", payloadSnippet: "", sessionSnippet: "" },
  "error-occurred.ps1":{ eventType: "errorOccurred", payloadSnippet: "", sessionSnippet: "" },
};

/**
 * Canonical stub filenames — one per unique event type from HOOK_MAP.
 * For event types that have both hyphenated and joined variants (e.g.
 * "session-start.sh" and "sessionstart.sh"), prefer the hyphenated name.
 * For event types with only one entry (e.g. "notification.sh"), use that entry.
 */
const CANONICAL_HOOK_NAMES = (() => {
  const eventSeen = new Set<string>();
  const hyphenated = Object.keys(HOOK_MAP).filter((name) => name.includes("-"));
  const nonHyphenated = Object.keys(HOOK_MAP).filter((name) => !name.includes("-"));

  const result: string[] = [];
  // Add hyphenated names first (preferred)
  for (const name of hyphenated) {
    const eventType = HOOK_MAP[name].eventType;
    if (!eventSeen.has(eventType)) {
      eventSeen.add(eventType);
      result.push(name);
    }
  }
  // Then add any non-hyphenated names for events not yet covered
  for (const name of nonHyphenated) {
    const eventType = HOOK_MAP[name].eventType;
    if (!eventSeen.has(eventType)) {
      eventSeen.add(eventType);
      result.push(name);
    }
  }
  return result;
})();

const EVENT_TO_CANONICAL_HOOK: Record<string, string> = CANONICAL_HOOK_NAMES.reduce<Record<string, string>>((acc, hookName) => {
  acc[HOOK_MAP[hookName].eventType] = hookName;
  return acc;
}, {});

const DEFAULT_TIMEOUT_BY_EVENT: Record<string, number> = {
  sessionStart: 15,
  sessionEnd: 15,
  userPromptSubmitted: 5,
  preToolUse: 10,
  postToolUse: 10,
  subagentStop: 10,
  agentStop: 10,
  errorOccurred: 10,
};

/**
 * Name of the dedicated visualizer hook manifest. This file is the single
 * source of truth for which lifecycle events the visualizer captures.
 */
export const VISUALIZER_MANIFEST_NAME = "visualizer-hooks.json";

/**
 * Subdirectory under .github/hooks/ where all visualizer-generated files
 * (stub hook scripts and the manifest) are placed. Keeps visualizer artifacts
 * isolated from user-managed hooks.
 */
export const VISUALIZER_HOOKS_SUBDIR = "visualizer";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildManifestCommand(eventType: string, prefix?: string): HookCommand | undefined {
  const canonicalHook = EVENT_TO_CANONICAL_HOOK[eventType];
  if (!canonicalHook) return undefined;

  const hookFile = prefix ? `${prefix}-${canonicalHook}` : canonicalHook;
  const ps1File = hookFile.replace(/\.sh$/, ".ps1");
  return {
    type: "command",
    bash: `./.github/hooks/${VISUALIZER_HOOKS_SUBDIR}/${hookFile}`,
    powershell: `./.github/hooks/${VISUALIZER_HOOKS_SUBDIR}/${ps1File}`,
    cwd: ".",
    timeoutSec: DEFAULT_TIMEOUT_BY_EVENT[eventType] ?? 10,
  };
}

export function updateEjsHooksManifest(
  manifestRaw: unknown,
  availableEvents: readonly string[],
  prefix?: string
): { updated: Record<string, unknown>; addedEvents: string[] } {
  const manifest: Record<string, unknown> = isRecord(manifestRaw)
    ? { ...manifestRaw }
    : { version: 1 };
  const existingHooks = isRecord(manifest.hooks) ? { ...manifest.hooks } : {};
  const addedEvents: string[] = [];

  for (const eventType of availableEvents) {
    const current = existingHooks[eventType];
    if (Array.isArray(current) && current.length > 0) {
      continue;
    }

    const cmd = buildManifestCommand(eventType, prefix);
    if (!cmd) continue;

    existingHooks[eventType] = [cmd];
    addedEvents.push(eventType);
  }

  return {
    updated: {
      ...manifest,
      hooks: existingHooks,
    },
    addedEvents,
  };
}

export const updateHookManifest = updateEjsHooksManifest;

function isCompatibleHookManifest(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && isRecord(value.hooks);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Try to match a filename against HOOK_MAP, optionally stripping a prefix.
 * Returns the mapping if found, or undefined.
 */
export function matchHookFilename(filename: string, prefix?: string): HookMapping | undefined {
  const lower = basename(filename).toLowerCase();

  // Direct match first
  const direct = HOOK_MAP[lower];
  if (direct) return direct;

  // Prefix match: strip "<prefix>-" from the start and re-check
  if (prefix) {
    const prefixPattern = new RegExp(`^${escapeRegExp(prefix.toLowerCase())}-`);
    const stripped = lower.replace(prefixPattern, "");
    if (stripped !== lower) {
      return HOOK_MAP[stripped];
    }
  }

  return undefined;
}

/**
 * Shell snippet that reads Copilot CLI context from stdin and exports fields
 * as environment variables. Copilot CLI passes a JSON object on stdin when
 * invoking hook commands. The extraction populates env vars that the payload
 * snippets already reference (e.g. $TOOL_NAME, $AGENT_NAME). Existing env
 * vars are preserved — stdin values only fill in unset/empty variables.
 */
const STDIN_EXTRACTION_BLOCK = [
  `# Read Copilot CLI context from stdin (JSON payload)`,
  `_VIZ_STDIN=$(cat 2>/dev/null || echo '{}')`,
  `if [ -z "$_VIZ_STDIN" ]; then _VIZ_STDIN='{}'; fi`,
  `_vjq() { echo "$_VIZ_STDIN" | jq -r "$1" 2>/dev/null || true; }`,
  `# Extract fields from stdin JSON into env vars (stdin fills unset vars)`,
  `: "\${TOOL_NAME:=$(_vjq '.tool_name // .toolName // empty')}"`,
  `: "\${SESSION_ID:=$(_vjq '.session_id // .sessionId // empty')}"`,
  `: "\${AGENT_NAME:=$(_vjq '.agent_name // .agentName // .active_agent // .activeAgent // .active_agent.name // .activeAgent.name // .active_agent.id // .activeAgent.id // .agent.name // .agent.id // .agent.slug // .actor.name // .name // empty')}"`,
  `: "\${AGENT_TYPE:=$(_vjq '.agent_type // .agentType // .active_agent.type // .activeAgent.type // .toolArgs.agent_type // .tool_args.agent_type // empty')}"`,
  `: "\${AGENT_TASK_NAME:=$(_vjq '.toolArgs.name // .tool_args.name // .task_name // .taskName // .task_description // .taskDescription // .task // .description // .name // empty')}"`,
  `: "\${SUBAGENT_NAME:=$(_vjq '.subagent_name // .subagentName // .subagent.name // .subagent.id // .agent_name // .agentName // .agent.name // empty')}"`,
  `: "\${AGENT_ID:=$(_vjq '.agent_id // .agentId // .agent.id // .actor.id // empty')}"`,
  `: "\${SUBAGENT_ID:=$(_vjq '.subagent_id // .subagentId // .subagent.id // empty')}"`,
  `: "\${AGENT_DISPLAY_NAME:=$(_vjq '.agent_display_name // .agentDisplayName // .agent.display_name // .agent.displayName // .actor.display_name // .display_name // .displayName // empty')}"`,
  `: "\${SUBAGENT_DISPLAY_NAME:=$(_vjq '.subagent_display_name // .subagentDisplayName // .subagent.display_name // .subagent.displayName // .agent_display_name // .agentDisplayName // .display_name // .displayName // empty')}"`,
  `: "\${AGENT_DESCRIPTION:=$(_vjq '.agent_description // .agentDescription // .agent.description // .actor.description // .description // empty')}"`,
  `: "\${SUBAGENT_DESCRIPTION:=$(_vjq '.subagent_description // .subagentDescription // .subagent.description // .agent_description // .agentDescription // .description // empty')}"`,
  `: "\${TASK_DESC:=$(_vjq '.task_description // .taskDescription // .task // .toolArgs.description // .tool_args.description // empty')}"`,
  `: "\${AGENT_MESSAGE:=$(_vjq '.agent.message // .agent.finalMessage // .agent.output.summary // .message // empty')}"`,
  `: "\${MESSAGE:=$(_vjq '.error.message // .message // .output.message // .final_message // .finalMessage // empty')}"`,
  `: "\${SUMMARY:=$(_vjq '.summary // .output.summary // .final_summary // .finalSummary // empty')}"`,
  `: "\${RESULT:=$(_vjq '.result // empty')}"`,
  `: "\${REASON:=$(_vjq '.reason // .stopReason // .stop_reason // .resultType // .status // empty')}"`,
  `: "\${STATUS:=$(_vjq '.toolResult.resultType // .status // .tool_status // empty')}"`,
  `: "\${ERROR_SUMMARY:=$(_vjq '.error.message // .error_summary // .errorSummary // empty')}"`,
  `: "\${TOOL_ARGS:=$(_vjq '.toolArgs // empty')}"`,
  `: "\${SKILL_NAME:=$(_vjq '.skill_name // .skillName // .skill.name // .tool.skill.name // .toolResult.skill.name // empty')}"`,
  `: "\${SKILL_ID:=$(_vjq '.skill_id // .skillId // .skill.id // .tool.skill.id // .toolResult.skill.id // empty')}"`,
  `: "\${TOOL_CALL_ID:=$(_vjq '.tool_call_id // .toolCallId // .tool_use_id // .toolUseId // empty')}"`,
  `: "\${SOURCE:=$(_vjq '.source // empty')}"`,
  `: "\${PROMPT:=$(_vjq '.prompt // .user_prompt // empty')}"`,
  `: "\${NOTIFICATION_TYPE:=$(_vjq '.notification_type // .notificationType // empty')}"`,
  `: "\${TITLE:=$(_vjq '.title // empty')}"`,
  `: "\${CODE:=$(_vjq '.code // .error_code // empty')}"`,
].join("\n");

function buildEmitBlock(emitScriptRelPath: string, eventType: string, payloadSnippet: string, sessionSnippet: string): string {
  // For postToolUse, generate a conditional block that routes to postToolUseFailure
  // when the Copilot CLI reports a failure result. The Copilot CLI fires a single
  // postToolUse hook for both success and failure — .toolResult.resultType carries
  // the actual outcome.
  if (eventType === "postToolUse") {
    return buildEmitBlockPostToolUse(emitScriptRelPath, sessionSnippet);
  }
  return [
    ``,
    `# --- Visualizer emit (auto-wired by bootstrap-existing-repo) ---`,
    STDIN_EXTRACTION_BLOCK,
    `if [ -x "\${REPO_ROOT}/${emitScriptRelPath}" ]; then`,
    `  _VIZ_PAYLOAD=${payloadSnippet}`,
    `  "\${REPO_ROOT}/${emitScriptRelPath}" ${eventType} "\${_VIZ_PAYLOAD}" ${sessionSnippet} >&2 || true`,
    `fi`,
  ].join("\n");
}

/**
 * Conditional emit block for postToolUse hooks. Copilot CLI uses a single
 * postToolUse hook for both success and failure. This block checks
 * $STATUS (extracted from .toolResult.resultType) and routes to the correct
 * visualizer event type.
 */
function buildEmitBlockPostToolUse(emitScriptRelPath: string, sessionSnippet: string): string {
  return [
    ``,
    `# --- Visualizer emit (auto-wired by bootstrap-existing-repo) ---`,
    STDIN_EXTRACTION_BLOCK,
    `if [ -x "\${REPO_ROOT}/${emitScriptRelPath}" ]; then`,
    `  if [ "\${STATUS}" = "failure" ] || [ "\${STATUS}" = "denied" ]; then`,
    `    _VIZ_PAYLOAD=$(jq -nc --arg tool "\${TOOL_NAME:-unknown}" --arg err "\${ERROR_SUMMARY:-}" --arg agent "${TOOL_CONTEXT_AGENT_FALLBACK}" --arg agentDisplay "${TOOL_CONTEXT_DISPLAY_NAME_FALLBACK}" --arg task "\${TASK_DESC:-}" --arg message "\${AGENT_MESSAGE:-\${MESSAGE:-\${SUMMARY:-}}}" --arg skill "\${SKILL_NAME:-}" --arg skillId "\${SKILL_ID:-}" --arg callId "\${TOOL_CALL_ID:-}" --arg toolArgsRaw "\${TOOL_ARGS:-}" '{"toolName":$tool,"status":"failure","errorSummary":$err} + (if ($toolArgsRaw|length)>0 then (try (($toolArgsRaw|fromjson) as $args | {"toolArgs":$args}) catch {"toolArgsText":$toolArgsRaw}) else {} end) + (if ($agent|length)>0 then {"agentName":$agent} else {} end) + (if ($agentDisplay|length)>0 then {"agentDisplayName":$agentDisplay} else {} end) + (if ($task|length)>0 then {"taskDescription":$task} else {} end) + (if ($message|length)>0 then {"message":$message} else {} end) + (if ($skill|length)>0 then {"skillName":$skill} else {} end) + (if ($skillId|length)>0 then {"skillId":$skillId} else {} end) + (if ($callId|length)>0 then {"toolCallId":$callId} else {} end)' 2>/dev/null || echo '{}')`,
    `    "\${REPO_ROOT}/${emitScriptRelPath}" postToolUseFailure "\${_VIZ_PAYLOAD}" ${sessionSnippet} >&2 || true`,
    `  else`,
    `    _VIZ_PAYLOAD=$(jq -nc --arg tool "\${TOOL_NAME:-unknown}" --arg agent "${TOOL_CONTEXT_AGENT_FALLBACK}" --arg agentDisplay "${TOOL_CONTEXT_DISPLAY_NAME_FALLBACK}" --arg task "\${TASK_DESC:-}" --arg message "\${AGENT_MESSAGE:-\${MESSAGE:-\${SUMMARY:-}}}" --arg skill "\${SKILL_NAME:-}" --arg skillId "\${SKILL_ID:-}" --arg callId "\${TOOL_CALL_ID:-}" --arg toolArgsRaw "\${TOOL_ARGS:-}" '{"toolName":$tool,"status":"success"} + (if ($toolArgsRaw|length)>0 then (try (($toolArgsRaw|fromjson) as $args | {"toolArgs":$args}) catch {"toolArgsText":$toolArgsRaw}) else {} end) + (if ($agent|length)>0 then {"agentName":$agent} else {} end) + (if ($agentDisplay|length)>0 then {"agentDisplayName":$agentDisplay} else {} end) + (if ($task|length)>0 then {"taskDescription":$task} else {} end) + (if ($message|length)>0 then {"message":$message} else {} end) + (if ($skill|length)>0 then {"skillName":$skill} else {} end) + (if ($skillId|length)>0 then {"skillId":$skillId} else {} end) + (if ($callId|length)>0 then {"toolCallId":$callId} else {} end)' 2>/dev/null || echo '{}')`,
    `    "\${REPO_ROOT}/${emitScriptRelPath}" postToolUse "\${_VIZ_PAYLOAD}" ${sessionSnippet} >&2 || true`,
    `  fi`,
    `fi`,
  ].join("\n");
}

/**
 * PowerShell snippet that reads Copilot CLI context from stdin and sets
 * environment variables. This is the PS1 equivalent of STDIN_EXTRACTION_BLOCK.
 * Copilot CLI pipes a JSON object on stdin; the extraction populates $env:*
 * vars that the payload snippets reference. Existing env vars are preserved —
 * stdin values only fill in unset/empty variables.
 */
const STDIN_EXTRACTION_BLOCK_PS1 = [
  `# Read Copilot CLI context from stdin (JSON payload)`,
  `try { $_vizStdin = [Console]::In.ReadToEnd() } catch { $_vizStdin = '{}' }`,
  `if (-not $_vizStdin) { $_vizStdin = '{}' }`,
  `try { $_vizJson = $_vizStdin | ConvertFrom-Json } catch { $_vizJson = $null }`,
  // Single-line function: avoids standalone `}` that would break the ps1BlockPattern regex in unbootstrap
  `function _vizField([string[]]$names) { if (-not $_vizJson) { return '' }; foreach ($n in $names) { $v = $_vizJson.PSObject.Properties[$n]; if ($v -and $v.Value) { return [string]$v.Value } }; return '' }`,
  // Single-line helper for nested property access (e.g. "toolResult.resultType")
  `function _vizNested([string]$path) { if (-not $_vizJson) { return '' }; $parts = $path -split '\\.'; $cur = $_vizJson; foreach ($p in $parts) { if (-not $cur) { return '' }; $v = $cur.PSObject.Properties[$p]; if (-not $v) { return '' }; $cur = $v.Value }; if ($cur -is [string]) { return $cur } elseif ($cur) { return [string]$cur } else { return '' } }`,
  `# Extract fields from stdin JSON into env vars (stdin fills unset vars)`,
  `if (-not $env:TOOL_NAME)              { $env:TOOL_NAME = _vizField 'tool_name','toolName' }`,
  `if (-not $env:SESSION_ID)             { $env:SESSION_ID = _vizField 'session_id','sessionId' }`,
  `if (-not $env:AGENT_NAME)             { $v = _vizNested 'activeAgent.name'; if ($v) { $env:AGENT_NAME = $v } else { $v = _vizNested 'activeAgent.id'; if ($v) { $env:AGENT_NAME = $v } else { $v = _vizNested 'active_agent.name'; if ($v) { $env:AGENT_NAME = $v } else { $v = _vizNested 'active_agent.id'; if ($v) { $env:AGENT_NAME = $v } else { $v = _vizNested 'agent.name'; if ($v) { $env:AGENT_NAME = $v } else { $v = _vizNested 'agent.id'; if ($v) { $env:AGENT_NAME = $v } else { $v = _vizNested 'agent.slug'; if ($v) { $env:AGENT_NAME = $v } else { $v = _vizNested 'actor.name'; if ($v) { $env:AGENT_NAME = $v } else { $env:AGENT_NAME = _vizField 'agent_name','agentName','name' } } } } } } } } }`,
  `if (-not $env:AGENT_TYPE)             { $v = _vizNested 'activeAgent.type'; if ($v) { $env:AGENT_TYPE = $v } else { $v = _vizNested 'active_agent.type'; if ($v) { $env:AGENT_TYPE = $v } else { $v = _vizNested 'toolArgs.agent_type'; if ($v) { $env:AGENT_TYPE = $v } else { $v = _vizNested 'tool_args.agent_type'; if ($v) { $env:AGENT_TYPE = $v } else { $env:AGENT_TYPE = _vizField 'agent_type','agentType' } } } } }`,
  `if (-not $env:AGENT_TASK_NAME)        { $v = _vizNested 'toolArgs.name'; if ($v) { $env:AGENT_TASK_NAME = $v } else { $v = _vizNested 'tool_args.name'; if ($v) { $env:AGENT_TASK_NAME = $v } else { $env:AGENT_TASK_NAME = _vizField 'task_name','taskName','task_description','taskDescription','task','description','name' } } }`,
  `if (-not $env:SUBAGENT_NAME)          { $v = _vizNested 'subagent.name'; if ($v) { $env:SUBAGENT_NAME = $v } else { $v = _vizNested 'subagent.id'; if ($v) { $env:SUBAGENT_NAME = $v } else { $env:SUBAGENT_NAME = _vizField 'subagent_name','subagentName','agent_name','agentName' } } }`,
  `if (-not $env:AGENT_ID)               { $v = _vizNested 'agent.id'; if ($v) { $env:AGENT_ID = $v } else { $v = _vizNested 'actor.id'; if ($v) { $env:AGENT_ID = $v } else { $env:AGENT_ID = _vizField 'agent_id','agentId' } } }`,
  `if (-not $env:SUBAGENT_ID)            { $v = _vizNested 'subagent.id'; if ($v) { $env:SUBAGENT_ID = $v } else { $env:SUBAGENT_ID = _vizField 'subagent_id','subagentId' } }`,
  `if (-not $env:AGENT_DISPLAY_NAME)     { $v = _vizNested 'agent.display_name'; if ($v) { $env:AGENT_DISPLAY_NAME = $v } else { $v = _vizNested 'agent.displayName'; if ($v) { $env:AGENT_DISPLAY_NAME = $v } else { $v = _vizNested 'actor.display_name'; if ($v) { $env:AGENT_DISPLAY_NAME = $v } else { $env:AGENT_DISPLAY_NAME = _vizField 'agent_display_name','agentDisplayName','display_name','displayName' } } } }`,
  `if (-not $env:SUBAGENT_DISPLAY_NAME)  { $v = _vizNested 'subagent.display_name'; if ($v) { $env:SUBAGENT_DISPLAY_NAME = $v } else { $v = _vizNested 'subagent.displayName'; if ($v) { $env:SUBAGENT_DISPLAY_NAME = $v } else { $env:SUBAGENT_DISPLAY_NAME = _vizField 'subagent_display_name','subagentDisplayName','agent_display_name','agentDisplayName','display_name','displayName' } } }`,
  `if (-not $env:AGENT_DESCRIPTION)      { $v = _vizNested 'agent.description'; if ($v) { $env:AGENT_DESCRIPTION = $v } else { $v = _vizNested 'actor.description'; if ($v) { $env:AGENT_DESCRIPTION = $v } else { $env:AGENT_DESCRIPTION = _vizField 'agent_description','agentDescription','description' } } }`,
  `if (-not $env:SUBAGENT_DESCRIPTION)   { $v = _vizNested 'subagent.description'; if ($v) { $env:SUBAGENT_DESCRIPTION = $v } else { $env:SUBAGENT_DESCRIPTION = _vizField 'subagent_description','subagentDescription','agent_description','agentDescription','description' } }`,
  `if (-not $env:TASK_DESC)              { $v = _vizNested 'toolArgs.description'; if ($v) { $env:TASK_DESC = $v } else { $v = _vizNested 'tool_args.description'; if ($v) { $env:TASK_DESC = $v } else { $env:TASK_DESC = _vizField 'task_description','taskDescription','task' } } }`,
  `if (-not $env:AGENT_MESSAGE)          { $v = _vizNested 'agent.message'; if ($v) { $env:AGENT_MESSAGE = $v } else { $v = _vizNested 'agent.finalMessage'; if ($v) { $env:AGENT_MESSAGE = $v } else { $v = _vizNested 'agent.output.summary'; if ($v) { $env:AGENT_MESSAGE = $v } else { $env:AGENT_MESSAGE = _vizField 'message' } } } }`,
  `if (-not $env:MESSAGE)                { $v = _vizNested 'error.message'; if ($v) { $env:MESSAGE = $v } else { $v = _vizNested 'output.message'; if ($v) { $env:MESSAGE = $v } else { $v = _vizNested 'final_message'; if ($v) { $env:MESSAGE = $v } else { $v = _vizNested 'finalMessage'; if ($v) { $env:MESSAGE = $v } else { $env:MESSAGE = _vizField 'message' } } } } }`,
  `if (-not $env:SUMMARY)                { $v = _vizNested 'output.summary'; if ($v) { $env:SUMMARY = $v } else { $v = _vizNested 'final_summary'; if ($v) { $env:SUMMARY = $v } else { $v = _vizNested 'finalSummary'; if ($v) { $env:SUMMARY = $v } else { $env:SUMMARY = _vizField 'summary' } } } }`,
  `if (-not $env:RESULT)                 { $env:RESULT = _vizField 'result' }`,
  `if (-not $env:REASON)                 { $v = _vizField 'reason','stopReason','stop_reason','resultType','status'; if ($v) { $env:REASON = $v } }`,
  `if (-not $env:STATUS)                 { $v = _vizNested 'toolResult.resultType'; if ($v) { $env:STATUS = $v } else { $env:STATUS = _vizField 'status','tool_status' } }`,
  `if (-not $env:ERROR_SUMMARY)          { $v = _vizNested 'error.message'; if ($v) { $env:ERROR_SUMMARY = $v } else { $env:ERROR_SUMMARY = _vizField 'error_summary','errorSummary' } }`,
  `if (-not $env:TOOL_ARGS)              { $env:TOOL_ARGS = _vizField 'toolArgs' }`,
  `if (-not $env:SKILL_NAME)             { $v = _vizNested 'skill.name'; if ($v) { $env:SKILL_NAME = $v } else { $v = _vizNested 'tool.skill.name'; if ($v) { $env:SKILL_NAME = $v } else { $v = _vizNested 'toolResult.skill.name'; if ($v) { $env:SKILL_NAME = $v } else { $env:SKILL_NAME = _vizField 'skill_name','skillName' } } } }`,
  `if (-not $env:SKILL_ID)               { $v = _vizNested 'skill.id'; if ($v) { $env:SKILL_ID = $v } else { $v = _vizNested 'tool.skill.id'; if ($v) { $env:SKILL_ID = $v } else { $v = _vizNested 'toolResult.skill.id'; if ($v) { $env:SKILL_ID = $v } else { $env:SKILL_ID = _vizField 'skill_id','skillId' } } } }`,
  `if (-not $env:TOOL_CALL_ID)           { $env:TOOL_CALL_ID = _vizField 'tool_call_id','toolCallId','tool_use_id','toolUseId' }`,
  `if (-not $env:SOURCE)                 { $env:SOURCE = _vizField 'source' }`,
  `if (-not $env:PROMPT)                 { $env:PROMPT = _vizField 'prompt','user_prompt' }`,
  `if (-not $env:NOTIFICATION_TYPE)      { $env:NOTIFICATION_TYPE = _vizField 'notification_type','notificationType' }`,
  `if (-not $env:TITLE)                  { $env:TITLE = _vizField 'title' }`,
  `if (-not $env:CODE)                   { $env:CODE = _vizField 'code','error_code' }`,
].join("\n");

// ── PowerShell payload snippets — only real Copilot CLI hook types ─────
const PS1_PAYLOAD_MAP: Record<string, { payloadSnippet: string; sessionSnippet: string }> = {
  sessionStart:        { payloadSnippet: `(ConvertTo-Json @{ source = $(if ($env:SOURCE) { $env:SOURCE } else { 'unknown' }) } -Compress)`, sessionSnippet: `$(if ($env:SESSION_ID) { $env:SESSION_ID } else { "run-$PID" })` },
  sessionEnd:          { payloadSnippet: `(ConvertTo-Json @{ reason = $(if ($env:REASON) { $env:REASON } else { 'unknown' }) } -Compress)`, sessionSnippet: `$(if ($env:SESSION_ID) { $env:SESSION_ID } else { "run-$PID" })` },
  subagentStop:        { payloadSnippet: `(ConvertTo-Json @{ agentName = $(if ($env:AGENT_NAME) { $env:AGENT_NAME } elseif ($env:SUBAGENT_NAME) { $env:SUBAGENT_NAME } else { 'unknown' }); taskDescription = $(if ($env:TASK_DESC) { $env:TASK_DESC } else { '' }); description = $(if ($env:TASK_DESC) { $env:TASK_DESC } else { '' }); message = $(if ($env:AGENT_MESSAGE) { $env:AGENT_MESSAGE } elseif ($env:MESSAGE) { $env:MESSAGE } elseif ($env:TASK_DESC) { $env:TASK_DESC } else { '' }); summary = $(if ($env:SUMMARY) { $env:SUMMARY } elseif ($env:MESSAGE) { $env:MESSAGE } elseif ($env:TASK_DESC) { $env:TASK_DESC } else { '' }) } -Compress)`, sessionSnippet: `$(if ($env:SESSION_ID) { $env:SESSION_ID } else { "run-$PID" })` },
  userPromptSubmitted: { payloadSnippet: `(ConvertTo-Json @{ prompt = $(if ($env:PROMPT) { $env:PROMPT } else { '' }) } -Compress)`, sessionSnippet: `$(if ($env:SESSION_ID) { $env:SESSION_ID } else { "run-$PID" })` },
  preToolUse:          { payloadSnippet: `(ConvertTo-Json @{ toolName = $(if ($env:TOOL_NAME) { $env:TOOL_NAME } else { 'unknown' }); toolArgs = $(if ($env:TOOL_ARGS) { try { $env:TOOL_ARGS | ConvertFrom-Json } catch { $env:TOOL_ARGS } } else { $null }); agentName = $(if ($env:AGENT_NAME) { $env:AGENT_NAME } elseif ($env:SUBAGENT_NAME) { $env:SUBAGENT_NAME } elseif ($env:AGENT_DISPLAY_NAME) { $env:AGENT_DISPLAY_NAME } else { '' }); agentDisplayName = $(if ($env:AGENT_DISPLAY_NAME) { $env:AGENT_DISPLAY_NAME } elseif ($env:SUBAGENT_DISPLAY_NAME) { $env:SUBAGENT_DISPLAY_NAME } else { '' }); taskDescription = $(if ($env:TASK_DESC) { $env:TASK_DESC } else { '' }); message = $(if ($env:AGENT_MESSAGE) { $env:AGENT_MESSAGE } elseif ($env:MESSAGE) { $env:MESSAGE } else { '' }); skillName = $(if ($env:SKILL_NAME) { $env:SKILL_NAME } else { '' }); skillId = $(if ($env:SKILL_ID) { $env:SKILL_ID } else { '' }); toolCallId = $(if ($env:TOOL_CALL_ID) { $env:TOOL_CALL_ID } else { '' }) } -Compress)`, sessionSnippet: `$(if ($env:SESSION_ID) { $env:SESSION_ID } else { "run-$PID" })` },
  // NOTE: postToolUse payloadSnippet is not used at runtime — the conditional
  // variants (buildStubScriptPs1PostToolUse / buildEmitBlockPs1PostToolUse)
  // override this with proper success/failure routing.
  postToolUse:         { payloadSnippet: `(ConvertTo-Json @{ toolName = $(if ($env:TOOL_NAME) { $env:TOOL_NAME } else { 'unknown' }); status = 'success'; toolArgs = $(if ($env:TOOL_ARGS) { try { $env:TOOL_ARGS | ConvertFrom-Json } catch { $env:TOOL_ARGS } } else { $null }); agentName = $(if ($env:AGENT_NAME) { $env:AGENT_NAME } elseif ($env:SUBAGENT_NAME) { $env:SUBAGENT_NAME } elseif ($env:AGENT_DISPLAY_NAME) { $env:AGENT_DISPLAY_NAME } else { '' }); agentDisplayName = $(if ($env:AGENT_DISPLAY_NAME) { $env:AGENT_DISPLAY_NAME } elseif ($env:SUBAGENT_DISPLAY_NAME) { $env:SUBAGENT_DISPLAY_NAME } else { '' }); taskDescription = $(if ($env:TASK_DESC) { $env:TASK_DESC } else { '' }); message = $(if ($env:AGENT_MESSAGE) { $env:AGENT_MESSAGE } elseif ($env:MESSAGE) { $env:MESSAGE } else { '' }); skillName = $(if ($env:SKILL_NAME) { $env:SKILL_NAME } else { '' }); skillId = $(if ($env:SKILL_ID) { $env:SKILL_ID } else { '' }); toolCallId = $(if ($env:TOOL_CALL_ID) { $env:TOOL_CALL_ID } else { '' }) } -Compress)`, sessionSnippet: `$(if ($env:SESSION_ID) { $env:SESSION_ID } else { "run-$PID" })` },
  postToolUseFailure:  { payloadSnippet: `(ConvertTo-Json @{ toolName = $(if ($env:TOOL_NAME) { $env:TOOL_NAME } else { 'unknown' }); status = 'failure'; errorSummary = $(if ($env:ERROR_SUMMARY) { $env:ERROR_SUMMARY } else { '' }); toolArgs = $(if ($env:TOOL_ARGS) { try { $env:TOOL_ARGS | ConvertFrom-Json } catch { $env:TOOL_ARGS } } else { $null }); agentName = $(if ($env:AGENT_NAME) { $env:AGENT_NAME } elseif ($env:SUBAGENT_NAME) { $env:SUBAGENT_NAME } elseif ($env:AGENT_DISPLAY_NAME) { $env:AGENT_DISPLAY_NAME } else { '' }); agentDisplayName = $(if ($env:AGENT_DISPLAY_NAME) { $env:AGENT_DISPLAY_NAME } elseif ($env:SUBAGENT_DISPLAY_NAME) { $env:SUBAGENT_DISPLAY_NAME } else { '' }); taskDescription = $(if ($env:TASK_DESC) { $env:TASK_DESC } else { '' }); message = $(if ($env:AGENT_MESSAGE) { $env:AGENT_MESSAGE } elseif ($env:MESSAGE) { $env:MESSAGE } else { '' }); skillName = $(if ($env:SKILL_NAME) { $env:SKILL_NAME } else { '' }); skillId = $(if ($env:SKILL_ID) { $env:SKILL_ID } else { '' }); toolCallId = $(if ($env:TOOL_CALL_ID) { $env:TOOL_CALL_ID } else { '' }) } -Compress)`, sessionSnippet: `$(if ($env:SESSION_ID) { $env:SESSION_ID } else { "run-$PID" })` },
  agentStop:           { payloadSnippet: `(ConvertTo-Json @{ agentName = $(if ($env:AGENT_NAME) { $env:AGENT_NAME } elseif ($env:SUBAGENT_NAME) { $env:SUBAGENT_NAME } elseif ($env:AGENT_TYPE) { $env:AGENT_TYPE } elseif ($env:AGENT_TASK_NAME) { $env:AGENT_TASK_NAME } elseif ($env:AGENT_DISPLAY_NAME) { $env:AGENT_DISPLAY_NAME } elseif ($env:SUBAGENT_DISPLAY_NAME) { $env:SUBAGENT_DISPLAY_NAME } else { 'unknown' }); taskDescription = $(if ($env:TASK_DESC) { $env:TASK_DESC } else { '' }); description = $(if ($env:TASK_DESC) { $env:TASK_DESC } elseif ($env:AGENT_DESCRIPTION) { $env:AGENT_DESCRIPTION } elseif ($env:SUBAGENT_DESCRIPTION) { $env:SUBAGENT_DESCRIPTION } elseif ($env:REASON) { $env:REASON } else { '' }); agentType = $(if ($env:AGENT_TYPE) { $env:AGENT_TYPE } else { '' }); agentId = $(if ($env:AGENT_ID) { $env:AGENT_ID } elseif ($env:SUBAGENT_ID) { $env:SUBAGENT_ID } else { '' }); reason = $(if ($env:REASON) { $env:REASON } else { '' }); message = $(if ($env:AGENT_MESSAGE) { $env:AGENT_MESSAGE } elseif ($env:MESSAGE) { $env:MESSAGE } elseif ($env:TASK_DESC) { $env:TASK_DESC } elseif ($env:REASON) { $env:REASON } else { '' }); summary = $(if ($env:SUMMARY) { $env:SUMMARY } elseif ($env:MESSAGE) { $env:MESSAGE } elseif ($env:TASK_DESC) { $env:TASK_DESC } elseif ($env:REASON) { $env:REASON } else { '' }) } -Compress)`, sessionSnippet: `$(if ($env:SESSION_ID) { $env:SESSION_ID } else { "run-$PID" })` },
  errorOccurred:       { payloadSnippet: `(ConvertTo-Json @{ message = $(if ($env:MESSAGE) { $env:MESSAGE } else { 'unknown error' }); code = $(if ($env:CODE) { $env:CODE } else { '' }) } -Compress)`, sessionSnippet: `$(if ($env:SESSION_ID) { $env:SESSION_ID } else { "run-$PID" })` },
};

function buildEmitBlockPs1(emitScriptRelPath: string, eventType: string): string {
  // For postToolUse, generate a conditional block that routes to postToolUseFailure
  // when the Copilot CLI reports a failure result.
  if (eventType === "postToolUse") {
    return buildEmitBlockPs1PostToolUse(emitScriptRelPath);
  }
  const ps1Payload = PS1_PAYLOAD_MAP[eventType];
  const payloadExpr = ps1Payload?.payloadSnippet ?? "'{}'";
  const sessionExpr = ps1Payload?.sessionSnippet ?? '"run-$PID"';
  return [
    ``,
    `# --- Visualizer emit (auto-wired by bootstrap-existing-repo) ---`,
    STDIN_EXTRACTION_BLOCK_PS1,
    `$_vizScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path`,
    `$_vizRepoRoot = (Resolve-Path (Join-Path $_vizScriptDir ".." ".." "..")).Path`,
    `$_vizEmitScript = Join-Path $_vizRepoRoot "${emitScriptRelPath}"`,
    `if (Test-Path $_vizEmitScript) {`,
    `  try {`,
    `    $_vizPayload = ${payloadExpr}`,
    `    & $_vizEmitScript -EventType "${eventType}" -Payload $_vizPayload -SessionId ${sessionExpr} 2>&1 | Out-Null`,
    `  } catch { <# visualizer emit errors are intentionally silenced #> }`,
    `}`,
  ].join("\n");
}

function buildEmitBlockPs1PostToolUse(emitScriptRelPath: string): string {
  const sessionExpr = PS1_PAYLOAD_MAP.postToolUse?.sessionSnippet ?? '"run-$PID"';
  return [
    ``,
    `# --- Visualizer emit (auto-wired by bootstrap-existing-repo) ---`,
    STDIN_EXTRACTION_BLOCK_PS1,
    `$_vizScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path`,
    `$_vizRepoRoot = (Resolve-Path (Join-Path $_vizScriptDir ".." ".." "..")).Path`,
    `$_vizEmitScript = Join-Path $_vizRepoRoot "${emitScriptRelPath}"`,
    `if (Test-Path $_vizEmitScript) {`,
    `  try {`,
    `    if ($env:STATUS -eq 'failure' -or $env:STATUS -eq 'denied') {`,
    `      $_vizPayload = (ConvertTo-Json @{ toolName = $(if ($env:TOOL_NAME) { $env:TOOL_NAME } else { 'unknown' }); status = 'failure'; errorSummary = $(if ($env:ERROR_SUMMARY) { $env:ERROR_SUMMARY } else { '' }); toolArgs = $(if ($env:TOOL_ARGS) { try { $env:TOOL_ARGS | ConvertFrom-Json } catch { $env:TOOL_ARGS } } else { $null }); agentName = $(if ($env:AGENT_NAME) { $env:AGENT_NAME } elseif ($env:SUBAGENT_NAME) { $env:SUBAGENT_NAME } elseif ($env:AGENT_DISPLAY_NAME) { $env:AGENT_DISPLAY_NAME } else { '' }); agentDisplayName = $(if ($env:AGENT_DISPLAY_NAME) { $env:AGENT_DISPLAY_NAME } elseif ($env:SUBAGENT_DISPLAY_NAME) { $env:SUBAGENT_DISPLAY_NAME } else { '' }); taskDescription = $(if ($env:TASK_DESC) { $env:TASK_DESC } else { '' }); message = $(if ($env:AGENT_MESSAGE) { $env:AGENT_MESSAGE } elseif ($env:MESSAGE) { $env:MESSAGE } else { '' }); skillName = $(if ($env:SKILL_NAME) { $env:SKILL_NAME } else { '' }); skillId = $(if ($env:SKILL_ID) { $env:SKILL_ID } else { '' }); toolCallId = $(if ($env:TOOL_CALL_ID) { $env:TOOL_CALL_ID } else { '' }) } -Compress)`,
    `      & $_vizEmitScript -EventType "postToolUseFailure" -Payload $_vizPayload -SessionId ${sessionExpr} 2>&1 | Out-Null`,
    `    } else {`,
    `      $_vizPayload = (ConvertTo-Json @{ toolName = $(if ($env:TOOL_NAME) { $env:TOOL_NAME } else { 'unknown' }); status = 'success'; toolArgs = $(if ($env:TOOL_ARGS) { try { $env:TOOL_ARGS | ConvertFrom-Json } catch { $env:TOOL_ARGS } } else { $null }); agentName = $(if ($env:AGENT_NAME) { $env:AGENT_NAME } elseif ($env:SUBAGENT_NAME) { $env:SUBAGENT_NAME } elseif ($env:AGENT_DISPLAY_NAME) { $env:AGENT_DISPLAY_NAME } else { '' }); agentDisplayName = $(if ($env:AGENT_DISPLAY_NAME) { $env:AGENT_DISPLAY_NAME } elseif ($env:SUBAGENT_DISPLAY_NAME) { $env:SUBAGENT_DISPLAY_NAME } else { '' }); taskDescription = $(if ($env:TASK_DESC) { $env:TASK_DESC } else { '' }); message = $(if ($env:AGENT_MESSAGE) { $env:AGENT_MESSAGE } elseif ($env:MESSAGE) { $env:MESSAGE } else { '' }); skillName = $(if ($env:SKILL_NAME) { $env:SKILL_NAME } else { '' }); skillId = $(if ($env:SKILL_ID) { $env:SKILL_ID } else { '' }); toolCallId = $(if ($env:TOOL_CALL_ID) { $env:TOOL_CALL_ID } else { '' }) } -Compress)`,
    `      & $_vizEmitScript -EventType "postToolUse" -Payload $_vizPayload -SessionId ${sessionExpr} 2>&1 | Out-Null`,
    `    }`,
    `  } catch { <# visualizer emit errors are intentionally silenced #> }`,
    `}`,
  ].join("\n");
}

/** Recursively collect all .sh and .ps1 files under a directory. */
async function findHookScripts(dir: string): Promise<{ relPath: string; absPath: string }[]> {
  const results: { relPath: string; absPath: string }[] = [];

  async function walk(currentDir: string, relBase: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const absEntry = join(currentDir, entry);
      const relEntry = relBase ? join(relBase, entry) : entry;
      const info = await stat(absEntry);

      if (info.isDirectory()) {
        await walk(absEntry, relEntry);
      } else if (info.isFile() && (entry.endsWith(".sh") || entry.endsWith(".ps1"))) {
        results.push({ relPath: relEntry, absPath: absEntry });
      }
    }
  }

  await walk(dir, "");
  return results;
}

function buildStubScript(eventType: string, payloadSnippet: string, sessionSnippet: string, emitScriptRelPath: string): string {
  // For postToolUse, generate a conditional stub that routes to postToolUseFailure
  // when the Copilot CLI reports a failure result.
  if (eventType === "postToolUse") {
    return buildStubScriptPostToolUse(sessionSnippet, emitScriptRelPath);
  }
  return `#!/usr/bin/env bash
set -euo pipefail
# Stub hook generated by bootstrap-existing-repo.
# Copilot CLI passes hook context as JSON on stdin.
# Add your custom logic above the visualizer emit block below.

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

${STDIN_EXTRACTION_BLOCK}

# --- Visualizer emit (auto-wired by bootstrap-existing-repo) ---
if [ -x "\${REPO_ROOT}/${emitScriptRelPath}" ]; then
  _VIZ_PAYLOAD=${payloadSnippet}
  "\${REPO_ROOT}/${emitScriptRelPath}" ${eventType} "\${_VIZ_PAYLOAD}" ${sessionSnippet} >&2 || true
fi

exit 0
`;
}

function buildStubScriptPostToolUse(sessionSnippet: string, emitScriptRelPath: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail
# Stub hook generated by bootstrap-existing-repo.
# Copilot CLI passes hook context as JSON on stdin.
# The Copilot CLI fires a single postToolUse hook for both success and failure.
# This stub routes to the correct visualizer event type based on toolResult.resultType.

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

${STDIN_EXTRACTION_BLOCK}

# --- Visualizer emit (auto-wired by bootstrap-existing-repo) ---
if [ -x "\${REPO_ROOT}/${emitScriptRelPath}" ]; then
  if [ "\${STATUS}" = "failure" ] || [ "\${STATUS}" = "denied" ]; then
    _VIZ_PAYLOAD=$(jq -nc --arg tool "\${TOOL_NAME:-unknown}" --arg err "\${ERROR_SUMMARY:-}" --arg agent "${TOOL_CONTEXT_AGENT_FALLBACK}" --arg agentDisplay "${TOOL_CONTEXT_DISPLAY_NAME_FALLBACK}" --arg task "\${TASK_DESC:-}" --arg message "\${AGENT_MESSAGE:-\${MESSAGE:-\${SUMMARY:-}}}" --arg skill "\${SKILL_NAME:-}" --arg skillId "\${SKILL_ID:-}" --arg callId "\${TOOL_CALL_ID:-}" --arg toolArgsRaw "\${TOOL_ARGS:-}" '{"toolName":$tool,"status":"failure","errorSummary":$err} + (if ($toolArgsRaw|length)>0 then (try (($toolArgsRaw|fromjson) as $args | {"toolArgs":$args}) catch {"toolArgsText":$toolArgsRaw}) else {} end) + (if ($agent|length)>0 then {"agentName":$agent} else {} end) + (if ($agentDisplay|length)>0 then {"agentDisplayName":$agentDisplay} else {} end) + (if ($task|length)>0 then {"taskDescription":$task} else {} end) + (if ($message|length)>0 then {"message":$message} else {} end) + (if ($skill|length)>0 then {"skillName":$skill} else {} end) + (if ($skillId|length)>0 then {"skillId":$skillId} else {} end) + (if ($callId|length)>0 then {"toolCallId":$callId} else {} end)' 2>/dev/null || echo '{}')
    "\${REPO_ROOT}/${emitScriptRelPath}" postToolUseFailure "\${_VIZ_PAYLOAD}" ${sessionSnippet} >&2 || true
  else
    _VIZ_PAYLOAD=$(jq -nc --arg tool "\${TOOL_NAME:-unknown}" --arg agent "${TOOL_CONTEXT_AGENT_FALLBACK}" --arg agentDisplay "${TOOL_CONTEXT_DISPLAY_NAME_FALLBACK}" --arg task "\${TASK_DESC:-}" --arg message "\${AGENT_MESSAGE:-\${MESSAGE:-\${SUMMARY:-}}}" --arg skill "\${SKILL_NAME:-}" --arg skillId "\${SKILL_ID:-}" --arg callId "\${TOOL_CALL_ID:-}" --arg toolArgsRaw "\${TOOL_ARGS:-}" '{"toolName":$tool,"status":"success"} + (if ($toolArgsRaw|length)>0 then (try (($toolArgsRaw|fromjson) as $args | {"toolArgs":$args}) catch {"toolArgsText":$toolArgsRaw}) else {} end) + (if ($agent|length)>0 then {"agentName":$agent} else {} end) + (if ($agentDisplay|length)>0 then {"agentDisplayName":$agentDisplay} else {} end) + (if ($task|length)>0 then {"taskDescription":$task} else {} end) + (if ($message|length)>0 then {"message":$message} else {} end) + (if ($skill|length)>0 then {"skillName":$skill} else {} end) + (if ($skillId|length)>0 then {"skillId":$skillId} else {} end) + (if ($callId|length)>0 then {"toolCallId":$callId} else {} end)' 2>/dev/null || echo '{}')
    "\${REPO_ROOT}/${emitScriptRelPath}" postToolUse "\${_VIZ_PAYLOAD}" ${sessionSnippet} >&2 || true
  fi
fi

exit 0
`;
}

function buildStubScriptPs1(eventType: string, emitScriptRelPath: string): string {
  // For postToolUse, generate a conditional stub that routes to postToolUseFailure
  // when the Copilot CLI reports a failure result.
  if (eventType === "postToolUse") {
    return buildStubScriptPs1PostToolUse(emitScriptRelPath);
  }
  const ps1Payload = PS1_PAYLOAD_MAP[eventType];
  const payloadExpr = ps1Payload?.payloadSnippet ?? "'{}'";
  const sessionExpr = ps1Payload?.sessionSnippet ?? '"run-$PID"';
  return `# Stub hook generated by bootstrap-existing-repo.
# Copilot CLI passes hook context as JSON on stdin.
# Add your custom logic above the visualizer emit block below.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir ".." ".." "..")).Path

${STDIN_EXTRACTION_BLOCK_PS1}

# --- Visualizer emit (auto-wired by bootstrap-existing-repo) ---
$_vizEmitScript = Join-Path $RepoRoot "${emitScriptRelPath}"
if (Test-Path $_vizEmitScript) {
  try {
    $_vizPayload = ${payloadExpr}
    & $_vizEmitScript -EventType "${eventType}" -Payload $_vizPayload -SessionId ${sessionExpr} 2>&1 | Out-Null
  } catch { <# visualizer emit errors are intentionally silenced #> }
}

exit 0
`;
}

function buildStubScriptPs1PostToolUse(emitScriptRelPath: string): string {
  const sessionExpr = PS1_PAYLOAD_MAP.postToolUse?.sessionSnippet ?? '"run-$PID"';
  return `# Stub hook generated by bootstrap-existing-repo.
# Copilot CLI passes hook context as JSON on stdin.
# The Copilot CLI fires a single postToolUse hook for both success and failure.
# This stub routes to the correct visualizer event type based on toolResult.resultType.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir ".." ".." "..")).Path

${STDIN_EXTRACTION_BLOCK_PS1}

# --- Visualizer emit (auto-wired by bootstrap-existing-repo) ---
$_vizEmitScript = Join-Path $RepoRoot "${emitScriptRelPath}"
if (Test-Path $_vizEmitScript) {
  try {
    if ($env:STATUS -eq 'failure' -or $env:STATUS -eq 'denied') {
      $_vizPayload = (ConvertTo-Json @{ toolName = $(if ($env:TOOL_NAME) { $env:TOOL_NAME } else { 'unknown' }); status = 'failure'; errorSummary = $(if ($env:ERROR_SUMMARY) { $env:ERROR_SUMMARY } else { '' }); toolArgs = $(if ($env:TOOL_ARGS) { try { $env:TOOL_ARGS | ConvertFrom-Json } catch { $env:TOOL_ARGS } } else { $null }); agentName = $(if ($env:AGENT_NAME) { $env:AGENT_NAME } elseif ($env:SUBAGENT_NAME) { $env:SUBAGENT_NAME } elseif ($env:AGENT_DISPLAY_NAME) { $env:AGENT_DISPLAY_NAME } else { '' }); agentDisplayName = $(if ($env:AGENT_DISPLAY_NAME) { $env:AGENT_DISPLAY_NAME } elseif ($env:SUBAGENT_DISPLAY_NAME) { $env:SUBAGENT_DISPLAY_NAME } else { '' }); taskDescription = $(if ($env:TASK_DESC) { $env:TASK_DESC } else { '' }); message = $(if ($env:AGENT_MESSAGE) { $env:AGENT_MESSAGE } elseif ($env:MESSAGE) { $env:MESSAGE } else { '' }); skillName = $(if ($env:SKILL_NAME) { $env:SKILL_NAME } else { '' }); skillId = $(if ($env:SKILL_ID) { $env:SKILL_ID } else { '' }); toolCallId = $(if ($env:TOOL_CALL_ID) { $env:TOOL_CALL_ID } else { '' }) } -Compress)
      & $_vizEmitScript -EventType "postToolUseFailure" -Payload $_vizPayload -SessionId ${sessionExpr} 2>&1 | Out-Null
    } else {
      $_vizPayload = (ConvertTo-Json @{ toolName = $(if ($env:TOOL_NAME) { $env:TOOL_NAME } else { 'unknown' }); status = 'success'; toolArgs = $(if ($env:TOOL_ARGS) { try { $env:TOOL_ARGS | ConvertFrom-Json } catch { $env:TOOL_ARGS } } else { $null }); agentName = $(if ($env:AGENT_NAME) { $env:AGENT_NAME } elseif ($env:SUBAGENT_NAME) { $env:SUBAGENT_NAME } elseif ($env:AGENT_DISPLAY_NAME) { $env:AGENT_DISPLAY_NAME } else { '' }); agentDisplayName = $(if ($env:AGENT_DISPLAY_NAME) { $env:AGENT_DISPLAY_NAME } elseif ($env:SUBAGENT_DISPLAY_NAME) { $env:SUBAGENT_DISPLAY_NAME } else { '' }); taskDescription = $(if ($env:TASK_DESC) { $env:TASK_DESC } else { '' }); message = $(if ($env:AGENT_MESSAGE) { $env:AGENT_MESSAGE } elseif ($env:MESSAGE) { $env:MESSAGE } else { '' }); skillName = $(if ($env:SKILL_NAME) { $env:SKILL_NAME } else { '' }); skillId = $(if ($env:SKILL_ID) { $env:SKILL_ID } else { '' }); toolCallId = $(if ($env:TOOL_CALL_ID) { $env:TOOL_CALL_ID } else { '' }) } -Compress)
      & $_vizEmitScript -EventType "postToolUse" -Payload $_vizPayload -SessionId ${sessionExpr} 2>&1 | Out-Null
    }
  } catch { <# visualizer emit errors are intentionally silenced #> }
}

exit 0
`;
}

// ── Vanilla stub script generators ─────────────────────────────────────
// These generate minimal hook scripts that log the raw Copilot CLI stdin
// JSON to a JSONL file with no transformations, no env var extraction,
// no enrichment, and no emit-event dependency.

/** Per-hook jq extraction snippets for vanilla bash stubs. */
const VANILLA_BASH_EXTRACTS: Record<string, string> = {
  sessionStart: [
    `TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')`,
    `SOURCE=$(echo "$INPUT" | jq -r '.source // empty')`,
    `CWD=$(echo "$INPUT" | jq -r '.cwd // empty')`,
    ``,
    `jq -n \\`,
    `  --arg event "sessionStart" \\`,
    `  --arg ts "$TIMESTAMP" \\`,
    `  --arg source "$SOURCE" \\`,
    `  --arg cwd "$CWD" \\`,
    `  '{event: $event, timestamp: $ts, source: $source, cwd: $cwd}' \\`,
    `  >> "$LOG_DIR/events.jsonl"`,
  ].join("\n"),
  sessionEnd: [
    `TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')`,
    `REASON=$(echo "$INPUT" | jq -r '.reason // empty')`,
    `CWD=$(echo "$INPUT" | jq -r '.cwd // empty')`,
    ``,
    `jq -n \\`,
    `  --arg event "sessionEnd" \\`,
    `  --arg ts "$TIMESTAMP" \\`,
    `  --arg reason "$REASON" \\`,
    `  --arg cwd "$CWD" \\`,
    `  '{event: $event, timestamp: $ts, reason: $reason, cwd: $cwd}' \\`,
    `  >> "$LOG_DIR/events.jsonl"`,
  ].join("\n"),
  userPromptSubmitted: [
    `TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')`,
    `PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')`,
    `CWD=$(echo "$INPUT" | jq -r '.cwd // empty')`,
    ``,
    `# Prompts may contain sensitive data. Consider redacting before persisting.`,
    `jq -n \\`,
    `  --arg event "userPromptSubmitted" \\`,
    `  --arg ts "$TIMESTAMP" \\`,
    `  --arg prompt "$PROMPT" \\`,
    `  --arg cwd "$CWD" \\`,
    `  '{event: $event, timestamp: $ts, prompt: $prompt, cwd: $cwd}' \\`,
    `  >> "$LOG_DIR/events.jsonl"`,
  ].join("\n"),
  preToolUse: [
    `TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')`,
    `TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName // empty')`,
    `TOOL_ARGS=$(echo "$INPUT" | jq -r '.toolArgs // empty')`,
    `CWD=$(echo "$INPUT" | jq -r '.cwd // empty')`,
    ``,
    `jq -n \\`,
    `  --arg event "preToolUse" \\`,
    `  --arg ts "$TIMESTAMP" \\`,
    `  --arg tool "$TOOL_NAME" \\`,
    `  --arg args "$TOOL_ARGS" \\`,
    `  --arg cwd "$CWD" \\`,
    `  '{event: $event, timestamp: $ts, toolName: $tool, toolArgs: $args, cwd: $cwd}' \\`,
    `  >> "$LOG_DIR/events.jsonl"`,
  ].join("\n"),
  postToolUse: [
    `TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')`,
    `TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName // empty')`,
    `RESULT_TYPE=$(echo "$INPUT" | jq -r '.toolResult.resultType // empty')`,
    `CWD=$(echo "$INPUT" | jq -r '.cwd // empty')`,
    ``,
    `jq -n \\`,
    `  --arg event "postToolUse" \\`,
    `  --arg ts "$TIMESTAMP" \\`,
    `  --arg tool "$TOOL_NAME" \\`,
    `  --arg result "$RESULT_TYPE" \\`,
    `  --arg cwd "$CWD" \\`,
    `  '{event: $event, timestamp: $ts, toolName: $tool, resultType: $result, cwd: $cwd}' \\`,
    `  >> "$LOG_DIR/events.jsonl"`,
  ].join("\n"),
  agentStop: [
    `TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')`,
    `CWD=$(echo "$INPUT" | jq -r '.cwd // empty')`,
    ``,
    `# agentStop payload is not fully documented — log the complete raw input.`,
    `jq -n \\`,
    `  --arg event "agentStop" \\`,
    `  --arg ts "$TIMESTAMP" \\`,
    `  --arg cwd "$CWD" \\`,
    `  --argjson raw "$INPUT" \\`,
    `  '{event: $event, timestamp: $ts, cwd: $cwd, rawPayload: $raw}' \\`,
    `  >> "$LOG_DIR/events.jsonl"`,
  ].join("\n"),
  subagentStop: [
    `TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')`,
    `CWD=$(echo "$INPUT" | jq -r '.cwd // empty')`,
    ``,
    `# subagentStop payload is not fully documented — log the complete raw input.`,
    `jq -n \\`,
    `  --arg event "subagentStop" \\`,
    `  --arg ts "$TIMESTAMP" \\`,
    `  --arg cwd "$CWD" \\`,
    `  --argjson raw "$INPUT" \\`,
    `  '{event: $event, timestamp: $ts, cwd: $cwd, rawPayload: $raw}' \\`,
    `  >> "$LOG_DIR/events.jsonl"`,
  ].join("\n"),
  errorOccurred: [
    `TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')`,
    `ERROR_MSG=$(echo "$INPUT" | jq -r '.error.message // empty')`,
    `ERROR_NAME=$(echo "$INPUT" | jq -r '.error.name // empty')`,
    `CWD=$(echo "$INPUT" | jq -r '.cwd // empty')`,
    ``,
    `jq -n \\`,
    `  --arg event "errorOccurred" \\`,
    `  --arg ts "$TIMESTAMP" \\`,
    `  --arg msg "$ERROR_MSG" \\`,
    `  --arg name "$ERROR_NAME" \\`,
    `  --arg cwd "$CWD" \\`,
    `  '{event: $event, timestamp: $ts, errorMessage: $msg, errorName: $name, cwd: $cwd}' \\`,
    `  >> "$LOG_DIR/events.jsonl"`,
  ].join("\n"),
};

/** Per-hook PowerShell extraction snippets for vanilla PS1 stubs. */
const VANILLA_PS1_EXTRACTS: Record<string, { logFields: string }> = {
  sessionStart:        { logFields: `    event     = "sessionStart"\n    timestamp = $inputObj.timestamp\n    source    = $inputObj.source\n    cwd       = $inputObj.cwd` },
  sessionEnd:          { logFields: `    event     = "sessionEnd"\n    timestamp = $inputObj.timestamp\n    reason    = $inputObj.reason\n    cwd       = $inputObj.cwd` },
  userPromptSubmitted: { logFields: `    event     = "userPromptSubmitted"\n    timestamp = $inputObj.timestamp\n    prompt    = $inputObj.prompt\n    cwd       = $inputObj.cwd` },
  preToolUse:          { logFields: `    event     = "preToolUse"\n    timestamp = $inputObj.timestamp\n    toolName  = $inputObj.toolName\n    toolArgs  = $inputObj.toolArgs\n    cwd       = $inputObj.cwd` },
  postToolUse:         { logFields: `    event      = "postToolUse"\n    timestamp  = $inputObj.timestamp\n    toolName   = $inputObj.toolName\n    resultType = $inputObj.toolResult.resultType\n    cwd        = $inputObj.cwd` },
  agentStop:           { logFields: `    event      = "agentStop"\n    timestamp  = $inputObj.timestamp\n    cwd        = $inputObj.cwd\n    rawPayload = $inputObj` },
  subagentStop:        { logFields: `    event      = "subagentStop"\n    timestamp  = $inputObj.timestamp\n    cwd        = $inputObj.cwd\n    rawPayload = $inputObj` },
  errorOccurred:       { logFields: `    event        = "errorOccurred"\n    timestamp    = $inputObj.timestamp\n    errorMessage = $inputObj.error.message\n    errorName    = $inputObj.error.name\n    cwd          = $inputObj.cwd` },
};

export function buildVanillaStubScript(eventType: string): string {
  const extract = VANILLA_BASH_EXTRACTS[eventType];
  if (!extract) {
    return `#!/usr/bin/env bash
set -euo pipefail
# Vanilla hook stub — logs raw stdin JSON.
INPUT=$(cat)
LOG_DIR=".github/hooks/logs"
mkdir -p "$LOG_DIR"
echo "$INPUT" >> "$LOG_DIR/events.jsonl"
exit 0
`;
  }
  return `#!/usr/bin/env bash
set -euo pipefail
# Vanilla ${eventType} hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.

INPUT=$(cat)

LOG_DIR=".github/hooks/logs"
mkdir -p "$LOG_DIR"

${extract}

exit 0
`;
}

export function buildVanillaStubScriptPs1(eventType: string): string {
  const extract = VANILLA_PS1_EXTRACTS[eventType];
  if (!extract) {
    return `# Vanilla hook stub — logs raw stdin JSON.
$ErrorActionPreference = "Stop"
$inputObj = [Console]::In.ReadToEnd() | ConvertFrom-Json
$logDir = ".github/hooks/logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$inputObj | ConvertTo-Json -Compress | Add-Content -Path "$logDir/events.jsonl"
exit 0
`;
  }
  return `# Vanilla ${eventType} hook — logs the raw Copilot CLI payload.
# No transformations, no env var extraction, no fallback cascades.
$ErrorActionPreference = "Stop"

$inputObj = [Console]::In.ReadToEnd() | ConvertFrom-Json

$logDir = ".github/hooks/logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

$logEntry = @{
${extract.logFields}
} | ConvertTo-Json -Compress

Add-Content -Path "$logDir/events.jsonl" -Value $logEntry
exit 0
`;
}

async function createStubHooks(targetRepo: string, prefix?: string): Promise<number> {
  const hooksDir = join(targetRepo, ".github", "hooks", VISUALIZER_HOOKS_SUBDIR);
  await mkdir(hooksDir, { recursive: true });

  let created = 0;
  for (const canonical of CANONICAL_HOOK_NAMES) {
    const stubName = prefix ? `${prefix}-${canonical}` : canonical;
    const mapping = HOOK_MAP[canonical];
    if (!mapping) continue;

    // Create bash stub (.sh)
    const stubPath = join(hooksDir, stubName);
    try {
      await access(stubPath, constants.F_OK);
      console.log(`  EXISTS ${stubName} — not overwriting`);
    } catch {
      const script = buildStubScript(
        mapping.eventType,
        mapping.payloadSnippet,
        mapping.sessionSnippet,
        ".visualizer/emit-event.sh"
      );
      await writeFile(stubPath, script, "utf8");
      await chmod(stubPath, 0o755);
      console.log(`  CREATE ${stubName} → ${mapping.eventType}`);
      created += 1;
    }

    // Create PowerShell stub (.ps1)
    const ps1Name = stubName.replace(/\.sh$/, ".ps1");
    const ps1Path = join(hooksDir, ps1Name);
    try {
      await access(ps1Path, constants.F_OK);
      console.log(`  EXISTS ${ps1Name} — not overwriting`);
    } catch {
      const ps1Script = buildStubScriptPs1(mapping.eventType, ".visualizer/emit-event.ps1");
      await writeFile(ps1Path, ps1Script, "utf8");
      console.log(`  CREATE ${ps1Name} → ${mapping.eventType}`);
      created += 1;
    }
  }

  return created;
}

async function createVanillaStubHooks(targetRepo: string, prefix?: string): Promise<number> {
  const hooksDir = join(targetRepo, ".github", "hooks", VISUALIZER_HOOKS_SUBDIR);
  await mkdir(hooksDir, { recursive: true });

  // Ensure the logs directory exists
  const logsDir = join(targetRepo, ".github", "hooks", "logs");
  await mkdir(logsDir, { recursive: true });

  let created = 0;
  for (const canonical of CANONICAL_HOOK_NAMES) {
    const stubName = prefix ? `${prefix}-${canonical}` : canonical;
    const mapping = HOOK_MAP[canonical];
    if (!mapping) continue;

    // Create vanilla bash stub (.sh)
    const stubPath = join(hooksDir, stubName);
    try {
      await access(stubPath, constants.F_OK);
      console.log(`  EXISTS ${stubName} — not overwriting`);
    } catch {
      const script = buildVanillaStubScript(mapping.eventType);
      await writeFile(stubPath, script, "utf8");
      await chmod(stubPath, 0o755);
      console.log(`  CREATE ${stubName} → ${mapping.eventType} (vanilla)`);
      created += 1;
    }

    // Create vanilla PowerShell stub (.ps1)
    const ps1Name = stubName.replace(/\.sh$/, ".ps1");
    const ps1Path = join(hooksDir, ps1Name);
    try {
      await access(ps1Path, constants.F_OK);
      console.log(`  EXISTS ${ps1Name} — not overwriting`);
    } catch {
      const ps1Script = buildVanillaStubScriptPs1(mapping.eventType);
      await writeFile(ps1Path, ps1Script, "utf8");
      console.log(`  CREATE ${ps1Name} → ${mapping.eventType} (vanilla)`);
      created += 1;
    }
  }

  return created;
}

async function findJsonFiles(dir: string): Promise<{ relPath: string; absPath: string }[]> {
  const results: { relPath: string; absPath: string }[] = [];

  async function walk(currentDir: string, relBase: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const absEntry = join(currentDir, entry);
      const relEntry = relBase ? join(relBase, entry) : entry;
      const info = await stat(absEntry);

      if (info.isDirectory()) {
        await walk(absEntry, relEntry);
      } else if (info.isFile() && entry.endsWith(".json")) {
        results.push({ relPath: relEntry, absPath: absEntry });
      }
    }
  }

  await walk(dir, "");
  return results;
}

async function syncHookManifests(
  targetRepo: string,
  coveredEvents: ReadonlySet<string>,
  prefix?: string
): Promise<void> {
  const hooksDir = join(targetRepo, ".github", "hooks");

  // Always create the dedicated visualizer manifest with all covered events
  await createVisualizerManifest(hooksDir, coveredEvents, prefix);

  const manifests = await findJsonFiles(hooksDir);

  const orderedCoveredEvents = CANONICAL_HOOK_NAMES
    .map((hookName) => HOOK_MAP[hookName].eventType)
    .filter((eventType, idx, list) => list.indexOf(eventType) === idx)
    .filter((eventType) => coveredEvents.has(eventType));

  for (const { relPath, absPath } of manifests) {
    // Skip the visualizer's own manifest — it was just created above
    if (basename(relPath) === VISUALIZER_MANIFEST_NAME) {
      continue;
    }

    const manifestLabel = `.github/hooks/${relPath.replaceAll("\\", "/")}`;

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(absPath, "utf8"));
    } catch {
      console.log(`\nSKIP  ${manifestLabel} — invalid JSON (left unchanged)`);
      continue;
    }

    if (!isCompatibleHookManifest(parsed)) {
      console.log(`\nSKIP  ${manifestLabel} — no hooks object`);
      continue;
    }

    const { updated, addedEvents } = updateEjsHooksManifest(parsed, orderedCoveredEvents, prefix);
    if (addedEvents.length === 0) {
      console.log(`\nOK    ${manifestLabel} — already includes mapped hooks`);
      continue;
    }

    await writeFile(absPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    console.log(`\nPATCH ${manifestLabel} — added: ${addedEvents.join(", ")}`);
  }
}

/**
 * Creates (or overwrites) the dedicated visualizer-hooks.json manifest in
 * .github/hooks/. This manifest declares every covered lifecycle event with
 * its corresponding hook command, serving as the single source of truth for
 * what the visualizer expects to capture.
 */
async function createVisualizerManifest(
  hooksDir: string,
  coveredEvents: ReadonlySet<string>,
  prefix?: string
): Promise<void> {
  const vizDir = join(hooksDir, VISUALIZER_HOOKS_SUBDIR);
  await mkdir(vizDir, { recursive: true });

  const allEvents = CANONICAL_HOOK_NAMES
    .map((hookName) => HOOK_MAP[hookName].eventType)
    .filter((eventType, idx, list) => list.indexOf(eventType) === idx)
    .filter((eventType) => coveredEvents.has(eventType));

  if (allEvents.length === 0) {
    console.log(`\nSKIP  .github/hooks/${VISUALIZER_HOOKS_SUBDIR}/${VISUALIZER_MANIFEST_NAME} — no covered events (manifest not created)`);
    return;
  }

  const hooks: Record<string, HookCommand[]> = {};
  for (const eventType of allEvents) {
    const cmd = buildManifestCommand(eventType, prefix);
    if (cmd) {
      hooks[eventType] = [cmd];
    }
  }

  const manifest = {
    version: 1,
    description: "Auto-generated by Copilot Activity Visualiser bootstrap. This is the canonical manifest for visualizer event capture.",
    hooks,
  };

  const manifestPath = join(vizDir, VISUALIZER_MANIFEST_NAME);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`\nCREATE .github/hooks/${VISUALIZER_HOOKS_SUBDIR}/${VISUALIZER_MANIFEST_NAME} — ${allEvents.length} event types`);
}

async function wireHooks(targetRepo: string, prefix?: string, createHooks?: boolean, vanilla?: boolean): Promise<void> {
  const hooksDir = join(targetRepo, ".github", "hooks");
  const createFn = vanilla ? createVanillaStubHooks : createStubHooks;
  const modeLabel = vanilla ? " (vanilla)" : "";

  let hooksDirExists = true;
  try {
    await access(hooksDir, constants.F_OK);
  } catch {
    hooksDirExists = false;
  }

  // If no hooks directory and --create-hooks was requested, create stubs
  if (!hooksDirExists) {
    if (createHooks) {
      console.log(`\nNo .github/hooks/ directory found — creating stub hooks${modeLabel}:`);
      const created = await createFn(targetRepo, prefix);
      const finalFiles = await findHookScripts(hooksDir);
      const finalCoveredEvents = new Set<string>();
      for (const { relPath } of finalFiles) {
        const match = matchHookFilename(relPath, prefix);
        if (match) finalCoveredEvents.add(match.eventType);
      }
      await syncHookManifests(targetRepo, finalCoveredEvents, prefix);
      console.log(`\nCreated ${created} stub hook scripts${modeLabel} in ${hooksDir}`);
      return;
    }
    console.log("\nNo .github/hooks/ directory found — skipping hook wiring.");
    console.log("Tip: re-run with --create-hooks to generate stub hooks automatically.");
    console.log("To wire manually, see .visualizer/HOOK_INTEGRATION.md");
    return;
  }

  // Recursively find all .sh and .ps1 files in hooks dir and subdirectories
  const hookFiles = await findHookScripts(hooksDir);

  if (hookFiles.length === 0) {
    if (createHooks) {
      console.log(`\nNo hook scripts found in .github/hooks/ — creating stub hooks${modeLabel}:`);
      const created = await createFn(targetRepo, prefix);
      const finalFiles = await findHookScripts(hooksDir);
      const finalCoveredEvents = new Set<string>();
      for (const { relPath } of finalFiles) {
        const match = matchHookFilename(relPath, prefix);
        if (match) finalCoveredEvents.add(match.eventType);
      }
      await syncHookManifests(targetRepo, finalCoveredEvents, prefix);
      console.log(`\nCreated ${created} stub hook scripts${modeLabel} in ${hooksDir}`);
      return;
    }
    console.log("\nNo hook scripts found in .github/hooks/ — skipping hook wiring.");
    console.log("Tip: re-run with --create-hooks to generate stub hooks automatically.");
    return;
  }

  // In vanilla mode, skip auto-wiring existing hooks — only create stubs
  if (vanilla) {
    console.log(`\nVanilla mode — skipping auto-wiring of existing hook scripts.`);
    if (createHooks) {
      const coveredEvents = new Set<string>();
      for (const { relPath } of hookFiles) {
        const m = matchHookFilename(relPath, prefix);
        if (m) coveredEvents.add(m.eventType);
      }
      const missingCanonical = CANONICAL_HOOK_NAMES.filter(
        (name) => !coveredEvents.has(HOOK_MAP[name].eventType)
      );
      if (missingCanonical.length > 0) {
        const vizHooksDir = join(hooksDir, VISUALIZER_HOOKS_SUBDIR);
        await mkdir(vizHooksDir, { recursive: true });
        const logsDir = join(targetRepo, ".github", "hooks", "logs");
        await mkdir(logsDir, { recursive: true });
        console.log(`\nCreating vanilla stub hooks for uncovered event types:`);
        let created = 0;
        for (const canonical of missingCanonical) {
          const mapping = HOOK_MAP[canonical];
          const stubName = prefix ? `${prefix}-${canonical}` : canonical;
          const stubPath = join(vizHooksDir, stubName);
          try {
            await access(stubPath, constants.F_OK);
            console.log(`  EXISTS ${VISUALIZER_HOOKS_SUBDIR}/${stubName} — not overwriting`);
          } catch {
            const script = buildVanillaStubScript(mapping.eventType);
            await writeFile(stubPath, script, "utf8");
            await chmod(stubPath, 0o755);
            console.log(`  CREATE ${VISUALIZER_HOOKS_SUBDIR}/${stubName} → ${mapping.eventType} (vanilla)`);
            created += 1;
          }
          const ps1Name = stubName.replace(/\.sh$/, ".ps1");
          const ps1Path = join(vizHooksDir, ps1Name);
          try {
            await access(ps1Path, constants.F_OK);
            console.log(`  EXISTS ${VISUALIZER_HOOKS_SUBDIR}/${ps1Name} — not overwriting`);
          } catch {
            const ps1Script = buildVanillaStubScriptPs1(mapping.eventType);
            await writeFile(ps1Path, ps1Script, "utf8");
            console.log(`  CREATE ${VISUALIZER_HOOKS_SUBDIR}/${ps1Name} → ${mapping.eventType} (vanilla)`);
            created += 1;
          }
        }
        console.log(`\nCreated ${created} vanilla stub hook scripts.`);
      }
    }

    const finalFiles = await findHookScripts(hooksDir);
    const finalCoveredEvents = new Set<string>();
    for (const { relPath } of finalFiles) {
      const match = matchHookFilename(relPath, prefix);
      if (match) finalCoveredEvents.add(match.eventType);
    }
    await syncHookManifests(targetRepo, finalCoveredEvents, prefix);
    return;
  }

  console.log(`\nAuto-wiring hooks in ${hooksDir}:`);
  let wired = 0;
  let skipped = 0;

  for (const { relPath, absPath } of hookFiles) {
    const mapping = matchHookFilename(relPath, prefix);
    if (!mapping) {
      console.log(`  SKIP  ${relPath} — no event type mapping (add manually if needed)`);
      skipped += 1;
      continue;
    }

    const content = await readFile(absPath, "utf8");
    const isPs1 = relPath.toLowerCase().endsWith(".ps1");

    if (isPs1) {
      // PowerShell wiring
      if (content.includes("emit-event.ps1")) {
        console.log(`  OK    ${relPath} — already wired`);
        skipped += 1;
        continue;
      }

      const emitBlock = buildEmitBlockPs1(".visualizer/emit-event.ps1", mapping.eventType);

      const exitPatternPs1 = /^exit 0\s*$/m;
      const updated = exitPatternPs1.test(content)
        ? content.replace(exitPatternPs1, `${emitBlock}\n\nexit 0`)
        : content + emitBlock + "\n";

      await writeFile(absPath, updated, "utf8");
      console.log(`  WIRED ${relPath} → ${mapping.eventType}`);
      wired += 1;
    } else {
      // Bash wiring
      if (content.includes(".visualizer/emit-event.sh")) {
        console.log(`  OK    ${relPath} — already wired`);
        skipped += 1;
        continue;
      }

      const emitBlock = buildEmitBlock(
        ".visualizer/emit-event.sh",
        mapping.eventType,
        mapping.payloadSnippet,
        mapping.sessionSnippet
      );

      const exitPattern = /^exit 0\s*$/m;
      const updated = exitPattern.test(content)
        ? content.replace(exitPattern, `${emitBlock}\n\nexit 0`)
        : content + emitBlock + "\n";

      await writeFile(absPath, updated, "utf8");
      console.log(`  WIRED ${relPath} → ${mapping.eventType}`);
      wired += 1;
    }
  }

  // If --create-hooks and nothing was wired, also create stubs for missing event types
  if (createHooks) {
    const coveredEvents = new Set<string>();
    for (const { relPath } of hookFiles) {
      const m = matchHookFilename(relPath, prefix);
      if (m) coveredEvents.add(m.eventType);
    }
    const missingCanonical = CANONICAL_HOOK_NAMES.filter(
      (name) => !coveredEvents.has(HOOK_MAP[name].eventType)
    );
    if (missingCanonical.length > 0) {
      const vizHooksDir = join(hooksDir, VISUALIZER_HOOKS_SUBDIR);
      await mkdir(vizHooksDir, { recursive: true });
      console.log(`\nCreating stub hooks for uncovered event types:`);
      for (const canonical of missingCanonical) {
        const mapping = HOOK_MAP[canonical];

        // Create bash stub
        const stubName = prefix ? `${prefix}-${canonical}` : canonical;
        const stubPath = join(vizHooksDir, stubName);
        try {
          await access(stubPath, constants.F_OK);
          console.log(`  EXISTS ${VISUALIZER_HOOKS_SUBDIR}/${stubName} — not overwriting`);
        } catch {
          const script = buildStubScript(
            mapping.eventType,
            mapping.payloadSnippet,
            mapping.sessionSnippet,
            ".visualizer/emit-event.sh"
          );
          await writeFile(stubPath, script, "utf8");
          await chmod(stubPath, 0o755);
          console.log(`  CREATE ${VISUALIZER_HOOKS_SUBDIR}/${stubName} → ${mapping.eventType}`);
          wired += 1;
        }

        // Create PowerShell stub
        const ps1Name = stubName.replace(/\.sh$/, ".ps1");
        const ps1Path = join(vizHooksDir, ps1Name);
        try {
          await access(ps1Path, constants.F_OK);
          console.log(`  EXISTS ${VISUALIZER_HOOKS_SUBDIR}/${ps1Name} — not overwriting`);
        } catch {
          const ps1Script = buildStubScriptPs1(mapping.eventType, ".visualizer/emit-event.ps1");
          await writeFile(ps1Path, ps1Script, "utf8");
          console.log(`  CREATE ${VISUALIZER_HOOKS_SUBDIR}/${ps1Name} → ${mapping.eventType}`);
          wired += 1;
        }
      }
    }
  }

  const finalFiles = await findHookScripts(hooksDir);
  const finalCoveredEvents = new Set<string>();
  for (const { relPath } of finalFiles) {
    const match = matchHookFilename(relPath, prefix);
    if (match) finalCoveredEvents.add(match.eventType);
  }

  if (finalCoveredEvents.size === 0 && !createHooks) {
    console.log("\n⚠️  No hook scripts matched any known lifecycle event type.");
    console.log("Tip: re-run with --create-hooks to generate stub hooks for all 8 supported Copilot CLI hook types.");
  }

  await syncHookManifests(targetRepo, finalCoveredEvents, prefix);

  console.log(`\nHook wiring complete: ${wired} wired, ${skipped} skipped.`);
  console.log("\nNext steps:");
  console.log("  1) Start the ingest service:   npm run serve:ingest  (from visualizer repo)");
  console.log("  2) Start the web UI:            npm run dev --workspace=packages/web-ui");
  console.log("  3) Run your agent workflow — events appear live at http://127.0.0.1:5173");
}

/* istanbul ignore next -- entry guard */
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename ?? "")) {
  void main();
}
