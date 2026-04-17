import type { EventEnvelope } from "../../../shared/event-schema/src/index.js";

/**
 * CSV column headers for the session event export.
 * Envelope-level fields come first, followed by a JSON-serialised payload column.
 */
const CSV_COLUMNS = [
  "eventId",
  "eventType",
  "timestamp",
  "sessionId",
  "schemaVersion",
  "source",
  "repoPath",
  "turnId",
  "traceId",
  "spanId",
  "parentSpanId",
  "toolName",
  "toolCallId",
  "agentName",
  "status",
  "notificationType",
  "durationMs",
  "errorSummary",
  "taskDescription",
  "payload",
] as const;

type CsvColumn = (typeof CSV_COLUMNS)[number];
type PayloadColumn =
  | "toolName"
  | "toolCallId"
  | "agentName"
  | "status"
  | "notificationType"
  | "durationMs"
  | "errorSummary"
  | "taskDescription";

function isPayloadColumn(column: CsvColumn): column is PayloadColumn {
  return (
    column === "toolName" ||
    column === "toolCallId" ||
    column === "agentName" ||
    column === "status" ||
    column === "notificationType" ||
    column === "durationMs" ||
    column === "errorSummary" ||
    column === "taskDescription"
  );
}

function getPayloadValue(event: EventEnvelope, key: PayloadColumn): unknown {
  const payload = event.payload as unknown;
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  return (payload as Record<string, unknown>)[key];
}

function toCsvCellValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Escape a value for inclusion in a CSV cell.
 * Wraps the value in double-quotes when it contains a comma, double-quote,
 * or newline. Inner double-quotes are escaped by doubling them (RFC 4180).
 */
export function escapeCsvValue(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Convert a single EventEnvelope to a CSV row string.
 */
export function eventToCsvRow(event: EventEnvelope): string {
  const values: string[] = CSV_COLUMNS.map((col) => {
    if (col === "payload") {
      return escapeCsvValue(JSON.stringify(event.payload));
    }
    if (isPayloadColumn(col)) {
      return escapeCsvValue(toCsvCellValue(getPayloadValue(event, col)));
    }
    const raw = (event as Record<string, unknown>)[col];
    return escapeCsvValue(toCsvCellValue(raw));
  });
  return values.join(",");
}

/**
 * Build a complete CSV string (header + rows) from an array of EventEnvelope records.
 * Returns an empty string when no events are provided.
 */
export function buildCsv(events: EventEnvelope[]): string {
  if (events.length === 0) {
    return "";
  }
  const header = CSV_COLUMNS.join(",");
  const rows = events.map(eventToCsvRow);
  return [header, ...rows].join("\n");
}

/**
 * Trigger a browser file download with the given content and filename.
 * Uses a temporary anchor + Blob URL so no server round-trip is required.
 */
export function downloadCsv(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Export an array of session events to a CSV file and trigger a download.
 * The filename includes the session ID and current date for easy identification.
 */
export function exportSessionToCsv(events: EventEnvelope[]): void {
  if (events.length === 0) {
    return;
  }
  const sessionId = events[0].sessionId;
  const date = new Date().toISOString().slice(0, 10);
  const filename = `session-${sessionId}-${date}.csv`;
  const csv = buildCsv(events);
  downloadCsv(csv, filename);
}
