import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseEvent, type EventEnvelope } from "../../shared/event-schema/src/index.js";
import { applyRedaction } from "../../shared/redaction/src/index.js";

export type VsCodeImportMode = "auto" | "chatSessions" | "chatResources" | "extensionDebugLogs";

export interface VsCodeImportOptions {
  workspaceStorageRoot: string;
  jsonlPath: string;
  repoPath: string;
  mode: VsCodeImportMode;
  sessionIds?: string[];
  httpEndpoint?: string;
  storePrompts?: boolean;
  append?: boolean;
}

export interface VsCodeImportResult {
  emitted: number;
  rejected: number;
  parsedFiles: number;
  byEventType: Record<string, number>;
}

function shouldImportSession(sessionId: string, sessionIds?: string[]): boolean {
  if (!sessionIds || sessionIds.length === 0) {
    return true;
  }
  return sessionIds.includes(sessionId);
}

function isoFromUnknown(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return fallback;
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function maybeJsonFromLine(line: string): unknown {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Some debug logs prefix JSON with timestamp/level text.
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const candidate = trimmed.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function findFirstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function findFirstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function extractSessionId(record: Record<string, unknown>): string | undefined {
  const direct = findFirstString(record, [
    "sessionId",
    "workspaceSessionId",
    "chatSessionId",
    "conversationId",
    "threadId",
  ]);
  if (direct) {
    return direct;
  }

  const nestedKeys = ["session", "chatSession", "conversation", "data", "payload", "context"];
  for (const nestedKey of nestedKeys) {
    const nested = asRecord(record[nestedKey]);
    if (!nested) {
      continue;
    }
    const nestedId = extractSessionId(nested);
    if (nestedId) {
      return nestedId;
    }
  }

  return undefined;
}

function parseToolStatus(record: Record<string, unknown>): "started" | "completed" | "failed" | null {
  const statusValue = findFirstString(record, ["status", "state", "phase", "result", "event", "type"]);
  const lower = statusValue?.toLowerCase() ?? "";

  if (lower.includes("fail") || lower.includes("error") || lower.includes("exception")) {
    return "failed";
  }
  if (lower.includes("complete") || lower.includes("success") || lower.includes("done")) {
    return "completed";
  }
  if (lower.includes("start") || lower.includes("request") || lower.includes("invoke") || lower.includes("run")) {
    return "started";
  }

  if (record.success === true) {
    return "completed";
  }
  if (record.success === false) {
    return "failed";
  }

  return null;
}

function hasDebugActivity(record: Record<string, unknown>): boolean {
  const kind = findFirstString(record, ["kind"])?.toLowerCase();
  if (kind && ["request", "toolcall", "message", "artifact", "sessionstart", "sessionend"].includes(kind)) {
    return true;
  }

  if (findFirstString(record, ["role", "sender", "author"])) {
    return true;
  }
  if (findFirstString(record, ["toolName", "tool", "operation"])) {
    return true;
  }
  if (findFirstString(record, ["artifactType", "resourceType", "artifactPath", "contentPath", "path"])) {
    return true;
  }

  const typeLower = findFirstString(record, ["type", "event", "status", "phase"])?.toLowerCase() ?? "";
  if (
    typeLower.includes("session")
    || typeLower.includes("conversation")
    || typeLower.includes("request")
    || typeLower.includes("tool")
    || typeLower.includes("artifact")
    || typeLower.includes("message")
  ) {
    return true;
  }

  return false;
}

async function parseExtensionDebugLogFile(
  filePath: string,
  fallbackSessionId: string,
  options: VsCodeImportOptions,
): Promise<EventEnvelope[]> {
  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  const records: Record<string, unknown>[] = [];

  // Newer file-logging format stores JSON as { content: "<json>" }.
  const wholeJson = maybeJsonFromLine(content);
  const wholeRecord = asRecord(wholeJson);
  if (wholeRecord && typeof wholeRecord.content === "string") {
    const decoded = maybeJsonFromLine(wholeRecord.content) ?? maybeJsonFromLine(wholeRecord.content.trim());
    if (Array.isArray(decoded)) {
      for (const item of decoded) {
        const rec = asRecord(item);
        if (rec) {
          records.push(rec);
        }
      }
    } else {
      const rec = asRecord(decoded);
      if (rec) {
        records.push(rec);
      }
    }
  }

  if (records.length === 0) {
    for (const line of lines) {
      const parsed = maybeJsonFromLine(line);
      const record = asRecord(parsed);
      if (record) {
        records.push(record);
      }
    }
  }

  const events: EventEnvelope[] = [];
  const startedSessions = new Set<string>();
  let currentSessionId = fallbackSessionId;

  const ensureSessionStart = (sessionId: string, timestamp: string, record: Record<string, unknown>): void => {
    if (startedSessions.has(sessionId)) {
      return;
    }
    startedSessions.add(sessionId);
    events.push({
      ...eventBase("chatSessionStart", sessionId, "vscode-chat-debug", options.repoPath, timestamp),
      payload: {
        workspaceSessionId: sessionId,
        title: findFirstString(record, ["title", "sessionTitle", "conversationTitle"]),
        initialLocation: findFirstString(record, ["location", "initialLocation", "source"]),
      },
    } as EventEnvelope);
  };

  for (const record of records) {
    const recordString = JSON.stringify(record).toLowerCase();
    if (!hasDebugActivity(record)) {
      continue;
    }

    const sessionId = extractSessionId(record) ?? currentSessionId;
    currentSessionId = sessionId;
    const timestamp = isoFromUnknown(
      findFirstString(record, ["timestamp", "time", "ts", "createdAt", "date"])
      ?? findFirstNumber(record, ["timestamp", "time", "ts", "createdAt"])
      ?? new Date().toISOString(),
      new Date().toISOString(),
    );

    ensureSessionStart(sessionId, timestamp, record);

    // Request-level debug records contain model and usage metadata that are not
    // always present in chatSessions JSONL. Emit a synthetic assistant message
    // with token metadata so downstream exports can populate Models & Tokens.
    if (record.kind === "request") {
      const metadata = asRecord(record.metadata);
      if (metadata) {
        const usage = asRecord(metadata.usage);
        const requestId =
          findFirstString(metadata, ["ourRequestId", "requestId", "serverRequestId"])
          ?? findFirstString(record, ["requestId"]);
        const model = findFirstString(metadata, ["model", "modelId"]);

        events.push({
          ...eventBase("chatMessage", sessionId, "vscode-chat-debug", options.repoPath, timestamp),
          payload: {
            role: "assistant",
            text: cleanText(findFirstString(record, ["name", "type"])),
            requestId,
            model,
            inputTokens: findFirstNumber(usage ?? {}, ["prompt_tokens", "input_tokens", "promptTokens", "inputTokens"]),
            outputTokens: findFirstNumber(usage ?? {}, [
              "completion_tokens",
              "output_tokens",
              "completionTokens",
              "outputTokens",
            ]),
            totalTokens: findFirstNumber(usage ?? {}, ["total_tokens", "totalTokens"]),
            requestDurationMs: findFirstNumber(metadata, ["duration", "durationMs"]),
            timeToFirstTokenMs: findFirstNumber(metadata, ["timeToFirstToken", "timeToFirstTokenMs"]),
          },
        } as EventEnvelope);
      }
    }

    const role = findFirstString(record, ["role", "sender", "author"]);
    const text =
      findFirstString(record, ["text", "message", "content", "prompt", "response"])
      ?? findFirstString(asRecord(record.payload) ?? {}, ["text", "message", "content", "prompt", "response"]);
    if (role && text && ["user", "assistant", "system"].includes(role.toLowerCase())) {
      events.push({
        ...eventBase("chatMessage", sessionId, "vscode-chat-debug", options.repoPath, timestamp),
        payload: {
          role: role.toLowerCase() as "user" | "assistant" | "system",
          text,
          requestId: findFirstString(record, ["requestId", "interactionId"]),
          model: findFirstString(record, ["model", "modelId"]),
        },
      } as EventEnvelope);
    }

    const toolRecord = asRecord(record.tool) ?? record;
    const toolName = findFirstString(toolRecord, ["toolName", "name", "tool", "operation", "id"]);
    const toolStatus =
      parseToolStatus(record)
      ?? parseToolStatus(toolRecord)
      ?? (findFirstString(record, ["kind"])?.toLowerCase() === "toolcall" ? "completed" : null);
    if (toolName && toolStatus) {
      events.push({
        ...eventBase("chatToolCall", sessionId, "vscode-chat-debug", options.repoPath, timestamp),
        payload: {
          toolName,
          status: toolStatus,
          durationMs: findFirstNumber(record, ["durationMs", "duration", "elapsedMs"]),
          errorSummary: findFirstString(record, ["error", "errorSummary", "message"]),
          toolCallId: findFirstString(record, ["toolCallId", "callId", "id"]),
          requestId: findFirstString(record, ["requestId", "interactionId"]),
        },
      } as EventEnvelope);
    }

    const artifactPath = findFirstString(record, ["path", "filePath", "contentPath", "artifactPath"]);
    const artifactType = findFirstString(record, ["artifactType", "resourceType", "kind"]);
    if (artifactPath && (artifactType || recordString.includes("artifact") || recordString.includes("resource"))) {
      events.push({
        ...eventBase("chatArtifactImported", sessionId, "vscode-chat-debug", options.repoPath, timestamp),
        payload: {
          artifactType: artifactType ?? "debug-log-artifact",
          path: artifactPath,
          sizeBytes: findFirstNumber(record, ["size", "sizeBytes", "bytes"]),
          callId: findFirstString(record, ["callId", "toolCallId"]),
        },
      } as EventEnvelope);
    }

    const typeLower = findFirstString(record, ["type", "event", "status", "phase"])?.toLowerCase() ?? "";
    if (typeLower.includes("sessionend") || typeLower.includes("session_end") || typeLower.includes("conversation_end")) {
      events.push({
        ...eventBase("chatSessionEnd", sessionId, "vscode-chat-debug", options.repoPath, timestamp),
        payload: {
          reason: findFirstString(record, ["reason", "message", "status"]),
        },
      } as EventEnvelope);
    }
  }

  return events;
}

function eventBase(
  eventType: EventEnvelope["eventType"],
  sessionId: string,
  source: EventEnvelope["source"],
  repoPath: string,
  timestamp: string,
): Omit<EventEnvelope, "payload"> {
  return {
    schemaVersion: "1.0.0",
    eventId: randomUUID(),
    eventType,
    timestamp,
    sessionId,
    source,
    repoPath,
  } as Omit<EventEnvelope, "payload">;
}

async function postEvent(endpoint: string, event: EventEnvelope): Promise<void> {
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch {
    // Keep importer resilient; JSONL is still the source of truth.
  }
}

async function parseChatSessionsFile(
  filePath: string,
  sessionId: string,
  options: VsCodeImportOptions,
): Promise<EventEnvelope[]> {
  const now = new Date().toISOString();
  const lines = (await readFile(filePath, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const events: EventEnvelope[] = [];
  let emittedStart = false;

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== "object") {
      continue;
    }

    const record = parsed as Record<string, unknown>;
    const kind = record.kind;

    if (kind === 0 && !emittedStart) {
      const v = (record.v ?? {}) as Record<string, unknown>;
      const createdAt = isoFromUnknown(v.creationDate, now);
      events.push({
        ...eventBase("chatSessionStart", sessionId, "vscode-chat", options.repoPath, createdAt),
        payload: {
          workspaceSessionId: cleanText(v.sessionId) ?? sessionId,
          title: cleanText(v.customTitle),
          initialLocation: cleanText(v.initialLocation),
        },
      } as EventEnvelope);
      emittedStart = true;
      continue;
    }

    if (kind === 2 && Array.isArray(record.v)) {
      for (const req of record.v as Array<Record<string, unknown>>) {
        const requestId = cleanText(req.requestId);
        const reqTs = isoFromUnknown(req.timestamp, now);
        const message = (req.message ?? {}) as Record<string, unknown>;
        const promptText = cleanText(message.text);

        const modelId = cleanText(req.modelId as string | undefined);

        if (promptText) {
          events.push({
            ...eventBase("chatMessage", sessionId, "vscode-chat", options.repoPath, reqTs),
            payload: {
              role: "user",
              text: promptText,
              requestId,
              model: modelId,
            },
          } as EventEnvelope);
        }

        const response = Array.isArray(req.response) ? req.response : [];
        for (const item of response as Array<Record<string, unknown>>) {
          const itemKind = cleanText(item.kind);
          const itemTs = reqTs;

          const valueText = cleanText(item.value);
          if (valueText && itemKind !== "thinking") {
            events.push({
              ...eventBase("chatMessage", sessionId, "vscode-chat", options.repoPath, itemTs),
              payload: {
                role: "assistant",
                text: valueText,
                requestId,
                model: modelId,
              },
            } as EventEnvelope);
          }

          if (itemKind === "toolInvocationSerialized") {
            const toolSpecific = (item.toolSpecificData ?? {}) as Record<string, unknown>;
            const toolName =
              cleanText(item.toolId)
              ?? cleanText(toolSpecific.name)
              ?? cleanText(toolSpecific.description)
              ?? "unknown-tool";

            const status: "started" | "completed" = item.isComplete === true ? "completed" : "started";

            // Extract human-readable intention from invocationMessage or generatedTitle
            const invocationMsg = asRecord(item.invocationMessage);
            const intentionSummary =
              cleanText(invocationMsg?.value)
              ?? cleanText(item.generatedTitle)
              ?? undefined;

            events.push({
              ...eventBase("chatToolCall", sessionId, "vscode-chat", options.repoPath, itemTs),
              payload: {
                toolName,
                status,
                toolCallId: cleanText(item.toolCallId),
                requestId,
                intentionSummary,
              },
            } as EventEnvelope);
          }
        }
      }
    }
  }

  return events;
}

async function parseChatResourcesDir(
  dirPath: string,
  sessionId: string,
  options: VsCodeImportOptions,
): Promise<EventEnvelope[]> {
  const events: EventEnvelope[] = [];
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const callDirName = entry.name;
    const contentPath = join(dirPath, callDirName, "content.txt");

    try {
      const fileStat = await stat(contentPath);
      if (!fileStat.isFile()) {
        continue;
      }

      const tsMatch = /__vscode-(\d+)$/.exec(callDirName);
      const callIdMatch = /^(.*?)__vscode-\d+$/.exec(callDirName);
      const timestamp = tsMatch ? new Date(Number(tsMatch[1])).toISOString() : new Date().toISOString();

      events.push({
        ...eventBase("chatArtifactImported", sessionId, "vscode-chat-debug", options.repoPath, timestamp),
        payload: {
          artifactType: "tool-call-content",
          path: contentPath,
          sizeBytes: fileStat.size,
          callId: callIdMatch?.[1],
        },
      } as EventEnvelope);
    } catch {
      continue;
    }
  }

  return events;
}

async function gatherEventsFromWorkspace(options: VsCodeImportOptions): Promise<{ events: EventEnvelope[]; parsedFiles: number }> {
  const events: EventEnvelope[] = [];
  let parsedFiles = 0;

  const includeChatSessions = options.mode === "auto" || options.mode === "chatSessions";
  const includeResources = options.mode === "auto" || options.mode === "chatResources";
  const includeExtensionDebugLogs = options.mode === "extensionDebugLogs";

  if (includeChatSessions) {
    const chatSessionsDir = join(options.workspaceStorageRoot, "chatSessions");
    try {
      const files = await readdir(chatSessionsDir, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith(".jsonl")) {
          continue;
        }

        const sessionId = file.name.replace(/\.jsonl$/, "");
        if (!shouldImportSession(sessionId, options.sessionIds)) {
          continue;
        }

        const filePath = join(chatSessionsDir, file.name);
        events.push(...await parseChatSessionsFile(filePath, sessionId, options));
        parsedFiles += 1;
      }
    } catch {
      // Directory may not exist for this workspace.
    }
  }

  if (includeResources) {
    const resourcesRoot = join(options.workspaceStorageRoot, "GitHub.copilot-chat", "chat-session-resources");
    try {
      const sessionDirs = await readdir(resourcesRoot, { withFileTypes: true });
      for (const sessionDir of sessionDirs) {
        if (!sessionDir.isDirectory()) {
          continue;
        }

        const sessionId = sessionDir.name;
        if (!shouldImportSession(sessionId, options.sessionIds)) {
          continue;
        }

        const full = join(resourcesRoot, sessionId);
        events.push(...await parseChatResourcesDir(full, sessionId, options));
        parsedFiles += 1;
      }
    } catch {
      // Directory may not exist for this workspace.
    }
  }

  if (includeExtensionDebugLogs) {
    const debugLogsDir = join(options.workspaceStorageRoot, "GitHub.copilot-chat", "debug-logs");
    try {
      const entries = await readdir(debugLogsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const fallbackSessionId = entry.name;
          if (!shouldImportSession(fallbackSessionId, options.sessionIds)) {
            continue;
          }

          const filePath = join(debugLogsDir, entry.name);
          events.push(...await parseExtensionDebugLogFile(filePath, fallbackSessionId, options));
          parsedFiles += 1;
          continue;
        }

        if (!entry.isDirectory()) {
          continue;
        }

        const fallbackSessionId = entry.name;
        if (!shouldImportSession(fallbackSessionId, options.sessionIds)) {
          continue;
        }

        const sessionDir = join(debugLogsDir, entry.name);
        const sessionFiles = await readdir(sessionDir, { withFileTypes: true });
        for (const sessionFile of sessionFiles) {
          if (!sessionFile.isFile()) {
            continue;
          }

          const filePath = join(sessionDir, sessionFile.name);
          events.push(...await parseExtensionDebugLogFile(filePath, fallbackSessionId, options));
          parsedFiles += 1;
        }
      }
    } catch {
      // Directory may not exist for this workspace.
    }
  }

  events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return { events, parsedFiles };
}

export async function importVsCodeChatWorkspace(options: VsCodeImportOptions): Promise<VsCodeImportResult> {
  const { events, parsedFiles } = await gatherEventsFromWorkspace(options);
  await mkdir(dirname(options.jsonlPath), { recursive: true });

  // Default to replacing output to avoid silent duplicate accumulation on reruns.
  if (!options.append) {
    await writeFile(options.jsonlPath, "", "utf8");
  }

  let emitted = 0;
  let rejected = 0;
  const byEventType: Record<string, number> = {};

  for (const event of events) {
    const parsed = parseEvent(event);
    if (!parsed.ok) {
      rejected += 1;
      continue;
    }

    const redacted = applyRedaction(parsed.value, { storePrompts: options.storePrompts });
    await appendFile(options.jsonlPath, `${JSON.stringify(redacted)}\n`, "utf8");

    if (options.httpEndpoint) {
      await postEvent(options.httpEndpoint, redacted);
    }

    emitted += 1;
    byEventType[redacted.eventType] = (byEventType[redacted.eventType] ?? 0) + 1;
  }

  return { emitted, rejected, parsedFiles, byEventType };
}
