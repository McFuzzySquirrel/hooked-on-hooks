import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { importVsCodeChatWorkspace } from "../lib/vscode-chat-import.js";
import { replayJsonl } from "../replay-jsonl.js";
import { createIngestServer } from "../../packages/ingest-service/src/index.js";
import { getSessionCards, getSessionExport } from "../export-session-store.js";
import { classifySessionSource, normalizeSessionExport } from "../../packages/web-ui/src/session-dashboard-helpers.js";
import { parseEvent, type EventEnvelope } from "../../shared/event-schema/src/index.js";

const sqliteCheck = spawnSync("sqlite3", ["--version"], { encoding: "utf8" });
const hasSqlite = sqliteCheck.status === 0;
const describeIfSqlite = hasSqlite ? describe : describe.skip;

function execSql(dbPath: string, sql: string): void {
  const result = spawnSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
}

function readEventsFromJsonl(path: string): EventEnvelope[] {
  const lines = readFileSync(path, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  return lines
    .map((line) => parseEvent(JSON.parse(line)))
    .filter((result) => result.ok)
    .map((result) => result.value);
}

function seedSessionStoreFromEvents(dbPath: string, events: EventEnvelope[]): void {
  execSql(
    dbPath,
    [
      "CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, host_type TEXT, branch TEXT, summary TEXT, created_at TEXT, updated_at TEXT);",
      "CREATE TABLE turns (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT, timestamp TEXT);",
      "CREATE TABLE checkpoints (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, checkpoint_number INTEGER, title TEXT, overview TEXT, history TEXT, work_done TEXT, technical_details TEXT, important_files TEXT, next_steps TEXT, created_at TEXT);",
      "CREATE TABLE session_files (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, file_path TEXT, tool_name TEXT, turn_index INTEGER, first_seen_at TEXT);",
      "CREATE TABLE session_refs (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, ref_type TEXT, ref_value TEXT, turn_index INTEGER, created_at TEXT);",
      "CREATE TABLE search_index (content TEXT, session_id TEXT, source_type TEXT, source_id TEXT);",
    ].join(" "),
  );

  const grouped = new Map<string, EventEnvelope[]>();
  for (const event of events) {
    const list = grouped.get(event.sessionId) ?? [];
    list.push(event);
    grouped.set(event.sessionId, list);
  }

  for (const [sessionId, sessionEvents] of grouped.entries()) {
    const sorted = [...sessionEvents].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const source = sorted[0]?.source ?? "vscode-chat";
    const createdAt = sorted[0]?.timestamp ?? "2026-05-04T00:00:00.000Z";
    const updatedAt = sorted.at(-1)?.timestamp ?? createdAt;
    const escapedSessionId = sessionId.replace(/'/g, "''");

    execSql(
      dbPath,
      [
        "INSERT INTO sessions (id, cwd, repository, host_type, branch, summary, created_at, updated_at)",
        `VALUES ('${escapedSessionId}', '/tmp/repo', 'owner/repo', '${source}', 'main', 'Imported ${escapedSessionId}', '${createdAt}', '${updatedAt}');`,
      ].join(" "),
    );

    let turnIndex = 0;
    for (const event of sorted) {
      if (event.eventType !== "chatMessage") {
        continue;
      }
      const role = event.payload.role;
      const text = (event.payload.text ?? "").replace(/'/g, "''");
      const userMessage = role === "user" ? `'${text}'` : "NULL";
      const assistantMessage = role === "assistant" ? `'${text}'` : "NULL";
      execSql(
        dbPath,
        [
          "INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp)",
          `VALUES ('${escapedSessionId}', ${turnIndex}, ${userMessage}, ${assistantMessage}, '${event.timestamp}');`,
        ].join(" "),
      );
      turnIndex += 1;
    }

    execSql(
      dbPath,
      [
        "INSERT INTO search_index (content, session_id, source_type, source_id)",
        `VALUES ('imported ${escapedSessionId}', '${escapedSessionId}', 'turn', '1');`,
      ].join(" "),
    );
  }

  execSql(
    dbPath,
    [
      "INSERT INTO sessions (id, cwd, repository, host_type, branch, summary, created_at, updated_at)",
      "VALUES ('sess-cli-1', '/tmp/repo', 'owner/repo', 'github', 'main', 'CLI session', '2026-05-04T12:10:00.000Z', '2026-05-04T12:11:00.000Z');",
      "INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp)",
      "VALUES ('sess-cli-1', 0, 'cli user prompt', 'cli assistant response', '2026-05-04T12:10:10.000Z');",
      "INSERT INTO search_index (content, session_id, source_type, source_id)",
      "VALUES ('cli search text', 'sess-cli-1', 'turn', '1');",
    ].join(" "),
  );
}

describeIfSqlite("VS Code chat import/replay/export integration", () => {
  it("imports fixture data, replays to ingest, exports sessions, and validates source filtering", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "vscode-chat-e2e-"));
    let server: Awaited<ReturnType<typeof createIngestServer>> | null = null;

    try {
      const workspaceStorageRoot = join(tempRoot, "workspaceStorage");
      const chatSessionsDir = join(workspaceStorageRoot, "chatSessions");
      const resourcesDir = join(workspaceStorageRoot, "GitHub.copilot-chat", "chat-session-resources", "sess-vscode-1", "call_123__vscode-1700000100000");
      mkdirSync(chatSessionsDir, { recursive: true });
      mkdirSync(resourcesDir, { recursive: true });

      const chatSessionFile = join(chatSessionsDir, "sess-vscode-1.jsonl");
      writeFileSync(
        chatSessionFile,
        [
          JSON.stringify({ kind: 0, v: { creationDate: 1700000000000, sessionId: "sess-vscode-1", customTitle: "VS Code chat" } }),
          JSON.stringify({
            kind: 2,
            v: [
              {
                requestId: "req-1",
                timestamp: 1700000002000,
                message: { text: "user message" },
                response: [
                  { kind: "toolInvocationSerialized", isComplete: false, toolId: "read_file", toolCallId: "tc-1" },
                  { kind: "toolInvocationSerialized", isComplete: true, toolId: "read_file", toolCallId: "tc-1" },
                  { kind: "text", value: "assistant response" },
                ],
              },
            ],
          }),
        ].join("\n") + "\n",
        "utf8",
      );

      writeFileSync(join(resourcesDir, "content.txt"), "artifact text", "utf8");

      const importedJsonl = join(tempRoot, "imported.jsonl");
      const importResult = await importVsCodeChatWorkspace({
        workspaceStorageRoot,
        jsonlPath: importedJsonl,
        repoPath: "/tmp/repo",
        mode: "auto",
      });

      expect(importResult.emitted).toBeGreaterThan(0);
      expect(importResult.rejected).toBe(0);

      server = await createIngestServer();
      await server.listen({ host: "127.0.0.1", port: 0 });
      const address = server.server.address();
      const endpoint = typeof address === "object" && address ? `http://127.0.0.1:${address.port}/events` : "http://127.0.0.1:7070/events";

      const replayResult = await replayJsonl(importedJsonl, endpoint);
      expect(replayResult.sent).toBeGreaterThan(0);
      expect(replayResult.rejected).toBe(0);
      expect(replayResult.errors).toBe(0);

      const ingested = await server.inject({ method: "GET", url: "/events" });
      const ingestedBody = ingested.json() as { count: number };
      expect(ingestedBody.count).toBe(replayResult.sent);

      await server.close();
      server = null;

      const events = readEventsFromJsonl(importedJsonl);
      const dbPath = join(tempRoot, "session-store.db");
      seedSessionStoreFromEvents(dbPath, events);

      const cards = getSessionCards(dbPath);
      expect(cards.length).toBeGreaterThanOrEqual(2);

      const exportedSessions = cards
        .map((card) => getSessionExport(dbPath, card.sessionId, false));

      const normalized = normalizeSessionExport({
        exportedAt: new Date().toISOString(),
        source: { type: "copilot-session-store-db", dbPath },
        sessions: exportedSessions,
      });

      const sourceCounts = normalized.sessions.reduce(
        (acc, session) => {
          const source = classifySessionSource(session, normalized.source.type);
          acc[source] += 1;
          return acc;
        },
        { "copilot-cli": 0, "vscode-chat": 0, unknown: 0 },
      );

      expect(sourceCounts["vscode-chat"]).toBeGreaterThanOrEqual(1);
      expect(sourceCounts["copilot-cli"]).toBeGreaterThanOrEqual(1);

      const vscodeFiltered = normalized.sessions.filter(
        (session) => classifySessionSource(session, normalized.source.type) === "vscode-chat",
      );
      const cliFiltered = normalized.sessions.filter(
        (session) => classifySessionSource(session, normalized.source.type) === "copilot-cli",
      );

      expect(vscodeFiltered.some((session) => session.sessionId === "sess-vscode-1")).toBe(true);
      expect(cliFiltered.some((session) => session.sessionId === "sess-cli-1")).toBe(true);
    } finally {
      if (server) {
        await server.close();
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
