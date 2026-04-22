import type { SessionCard, SessionExport, SessionExportData, SessionListData } from "./types.js";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatDate(value: string): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) {
    return "n/a";
  }
  return new Date(ts).toLocaleString();
}

export function normalizeSessionList(raw: unknown): SessionListData {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid session list JSON");
  }
  const record = raw as Record<string, unknown>;
  const sessions = Array.isArray(record.sessions) ? record.sessions : [];
  const normalized: SessionCard[] = sessions
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item.sessionId === "string")
    .map((item) => ({
      sessionId: String(item.sessionId),
      repository: String(item.repository ?? "unknown-repo"),
      branch: String(item.branch ?? "unknown-branch"),
      summary: String(item.summary ?? "Untitled session"),
      eventCount: Number(item.eventCount ?? 0),
      fileSizeBytes: Number(item.fileSizeBytes ?? 0),
      modifiedAt: String(item.modifiedAt ?? ""),
      createdAt: String(item.createdAt ?? ""),
    }));

  return {
    generatedAt: String(record.generatedAt ?? ""),
    source: {
      type: String((record.source as Record<string, unknown> | undefined)?.type ?? "unknown"),
      dbPath: String((record.source as Record<string, unknown> | undefined)?.dbPath ?? ""),
    },
    count: normalized.length,
    sessions: normalized,
  };
}

export function normalizeSessionExport(raw: unknown): SessionExportData {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid export JSON");
  }
  const record = raw as Record<string, unknown>;
  const sessions = Array.isArray(record.sessions)
    ? (record.sessions as SessionExport[])
    : [record as unknown as SessionExport];

  return {
    exportedAt: String(record.exportedAt ?? ""),
    source: {
      type: String((record.source as Record<string, unknown> | undefined)?.type ?? "unknown"),
      dbPath: String((record.source as Record<string, unknown> | undefined)?.dbPath ?? ""),
    },
    sessions,
  };
}

export function buildSessionSearchText(session: SessionExport): string {
  return [
    session.summary,
    session.repository,
    session.branch,
    session.cwd,
    ...session.searchBlob,
    ...session.modelsAndTokens.detectedModels,
  ]
    .join("\n")
    .toLowerCase();
}
