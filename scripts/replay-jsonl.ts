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

function parseArgs(argv: string[]): { jsonlPath: string; endpoint: string } {
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

async function main(): Promise<void> {
  const { jsonlPath, endpoint } = parseArgs(process.argv.slice(2));

  const rl = createInterface({
    input: createReadStream(jsonlPath, "utf8"),
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
        process.stdout.write(".");
      } else {
        rejected += 1;
        console.warn(`\n  REJECTED: ${body.error ?? "unknown"}`);
      }
    } catch (err) {
      fail(
        `Cannot reach ingest service at ${endpoint}. Is it running?\n  ${(err as Error).message}`
      );
    }
  }

  console.log(`\nDone: ${sent} accepted, ${rejected} rejected, ${errors} parse errors`);
}

void main();
