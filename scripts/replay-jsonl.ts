#!/usr/bin/env node
/**
 * replay-jsonl.ts
 *
 * Replays a JSONL event log into a running ingest service.
 *
 * Usage:
 *   npm run replay:jsonl -- /path/to/.visualizer/logs/events.jsonl
 *   npm run replay:jsonl -- /path/to/.visualizer/logs/events.jsonl --endpoint http://127.0.0.1:7070/events
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function fail(message: string): never {
  console.error(`replay-jsonl error: ${message}`);
  process.exit(1);
}

function usage(): string {
  return [
    "Usage:",
    "  npm run replay:jsonl -- /path/to/.visualizer/logs/events.jsonl",
    "  npm run replay:jsonl -- /path/to/events.jsonl --endpoint http://127.0.0.1:7070/events",
  ].join("\n");
}

export function parseArgs(argv: string[]): { jsonlPath: string; endpoint: string } {
  const jsonlPath = argv[0];
  if (!jsonlPath || jsonlPath.startsWith("--")) {
    console.log(usage());
    process.exit(1);
  }
  let endpoint = "http://127.0.0.1:7070/events";
  const endpointIdx = argv.indexOf("--endpoint");
  if (endpointIdx !== -1 && argv[endpointIdx + 1]) {
    endpoint = argv[endpointIdx + 1];
  }
  return { jsonlPath: resolve(jsonlPath), endpoint };
}

export interface ReplayResult {
  sent: number;
  rejected: number;
  errors: number;
}

export async function replayJsonl(jsonlPath: string, endpoint: string): Promise<ReplayResult> {
  const resolvedPath = resolve(jsonlPath);

  const rl = createInterface({
    input: createReadStream(resolvedPath, "utf8"),
    crlfDelay: Infinity,
  });

  let sent = 0;
  let rejected = 0;
  let errors = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      console.warn(`  SKIP  line ${sent + rejected + errors + 1}: invalid JSON`);
      errors += 1;
      continue;
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const body = await res.json() as { ok: boolean; error?: string };
      if (body.ok) {
        sent += 1;
      } else {
        rejected += 1;
      }
    } catch (err) {
      fail(
        `Cannot reach ingest service at ${endpoint}. Is it running?\n  ${(err as Error).message}`
      );
    }
  }

  return { sent, rejected, errors };
}

async function main(): Promise<void> {
  const { jsonlPath, endpoint } = parseArgs(process.argv.slice(2));
  const result = await replayJsonl(jsonlPath, endpoint);
  console.log(`Done: ${result.sent} accepted, ${result.rejected} rejected, ${result.errors} parse errors`);
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  void main();
}
