import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importVsCodeChatWorkspace } from "../lib/vscode-chat-import.js";
import { parseEvent } from "../../shared/event-schema/src/index.js";

describe("importVsCodeChatWorkspace", () => {
  it("imports chatSessions and chat resources as canonical events", async () => {
    const root = await mkdtemp(join(tmpdir(), "vscode-chat-import-"));
    const chatSessionsDir = join(root, "chatSessions");
    const resourcesDir = join(root, "GitHub.copilot-chat", "chat-session-resources", "sess-1", "call_abc__vscode-1700000000000");
    await mkdir(chatSessionsDir, { recursive: true });
    await mkdir(resourcesDir, { recursive: true });

    const chatSessionFile = join(chatSessionsDir, "sess-1.jsonl");
    const lines = [
      JSON.stringify({ kind: 0, v: { creationDate: 1700000000000, sessionId: "sess-1", customTitle: "My chat" } }),
      JSON.stringify({
        kind: 2,
        v: [
          {
            requestId: "req-1",
            timestamp: 1700000000500,
            message: { text: "hello" },
            response: [
              { kind: "toolInvocationSerialized", isComplete: true, toolId: "read_file", toolCallId: "call-1" },
              { kind: "text", value: "world" }
            ]
          }
        ]
      })
    ].join("\n");
    await writeFile(chatSessionFile, `${lines}\n`, "utf8");

    await writeFile(join(resourcesDir, "content.txt"), "artifact-content", "utf8");

    const outPath = join(root, "events.jsonl");
    const result = await importVsCodeChatWorkspace({
      workspaceStorageRoot: root,
      jsonlPath: outPath,
      repoPath: "/tmp/repo",
      mode: "auto",
    });

    expect(result.emitted).toBeGreaterThan(0);
    expect(result.rejected).toBe(0);

    const outLines = (await readFile(outPath, "utf8")).trim().split("\n").filter(Boolean);
    const parsed = outLines.map((line) => JSON.parse(line));

    expect(parsed.some((event) => event.eventType === "chatSessionStart")).toBe(true);
    expect(parsed.some((event) => event.eventType === "chatMessage")).toBe(true);
    expect(parsed.some((event) => event.eventType === "chatToolCall")).toBe(true);
    expect(parsed.some((event) => event.eventType === "chatArtifactImported")).toBe(true);

    for (const event of parsed) {
      const validated = parseEvent(event);
      expect(validated.ok).toBe(true);
    }

    await rm(root, { recursive: true, force: true });
  });

  it("imports extension debug logs in extensionDebugLogs mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "vscode-chat-import-debug-"));
    const debugLogsDir = join(root, "GitHub.copilot-chat", "debug-logs");
    await mkdir(debugLogsDir, { recursive: true });

    const debugLogPath = join(debugLogsDir, "sess-debug-1.log");
    const lines = [
      JSON.stringify({
        timestamp: 1700000010000,
        type: "session_start",
        sessionId: "sess-debug-1",
        title: "Debug Session",
      }),
      "2026-05-04T12:00:00.000Z INFO " + JSON.stringify({
        timestamp: 1700000011000,
        role: "user",
        text: "hello from debug logs",
        requestId: "req-debug-1",
        sessionId: "sess-debug-1",
      }),
      JSON.stringify({
        timestamp: 1700000012000,
        type: "tool_complete",
        toolName: "read_file",
        status: "completed",
        durationMs: 25,
        toolCallId: "call-debug-1",
        sessionId: "sess-debug-1",
      }),
      JSON.stringify({
        timestamp: 1700000013000,
        type: "artifact",
        artifactType: "tool-call-content",
        path: "/tmp/content.txt",
        sizeBytes: 128,
        callId: "call-debug-1",
        sessionId: "sess-debug-1",
      }),
      JSON.stringify({
        timestamp: 1700000014000,
        type: "sessionEnd",
        reason: "done",
        sessionId: "sess-debug-1",
      }),
    ].join("\n");

    await writeFile(debugLogPath, `${lines}\n`, "utf8");

    const outPath = join(root, "events-debug.jsonl");
    const result = await importVsCodeChatWorkspace({
      workspaceStorageRoot: root,
      jsonlPath: outPath,
      repoPath: "/tmp/repo",
      mode: "extensionDebugLogs",
    });

    expect(result.emitted).toBeGreaterThan(0);
    expect(result.rejected).toBe(0);

    const outLines = (await readFile(outPath, "utf8")).trim().split("\n").filter(Boolean);
    const parsed = outLines.map((line) => JSON.parse(line));

    expect(parsed.some((event) => event.eventType === "chatSessionStart")).toBe(true);
    expect(parsed.some((event) => event.eventType === "chatMessage")).toBe(true);
    expect(parsed.some((event) => event.eventType === "chatToolCall")).toBe(true);
    expect(parsed.some((event) => event.eventType === "chatArtifactImported")).toBe(true);
    expect(parsed.some((event) => event.eventType === "chatSessionEnd")).toBe(true);

    for (const event of parsed) {
      const validated = parseEvent(event);
      expect(validated.ok).toBe(true);
    }

    await rm(root, { recursive: true, force: true });
  });

  it("parses nested wrapped debug JSON and ignores capability-only tool schema files", async () => {
    const root = await mkdtemp(join(tmpdir(), "vscode-chat-import-debug-wrapped-"));
    const sessionDir = join(root, "GitHub.copilot-chat", "debug-logs", "sess-debug-2");
    await mkdir(sessionDir, { recursive: true });

    const toolsSchemaPath = join(sessionDir, "tools_0.json");
    const requestLogPath = join(sessionDir, "requests_0.json");

    await writeFile(toolsSchemaPath, JSON.stringify({
      content: JSON.stringify([
        { type: "function", name: "read_file", description: "Tool schema" }
      ])
    }), "utf8");

    await writeFile(requestLogPath, JSON.stringify({
      content: JSON.stringify([
        {
          kind: "request",
          timestamp: "2026-05-04T21:19:52.913Z",
          metadata: {
            requestId: "req-wrap-1",
            model: "claude-sonnet-4.6",
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
            duration: 3000,
            timeToFirstToken: 500,
          },
          name: "panel/editAgent",
        },
        {
          kind: "toolCall",
          time: "2026-05-04T21:19:53.100Z",
          tool: "read_file",
          id: "toolu_fixture",
        }
      ])
    }), "utf8");

    const outPath = join(root, "events-debug-wrapped.jsonl");
    const result = await importVsCodeChatWorkspace({
      workspaceStorageRoot: root,
      jsonlPath: outPath,
      repoPath: "/tmp/repo",
      mode: "extensionDebugLogs",
    });

    expect(result.rejected).toBe(0);
    expect(result.byEventType.chatSessionStart).toBe(1);
    expect(result.byEventType.chatMessage).toBe(1);
    expect(result.byEventType.chatToolCall).toBe(1);

    const outLines = (await readFile(outPath, "utf8")).trim().split("\n").filter(Boolean);
    const parsed = outLines.map((line) => JSON.parse(line));

    const usageMessage = parsed.find((event) => event.eventType === "chatMessage");
    expect(usageMessage?.payload.model).toBe("claude-sonnet-4.6");
    expect(usageMessage?.payload.inputTokens).toBe(100);
    expect(usageMessage?.payload.outputTokens).toBe(20);
    expect(usageMessage?.payload.totalTokens).toBe(120);

    const toolCall = parsed.find((event) => event.eventType === "chatToolCall");
    expect(toolCall?.payload.toolName).toBe("read_file");
    expect(toolCall?.payload.status).toBe("completed");

    for (const event of parsed) {
      const validated = parseEvent(event);
      expect(validated.ok).toBe(true);
    }

    await rm(root, { recursive: true, force: true });
  });

  it("overwrites output by default and appends only when requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "vscode-chat-import-overwrite-"));
    const chatSessionsDir = join(root, "chatSessions");
    await mkdir(chatSessionsDir, { recursive: true });

    const chatSessionFile = join(chatSessionsDir, "sess-2.jsonl");
    const lines = [
      JSON.stringify({ kind: 0, v: { creationDate: 1700000000000, sessionId: "sess-2", customTitle: "Overwrite test" } }),
      JSON.stringify({
        kind: 2,
        v: [
          {
            requestId: "req-2",
            timestamp: 1700000000500,
            message: { text: "hello" },
            response: [
              { kind: "text", value: "world" }
            ]
          }
        ]
      })
    ].join("\n");
    await writeFile(chatSessionFile, `${lines}\n`, "utf8");

    const outPath = join(root, "events.jsonl");
    await writeFile(outPath, "stale-line\n", "utf8");

    const first = await importVsCodeChatWorkspace({
      workspaceStorageRoot: root,
      jsonlPath: outPath,
      repoPath: "/tmp/repo",
      mode: "chatSessions",
    });
    expect(first.emitted).toBeGreaterThan(0);

    const firstLines = (await readFile(outPath, "utf8")).trim().split("\n").filter(Boolean);
    expect(firstLines.some((line) => line === "stale-line")).toBe(false);
    const baselineCount = firstLines.length;

    const second = await importVsCodeChatWorkspace({
      workspaceStorageRoot: root,
      jsonlPath: outPath,
      repoPath: "/tmp/repo",
      mode: "chatSessions",
    });
    expect(second.emitted).toBe(first.emitted);

    const secondLines = (await readFile(outPath, "utf8")).trim().split("\n").filter(Boolean);
    expect(secondLines.length).toBe(baselineCount);

    const appended = await importVsCodeChatWorkspace({
      workspaceStorageRoot: root,
      jsonlPath: outPath,
      repoPath: "/tmp/repo",
      mode: "chatSessions",
      append: true,
    });
    expect(appended.emitted).toBe(first.emitted);

    const thirdLines = (await readFile(outPath, "utf8")).trim().split("\n").filter(Boolean);
    expect(thirdLines.length).toBe(baselineCount * 2);

    await rm(root, { recursive: true, force: true });
  });
});
