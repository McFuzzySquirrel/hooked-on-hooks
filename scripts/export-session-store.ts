#!/usr/bin/env node
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { redactSensitiveStrings } from "../shared/redaction/src/patterns.js";

interface Args {
  dbPath: string;
  json?: string;
  ids: string[];
  out?: string;
  split: boolean;
  splitDir?: string;
  redact: boolean;
}

interface SessionCard {
  sessionId: string;
  repository: string;
  branch: string;
  summary: string;
  eventCount: number;
  fileSizeBytes: number;
  modifiedAt: string;
  createdAt: string;
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
    modelUsage: Array<{
      model: string;
      eventCount: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }>;
    totals: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    notes: string[];
  };
  searchBlob: string[];
}

interface CombinedExport {
  exportedAt: string;
  source: {
    type: "copilot-session-store-db";
    dbPath: string;
  };
  sessions: SessionExport[];
}

function usage(): string {
  return [
    "Usage:",
    "  npm run session:list -- --json ./session-list.json",
    "  npm run session:export -- --ids <id1,id2> --out ./session-store-export.json [--redact]",
    "  npm run session:export -- --ids <id1,id2> --split --split-dir ./exports [--redact]",
    "Options:",
    "  --db-path <path>      Path to session-store.db (default: ~/.copilot/session-store.db)",
    "  --json <path>         Write selector list JSON to file",
    "  --ids <csv>           Comma-separated session ids to export",
    "  --out <path>          Combined export output file path",
    "  --split               Write one file per session",
    "  --split-dir <path>    Output directory for split exports",
    "  --redact              Apply pattern-based string redaction",
  ].join("\n");
}

function fail(message: string): never {
  console.error(`export-session-store error: ${message}`);
  process.exit(1);
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    dbPath: resolve(homedir(), ".copilot", "session-store.db"),
    ids: [],
    split: false,
    redact: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;

    if (token === "--split") {
      args.split = true;
      continue;
    }
    if (token === "--redact") {
      args.redact = true;
      continue;
    }

    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      fail(`missing value for ${token}`);
    }

    switch (token) {
      case "--db-path":
        args.dbPath = resolve(value);
        break;
      case "--json":
        args.json = resolve(value);
        break;
      case "--ids":
        args.ids = value.split(",").map((entry) => entry.trim()).filter(Boolean);
        break;
      case "--out":
        args.out = resolve(value);
        break;
      case "--split-dir":
        args.splitDir = resolve(value);
        break;
      default:
        fail(`unknown option ${token}`);
    }

    i += 1;
  }

  return args;
}

function sqlEscape(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function runSqlJson<T>(dbPath: string, sql: string): T[] {
  const result = spawnSync("sqlite3", [dbPath, "-json", sql], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    fail(result.stderr || `sqlite3 failed with exit code ${result.status ?? "unknown"}`);
  }

  const stdout = (result.stdout || "").trim();
  if (!stdout) {
    return [];
  }

  try {
    return JSON.parse(stdout) as T[];
  } catch (error) {
    fail(`failed to parse sqlite JSON output: ${(error as Error).message}`);
  }
}

function runSqlJsonSafe<T>(dbPath: string, sql: string): T[] {
  const result = spawnSync("sqlite3", [dbPath, "-json", sql], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const stderr = result.stderr || "";
    if (stderr.includes("no such module: fts5")) {
      return [];
    }
    fail(stderr || `sqlite3 failed with exit code ${result.status ?? "unknown"}`);
  }

  const stdout = (result.stdout || "").trim();
  if (!stdout) {
    return [];
  }

  try {
    return JSON.parse(stdout) as T[];
  } catch (error) {
    fail(`failed to parse sqlite JSON output: ${(error as Error).message}`);
  }
}

function estimateBytes(parts: Array<string | null | undefined>): number {
  return Buffer.byteLength(parts.filter((p): p is string => Boolean(p)).join("\n"), "utf8");
}

function safeString(value: unknown, fallback = "unknown"): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  return value;
}

function maybeRedact(value: string, redact: boolean): string {
  return redact ? redactSensitiveStrings(value) : value;
}

function redactUnknown(value: unknown, redact: boolean): unknown {
  if (!redact) return value;
  if (typeof value === "string") {
    return redactSensitiveStrings(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, true));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      out[k] = redactUnknown(v, true);
    }
    return out;
  }
  return value;
}

export function detectModels(searchBlob: string[]): string[] {
  const modelRegex = /(gpt-[a-zA-Z0-9_.-]+|claude-[a-zA-Z0-9_.-]+|o[1-9](?:-[a-zA-Z0-9_.-]+)?)/g;
  const set = new Set<string>();
  for (const line of searchBlob) {
    for (const match of line.matchAll(modelRegex)) {
      set.add(match[0]);
    }
  }
  return [...set].sort();
}

