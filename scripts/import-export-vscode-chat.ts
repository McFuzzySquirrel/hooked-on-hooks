#!/usr/bin/env node
import { homedir } from "node:os";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { importVsCodeChatWorkspace, type VsCodeImportMode } from "./lib/vscode-chat-import.js";
import { exportJsonlDashboard } from "./export-jsonl-dashboard.js";

interface Args {
  workspaceStorageRoot?: string;
  jsonlPath?: string;
  out?: string;
  repoPath?: string;
  mode?: string;
  sessionIds?: string;
  storePrompts?: string;
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
    "  npm run refresh:vscode-chat-dashboard",
    "  npm run refresh:vscode-chat-dashboard -- --workspaceStorageRoot <path>",
    "  npm run refresh:vscode-chat-dashboard -- --workspaceStorageRoot <path> --jsonlPath /tmp/vscode-chat-events.jsonl --out ./vscode-chat-export.json",
    "",
    "Modes:",
    "  auto | chatSessions | chatResources | extensionDebugLogs",
  ].join("\n");
}

function fail(message: string): never {
  console.error(`refresh-vscode-chat-dashboard error: ${message}`);
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

function getWorkspaceStorageRoots(): string[] {
  const home = homedir();
  return [
    resolve(home, ".config", "Code", "User", "workspaceStorage"),
    resolve(home, "Library", "Application Support", "Code", "User", "workspaceStorage"),
    process.env.APPDATA ? resolve(process.env.APPDATA, "Code", "User", "workspaceStorage") : "",
  ].filter(Boolean);
}

async function detectWorkspaceStorageRoot(): Promise<string | null> {
  for (const root of getWorkspaceStorageRoots()) {
    if (!existsSync(root)) {
      continue;
    }

    const entries = await readdir(root, { withFileTypes: true });
    const candidates: Array<{ path: string; mtimeMs: number }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const workspaceRoot = resolve(root, entry.name);
      const hasChatSessions = existsSync(resolve(workspaceRoot, "chatSessions"));
      const hasCopilotChat = existsSync(resolve(workspaceRoot, "GitHub.copilot-chat"));
      if (!hasChatSessions && !hasCopilotChat) {
        continue;
      }

      try {
        const stats = await stat(workspaceRoot);
        candidates.push({ path: workspaceRoot, mtimeMs: stats.mtimeMs });
      } catch {
        // Ignore candidate if stat fails.
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return candidates[0]!.path;
    }
  }

  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const detectedRoot = args.workspaceStorageRoot ? null : await detectWorkspaceStorageRoot();
  const workspaceStorageRoot = args.workspaceStorageRoot ? resolve(args.workspaceStorageRoot) : detectedRoot;
  if (!workspaceStorageRoot) {
    fail("missing --workspaceStorageRoot and could not auto-detect a workspaceStorage root");
  }

  const mode = parseMode(args.mode);
  const jsonlPath = resolve(args.jsonlPath ?? "/tmp/vscode-chat-events.jsonl");
  const outPath = resolve(args.out ?? "./vscode-chat-export.json");
  const repoPath = resolve(args.repoPath ?? process.cwd());
  const sessionIds = args.sessionIds?.split(",").map((s) => s.trim()).filter(Boolean);

  const importResult = await importVsCodeChatWorkspace({
    workspaceStorageRoot,
    jsonlPath,
    repoPath,
    mode,
    sessionIds,
    storePrompts: args.storePrompts === "true",
    append: false,
  });

  const exportResult = await exportJsonlDashboard(jsonlPath, outPath);

  console.log(
    JSON.stringify({
      ok: true,
      mode,
      workspaceStorageRoot,
      jsonlPath,
      out: outPath,
      imported: importResult,
      exportedSessions: exportResult.sessions.length,
    }),
  );
}

void main();
