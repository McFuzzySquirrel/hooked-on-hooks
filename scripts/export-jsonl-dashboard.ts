#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEvent, type EventEnvelope } from "../shared/event-schema/src/index.js";
import { rebuildState } from "../shared/state-machine/src/index.js";

interface Args {
  jsonlPath?: string;
  out?: string;
}

interface ToolCall {
  toolName: string;
  intentionSummary?: string;
  arguments?: Record<string, string>;
  success?: boolean;
  resultSummary?: string;
}

interface TurnEnrichment {
  interactionId: string;
  model?: string;
  outputTokens?: number;
  tools: ToolCall[];
  skills: Array<{ name: string; description?: string }>;
  agents: Array<{ agentName: string; task?: string }>;
  firstTimestamp?: string;
}

interface SessionExport {
  sessionId: string;
  summary: string;
  repository: string;
  branch: string;
  cwd: string;
  hostType: string;
  createdAt: string;
  updatedAt: string;
  stats: {
    eventCount: number;
    turnCount: number;
    checkpointCount: number;
    fileCount: number;
    refCount: number;
    fileSizeBytes: number;
  };
  checkpoints: Array<Record<string, unknown>>;
  turns: Array<Record<string, unknown>>;
  files: Array<Record<string, unknown>>;
  refs: Array<Record<string, unknown>>;
  modelsAndTokens: {
    detectedModels: string[];
    tokenMentions: Array<{ source: string; value: number }>;
    notes: string[];
  };
  turnEnrichments: TurnEnrichment[];
  searchBlob: string[];
}

interface CombinedExport {
  exportedAt: string;
  source: {
    type: string;
    dbPath: string;
  };
  sessions: SessionExport[];
}

function usage(): string {
  return [
    "Usage:",
    "  npm run export:jsonl-dashboard -- --jsonlPath /tmp/vscode-chat-events.jsonl --out ./vscode-chat-export.json",
  ].join("\n");
}

function fail(message: string): never {
  console.error(`export-jsonl-dashboard error: ${message}`);
  console.error(usage());
  process.exit(1);
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2) as keyof Args;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`missing value for ${token}`);
    }
    args[key] = value;
    index += 1;
  }

  return args;
}

export async function readCanonicalEvents(jsonlPath: string): Promise<EventEnvelope[]> {
  const content = await readFile(resolve(jsonlPath), "utf8");
  const events: EventEnvelope[] = [];

  for (const [index, line] of content.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      fail(`invalid JSON at line ${index + 1}`);
    }

    const parsed = parseEvent(raw);
    if (!parsed.ok) {
      fail(`invalid event at line ${index + 1}: ${parsed.error}`);
    }

    events.push(parsed.value);
  }

  return events.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function estimateBytes(values: string[]): number {
  return new TextEncoder().encode(values.join("\n")).length;
}

function detectRepository(repoPath: string): string {
  const normalized = repoPath.trim();
  if (!normalized) {
    return "unknown-repo";
  }

  const tail = basename(normalized);
  return tail || normalized;
}

function truncateSummary(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.length > 96 ? `${trimmed.slice(0, 93)}...` : trimmed;
}

function ensureTurn(
  turns: Array<Record<string, unknown>>,
  enrichments: TurnEnrichment[],
  requestId: string | undefined,
  timestamp: string,
): { turn: Record<string, unknown>; enrichment: TurnEnrichment; index: number } {
  if (requestId) {
    const existingIndex = enrichments.findIndex((entry) => entry.interactionId === requestId);
    if (existingIndex !== -1) {
      return {
        turn: turns[existingIndex]!,
        enrichment: enrichments[existingIndex]!,
        index: existingIndex,
      };
    }
  }

  if (!requestId && turns.length > 0) {
    const index = turns.length - 1;
    return {
      turn: turns[index]!,
      enrichment: enrichments[index]!,
      index,
    };
  }

  const index = turns.length;
  const interactionId = requestId ?? `turn-${index + 1}`;
  const turn: Record<string, unknown> = {
    id: interactionId,
    interaction_id: interactionId,
    turn_index: index + 1,
    timestamp,
    user_message: "",
    assistant_response: "",
  };
  const enrichment: TurnEnrichment = {
    interactionId,
    tools: [],
    skills: [],
    agents: [],
    firstTimestamp: timestamp,
  };
  turns.push(turn);
  enrichments.push(enrichment);
  return { turn, enrichment, index };
}

