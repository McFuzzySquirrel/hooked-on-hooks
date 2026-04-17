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
  "payload",
] as const;

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
    const raw = (event as Record<string, unknown>)[col];
    if (raw === undefined || raw === null) {
      return "";
    }
    return escapeCsvValue(String(raw));
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
