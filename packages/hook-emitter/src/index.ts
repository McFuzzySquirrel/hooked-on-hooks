import { appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { v4 as uuidv4 } from "uuid";
import {
  EVENT_TYPES,
  SCHEMA_VERSION,
  buildEventFacets,
  parseEvent,
  type ConfidenceLevel,
  type EventEnvelope,
  type EventSource,
  type ParseResult,
  type PrivacyMetadata
} from "../../../shared/event-schema/src/index.js";
import { applyRedaction } from "../../../shared/redaction/src/index.js";

export interface EmitOptions {
  jsonlPath: string;
  repoPath: string;
  sessionId: string;
  turnId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  source?: EventSource;
  sourceVersion?: string;
  userId?: string;
  machineId?: string;
  workspaceId?: string;
  workspacePath?: string;
  privacy?: Partial<PrivacyMetadata>;
  confidence?: ConfidenceLevel;
  httpEndpoint?: string;
  now?: () => string;
  eventIdFactory?: () => string;
  /**
   * When true, attach a locally redacted rawPayload copy for replay/debug.
   * Defaults to false so the streamed envelope only carries normalized payload
   * and facets.
   */
  includeRawPayload?: boolean;
  /**
   * When true, prompt bodies are stored as "[REDACTED_PROMPT]" instead of
   * being removed entirely. Defaults to false (PRIV-FR-05 safe default).
   */
  storePrompts?: boolean;
}

export interface EmitResult {
  accepted: boolean;
  event?: EventEnvelope;
  error?: string;
}

async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

async function sendHttp(event: EventEnvelope, endpoint: string): Promise<void> {
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event)
    });
  } catch {
    // HTTP delivery is best-effort. The event is already written to JSONL.
    // Suppress connection errors so the emitter never crashes hook scripts.
  }
}

export async function emitEvent(
  eventType: (typeof EVENT_TYPES)[number],
  payload: Record<string, unknown>,
  options: EmitOptions
): Promise<EmitResult> {
  const rawEvent = {
    schemaVersion: SCHEMA_VERSION,
    eventId: options.eventIdFactory?.() ?? uuidv4(),
    eventType,
    timestamp: options.now?.() ?? new Date().toISOString(),
    sessionId: options.sessionId,
    userId: options.userId ?? "unknown",
    machineId: options.machineId ?? "unknown",
    source: options.source ?? "copilot-cli",
    sourceVersion: options.sourceVersion ?? "unknown",
    repoPath: options.repoPath,
    workspaceId: options.workspaceId ?? options.repoPath,
    workspacePath: options.workspacePath ?? options.repoPath,
    privacy: {
      classification: "internal",
      locallyRedacted: false,
      rawPayloadOptIn: options.includeRawPayload === true,
      retention: "standard",
      ...options.privacy
    },
    confidence: options.confidence ?? "exact",
    facets: buildEventFacets(eventType, payload),
    rawPayload: options.includeRawPayload
      ? { redacted: false, payload, retainedFor: "debug" }
      : undefined,
    turnId: options.turnId,
    traceId: options.traceId,
    spanId: options.spanId,
    parentSpanId: options.parentSpanId,
    payload
  };

  const parsed = parseEvent(rawEvent);
  if (!parsed.ok) {
    return { accepted: false, error: parsed.error };
  }

  const redacted = applyRedaction(parsed.value, { storePrompts: options.storePrompts });
  await ensureParent(options.jsonlPath);
  await appendFile(options.jsonlPath, `${JSON.stringify(redacted)}\n`, "utf8");

  if (options.httpEndpoint) {
    await sendHttp(redacted, options.httpEndpoint);
  }

  return { accepted: true, event: redacted };
}

export async function emitRawAndValidate(
  raw: unknown,
  options: Pick<EmitOptions, "jsonlPath" | "storePrompts">
): Promise<ParseResult> {
  const parsed = parseEvent(raw);
  if (parsed.ok) {
    const redacted = applyRedaction(parsed.value, { storePrompts: options.storePrompts });
    await ensureParent(options.jsonlPath);
    await appendFile(options.jsonlPath, `${JSON.stringify(redacted)}\n`, "utf8");
  }
  return parsed;
}

export function getHookEventTypes(): readonly string[] {
  return EVENT_TYPES.filter((eventType) => eventType !== "sourceEvent");
}