function deriveSummary(events: EventEnvelope[]): string {
  for (const event of events) {
    if (event.eventType === "chatSessionStart" && typeof event.payload.title === "string" && event.payload.title.trim()) {
      return truncateSummary(event.payload.title, "Imported session");
    }
    if (event.eventType === "chatMessage" && event.payload.role === "user" && typeof event.payload.text === "string") {
      return truncateSummary(event.payload.text, "Imported session");
    }
    if (event.eventType === "userPromptSubmitted" && typeof event.payload.prompt === "string") {
      return truncateSummary(event.payload.prompt, "Imported session");
    }
  }
  return "Imported session";
}

function buildSessionExport(events: EventEnvelope[]): SessionExport {
  const state = rebuildState(events);
  const firstEvent = events[0]!;
  const lastEvent = events[events.length - 1]!;
  const turns: Array<Record<string, unknown>> = [];
  const enrichments: TurnEnrichment[] = [];
  const files: Array<Record<string, unknown>> = [];
  const searchBlob = new Set<string>();
  const detectedModels = new Set<string>();
  const tokenMentions: Array<{ source: string; value: number }> = [];
  const modelUsageMap = new Map<string, { eventCount: number; inputTokens: number; outputTokens: number; totalTokens: number }>();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;

  for (const event of events) {
    searchBlob.add(event.eventType);
    searchBlob.add(event.repoPath);

    switch (event.eventType) {
      case "chatMessage": {
        const { turn, enrichment } = ensureTurn(turns, enrichments, event.payload.requestId, event.timestamp);
        if (event.payload.role === "user") {
          if (event.payload.text) {
            turn.user_message = event.payload.text;
            turn.timestamp = event.timestamp;
          }
        } else if (event.payload.role === "assistant") {
          if (event.payload.text) {
            const existing = String(turn.assistant_response ?? "");
            turn.assistant_response = existing
              ? `${existing}\n\n${event.payload.text}`
              : event.payload.text;
          }
        }
        if (event.payload.text) {
          searchBlob.add(event.payload.text);
        }
        if (event.payload.model) {
          detectedModels.add(event.payload.model);
          enrichment.model = enrichment.model ?? event.payload.model;
        }

        const inputTokens = event.payload.inputTokens;
        const outputTokens = event.payload.outputTokens;
        const messageTotalTokens = event.payload.totalTokens;
        const modelName = event.payload.model;

        if (typeof inputTokens === "number") {
          tokenMentions.push({ source: `request:${event.payload.requestId ?? event.eventId}:input`, value: inputTokens });
          totalInputTokens += inputTokens;
        }
        if (typeof outputTokens === "number") {
          tokenMentions.push({ source: `request:${event.payload.requestId ?? event.eventId}:output`, value: outputTokens });
          totalOutputTokens += outputTokens;
          enrichment.outputTokens = Math.max(enrichment.outputTokens ?? 0, outputTokens);
        }
        if (typeof messageTotalTokens === "number") {
          tokenMentions.push({ source: `request:${event.payload.requestId ?? event.eventId}:total`, value: messageTotalTokens });
          totalTokens += messageTotalTokens;
        } else if (typeof inputTokens === "number" || typeof outputTokens === "number") {
          totalTokens += (inputTokens ?? 0) + (outputTokens ?? 0);
        }

        if (modelName && (typeof inputTokens === "number" || typeof outputTokens === "number" || typeof messageTotalTokens === "number")) {
          const usage = modelUsageMap.get(modelName) ?? { eventCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
          usage.eventCount += 1;
          usage.inputTokens += inputTokens ?? 0;
          usage.outputTokens += outputTokens ?? 0;
          usage.totalTokens += messageTotalTokens ?? ((inputTokens ?? 0) + (outputTokens ?? 0));
          modelUsageMap.set(modelName, usage);
        }
        break;
      }

      case "userPromptSubmitted": {
        const { turn } = ensureTurn(turns, enrichments, event.turnId, event.timestamp);
        turn.user_message = event.payload.prompt ?? "";
        turn.timestamp = event.timestamp;
        if (event.payload.prompt) {
          searchBlob.add(event.payload.prompt);
        }
        break;
      }

      case "preToolUse": {
        const { enrichment } = ensureTurn(turns, enrichments, event.turnId ?? event.payload.toolCallId, event.timestamp);
        enrichment.tools.push({
          toolName: event.payload.toolName,
          arguments: Object.fromEntries(
            Object.entries(event.payload.toolArgs ?? {}).map(([key, value]) => [key, String(value)]),
          ),
        });
        searchBlob.add(event.payload.toolName);
        break;
      }

      case "postToolUse":
      case "postToolUseFailure": {
        const { enrichment } = ensureTurn(turns, enrichments, event.turnId ?? event.payload.toolCallId, event.timestamp);
        const tool = [...enrichment.tools].reverse().find((entry) => entry.toolName === event.payload.toolName);
        if (tool) {
          tool.success = event.eventType === "postToolUse";
          if (event.eventType === "postToolUseFailure") {
            tool.resultSummary = event.payload.errorSummary;
          }
        } else {
          enrichment.tools.push({
            toolName: event.payload.toolName,
            success: event.eventType === "postToolUse",
            resultSummary: event.eventType === "postToolUseFailure" ? event.payload.errorSummary : undefined,
          });
        }
        searchBlob.add(event.payload.toolName);
        break;
      }

      case "chatToolCall": {
        const { enrichment } = ensureTurn(turns, enrichments, event.payload.requestId ?? event.payload.toolCallId, event.timestamp);
        const tool = [...enrichment.tools].reverse().find((entry) => entry.toolName === event.payload.toolName);
        if (tool) {
          if (event.payload.status === "completed") {
            tool.success = true;
          } else if (event.payload.status === "failed") {
            tool.success = false;
            tool.resultSummary = event.payload.errorSummary;
          }
          if (event.payload.intentionSummary && !tool.intentionSummary) {
            tool.intentionSummary = event.payload.intentionSummary;
          }
        } else {
          enrichment.tools.push({
            toolName: event.payload.toolName,
            success: event.payload.status === "completed" ? true : event.payload.status === "failed" ? false : undefined,
            resultSummary: event.payload.errorSummary,
            intentionSummary: event.payload.intentionSummary,
          });
        }
        searchBlob.add(event.payload.toolName);
        break;
      }

      case "subagentStart": {
        const { enrichment } = ensureTurn(turns, enrichments, event.turnId, event.timestamp);
        enrichment.agents.push({
          agentName: event.payload.agentName,
          task: event.payload.taskDescription,
        });
        searchBlob.add(event.payload.agentName);
        if (event.payload.taskDescription) {
          searchBlob.add(event.payload.taskDescription);
        }
        break;
      }

      case "chatArtifactImported": {
        files.push({
          id: event.eventId,
          session_id: event.sessionId,
          file_path: event.payload.path,
          tool_name: event.payload.artifactType,
          turn_index: turns.length || 1,
          first_seen_at: event.timestamp,
          size_bytes: event.payload.sizeBytes ?? 0,
        });
        searchBlob.add(event.payload.path);
        break;
      }

      default:
        break;
    }
  }

  const searchValues = [...searchBlob].filter((value) => value.trim().length > 0);
  return {
    sessionId: firstEvent.sessionId,
    summary: deriveSummary(events),
    repository: detectRepository(firstEvent.repoPath),
    branch: "imported-jsonl",
    cwd: firstEvent.repoPath,
    hostType: firstEvent.source,
    createdAt: firstEvent.timestamp,
    updatedAt: lastEvent.timestamp,
    stats: {
      eventCount: events.length,
      turnCount: state.turnCount || turns.length,
      checkpointCount: 0,
      fileCount: files.length,
      refCount: 0,
      fileSizeBytes: estimateBytes(searchValues),
    },
    checkpoints: [],
    turns,
    files,
    refs: [],
    modelsAndTokens: {
      detectedModels: [...detectedModels].sort(),
      tokenMentions,
      modelUsage: [...modelUsageMap.entries()]
        .map(([model, usage]) => ({
          model,
          eventCount: usage.eventCount,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
        }))
        .sort((left, right) => right.totalTokens - left.totalTokens),
      totals: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens,
      },
      notes: [
        "This export was derived from canonical JSONL rather than session-store.db.",
        "Turns, files, and model details reflect event data available in the imported log.",
      ],
    },
    turnEnrichments: enrichments,
    searchBlob: searchValues,
  };
}

export async function exportJsonlDashboard(jsonlPath: string, outPath: string): Promise<CombinedExport> {
  const events = await readCanonicalEvents(jsonlPath);
  const sessionsById = new Map<string, EventEnvelope[]>();

  for (const event of events) {
    const current = sessionsById.get(event.sessionId) ?? [];
    current.push(event);
    sessionsById.set(event.sessionId, current);
  }

  const payload: CombinedExport = {
    exportedAt: new Date().toISOString(),
    source: {
      type: "canonical-jsonl-export",
      dbPath: resolve(jsonlPath),
    },
    sessions: [...sessionsById.values()].map((sessionEvents) => buildSessionExport(sessionEvents)),
  };

  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jsonlPath) {
    fail("missing --jsonlPath");
  }
  if (!args.out) {
    fail("missing --out");
  }

  const payload = await exportJsonlDashboard(args.jsonlPath, args.out);
  console.log(JSON.stringify({ ok: true, sessions: payload.sessions.length, out: resolve(args.out) }));
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  void main();
}