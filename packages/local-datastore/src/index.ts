import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { hostname, homedir, platform, userInfo } from "node:os";
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
  includeSessionStore?: boolean;
  includeDefaultVscodeChatDebug?: boolean;
  vscodeChatDebugPaths?: string[];
  now?: () => string;
}

export interface DatastoreImportResult {
  datastorePath: string;
  importedEvents: number;
  skippedLines: number;
  sessions: string[];
  vscodeDebugImport?: {
    enabled: boolean;
    discoveredFiles: number;
    roots: Array<{
      path: string;
      discoveredFiles: number;
      importedEvents: number;
      skippedLines: number;
    }>;
  };
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
  sourceEventCounts: Record<string, number>;
  earliestTimestamp?: string;
  latestTimestamp?: string;
  vscodePathBreakdown?: {
    totalVscodeEvents: number;
    buckets: {
      logs: number;
      workspaceStorage: number;
      other: number;
      missingSourcePath: number;
    };
    topSourcePaths: Array<{
      path: string;
      events: number;
    }>;
  };
}

export interface DatastoreSummaryOptions {
  verbose?: boolean;
  topSourcePathsLimit?: number;
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

interface VscodeChatDebugLineContext {
  logPath: string;
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

function defaultVscodeChatDebugRoots(): string[] {
  const home = homedir();
  const candidates = platform() === "win32"
    ? [
      process.env.APPDATA ? join(process.env.APPDATA, "Code", "logs") : undefined,
      process.env.APPDATA ? join(process.env.APPDATA, "Code - Insiders", "logs") : undefined,
      process.env.APPDATA ? join(process.env.APPDATA, "Code", "User", "workspaceStorage") : undefined,
      process.env.APPDATA ? join(process.env.APPDATA, "Code - Insiders", "User", "workspaceStorage") : undefined
    ]
    : platform() === "darwin"
      ? [
        join(home, "Library", "Application Support", "Code", "logs"),
        join(home, "Library", "Application Support", "Code - Insiders", "logs"),
        join(home, "Library", "Application Support", "Code", "User", "workspaceStorage"),
        join(home, "Library", "Application Support", "Code - Insiders", "User", "workspaceStorage")
      ]
      : [
        join(home, ".config", "Code", "logs"),
        join(home, ".config", "Code - Insiders", "logs"),
        join(home, ".vscode-server", "data", "logs"),
        join(home, ".vscode-server-insiders", "data", "logs"),
        join(home, ".config", "Code", "User", "workspaceStorage"),
        join(home, ".config", "Code - Insiders", "User", "workspaceStorage")
      ];

  return candidates.filter((candidate): candidate is string => Boolean(candidate));
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

function vscodeSessionId(logPath: string, machineId: string): string {
  return `vscode-copilot-chat-${stableUuid(`${machineId}:${logPath}`).slice(0, 8)}`;
}

function isVscodeCopilotChatLogPath(logPath: string): boolean {
  const normalizedPath = logPath.replaceAll("\\", "/").toLowerCase();
  const lowerBase = basename(logPath).toLowerCase();
  if (!lowerBase.endsWith(".log") && !lowerBase.endsWith(".jsonl")) {
    return false;
  }

  return lowerBase.includes("github copilot chat")
    || lowerBase.includes("copilot chat")
    || lowerBase.includes("github.copilot-chat")
    || normalizedPath.includes("/github.copilot-chat/");
}

function normalizeRootPath(rootPath: string): string {
  return resolve(rootPath).replaceAll("\\", "/").replace(/\/+$/, "");
}

function rootForFile(filePath: string, roots: string[]): string {
  const normalizedFile = normalizeRootPath(filePath);
  let bestMatch: string | undefined;
  for (const root of roots) {
    const normalizedRoot = normalizeRootPath(root);
    if (normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`)) {
      if (!bestMatch || normalizedRoot.length > bestMatch.length) {
        bestMatch = normalizedRoot;
      }
    }
  }
  return bestMatch ?? "(unmatched)";
}

function classifyVscodeSourcePath(sourcePath: string): "logs" | "workspaceStorage" | "other" {
  const normalizedPath = sourcePath.replaceAll("\\", "/").toLowerCase();
  if (normalizedPath.includes("/user/workspacestorage/") && normalizedPath.includes("/github.copilot-chat/")) {
    return "workspaceStorage";
  }
  if (normalizedPath.includes("/logs/")) {
    return "logs";
  }
  return "other";
}

async function discoverVscodeChatDebugFiles(paths: string[], depth = 0): Promise<string[]> {
  const files: string[] = [];
  if (depth > 6) {
    return files;
  }

  for (const candidate of paths) {
    if (!existsSync(candidate)) {
      continue;
    }

    const info = await stat(candidate);
    if (info.isFile()) {
      files.push(candidate);
      continue;
    }
    if (!info.isDirectory()) {
      continue;
    }

    const childPaths = (await readdir(candidate, { withFileTypes: true }))
      .map((entry) => join(candidate, entry.name));
    for (const childPath of childPaths) {
      const childInfo = await stat(childPath);
      if (childInfo.isFile() && isVscodeCopilotChatLogPath(childPath)) {
        files.push(childPath);
      } else if (childInfo.isDirectory()) {
        files.push(...await discoverVscodeChatDebugFiles([childPath], depth + 1));
      }
    }
  }

  return [...new Set(files)].sort();
}

function parseVscodeChatDebugLine(line: string): { timestamp?: string; level?: string; message: string } {
  let remainder = line.trim();
  let timestamp: string | undefined;
  const timestampMatch = remainder.match(/^\[?(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z?)\]?\s*/);
  if (timestampMatch?.[1]) {
    const normalized = timestampMatch[1].includes("T")
      ? timestampMatch[1]
      : timestampMatch[1].replace(" ", "T");
    const withZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
    const parsed = new Date(withZone);
    if (!Number.isNaN(parsed.getTime())) {
      timestamp = parsed.toISOString();
    }
    remainder = remainder.slice(timestampMatch[0].length).trim();
  }

  const levelMatch = remainder.match(/\[(trace|debug|info|warn|warning|error)\]/i)
    ?? remainder.match(/^(trace|debug|info|warn|warning|error)\b/i);
  const level = levelMatch?.[1]?.toLowerCase().replace("warning", "warn");

  return {
    timestamp,
    level,
    message: remainder
  };
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

function normalizeVscodeChatDebugLine(context: VscodeChatDebugLineContext): EventEnvelope | null {
  const parsed = parseVscodeChatDebugLine(context.line);
  const level = parsed.level ?? "debug";
  const sourceEventType = `vscode.copilot-chat.${level}`;
  const payload = {
    sourceEventType,
    data: {
      level,
      message: parsed.message
    },
    sourceLine: context.lineNumber,
    sourcePath: context.logPath
  };
  const timestamp = parsed.timestamp ?? context.now();
  const sessionId = vscodeSessionId(context.logPath, context.machineId);
  const event = {
    schemaVersion: SCHEMA_VERSION,
    eventId: stableUuid(`${context.machineId}:${context.logPath}:${context.lineNumber}:${context.line}`),
    eventType: "sourceEvent",
    timestamp,
    sessionId,
    userId: context.userId,
    machineId: context.machineId,
    source: "vscode",
    sourceVersion: "copilot-chat-debug-log-v1",
    repoPath: "vscode-copilot-chat",
    workspaceId: "vscode-copilot-chat",
    privacy: {
      classification: "internal",
      locallyRedacted: false,
      rawPayloadOptIn: context.includeRawPayload,
      retention: "standard"
    },
    confidence: "inferred",
    facets: buildEventFacets("sourceEvent", payload),
    rawPayload: context.includeRawPayload
      ? {
        redacted: false,
        retainedFor: "debug",
        payload: {
          sourceEventType,
          sourceLine: context.lineNumber,
          sourcePath: context.logPath,
          rawLine: context.line
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
  const includeSessionStore = options.includeSessionStore ?? true;
  const sessions = includeSessionStore ? getCopilotSessionRows(options.dbPath, options.sessionIds) : [];
  let importedEvents = 0;
  let skippedLines = 0;
  const importedSessions = new Set<string>(sessions.map((session) => session.id));

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

  const explicitVscodePaths = options.vscodeChatDebugPaths ?? [];
  const vscodePaths = [
    ...explicitVscodePaths,
    ...(options.includeDefaultVscodeChatDebug ? defaultVscodeChatDebugRoots() : [])
  ];
  const normalizedRoots = [...new Set(vscodePaths.map((rootPath) => normalizeRootPath(rootPath)))];
  const vscodeDebugEnabled = normalizedRoots.length > 0 || (options.includeDefaultVscodeChatDebug ?? false);
  const rootStats = new Map<string, { discoveredFiles: number; importedEvents: number; skippedLines: number }>();
  for (const rootPath of normalizedRoots) {
    rootStats.set(rootPath, {
      discoveredFiles: 0,
      importedEvents: 0,
      skippedLines: 0
    });
  }
  const vscodeFiles = await discoverVscodeChatDebugFiles(vscodePaths);
  for (const logPath of vscodeFiles) {
    const matchedRoot = rootForFile(logPath, normalizedRoots);
    if (!rootStats.has(matchedRoot)) {
      rootStats.set(matchedRoot, {
        discoveredFiles: 0,
        importedEvents: 0,
        skippedLines: 0
      });
    }
    const matchedStats = rootStats.get(matchedRoot);
    if (matchedStats) {
      matchedStats.discoveredFiles += 1;
    }

    const sessionId = vscodeSessionId(logPath, machineId);
    importedSessions.add(sessionId);
    const lines = (await readFile(logPath, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    for (let index = 0; index < lines.length; index += 1) {
      const event = normalizeVscodeChatDebugLine({
        logPath,
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
        if (matchedStats) {
          matchedStats.skippedLines += 1;
        }
        continue;
      }
      await appendFile(options.datastorePath, `${JSON.stringify(event)}\n`, "utf8");
      importedEvents += 1;
      if (matchedStats) {
        matchedStats.importedEvents += 1;
      }
    }
  }

  return {
    datastorePath: options.datastorePath,
    importedEvents,
    skippedLines,
    sessions: [...importedSessions].sort(),
    vscodeDebugImport: vscodeDebugEnabled
      ? {
        enabled: vscodeDebugEnabled,
        discoveredFiles: vscodeFiles.length,
        roots: [...rootStats.entries()]
          .map(([path, stats]) => ({
            path,
            ...stats
          }))
          .sort((a, b) => a.path.localeCompare(b.path))
      }
      : undefined
  };
}

export async function summarizeDatastore(datastorePath: string, options: DatastoreSummaryOptions = {}): Promise<DatastoreSummary> {
  const verbose = options.verbose ?? false;
  const topSourcePathsLimit = options.topSourcePathsLimit ?? 20;
  const sessions = new Set<string>();
  const machines = new Set<string>();
  const sources = new Set<string>();
  const sourceEventCounts = new Map<string, number>();
  const vscodeBuckets = {
    logs: 0,
    workspaceStorage: 0,
    other: 0,
    missingSourcePath: 0
  };
  const vscodeSourcePathCounts = new Map<string, number>();
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
      sources: [],
      sourceEventCounts: {}
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
    sourceEventCounts.set(
      parsed.value.source,
      (sourceEventCounts.get(parsed.value.source) ?? 0) + 1
    );
    if (verbose && parsed.value.source === "vscode") {
      const sourcePath = safeString(asRecord(parsed.value.payload).sourcePath, "");
      if (sourcePath.length === 0) {
        vscodeBuckets.missingSourcePath += 1;
      } else {
        const bucket = classifyVscodeSourcePath(sourcePath);
        vscodeBuckets[bucket] += 1;
        vscodeSourcePathCounts.set(sourcePath, (vscodeSourcePathCounts.get(sourcePath) ?? 0) + 1);
      }
    }
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
    sourceEventCounts: Object.fromEntries([...sourceEventCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    vscodePathBreakdown: verbose
      ? {
        totalVscodeEvents: sourceEventCounts.get("vscode") ?? 0,
        buckets: vscodeBuckets,
        topSourcePaths: [...vscodeSourcePathCounts.entries()]
          .map(([path, events]) => ({ path, events }))
          .sort((a, b) => b.events - a.events || a.path.localeCompare(b.path))
          .slice(0, topSourcePathsLimit)
      }
      : undefined,
    earliestTimestamp,
    latestTimestamp
  };
}
