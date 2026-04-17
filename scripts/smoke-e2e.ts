import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIngestServer } from "../packages/ingest-service/src/index.js";
import { emitEvent } from "../packages/hook-emitter/src/index.js";

interface EventsResponse {
  count: number;
  events: Array<{ eventType: string; sessionId: string }>;
}

interface PairingDiagnosticsResponse {
  totalPairs: number;
  byMode: { toolCallId: number; spanId: number; heuristic: number };
  unmatched: { preToolUse: number; postToolUse: number };
}

async function run(): Promise<void> {
  const server = await createIngestServer();
  const tempDir = await mkdtemp(join(tmpdir(), "visualizer-smoke-"));
  const jsonlPath = join(tempDir, "events.jsonl");

  try {
    await server.listen({ host: "127.0.0.1", port: 0 });
    const address = server.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    if (!port) {
      throw new Error("Failed to resolve ingest-service port");
    }

    const sessionId = "smoke-session";
    const options = {
      jsonlPath,
      repoPath: process.cwd(),
      sessionId,
      httpEndpoint: `http://127.0.0.1:${port}/events`
    };

    await emitEvent("sessionStart", {}, options);
    await emitEvent("preToolUse", { toolName: "bash", toolArgs: { command: "echo smoke" }, toolCallId: "call-1" }, options);
    await emitEvent("postToolUse", { toolName: "bash", status: "success", durationMs: 5, toolCallId: "call-1" }, options);
    // Second pair using only span IDs (no toolCallId) to exercise spanId pairing
    await emitEvent("preToolUse", { toolName: "edit" }, { ...options, spanId: "span-2" });
    await emitEvent("postToolUse", { toolName: "edit", status: "success", durationMs: 3 }, { ...options, spanId: "span-2" });
    // Third pair with no correlation IDs — exercises FIFO heuristic
    await emitEvent("preToolUse", { toolName: "view" }, options);
    await emitEvent("postToolUse", { toolName: "view", status: "success", durationMs: 1 }, options);
    await emitEvent("sessionEnd", {}, options);

    const eventsResponse = await fetch(`http://127.0.0.1:${port}/events`);
    if (!eventsResponse.ok) {
      throw new Error(`GET /events failed with ${eventsResponse.status}`);
    }

    const body = (await eventsResponse.json()) as EventsResponse;
    if (body.count !== 8) {
      throw new Error(`Expected 8 ingested events, received ${body.count}`);
    }

    const expectedOrder = ["sessionStart", "preToolUse", "postToolUse", "preToolUse", "postToolUse", "preToolUse", "postToolUse", "sessionEnd"];
    const actualOrder = body.events.map((event) => event.eventType);
    if (expectedOrder.join(",") !== actualOrder.join(",")) {
      throw new Error(`Unexpected event order: ${actualOrder.join(" -> ")}`);
    }

    const streamResponse = await fetch(`http://127.0.0.1:${port}/state/stream`, {
      headers: { Accept: "text/event-stream" },
      signal: AbortSignal.timeout(2000)
    });

    if (!streamResponse.ok || !streamResponse.body) {
      throw new Error(`GET /state/stream failed with ${streamResponse.status}`);
    }

    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    const firstChunk = await reader.read();
    await reader.cancel();

    const streamText = decoder.decode(firstChunk.value ?? new Uint8Array());
    if (!streamText.includes(`\"sessionId\":\"${sessionId}\"`) || !streamText.includes("\"lifecycle\":\"completed\"")) {
      throw new Error(`Unexpected state stream payload: ${streamText}`);
    }

    // --- Tracing v2: pairing diagnostics endpoint ---
    const diagResponse = await fetch(`http://127.0.0.1:${port}/diagnostics/pairing`);
    if (!diagResponse.ok) {
      throw new Error(`GET /diagnostics/pairing failed with ${diagResponse.status}`);
    }
    const diag = (await diagResponse.json()) as PairingDiagnosticsResponse;
    if (diag.totalPairs !== 3) {
      throw new Error(`Expected 3 tool pairs, got ${diag.totalPairs}`);
    }
    if (diag.byMode.toolCallId !== 1) {
      throw new Error(`Expected 1 toolCallId pair, got ${diag.byMode.toolCallId}`);
    }
    if (diag.byMode.spanId !== 1) {
      throw new Error(`Expected 1 spanId pair, got ${diag.byMode.spanId}`);
    }
    if (diag.byMode.heuristic !== 1) {
      throw new Error(`Expected 1 heuristic pair, got ${diag.byMode.heuristic}`);
    }
    if (diag.unmatched.preToolUse !== 0 || diag.unmatched.postToolUse !== 0) {
      throw new Error(`Expected 0 unmatched, got pre=${diag.unmatched.preToolUse} post=${diag.unmatched.postToolUse}`);
    }
    console.log(`SMOKE_OK: pairing diagnostics — toolCallId:${diag.byMode.toolCallId} spanId:${diag.byMode.spanId} heuristic:${diag.byMode.heuristic}`);

    console.log("SMOKE_OK: emitter -> ingest -> state stream flow verified");
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

await run();
