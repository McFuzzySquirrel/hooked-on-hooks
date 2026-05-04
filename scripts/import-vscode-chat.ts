#!/usr/bin/env node
import { resolve } from "node:path";
import { importVsCodeChatWorkspace, type VsCodeImportMode } from "./lib/vscode-chat-import.js";

interface Args {
  workspaceStorageRoot?: string;
  jsonlPath?: string;
  repoPath?: string;
  mode?: string;
  sessionIds?: string;
  httpEndpoint?: string;
  storePrompts?: string;
  append?: string;
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
    "  npm run import:vscode-chat -- --workspaceStorageRoot <path> --jsonlPath <path>",
    "  npm run import:vscode-chat -- --workspaceStorageRoot <path> --jsonlPath <path> --mode auto --sessionIds <id1,id2>",
    "  npm run import:vscode-chat -- --workspaceStorageRoot <path> --jsonlPath <path> --append true",
    "",
    "Modes:",
    "  auto | chatSessions | chatResources | extensionDebugLogs",
  ].join("\n");
}

function fail(message: string): never {
  console.error(`import-vscode-chat error: ${message}`);
  console.error(usage());
  process.exit(1);
}

function parseMode(value: string | undefined): VsCodeImportMode {
  const normalized = value ?? "auto";
  if (
    normalized !== "auto"
    && normalized !== "chatSessions"
    && normalized !== "chatResources"
    && normalized !== "extensionDebugLogs"
  ) {
    fail(`invalid --mode '${normalized}'`);
  }
  return normalized;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.workspaceStorageRoot) {
    fail("missing --workspaceStorageRoot");
  }
  if (!args.jsonlPath) {
    fail("missing --jsonlPath");
  }

  const mode = parseMode(args.mode);
  const sessionIds = args.sessionIds?.split(",").map((s) => s.trim()).filter(Boolean);

  const result = await importVsCodeChatWorkspace({
    workspaceStorageRoot: resolve(args.workspaceStorageRoot),
    jsonlPath: resolve(args.jsonlPath),
    repoPath: resolve(args.repoPath ?? process.cwd()),
    mode,
    sessionIds,
    httpEndpoint: args.httpEndpoint,
    storePrompts: args.storePrompts === "true",
    append: args.append === "true",
  });

  console.log(JSON.stringify({ ok: true, mode, ...result }));
}

void main();
