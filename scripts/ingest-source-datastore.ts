#!/usr/bin/env node
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  importCopilotSessionStore,
  summarizeDatastore
} from "../packages/local-datastore/src/index.js";

interface Args {
  command: "import" | "summary";
  dbPath: string;
  datastorePath: string;
  ids: string[];
  machineId?: string;
  userId?: string;
  includeRawPayload: boolean;
  redact: boolean;
}

function usage(): string {
  return [
    "Usage:",
    "  npm run datastore:import -- --db-path ~/.copilot/session-store.db --datastore ./datastore/events.jsonl",
    "  npm run datastore:summary -- --datastore ./datastore/events.jsonl",
    "Options:",
    "  --db-path <path>      Path to local Copilot session-store.db",
    "  --datastore <path>    Append-only normalized event datastore JSONL path",
    "  --ids <csv>           Optional comma-separated session ids to import",
    "  --machine-id <id>     Machine identifier for multi-machine datastore records",
    "  --user-id <id>        User identifier for datastore records",
    "  --include-raw-payload Store opt-in redacted raw source payload copies",
    "  --no-redact           Disable local redaction (not recommended)",
  ].join("\n");
}

function fail(message: string): never {
  console.error(`ingest-source-datastore error: ${message}`);
  process.exit(1);
}

export function parseArgs(argv: string[]): Args {
  const [maybeCommand, ...rest] = argv;
  const command = maybeCommand === "summary" ? "summary" : "import";
  const tokens = maybeCommand === "summary" || maybeCommand === "import" ? rest : argv;
  const args: Args = {
    command,
    dbPath: resolve(homedir(), ".copilot", "session-store.db"),
    datastorePath: resolve(process.cwd(), "datastore", "events.jsonl"),
    ids: [],
    includeRawPayload: false,
    redact: true
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "--include-raw-payload") {
      args.includeRawPayload = true;
      continue;
    }
    if (token === "--no-redact") {
      args.redact = false;
      continue;
    }
    if (!token.startsWith("--")) {
      continue;
    }

    const value = tokens[i + 1];
    if (!value || value.startsWith("--")) {
      fail(`missing value for ${token}`);
    }

    switch (token) {
      case "--db-path":
        args.dbPath = resolve(value);
        break;
      case "--datastore":
        args.datastorePath = resolve(value);
        break;
      case "--ids":
        args.ids = value.split(",").map((entry) => entry.trim()).filter(Boolean);
        break;
      case "--machine-id":
        args.machineId = value;
        break;
      case "--user-id":
        args.userId = value;
        break;
      default:
        fail(`unknown option ${token}`);
    }
    i += 1;
  }

  return args;
}

export async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return;
  }

  const args = parseArgs(argv);
  if (args.command === "summary") {
    const summary = await summarizeDatastore(args.datastorePath);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const result = await importCopilotSessionStore({
    dbPath: args.dbPath,
    datastorePath: args.datastorePath,
    sessionIds: args.ids,
    machineId: args.machineId,
    userId: args.userId,
    includeRawPayload: args.includeRawPayload,
    redact: args.redact
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
