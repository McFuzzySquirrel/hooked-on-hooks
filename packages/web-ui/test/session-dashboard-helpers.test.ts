import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDate,
  normalizeSessionList,
  normalizeSessionExport,
  buildSessionSearchText,
} from "../src/session-dashboard-helpers.js";

describe("session dashboard helper functions", () => {
  it("formats bytes using human-readable units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("formats valid dates and returns n/a for invalid values", () => {
    expect(formatDate("not-a-date")).toBe("n/a");
    expect(formatDate("2026-04-20T10:00:00.000Z")).not.toBe("n/a");
  });

  it("normalizes selector session list payload", () => {
    const normalized = normalizeSessionList({
      generatedAt: "2026-04-22T21:00:00.000Z",
      source: { type: "copilot-session-store-db", dbPath: "/tmp/s.db" },
      sessions: [
        {
          sessionId: "sess-1",
          repository: "owner/repo",
          branch: "main",
          summary: "My session",
          eventCount: 12,
          fileSizeBytes: 4096,
          modifiedAt: "2026-04-22T21:00:00.000Z",
          createdAt: "2026-04-22T20:00:00.000Z",
        },
      ],
    });

    expect(normalized.count).toBe(1);
    expect(normalized.sessions[0]?.sessionId).toBe("sess-1");
    expect(normalized.source.dbPath).toBe("/tmp/s.db");
  });

  it("normalizes export payload for both combined and single-session shapes", () => {
    const combined = normalizeSessionExport({
      exportedAt: "2026-04-22T21:00:00.000Z",
      source: { type: "copilot-session-store-db", dbPath: "/tmp/s.db" },
      sessions: [
        {
          sessionId: "sess-1",
          summary: "Summary",
          repository: "owner/repo",
          branch: "main",
          cwd: "/tmp/repo",
          hostType: "github",
          createdAt: "2026-04-22T20:00:00.000Z",
          updatedAt: "2026-04-22T21:00:00.000Z",
          stats: { eventCount: 1, turnCount: 1, checkpointCount: 0, fileCount: 0, refCount: 0, fileSizeBytes: 10 },
          checkpoints: [],
          turns: [],
          files: [],
          refs: [],
          modelsAndTokens: {
            detectedModels: [],
            tokenMentions: [],
            modelUsage: [],
            totals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            notes: [],
          },
          searchBlob: [],
        },
      ],
    });

    expect(combined.sessions).toHaveLength(1);

    const single = normalizeSessionExport({
      sessionId: "sess-single",
      summary: "Only one",
      repository: "owner/repo",
      branch: "main",
      cwd: "/tmp/repo",
      hostType: "github",
      createdAt: "2026-04-22T20:00:00.000Z",
      updatedAt: "2026-04-22T21:00:00.000Z",
      stats: { eventCount: 1, turnCount: 1, checkpointCount: 0, fileCount: 0, refCount: 0, fileSizeBytes: 10 },
      checkpoints: [],
      turns: [],
      files: [],
      refs: [],
      modelsAndTokens: { detectedModels: [], tokenMentions: [], notes: [] },
      searchBlob: ["hello"],
    });

    expect(single.sessions).toHaveLength(1);
    expect(single.sessions[0]?.sessionId).toBe("sess-single");
  });

  it("builds lowercased search text from session fields", () => {
    const text = buildSessionSearchText({
      sessionId: "sess-1",
      summary: "Review Feature PRD",
      repository: "Owner/Repo",
      branch: "Main",
      cwd: "/tmp/repo",
      hostType: "github",
      createdAt: "2026-04-22T20:00:00.000Z",
      updatedAt: "2026-04-22T21:00:00.000Z",
      stats: { eventCount: 1, turnCount: 1, checkpointCount: 0, fileCount: 0, refCount: 0, fileSizeBytes: 10 },
      checkpoints: [],
      turns: [],
      files: [],
      refs: [],
      modelsAndTokens: {
        detectedModels: ["gpt-5.3-codex"],
        tokenMentions: [],
        modelUsage: [
          { model: "gpt-5.3-codex", eventCount: 2, inputTokens: 100, outputTokens: 250, totalTokens: 350 },
        ],
        totals: { inputTokens: 100, outputTokens: 250, totalTokens: 350 },
        notes: [],
      },
      searchBlob: ["Contains TOKENS"],
    });

    expect(text).toContain("review feature prd");
    expect(text).toContain("owner/repo");
    expect(text).toContain("gpt-5.3-codex");
    expect(text).toContain("contains tokens");
  });

  it("throws for invalid list payload", () => {
    expect(() => normalizeSessionList(null)).toThrow("Invalid session list JSON");
  });

  it("throws for invalid export payload", () => {
    expect(() => normalizeSessionExport(undefined)).toThrow("Invalid export JSON");
  });
});
