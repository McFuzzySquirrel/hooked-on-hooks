#!/usr/bin/env node
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { getSessionCards, getSessionExport } from "./export-session-store.js";

interface Args {
  dbPath?: string;
  listOut?: string;
  out?: string;
  ids?: string;
  limit?: string;
  redact?: string;
}

interface CombinedExport {
  exportedAt: string;
  source: {
    type: "copilot-session-store-db";
    dbPath: string;
  };
  sessions: ReturnType<typeof getSessionExport>[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2) as keyof Args;
    const value = argv[i + 1];
    if (typeof value === "string" && !value.startsWith("--")) {
      args[key] = value;
      i += 1;
    } else {
      args[key] = "true";
    }
  }
  return args;
}

function usage(): string {
  return [
    "Usage:",
    "  npm run refresh:copilot-cli-dashboard",
    "  npm run refresh:copilot-cli-dashboard -- --limit 20",
    "  npm run refresh:copilot-cli-dashboard -- --ids <id1,id2> --redact true",
    "",
    "Defaults:",
    "  --dbPath ~/.copilot/session-store.db",
    "  --listOut ./session-list.json",
    "  --out ./session-store-export.json",
    "  --limit 10 (ignored when --ids is provided)",
  ].join("\n");
}

function fail(message: string): never {
  console.error(`refresh-copilot-cli-dashboard error: ${message}`);
  console.error(usage());
  process.exit(1);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const resolved = resolve(path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveIds(args: Args, allSessionIds: string[]): string[] {
  if (args.ids) {
    return args.ids.split(",").map((id) => id.trim()).filter(Boolean);
  }

  const parsedLimit = Number.parseInt(args.limit ?? "10", 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;
  return allSessionIds.slice(0, limit);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = resolve(args.dbPath ?? resolve(homedir(), ".copilot", "session-store.db"));
  const listOut = resolve(args.listOut ?? "./session-list.json");
  const out = resolve(args.out ?? "./session-store-export.json");
  const redact = args.redact === "true";

  let cards: ReturnType<typeof getSessionCards>;
  try {
    cards = getSessionCards(dbPath);
  } catch (error) {
    fail((error as Error).message);
  }

  const selectorPayload = {
    generatedAt: new Date().toISOString(),
    source: {
      type: "copilot-session-store-db",
      dbPath,
    },
    count: cards.length,
    sessions: cards,
  };

  await writeJson(listOut, selectorPayload);

  const ids = resolveIds(args, cards.map((card) => card.sessionId));
  const sessions = ids.map((id) => getSessionExport(dbPath, id, redact));
  const combined: CombinedExport = {
    exportedAt: new Date().toISOString(),
    source: {
      type: "copilot-session-store-db",
      dbPath,
    },
    sessions,
  };

  await writeJson(out, combined);

  console.log(
    JSON.stringify({
      ok: true,
      dbPath,
      listOut,
      out,
      listedSessions: cards.length,
      exportedSessions: sessions.length,
      selectedIds: ids,
      redact,
    }),
  );
}

void main();
