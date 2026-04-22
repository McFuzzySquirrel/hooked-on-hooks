import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  parseArgs,
  detectModels,
  detectTokenMentions,
  getSessionCards,
  getSessionExport,
} from "../export-session-store.js";

function execSql(dbPath: string, sql: string): void {
  const result = spawnSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
}

describe("export-session-store", () => {
  let tempRoot = "";
  let dbPath = "";

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "session-store-test-"));
    dbPath = join(tempRoot, "session-store.db");

    execSql(
      dbPath,
      [
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, host_type TEXT, branch TEXT, summary TEXT, created_at TEXT, updated_at TEXT);",
        "CREATE TABLE turns (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT, timestamp TEXT);",
        "CREATE TABLE checkpoints (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, checkpoint_number INTEGER, title TEXT, overview TEXT, history TEXT, work_done TEXT, technical_details TEXT, important_files TEXT, next_steps TEXT, created_at TEXT);",
        "CREATE TABLE session_files (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, file_path TEXT, tool_name TEXT, turn_index INTEGER, first_seen_at TEXT);",
        "CREATE TABLE session_refs (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, ref_type TEXT, ref_value TEXT, turn_index INTEGER, created_at TEXT);",
        "CREATE TABLE search_index (content TEXT, session_id TEXT, source_type TEXT, source_id TEXT);",
      ].join(" ")
    );

    execSql(
      dbPath,
      [
        "INSERT INTO sessions (id, cwd, repository, host_type, branch, summary, created_at, updated_at)",
        "VALUES ('sess-1', '/tmp/repo', 'owner/repo', 'github', 'main', 'Session with sk-abcdefghijklmnopqrstuvwxyz012345', '2026-04-20T10:00:00.000Z', '2026-04-20T10:05:00.000Z');",
        "INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp)",
        "VALUES ('sess-1', 0, 'contains sk-abcdefghijklmnopqrstuvwxyz012345', 'Using gpt-5.3-codex with 1,234 tokens', '2026-04-20T10:01:00.000Z');",
        "INSERT INTO checkpoints (session_id, checkpoint_number, title, overview, work_done, next_steps, created_at)",
        "VALUES ('sess-1', 1, 'Milestone', 'Overview text', 'Done', 'Next', '2026-04-20T10:02:00.000Z');",
        "INSERT INTO session_files (session_id, file_path, tool_name, turn_index, first_seen_at)",
        "VALUES ('sess-1', '/tmp/repo/src/index.ts', 'edit', 0, '2026-04-20T10:03:00.000Z');",
        "INSERT INTO session_refs (session_id, ref_type, ref_value, turn_index, created_at)",
        "VALUES ('sess-1', 'commit', 'abc1234', 0, '2026-04-20T10:04:00.000Z');",
        "INSERT INTO search_index (content, session_id, source_type, source_id)",
        "VALUES ('gpt-5.3-codex summary 1,234 tokens', 'sess-1', 'turn', '1');",
      ].join(" ")
    );

    const sessionStateDir = join(tempRoot, "session-state", "sess-1");
    mkdirSync(sessionStateDir, { recursive: true });
    writeFileSync(
      join(sessionStateDir, "events.jsonl"),
      [
        JSON.stringify({
          type: "session.model_change",
          data: { newModel: "claude-opus-4.6" },
        }),
        JSON.stringify({
          type: "assistant.message",
          data: { model: "claude-opus-4.6", inputTokens: 150, outputTokens: 300 },
        }),
        JSON.stringify({
          type: "tool.execution_complete",
          data: { model: "gpt-5.3-codex", outputTokens: 75 },
        }),
      ].join("\n"),
      "utf8"
    );
  });

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("parses exporter args for ids and output modes", () => {
    const args = parseArgs([
      "--db-path",
      dbPath,
      "--ids",
      "sess-1,sess-2",
      "--out",
      "./combined.json",
      "--split",
      "--split-dir",
      "./split",
      "--redact",
    ]);

    expect(args.dbPath).toContain("session-store.db");
    expect(args.ids).toEqual(["sess-1", "sess-2"]);
    expect(args.out).toContain("combined.json");
    expect(args.split).toBe(true);
    expect(args.splitDir).toContain("split");
    expect(args.redact).toBe(true);
  });

  it("detects models and token mentions from indexed strings", () => {
    const lines = [
      "We used gpt-5.3-codex and claude-3-7-sonnet in this run",
      "Total 2,048 tokens consumed",
    ];

    expect(detectModels(lines)).toEqual(["claude-3-7-sonnet", "gpt-5.3-codex"]);
    expect(detectTokenMentions(lines)).toEqual([
      { source: "Total 2,048 tokens consumed", value: 2048 },
    ]);
  });

  it("builds session cards with aggregated counts", () => {
    const cards = getSessionCards(dbPath);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.sessionId).toBe("sess-1");
    expect(cards[0]?.repository).toBe("owner/repo");
    expect(cards[0]?.eventCount).toBe(4);
    expect(cards[0]?.fileSizeBytes).toBeGreaterThan(0);
  });

  it("exports session data and applies redaction when enabled", () => {
    const raw = getSessionExport(dbPath, "sess-1", false);
    const redacted = getSessionExport(dbPath, "sess-1", true);

    const rawTurn = String(raw.turns[0]?.user_message ?? "");
    const redactedTurn = String(redacted.turns[0]?.user_message ?? "");

    expect(rawTurn).toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(redactedTurn).toContain("[REDACTED_API_KEY]");
    expect(redacted.searchBlob.join("\n")).toContain("gpt-5.3-codex");
    expect(redacted.modelsAndTokens.detectedModels).toContain("gpt-5.3-codex");
    expect(redacted.modelsAndTokens.detectedModels).toContain("claude-opus-4.6");
    expect(redacted.modelsAndTokens.tokenMentions[0]?.value).toBe(1234);
    expect(redacted.modelsAndTokens.totals.totalTokens).toBe(525);
    expect(redacted.modelsAndTokens.modelUsage.find((entry) => entry.model === "claude-opus-4.6")?.totalTokens).toBe(450);
    expect(redacted.modelsAndTokens.modelUsage.find((entry) => entry.model === "gpt-5.3-codex")?.outputTokens).toBe(75);
  });
});