export function detectTokenMentions(searchBlob: string[]): Array<{ source: string; value: number }> {
  const tokenRegex = /([0-9][0-9,]*)\s+tokens?/gi;
  const found: Array<{ source: string; value: number }> = [];
  for (const line of searchBlob) {
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(line)) !== null) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value)) {
        found.push({ source: line.slice(0, 200), value });
      }
    }
  }
  return found;
}

interface EventTokenTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface EventModelMetrics {
  detectedModels: string[];
  modelUsage: Array<{
    model: string;
    eventCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  totals: EventTokenTotals;
  eventsPathExists: boolean;
}

function readTokenNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  return 0;
}

function resolveSessionEventsJsonlPath(dbPath: string, sessionId: string): string {
  return resolve(dirname(dbPath), "session-state", sessionId, "events.jsonl");
}

function extractEventModelMetrics(dbPath: string, sessionId: string): EventModelMetrics {
  const eventsPath = resolveSessionEventsJsonlPath(dbPath, sessionId);
  if (!existsSync(eventsPath)) {
    return {
      detectedModels: [],
      modelUsage: [],
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      eventsPathExists: false,
    };
  }

  const content = readFileSync(eventsPath, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const modelSet = new Set<string>();
  const modelUsageMap = new Map<string, { eventCount: number; inputTokens: number; outputTokens: number; totalTokens: number }>();
  const totals: EventTokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

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

    const envelope = parsed as Record<string, unknown>;
    const type = typeof envelope.type === "string" ? envelope.type : "";
    const data = envelope.data && typeof envelope.data === "object"
      ? envelope.data as Record<string, unknown>
      : {};

    const usage = data.usage && typeof data.usage === "object"
      ? data.usage as Record<string, unknown>
      : {};

    const inputTokens =
      readTokenNumber(data, ["inputTokens", "promptTokens", "input_tokens", "prompt_tokens"]) ||
      readTokenNumber(usage, ["inputTokens", "promptTokens", "input_tokens", "prompt_tokens"]);

    const outputTokens =
      readTokenNumber(data, ["outputTokens", "completionTokens", "output_tokens", "completion_tokens"]) ||
      readTokenNumber(usage, ["outputTokens", "completionTokens", "output_tokens", "completion_tokens"]);

    const explicitTotal =
      readTokenNumber(data, ["totalTokens", "total_tokens", "tokens"]) ||
      readTokenNumber(usage, ["totalTokens", "total_tokens", "tokens"]);

    const directionalTotal = inputTokens + outputTokens;
    const totalTokens = directionalTotal > 0 ? directionalTotal : explicitTotal;

    totals.inputTokens += inputTokens;
    totals.outputTokens += outputTokens;
    totals.totalTokens += totalTokens;

    let model = "";
    if (typeof data.model === "string") {
      model = data.model;
    } else if (type === "session.model_change" && typeof data.newModel === "string") {
      model = data.newModel;
    }

    if (!model) {
      continue;
    }

    modelSet.add(model);

    if (!modelUsageMap.has(model)) {
      modelUsageMap.set(model, {
        eventCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    }

    const usageEntry = modelUsageMap.get(model);
    if (!usageEntry) {
      continue;
    }

    usageEntry.eventCount += 1;
    usageEntry.inputTokens += inputTokens;
    usageEntry.outputTokens += outputTokens;
    usageEntry.totalTokens += totalTokens;
  }

  const modelUsage = [...modelUsageMap.entries()]
    .map(([model, usage]) => ({ model, ...usage }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.eventCount - a.eventCount || a.model.localeCompare(b.model));

  return {
    detectedModels: [...modelSet].sort(),
    modelUsage,
    totals,
    eventsPathExists: true,
  };
}

export function getSessionCards(dbPath: string): SessionCard[] {
  const rows = runSqlJson<{
    id: string;
    repository: string | null;
    branch: string | null;
    summary: string | null;
    created_at: string | null;
    updated_at: string | null;
    turn_count: number;
    checkpoint_count: number;
    file_count: number;
    ref_count: number;
    text_bytes: number;
  }>(
    dbPath,
    `SELECT
       s.id,
       s.repository,
       s.branch,
       s.summary,
       s.created_at,
       s.updated_at,
       COALESCE(t.turn_count, 0) AS turn_count,
       COALESCE(cp.checkpoint_count, 0) AS checkpoint_count,
       COALESCE(sf.file_count, 0) AS file_count,
       COALESCE(sr.ref_count, 0) AS ref_count,
       COALESCE(tx.text_bytes, 0) AS text_bytes
     FROM sessions s
     LEFT JOIN (
       SELECT session_id, COUNT(*) AS turn_count
       FROM turns
       GROUP BY session_id
     ) t ON t.session_id = s.id
     LEFT JOIN (
       SELECT session_id, COUNT(*) AS checkpoint_count
       FROM checkpoints
       GROUP BY session_id
     ) cp ON cp.session_id = s.id
     LEFT JOIN (
       SELECT session_id, COUNT(*) AS file_count
       FROM session_files
       GROUP BY session_id
     ) sf ON sf.session_id = s.id
     LEFT JOIN (
       SELECT session_id, COUNT(*) AS ref_count
       FROM session_refs
       GROUP BY session_id
     ) sr ON sr.session_id = s.id
     LEFT JOIN (
       SELECT
         session_id,
         SUM(LENGTH(COALESCE(user_message, '')) + LENGTH(COALESCE(assistant_response, ''))) AS text_bytes
       FROM turns
       GROUP BY session_id
     ) tx ON tx.session_id = s.id
     ORDER BY s.updated_at DESC`
  );

  return rows.map((row) => {
    const eventCount = row.turn_count + row.checkpoint_count + row.file_count + row.ref_count;
    return {
      sessionId: row.id,
      repository: safeString(row.repository, "unknown-repo"),
      branch: safeString(row.branch, "unknown-branch"),
      summary: safeString(row.summary, "Untitled session"),
      eventCount,
      fileSizeBytes: Math.max(0, row.text_bytes),
      modifiedAt: safeString(row.updated_at, ""),
      createdAt: safeString(row.created_at, ""),
    };
  });
}

export function getSessionExport(dbPath: string, sessionId: string, redact: boolean): SessionExport {
  const sessionRows = runSqlJson<{
    id: string;
    cwd: string | null;
    repository: string | null;
    host_type: string | null;
    branch: string | null;
    summary: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>(
    dbPath,
    `SELECT id, cwd, repository, host_type, branch, summary, created_at, updated_at
     FROM sessions
     WHERE id = ${sqlEscape(sessionId)}
     LIMIT 1`
  );

  if (sessionRows.length === 0) {
    fail(`session not found: ${sessionId}`);
  }

  const turns = runSqlJson<Record<string, unknown>>(
    dbPath,
    `SELECT id, session_id, turn_index, user_message, assistant_response, timestamp
     FROM turns
     WHERE session_id = ${sqlEscape(sessionId)}
     ORDER BY turn_index ASC`
  ).map((row) => redactUnknown(row, redact) as Record<string, unknown>);

  const checkpoints = runSqlJson<Record<string, unknown>>(
    dbPath,
    `SELECT id, session_id, checkpoint_number, title, overview, history, work_done, technical_details, important_files, next_steps, created_at
     FROM checkpoints
     WHERE session_id = ${sqlEscape(sessionId)}
     ORDER BY checkpoint_number ASC`
  ).map((row) => redactUnknown(row, redact) as Record<string, unknown>);

  const files = runSqlJson<Record<string, unknown>>(
    dbPath,
    `SELECT id, session_id, file_path, tool_name, turn_index, first_seen_at
     FROM session_files
     WHERE session_id = ${sqlEscape(sessionId)}
     ORDER BY first_seen_at ASC`
  ).map((row) => redactUnknown(row, redact) as Record<string, unknown>);

  const refs = runSqlJson<Record<string, unknown>>(
    dbPath,
    `SELECT id, session_id, ref_type, ref_value, turn_index, created_at
     FROM session_refs
     WHERE session_id = ${sqlEscape(sessionId)}
     ORDER BY created_at ASC`
  ).map((row) => redactUnknown(row, redact) as Record<string, unknown>);

  const searchRows = runSqlJsonSafe<{ content: string }>(
    dbPath,
    `SELECT content
     FROM search_index
     WHERE session_id = ${sqlEscape(sessionId)}
     ORDER BY rowid ASC`
  );

  const fallbackSearchBlob = [
    ...turns.flatMap((turn) => [String(turn.user_message ?? ""), String(turn.assistant_response ?? "")]),
    ...checkpoints.flatMap((checkpoint) => [
      String(checkpoint.title ?? ""),
      String(checkpoint.overview ?? ""),
      String(checkpoint.work_done ?? ""),
      String(checkpoint.technical_details ?? ""),
      String(checkpoint.next_steps ?? ""),
    ]),
    ...files.map((file) => String(file.file_path ?? "")),
    ...refs.map((ref) => String(ref.ref_value ?? "")),
  ].filter((value) => value.trim().length > 0);

  const searchBlob = (searchRows.length > 0
    ? searchRows.map((row) => row.content)
    : fallbackSearchBlob).map((text) => maybeRedact(text, redact));

  const searchDetectedModels = detectModels(searchBlob);
  const tokenMentions = detectTokenMentions(searchBlob);
  const eventMetrics = extractEventModelMetrics(dbPath, sessionId);
  const detectedModels = [...new Set([...searchDetectedModels, ...eventMetrics.detectedModels])].sort();

  const eventCount = turns.length + checkpoints.length + files.length + refs.length;
  const fileSizeBytes = estimateBytes([
    ...turns.flatMap((turn) => [String(turn.user_message ?? ""), String(turn.assistant_response ?? "")]),
    ...checkpoints.flatMap((checkpoint) => [String(checkpoint.overview ?? ""), String(checkpoint.work_done ?? "")]),
    ...files.map((file) => String(file.file_path ?? "")),
    ...refs.map((ref) => String(ref.ref_value ?? "")),
  ]);

  const session = sessionRows[0];

  return {
    sessionId,
    summary: maybeRedact(safeString(session.summary, "Untitled session"), redact),
    repository: maybeRedact(safeString(session.repository, "unknown-repo"), redact),
    branch: maybeRedact(safeString(session.branch, "unknown-branch"), redact),
    cwd: maybeRedact(safeString(session.cwd, ""), redact),
    hostType: safeString(session.host_type, "unknown"),
    createdAt: safeString(session.created_at, ""),
    updatedAt: safeString(session.updated_at, ""),
    stats: {
      eventCount,
      turnCount: turns.length,
      checkpointCount: checkpoints.length,
      fileCount: files.length,
      refCount: refs.length,
      fileSizeBytes,
    },
    checkpoints,
    turns,
    files,
    refs,
    modelsAndTokens: {
      detectedModels,
      tokenMentions,
      modelUsage: eventMetrics.modelUsage,
      totals: eventMetrics.totals,
      notes: [
        "Model and token details are sourced from session-state events.jsonl when available.",
        "Additional model/token mentions are inferred from indexed text for compatibility.",
        eventMetrics.eventsPathExists
          ? "events.jsonl was found and parsed for this session."
          : "events.jsonl was not found for this session; model usage and token totals may be incomplete.",
        "If SQLite FTS5 is unavailable, search data falls back to turns/checkpoints/files/refs text.",
      ],
    },
    searchBlob,
  };
}

function writeJsonFile(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function ensureSqliteAvailable(): void {
  const check = spawnSync("sqlite3", ["--version"], { encoding: "utf8" });
  if (check.status !== 0) {
    fail("sqlite3 CLI is required but not available in PATH");
  }
}

function exportSelected(args: Args): void {
  if (args.ids.length === 0) {
    fail("missing --ids <id1,id2,...> for export mode");
  }

  const sessions = args.ids.map((sessionId) => getSessionExport(args.dbPath, sessionId, args.redact));
  const combined: CombinedExport = {
    exportedAt: new Date().toISOString(),
    source: {
      type: "copilot-session-store-db",
      dbPath: args.dbPath,
    },
    sessions,
  };

  if (args.out) {
    writeJsonFile(args.out, combined);
    console.log(`Wrote combined export: ${args.out}`);
  }

  if (args.split) {
    const splitDir = args.splitDir ?? resolve(process.cwd(), "session-export-split");
    mkdirSync(splitDir, { recursive: true });
    for (const session of sessions) {
      const path = resolve(splitDir, `${session.sessionId}.json`);
      writeJsonFile(path, session);
    }
    console.log(`Wrote split exports: ${splitDir}`);
  }

  if (!args.out && !args.split) {
    process.stdout.write(`${JSON.stringify(combined, null, 2)}\n`);
  }
}

function listSessions(args: Args): void {
  const sessions = getSessionCards(args.dbPath);
  const payload = {
    generatedAt: new Date().toISOString(),
    source: {
      type: "copilot-session-store-db",
      dbPath: args.dbPath,
    },
    count: sessions.length,
    sessions,
  };

  if (args.json) {
    writeJsonFile(args.json, payload);
    console.log(`Wrote session list: ${args.json}`);
    return;
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }

  const args = parseArgs(argv);
  ensureSqliteAvailable();

  if (args.ids.length > 0 || args.out || args.split) {
    exportSelected(args);
    return;
  }

  listSessions(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
