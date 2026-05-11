import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { hostname, userInfo } from "node:os";
import {
  SCHEMA_VERSION,
  buildEventFacets,
  parseEvent,
  type EventEnvelope
} from "../../../shared/event-schema/src/index.js";
import { applyRedaction } from "../../../shared/redaction/src/index.js";

export interface CopilotSessionStoreImportOptions {
  dbPath: string;
  datastorePath: string;
  sessionIds?: string[];
  machineId?: string;
  userId?: string;
  includeRawPayload?: boolean;
  redact?: boolean;
  now?: () => string;
}

export interface DatastoreImportResult {
  datastorePath: string;
  importedEvents: number;
  skippedLines: number;
  sessions: string[];
}

export interface DatastoreSummary {
  datastorePath: string;
  eventCount: number;
  sessionCount: number;
  machineCount: number;
  sourceCount: number;
  sessions: string[];
  machines: string[];
  sources: string[];
  earliestTimestamp?: string;
  latestTimestamp?: string;
}

interface SessionRow {
  id: string;
  cwd: string | null;
  repository: string | null;
  host_type: string | null;
  branch: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface SourceLineContext {
  dbPath: string;
  session: SessionRow;
  eventsPath: string;
  lineNumber: number;
  line: string;
  machineId: string;
  userId: string;
  includeRawPayload: boolean;
  redact: boolean;
  now: () => string;
}

function sqlEscape(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function runSqlJson<T>(dbPath: string, sql: string): T[] {
  const result = spawnSync("sqlite3", [dbPath, "-json", sql], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `sqlite3 failed with exit code ${result.status ?? "unknown"}`);
  }

  const stdout = (result.stdout || "").trim();
  if (!stdout) {
    return [];
  }
  return JSON.parse(stdout) as T[];
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sourceEventsPath(dbPath: string, sessionId: string): string {
  return resolve(dirname(dbPath), "session-state", sessionId, "events.jsonl");
}

function defaultMachineId(): string {
  return hostname() || "unknown";
}

function defaultUserId(): string {
  try {
    return userInfo().username || "unknown";
  } catch {
    return "unknown";
  }
}

function stableUuid(input: string): string {
  const hex = createHash("sha256").update(input).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  const variant = Number.parseInt(hex[16], 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function eventTimestamp(source: Record<string, unknown>, session: SessionRow, now: () => string): string {
  const raw = source.timestamp ?? asRecord(source.data).timestamp ?? session.updated_at ?? session.created_at;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : now();
}

function normalizeSourceLine(context: SourceLineContext): EventEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(context.line);
  } catch {
    return null;
  }

  const sourceRecord = asRecord(parsed);
  const sourceEventType = safeString(sourceRecord.type, "unknown");
  const sourceData = asRecord(sourceRecord.data);
  const payload = {
    sourceEventType,
    data: sourceData,
    sourceLine: context.lineNumber,
    sourcePath: context.eventsPath
  };
  const repoPath = safeString(context.session.cwd, safeString(context.session.repository, "unknown-repo"));
  const workspaceId = safeString(context.session.repository, repoPath);
  const timestamp = eventTimestamp(sourceRecord, context.session, context.now);
  const event = {
    schemaVersion: SCHEMA_VERSION,
    eventId: stableUuid(`${context.machineId}:${context.dbPath}:${context.session.id}:${context.eventsPath}:${context.lineNumber}:${context.line}`),
    eventType: "sourceEvent",
    timestamp,
    sessionId: context.session.id,
    userId: context.userId,
    machineId: context.machineId,
    source: "copilot-session-store",
    sourceVersion: "session-store-v1",
    repoPath,
    workspaceId,
    workspacePath: repoPath,
    privacy: {
      classification: "internal",
      locallyRedacted: false,
      rawPayloadOptIn: context.includeRawPayload,
      retention: "standard"
    },
    confidence: "exact",
    facets: buildEventFacets("sourceEvent", payload),
    rawPayload: context.includeRawPayload
      ? {
        redacted: false,
        retainedFor: "debug",
        payload: {
          sourceEventType,
          sourceLine: context.lineNumber,
          sourcePath: context.eventsPath,
          rawEvent: sourceRecord
        }
      }
      : undefined,
    payload
  };

  const validation = parseEvent(event);
  if (!validation.ok) {
    return null;
  }

  return context.redact
    ? applyRedaction(validation.value)
    : validation.value;
}

export function getCopilotSessionRows(dbPath: string, sessionIds?: string[]): SessionRow[] {
  const where = sessionIds && sessionIds.length > 0
    ? `WHERE id IN (${sessionIds.map(sqlEscape).join(", ")})`
    : "";
  return runSqlJson<SessionRow>(
    dbPath,
    `SELECT id, cwd, repository, host_type, branch, created_at, updated_at
     FROM sessions
     ${where}
     ORDER BY updated_at DESC`
  );
}

export async function importCopilotSessionStore(options: CopilotSessionStoreImportOptions): Promise<DatastoreImportResult> {
  const machineId = options.machineId ?? defaultMachineId();
  const userId = options.userId ?? defaultUserId();
  const now = options.now ?? (() => new Date().toISOString());
  const redact = options.redact ?? true;
  const sessions = getCopilotSessionRows(options.dbPath, options.sessionIds);
  let importedEvents = 0;
  let skippedLines = 0;

  await mkdir(dirname(options.datastorePath), { recursive: true });

  for (const session of sessions) {
    const eventsPath = sourceEventsPath(options.dbPath, session.id);
    if (!existsSync(eventsPath)) {
      continue;
    }

    const lines = (await readFile(eventsPath, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);

    for (let index = 0; index < lines.length; index += 1) {
      const event = normalizeSourceLine({
        dbPath: options.dbPath,
        session,
        eventsPath,
        lineNumber: index + 1,
        line: lines[index],
        machineId,
        userId,
        includeRawPayload: options.includeRawPayload ?? false,
        redact,
        now
      });
      if (!event) {
        skippedLines += 1;
        continue;
      }
      await appendFile(options.datastorePath, `${JSON.stringify(event)}\n`, "utf8");
      importedEvents += 1;
    }
  }

  return {
    datastorePath: options.datastorePath,
    importedEvents,
    skippedLines,
    sessions: sessions.map((session) => session.id)
  };
}

export async function summarizeDatastore(datastorePath: string): Promise<DatastoreSummary> {
  const sessions = new Set<string>();
  const machines = new Set<string>();
  const sources = new Set<string>();
  let eventCount = 0;
  let earliestTimestamp: string | undefined;
  let latestTimestamp: string | undefined;

  if (!existsSync(datastorePath)) {
    return {
      datastorePath,
      eventCount: 0,
      sessionCount: 0,
      machineCount: 0,
      sourceCount: 0,
      sessions: [],
      machines: [],
      sources: []
    };
  }

  const lines = (await readFile(datastorePath, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  for (const line of lines) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = parseEvent(raw);
    if (!parsed.ok) {
      continue;
    }
    eventCount += 1;
    sessions.add(parsed.value.sessionId);
    machines.add(parsed.value.machineId);
    sources.add(parsed.value.source);
    if (!earliestTimestamp || parsed.value.timestamp < earliestTimestamp) {
      earliestTimestamp = parsed.value.timestamp;
    }
    if (!latestTimestamp || parsed.value.timestamp > latestTimestamp) {
      latestTimestamp = parsed.value.timestamp;
    }
  }

  return {
    datastorePath,
    eventCount,
    sessionCount: sessions.size,
    machineCount: machines.size,
    sourceCount: sources.size,
    sessions: [...sessions].sort(),
    machines: [...machines].sort(),
    sources: [...sources].sort(),
    earliestTimestamp,
    latestTimestamp
  };
}
