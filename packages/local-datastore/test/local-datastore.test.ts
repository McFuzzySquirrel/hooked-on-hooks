import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  importCopilotSessionStore,
  summarizeDatastore
} from "../src/index.js";
import { parseArgs } from "../../../scripts/ingest-source-datastore.js";

const sqliteCheck = spawnSync("sqlite3", ["--version"], { encoding: "utf8" });
const hasSqlite = sqliteCheck.status === 0;
const describeIfSqlite = hasSqlite ? describe : describe.skip;

function execSql(dbPath: string, sql: string): void {
  const result = spawnSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
}

describe("ingest-source-datastore args", () => {
  it("parses import and summary commands", () => {
    const importArgs = parseArgs([
      "import",
      "--db-path",
      "./session-store.db",
      "--datastore",
      "./datastore/events.jsonl",
      "--ids",
      "a,b",
      "--machine-id",
      "machine-1",
      "--include-raw-payload"
    ]);
    expect(importArgs.command).toBe("import");
    expect(importArgs.ids).toEqual(["a", "b"]);
    expect(importArgs.machineId).toBe("machine-1");
    expect(importArgs.includeRawPayload).toBe(true);

    const summaryArgs = parseArgs(["summary", "--datastore", "./datastore/events.jsonl"]);
    expect(summaryArgs.command).toBe("summary");
    expect(summaryArgs.datastorePath).toContain("datastore/events.jsonl");
  });
});

describeIfSqlite("local source datastore import", () => {
  let tempRoot = "";
  let dbPath = "";
  let datastorePath = "";

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "local-datastore-test-"));
    dbPath = join(tempRoot, "session-store.db");
    datastorePath = join(tempRoot, "datastore", "events.jsonl");

    execSql(
      dbPath,
      [
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, host_type TEXT, branch TEXT, created_at TEXT, updated_at TEXT);",
        "INSERT INTO sessions (id, cwd, repository, host_type, branch, created_at, updated_at)",
        "VALUES ('sess-1', '/tmp/repo', 'owner/repo', 'github', 'main', '2026-04-20T10:00:00.000Z', '2026-04-20T10:05:00.000Z');",
      ].join(" ")
    );

    const eventsDir = join(tempRoot, "session-state", "sess-1");
    mkdirSync(eventsDir, { recursive: true });
    writeFileSync(
      join(eventsDir, "events.jsonl"),
      [
        JSON.stringify({
          type: "assistant.message",
          timestamp: "2026-04-20T10:01:00.000Z",
          data: {
            interactionId: "turn-1",
            model: "gpt-5.3-codex",
            inputTokens: 10,
            outputTokens: 20,
            toolRequests: [
              { name: "subagent", toolCallId: "tc-1", intentionSummary: "qa-engineer", arguments: { agentName: "qa-engineer", task: "test token=abc123" } }
            ]
          }
        }),
        JSON.stringify({
          type: "tool.execution_complete",
          timestamp: "2026-04-20T10:01:01.000Z",
          data: { interactionId: "turn-1", toolCallId: "tc-1", toolName: "subagent", success: true }
        }),
        "{not-json"
      ].join("\n"),
      "utf8"
    );
  });

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("imports direct source events into an append-only multi-session datastore", async () => {
    const result = await importCopilotSessionStore({
      dbPath,
      datastorePath,
      machineId: "machine-1",
      userId: "user-1",
      includeRawPayload: true,
      now: () => "2026-04-20T10:00:00.000Z"
    });

    expect(result.importedEvents).toBe(2);
    expect(result.skippedLines).toBe(1);

    const lines = (await readFile(datastorePath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]) as {
      eventType: string;
      source: string;
      sourceVersion: string;
      sessionId: string;
      machineId: string;
      privacy: { locallyRedacted: boolean; rawPayloadOptIn: boolean };
      facets: {
        toolCalls: Array<{ category: string; status: string }>;
        modelUsage: Array<{ model: string; totalTokens: number }>;
        subagentActivity: Array<{ agentName: string; action: string }>;
      };
      rawPayload?: { redacted: boolean; payload: unknown };
    };

    expect(first.eventType).toBe("sourceEvent");
    expect(first.source).toBe("copilot-session-store");
    expect(first.sourceVersion).toBe("session-store-v1");
    expect(first.sessionId).toBe("sess-1");
    expect(first.machineId).toBe("machine-1");
    expect(first.privacy.locallyRedacted).toBe(true);
    expect(first.privacy.rawPayloadOptIn).toBe(true);
    expect(first.facets.modelUsage[0]).toMatchObject({ model: "gpt-5.3-codex", totalTokens: 30 });
    expect(first.facets.toolCalls[0]).toMatchObject({ category: "subagent_task_launch", status: "requested" });
    expect(first.facets.subagentActivity[0]).toMatchObject({ agentName: "qa-engineer", action: "delegated" });
    expect(first.rawPayload?.redacted).toBe(true);
    expect(JSON.stringify(first)).not.toContain("abc123");

    const summary = await summarizeDatastore(datastorePath);
    expect(summary.eventCount).toBe(2);
    expect(summary.sessionCount).toBe(1);
    expect(summary.machineCount).toBe(1);
    expect(summary.sources).toEqual(["copilot-session-store"]);
  });
});
