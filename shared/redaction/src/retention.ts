import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Retention modes for local event log files (PRIV-FR-02).
 * - "1d"     : auto-expire logs older than 1 day
 * - "7d"     : auto-expire logs older than 7 days (DEFAULT)
 * - "30d"    : auto-expire logs older than 30 days
 * - "manual" : never auto-expire; users purge manually
 */
export type RetentionMode = "1d" | "7d" | "30d" | "manual";

export const DEFAULT_RETENTION_MODE: RetentionMode = "7d";

const RETENTION_MS: Record<Exclude<RetentionMode, "manual">, number> = {
  "1d":  1  * 24 * 60 * 60 * 1000,
  "7d":  7  * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000
};

/**
 * Returns the cutoff Date before which event log files are considered expired.
 * In manual mode, returns epoch 0 — no files will ever be automatically expired.
 */
export function getRetentionCutoff(mode: RetentionMode, now = new Date()): Date {
  if (mode === "manual") {
    return new Date(0);
  }
  return new Date(now.getTime() - RETENTION_MS[mode]);
}

/**
 * Returns true if the file's mtime is before the retention cutoff.
 * Always returns false in manual mode (cutoff = epoch 0).
 */
export function isExpired(mtime: Date, cutoff: Date): boolean {
  if (cutoff.getTime() === 0) return false; // manual mode
  return mtime < cutoff;
}

/**
 * Deletes all *.jsonl log files in `dir` whose modification time is before the
 * retention cutoff for `mode`. Returns the list of deleted file paths (PRIV-FR-02).
 */
export async function purgeExpiredLogs(
  dir: string,
  mode: RetentionMode,
  now = new Date()
): Promise<string[]> {
  const cutoff = getRetentionCutoff(mode, now);
  const deleted: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return deleted; // directory does not exist — nothing to purge
  }

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const fullPath = join(dir, entry);
    const info = await stat(fullPath);
    if (isExpired(info.mtime, cutoff)) {
      await rm(fullPath);
      deleted.push(fullPath);
    }
  }

  return deleted;
}

/**
 * Deletes ALL *.jsonl log files in `dir`, regardless of age (PRIV-FR-03 purge).
 * Returns the list of deleted file paths.
 */
export async function purgeAllLogs(dir: string): Promise<string[]> {
  const deleted: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return deleted;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const fullPath = join(dir, entry);
    await rm(fullPath);
    deleted.push(fullPath);
  }

  return deleted;
}
