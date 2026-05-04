import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJsonlDashboard } from "../export-jsonl-dashboard.js";
import { normalizeSessionExport } from "../../packages/web-ui/src/session-dashboard-helpers.js";

describe("exportJsonlDashboard", () => {
  it("converts canonical vscode chat JSONL into dashboard export JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "export-jsonl-dashboard-"));
    const jsonlPath = join(root, "events.jsonl");
    const outPath = join(root, "dashboard.json");

    const events = [
      {
        schemaVersion: "1.0.0",
        eventId: "11111111-1111-4111-8111-111111111111",
        eventType: "chatSessionStart",
        timestamp: "2026-05-04T20:00:00.000Z",
        sessionId: "sess-1",
        source: "vscode-chat",
        repoPath: "/tmp/repo-a",
        payload: { workspaceSessionId: "sess-1", title: "Fixture chat" },
      },
      {
        schemaVersion: "1.0.0",
        eventId: "22222222-2222-4222-8222-222222222222",
        eventType: "chatMessage",
        timestamp: "2026-05-04T20:00:01.000Z",
        sessionId: "sess-1",
        source: "vscode-chat",
        repoPath: "/tmp/repo-a",
        payload: { role: "user", text: "hello", requestId: "req-1" },
      },
      {
        schemaVersion: "1.0.0",
        eventId: "33333333-3333-4333-8333-333333333333",
        eventType: "chatMessage",
        timestamp: "2026-05-04T20:00:02.000Z",
        sessionId: "sess-1",
        source: "vscode-chat",
        repoPath: "/tmp/repo-a",
        payload: {
          role: "assistant",
          text: "world",
          requestId: "req-1",
          model: "gpt-5.4",
          inputTokens: 12,
          outputTokens: 34,
          totalTokens: 46,
        },
      },
      {
        schemaVersion: "1.0.0",
        eventId: "33333333-3333-4333-8333-333333333334",
        eventType: "chatMessage",
        timestamp: "2026-05-04T20:00:02.500Z",
        sessionId: "sess-1",
        source: "vscode-chat",
        repoPath: "/tmp/repo-a",
        payload: {
          role: "assistant",
          text: "world-2",
          requestId: "req-2",
          model: "claude-sonnet-4.6",
          inputTokens: 5,
          outputTokens: 15,
          totalTokens: 20,
        },
      },
      {
        schemaVersion: "1.0.0",
        eventId: "44444444-4444-4444-8444-444444444444",
        eventType: "chatToolCall",
        timestamp: "2026-05-04T20:00:03.000Z",
        sessionId: "sess-1",
        source: "vscode-chat",
        repoPath: "/tmp/repo-a",
        payload: { toolName: "read_file", status: "completed", requestId: "req-1", toolCallId: "call-1" },
      },
      {
        schemaVersion: "1.0.0",
        eventId: "55555555-5555-4555-8555-555555555555",
        eventType: "chatArtifactImported",
        timestamp: "2026-05-04T20:00:04.000Z",
        sessionId: "sess-1",
        source: "vscode-chat",
        repoPath: "/tmp/repo-a",
        payload: { artifactType: "tool-call-content", path: "/tmp/content.txt", sizeBytes: 12 },
      },
    ];

    await writeFile(jsonlPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");

    const payload = await exportJsonlDashboard(jsonlPath, outPath);
    expect(payload.sessions).toHaveLength(1);
    expect(payload.sessions[0]?.hostType).toBe("vscode-chat");
    expect(payload.sessions[0]?.turns).toHaveLength(2);
    expect(payload.sessions[0]?.files).toHaveLength(1);

    const written = JSON.parse(await readFile(outPath, "utf8"));
    const normalized = normalizeSessionExport(written);
    expect(normalized.sessions).toHaveLength(1);
    expect(normalized.sessions[0]?.summary).toBe("Fixture chat");
    expect(normalized.sessions[0]?.modelsAndTokens.detectedModels).toContain("gpt-5.4");
    expect(normalized.sessions[0]?.modelsAndTokens.detectedModels).toContain("claude-sonnet-4.6");

    expect(normalized.sessions[0]?.modelsAndTokens.totals).toEqual({
      inputTokens: 17,
      outputTokens: 49,
      totalTokens: 66,
    });

    expect(normalized.sessions[0]?.modelsAndTokens.modelUsage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "gpt-5.4",
          eventCount: 1,
          inputTokens: 12,
          outputTokens: 34,
          totalTokens: 46,
        }),
        expect.objectContaining({
          model: "claude-sonnet-4.6",
          eventCount: 1,
          inputTokens: 5,
          outputTokens: 15,
          totalTokens: 20,
        }),
      ])
    );

    expect(normalized.sessions[0]?.turnEnrichments?.[0]?.outputTokens).toBe(34);
    expect(normalized.sessions[0]?.turnEnrichments?.[1]?.outputTokens).toBe(15);

    await rm(root, { recursive: true, force: true });
  });
});