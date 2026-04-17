import { describe, it, expect } from "vitest";
import { escapeCsvValue, eventToCsvRow, buildCsv } from "../src/csvExport.js";
import type { EventEnvelope } from "../../../shared/event-schema/src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_ID = "sess-csv-01";
let seq = 0;

function nextId(): string {
  return `C000000${++seq}-0000-4000-8000-000000000000`;
}

function make<T extends EventEnvelope["eventType"]>(
  eventType: T,
  payload: Extract<EventEnvelope, { eventType: T }>["payload"]
): Extract<EventEnvelope, { eventType: T }> {
  return {
    schemaVersion: "1.0.0",
    eventId: nextId(),
    eventType,
    timestamp: "2026-01-15T10:00:00.000Z",
    sessionId: SESSION_ID,
    source: "copilot-cli" as const,
    repoPath: "/tmp/repo",
    payload,
  } as Extract<EventEnvelope, { eventType: T }>;
}

// ---------------------------------------------------------------------------
// escapeCsvValue
// ---------------------------------------------------------------------------

describe("escapeCsvValue", () => {
  it("returns plain value unchanged", () => {
    expect(escapeCsvValue("hello")).toBe("hello");
  });

  it("wraps value containing commas in double quotes", () => {
    expect(escapeCsvValue("a,b")).toBe('"a,b"');
  });

  it("wraps value containing double quotes and escapes them", () => {
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
  });

  it("wraps value containing newlines", () => {
    expect(escapeCsvValue("line1\nline2")).toBe('"line1\nline2"');
  });

  it("wraps value containing carriage return", () => {
    expect(escapeCsvValue("a\rb")).toBe('"a\rb"');
  });

  it("handles empty string", () => {
    expect(escapeCsvValue("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// eventToCsvRow
// ---------------------------------------------------------------------------

describe("eventToCsvRow", () => {
  it("produces a comma-separated row with correct column count", () => {
    const event = make("sessionStart", {});
    const row = eventToCsvRow(event);
    // 12 columns
    expect(row.split(",").length).toBeGreaterThanOrEqual(12);
  });

  it("includes the event type and session ID", () => {
    const event = make("preToolUse", { toolName: "bash" });
    const row = eventToCsvRow(event);
    expect(row).toContain("preToolUse");
    expect(row).toContain(SESSION_ID);
  });

  it("serialises the payload as JSON", () => {
    const event = make("preToolUse", { toolName: "grep", toolArgs: { pattern: "foo" } });
    const row = eventToCsvRow(event);
    // The payload JSON should be present (possibly escaped)
    expect(row).toContain("grep");
    expect(row).toContain("foo");
  });

  it("handles missing optional fields gracefully", () => {
    const event = make("sessionStart", {});
    const row = eventToCsvRow(event);
    // turnId, traceId, spanId, parentSpanId should be empty
    expect(row).not.toContain("undefined");
  });
});

// ---------------------------------------------------------------------------
// buildCsv
// ---------------------------------------------------------------------------

describe("buildCsv", () => {
  it("returns empty string for empty events array", () => {
    expect(buildCsv([])).toBe("");
  });

  it("includes a header row as the first line", () => {
    const event = make("sessionStart", {});
    const csv = buildCsv([event]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "eventId,eventType,timestamp,sessionId,schemaVersion,source,repoPath,turnId,traceId,spanId,parentSpanId,payload"
    );
  });

  it("produces header + one data row for a single event", () => {
    const event = make("sessionStart", {});
    const csv = buildCsv([event]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(2);
  });

  it("produces header + N data rows for N events", () => {
    const events = [
      make("sessionStart", {}),
      make("preToolUse", { toolName: "bash" }),
      make("postToolUse", { toolName: "bash", status: "success" }),
    ];
    const csv = buildCsv(events);
    const lines = csv.split("\n");
    expect(lines.length).toBe(4); // 1 header + 3 rows
  });

  it("payload with commas is properly escaped", () => {
    const event = make("preToolUse", { toolName: "bash", toolArgs: { command: "a,b,c" } });
    const csv = buildCsv([event]);
    // The payload column should be wrapped in quotes because it contains commas
    expect(csv).toContain('"');
  });
});
