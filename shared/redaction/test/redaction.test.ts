import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyRedaction } from "../src/index.js";
import { redactSensitiveStrings } from "../src/patterns.js";
import {
  getRetentionCutoff,
  isExpired,
  purgeExpiredLogs,
  purgeAllLogs,
  DEFAULT_RETENTION_MODE
} from "../src/retention.js";
import {
  canExport,
  DEFAULT_EXPORT_CONFIG
} from "../src/export-config.js";
import type { EventEnvelope } from "../../event-schema/src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE: Omit<EventEnvelope, "eventType" | "payload"> = {
  schemaVersion: "1.0.0",
  eventId: "00000000-0000-4000-8000-000000000001",
  timestamp: new Date().toISOString(),
  sessionId: "sess-priv-01",
  source: "copilot-cli",
  repoPath: "/tmp/repo"
};

function makePromptEvent(prompt: string): EventEnvelope {
  return { ...BASE, eventType: "userPromptSubmitted", payload: { prompt } } as EventEnvelope;
}

function makeToolEvent(command: string): EventEnvelope {
  return {
    ...BASE,
    eventType: "preToolUse",
    payload: { toolName: "shell", toolArgs: { command } }
  } as EventEnvelope;
}

// ---------------------------------------------------------------------------
// PRIV-FR-05 — Prompt storage opt-in
// ---------------------------------------------------------------------------

describe("PRIV-FR-05: Prompt storage opt-in", () => {
  it("removes prompt field entirely by default (storePrompts=false)", () => {
    const event = makePromptEvent("secret: my-token");
    const redacted = applyRedaction(event);
    expect((redacted.payload as Record<string, unknown>).prompt).toBeUndefined();
  });

  it("stores [REDACTED_PROMPT] when storePrompts=true", () => {
    const event = makePromptEvent("my sensitive prompt");
    const redacted = applyRedaction(event, { storePrompts: true });
    expect((redacted.payload as Record<string, unknown>).prompt).toBe("[REDACTED_PROMPT]");
  });

  it("does not expose original prompt content even with storePrompts=true", () => {
    const event = makePromptEvent("password=supersecret");
    const redacted = applyRedaction(event, { storePrompts: true });
    expect(JSON.stringify(redacted)).not.toContain("supersecret");
  });
});

// ---------------------------------------------------------------------------
// PRIV-FR-01 — Pattern-based redaction pre-persist and pre-export
// ---------------------------------------------------------------------------

