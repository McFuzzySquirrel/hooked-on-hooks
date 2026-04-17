#!/usr/bin/env node
import { resolve } from "node:path";
import { emitEvent, getHookEventTypes } from "../packages/hook-emitter/src/index.js";

interface Args {
  eventType?: string;
  payload?: string;
  sessionId?: string;
  repoPath?: string;
  jsonlPath?: string;
  httpEndpoint?: string;
  storePrompts?: string;
  turnId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
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

function fail(message: string): never {
  console.error(`emit-event-cli error: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.eventType) {
    fail("missing --eventType");
  }
  if (!args.payload) {
    fail("missing --payload (JSON string)");
  }
  if (!args.sessionId) {
    fail("missing --sessionId");
  }
  if (!args.repoPath) {
    fail("missing --repoPath");
  }
  if (!args.jsonlPath) {
    fail("missing --jsonlPath");
  }

  const eventType = args.eventType;
  if (!getHookEventTypes().includes(eventType)) {
    fail(`unsupported eventType '${eventType}'. Supported: ${getHookEventTypes().join(", ")}`);
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(args.payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail("--payload must decode to a JSON object");
    }
    payload = parsed as Record<string, unknown>;
  } catch (error) {
    fail(`invalid payload JSON: ${(error as Error).message}`);
  }

  const result = await emitEvent(eventType as never, payload, {
    jsonlPath: resolve(args.jsonlPath),
    repoPath: resolve(args.repoPath),
    sessionId: args.sessionId,
    source: "copilot-cli",
    httpEndpoint: args.httpEndpoint,
    storePrompts: args.storePrompts === "true",
    turnId: args.turnId || undefined,
    traceId: args.traceId || undefined,
    spanId: args.spanId || undefined,
    parentSpanId: args.parentSpanId || undefined,
  });

  if (!result.accepted) {
    fail(result.error ?? "event rejected");
  }

  console.log(
    JSON.stringify({
      ok: true,
      eventType,
      eventId: result.event?.eventId,
      sessionId: args.sessionId
    })
  );
}

void main();