describe("PRIV-FR-01: Redaction in all event pathways", () => {
  it("leaves non-sensitive events unchanged", () => {
    const event: EventEnvelope = {
      ...BASE,
      eventType: "sessionStart",
      payload: {}
    };
    const redacted = applyRedaction(event);
    expect(redacted).toEqual(event);
  });

  it("redacts GitHub personal access token in toolArgs.command", () => {
    const event = makeToolEvent("curl -H 'Authorization: token ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ' https://api.github.com");
    const redacted = applyRedaction(event);
    const payload = redacted.payload as Record<string, Record<string, unknown>>;
    expect(JSON.stringify(payload)).not.toContain("ghp_");
    expect(JSON.stringify(payload)).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  it("redacts OpenAI-style API key in toolArgs.command", () => {
    const event = makeToolEvent("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456 python run.py");
    const redacted = applyRedaction(event);
    expect(JSON.stringify(redacted.payload)).not.toContain("sk-abcdef");
    // Either the token-specific pattern or the key=value pattern will fire —
    // the important guarantee is that the original secret is not present.
    expect(JSON.stringify(redacted.payload)).toContain("[REDACTED_");
  });

  it("redacts URL with embedded credentials", () => {
    const event = makeToolEvent("git clone https://user:mypassword@github.com/org/repo.git");
    const redacted = applyRedaction(event);
    expect(JSON.stringify(redacted.payload)).not.toContain("mypassword");
    expect(JSON.stringify(redacted.payload)).toContain("[REDACTED_CREDENTIALS]");
  });

  it("redacts key=value credential pattern", () => {
    const event = makeToolEvent("export secret=abc123xyz");
    const redacted = applyRedaction(event);
    expect(JSON.stringify(redacted.payload)).not.toContain("abc123xyz");
    expect(JSON.stringify(redacted.payload)).toContain("[REDACTED_CREDENTIAL]");
  });

  it("does not alter non-sensitive string fields", () => {
    const event: EventEnvelope = {
      ...BASE,
      eventType: "notification",
      payload: { notificationType: "info", title: "Build done", message: "All steps completed." }
    };
    const redacted = applyRedaction(event);
    const p = redacted.payload as Record<string, unknown>;
    expect(p.message).toBe("All steps completed.");
    expect(p.title).toBe("Build done");
  });
});

// ---------------------------------------------------------------------------
// Pattern unit tests
// ---------------------------------------------------------------------------

describe("redactSensitiveStrings: individual pattern coverage", () => {
  const GITHUB_PAT = "ghp_" + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
  const GITHUB_SERVER_TOKEN = "ghs_" + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
  const GITHUB_FINE_GRAINED = "github_pat_" + "ABC12345678901234567890abc";
  const OPENAI_KEY = "sk-" + "abcdefghijklmnopqrstuvwxyz123456";
  const AWS_KEY = "AKIA" + "IOSFODNN7EXAMPLE";

  const cases: [string, string, string][] = [
    ["GitHub PAT", GITHUB_PAT, "[REDACTED_GITHUB_TOKEN]"],
    ["GitHub server token", GITHUB_SERVER_TOKEN, "[REDACTED_GITHUB_TOKEN]"],
    ["GitHub fine-grained PAT", GITHUB_FINE_GRAINED, "[REDACTED_GITHUB_TOKEN]"],
    ["OpenAI key", OPENAI_KEY, "[REDACTED_API_KEY]"],
    ["AWS access key", AWS_KEY, "[REDACTED_AWS_KEY]"],
    ["URL credentials", "https://user:pass@example.com/path", "[REDACTED_CREDENTIALS]@example.com/path"],
    ["password= assignment", "password=abc123", "[REDACTED_CREDENTIAL]"],
    ["token= assignment", "token=xyz789", "[REDACTED_CREDENTIAL]"],
    ["API key= assignment", "api_key=mykey", "[REDACTED_CREDENTIAL]"],
  ];

  for (const [label, input, expected] of cases) {
    it(`redacts ${label}`, () => {
      expect(redactSensitiveStrings(input)).toContain(expected.split("@")[0]);
    });
  }

  it("returns non-sensitive strings unchanged", () => {
    const safe = "npm install && npm run build";
    expect(redactSensitiveStrings(safe)).toBe(safe);
  });
});

// ---------------------------------------------------------------------------
// PRIV-FR-02 — Retention modes
// ---------------------------------------------------------------------------

describe("PRIV-FR-02: Retention modes", () => {
  it("default retention mode is 7d", () => {
    expect(DEFAULT_RETENTION_MODE).toBe("7d");
  });

  it.each([
    ["1d",  1  * 24 * 60 * 60 * 1000],
    ["7d",  7  * 24 * 60 * 60 * 1000],
    ["30d", 30 * 24 * 60 * 60 * 1000]
  ] as const)("getRetentionCutoff(%s) returns now minus %d ms", (mode, ms) => {
    const now = new Date("2026-04-12T12:00:00Z");
    const cutoff = getRetentionCutoff(mode, now);
    expect(cutoff.getTime()).toBe(now.getTime() - ms);
  });

  it("getRetentionCutoff(manual) returns epoch 0", () => {
    const cutoff = getRetentionCutoff("manual");
    expect(cutoff.getTime()).toBe(0);
  });

  it("isExpired returns false in manual mode (cutoff=epoch 0)", () => {
    const mtime = new Date("2020-01-01T00:00:00Z");
    const cutoff = getRetentionCutoff("manual");
    expect(isExpired(mtime, cutoff)).toBe(false);
  });

  it("isExpired returns true for files older than cutoff", () => {
    const now = new Date("2026-04-12T00:00:00Z");
    const cutoff = getRetentionCutoff("7d", now);
    const oldMtime = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    expect(isExpired(oldMtime, cutoff)).toBe(true);
  });

  it("isExpired returns false for files newer than cutoff", () => {
    const now = new Date("2026-04-12T00:00:00Z");
    const cutoff = getRetentionCutoff("7d", now);
    const recentMtime = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    expect(isExpired(recentMtime, cutoff)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PRIV-FR-03 — Purge operation
// ---------------------------------------------------------------------------

describe("PRIV-FR-03: Purge operation", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "purge-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("purgeAllLogs deletes all .jsonl files in directory", async () => {
    await writeFile(join(dir, "a.jsonl"), "{}");
    await writeFile(join(dir, "b.jsonl"), "{}");
    await writeFile(join(dir, "keep.txt"), "should stay");

    const deleted = await purgeAllLogs(dir);
    expect(deleted.length).toBe(2);
    expect(deleted.every((p) => p.endsWith(".jsonl"))).toBe(true);
  });

  it("purgeAllLogs returns empty array for non-existent directory", async () => {
    const deleted = await purgeAllLogs(join(dir, "nonexistent"));
    expect(deleted).toEqual([]);
  });

  it("purgeExpiredLogs deletes files older than cutoff, keeps recent ones", async () => {
    const oldFile  = join(dir, "old.jsonl");
    const newFile  = join(dir, "new.jsonl");

    await writeFile(oldFile, "{}");
    await writeFile(newFile, "{}");

    const now = new Date();
    // Set old file mtime to 10 days ago
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    await utimes(oldFile, tenDaysAgo, tenDaysAgo);

    const deleted = await purgeExpiredLogs(dir, "7d", now);
    expect(deleted.length).toBe(1);
    expect(deleted[0]).toContain("old.jsonl");
  });

  it("purgeExpiredLogs with manual mode deletes nothing", async () => {
    await writeFile(join(dir, "ancient.jsonl"), "{}");
    const now = new Date();
    const longAgo = new Date(0);
    await utimes(join(dir, "ancient.jsonl"), longAgo, longAgo);

    const deleted = await purgeExpiredLogs(dir, "manual", now);
    expect(deleted.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PRIV-FR-04 — Export disabled by default
// ---------------------------------------------------------------------------

describe("PRIV-FR-04: Export controls", () => {
  it("default export config has enabled=false", () => {
    expect(DEFAULT_EXPORT_CONFIG.enabled).toBe(false);
    expect(DEFAULT_EXPORT_CONFIG.destination).toBeUndefined();
  });

  it("canExport returns false for default config", () => {
    expect(canExport(DEFAULT_EXPORT_CONFIG)).toBe(false);
  });

  it("canExport returns false when enabled=false even with destination", () => {
    expect(canExport({ enabled: false, destination: "http://example.com" })).toBe(false);
  });

  it("canExport returns false when enabled=true but no destination", () => {
    expect(canExport({ enabled: true })).toBe(false);
  });

  it("canExport returns false when enabled=true but destination is empty string", () => {
    expect(canExport({ enabled: true, destination: "" })).toBe(false);
  });

  it("canExport returns true only when enabled=true AND destination is provided", () => {
    expect(canExport({ enabled: true, destination: "http://collector.internal/events" })).toBe(true);
  });
});
