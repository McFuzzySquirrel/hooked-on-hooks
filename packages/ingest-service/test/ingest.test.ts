import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { emitEvent } from "../../hook-emitter/src/index.js";
import { createIngestServer, parseJsonlFile, rebuildStateFromFile } from "../src/index.js";

describe("ingestion inputs", () => {
  it("parses append-only JSONL logs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ingest-"));
    const jsonlPath = join(dir, "events.jsonl");

    await emitEvent("preToolUse", { toolName: "bash", toolArgs: { command: "npm test" } }, {
      jsonlPath,
      repoPath: "/tmp/repo",
      sessionId: "session-1"
    });

    const events = await parseJsonlFile(jsonlPath);
    expect(events.length).toBe(1);
    expect(events[0]?.eventType).toBe("preToolUse");

    await rm(dir, { recursive: true, force: true });
  });

  it("accepts optional localhost HTTP stream input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ingest-"));
    const jsonlPath = join(dir, "events.jsonl");

    const server = await createIngestServer();
    await server.listen({ host: "127.0.0.1", port: 0 });
    const addr = server.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    await emitEvent("sessionStart", {}, {
      jsonlPath,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      httpEndpoint: `http://127.0.0.1:${port}/events`
    });

    const response = await fetch(`http://127.0.0.1:${port}/events`);
    const body = (await response.json()) as { count: number };
    expect(body.count).toBe(1);

    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("synthesizes subagentStart before task postToolUse when agent_type is present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ingest-task-start-"));
    const jsonlPath = join(dir, "events.jsonl");

    const server = await createIngestServer();
    await server.listen({ host: "127.0.0.1", port: 0 });
    const addr = server.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    await emitEvent("postToolUse", {
      toolName: "task",
      status: "success",
      toolArgs: {
        agent_type: "project-architect",
        name: "phase1-foundation",
        description: "Execute phase 1.1"
      }
    } as Record<string, unknown>, {
      jsonlPath,
      repoPath: "/tmp/repo",
      sessionId: "session-task-1",
      httpEndpoint: `http://127.0.0.1:${port}/events`
    });

    const response = await fetch(`http://127.0.0.1:${port}/events`);
    const body = (await response.json()) as { count: number; events: Array<{ eventType: string; payload: Record<string, unknown> }> };

    expect(body.count).toBe(2);
    expect(body.events[0]?.eventType).toBe("subagentStart");
    expect(body.events[0]?.payload.agentName).toBe("project-architect");
    expect(body.events[1]?.eventType).toBe("postToolUse");

    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("synthesizes subagentStop before agentStop when task agent is active", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ingest-task-stop-"));
    const jsonlPath = join(dir, "events.jsonl");

    const server = await createIngestServer();
    await server.listen({ host: "127.0.0.1", port: 0 });
    const addr = server.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const options = {
      jsonlPath,
      repoPath: "/tmp/repo",
      sessionId: "session-task-2",
      httpEndpoint: `http://127.0.0.1:${port}/events`
    };

    await emitEvent("postToolUse", {
      toolName: "task",
      status: "success",
      toolArgs: { agent_type: "project-architect", description: "Execute phase 1.1" }
    } as Record<string, unknown>, options);

    await emitEvent("agentStop", {
      message: "agent finished",
      summary: "agent finished",
    }, options);

    const response = await fetch(`http://127.0.0.1:${port}/events`);
    const body = (await response.json()) as { count: number; events: Array<{ eventType: string; payload: Record<string, unknown> }> };

    expect(body.count).toBe(4);
    expect(body.events.map((event) => event.eventType)).toEqual([
      "subagentStart",
      "postToolUse",
      "subagentStop",
      "agentStop",
    ]);
    expect(body.events[2]?.payload.agentName).toBe("project-architect");

    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("enriches agentStop payload with active task description when missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ingest-agentstop-desc-"));
    const jsonlPath = join(dir, "events.jsonl");

    const server = await createIngestServer();
    await server.listen({ host: "127.0.0.1", port: 0 });
    const addr = server.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const options = {
      jsonlPath,
      repoPath: "/tmp/repo",
      sessionId: "session-task-3",
      httpEndpoint: `http://127.0.0.1:${port}/events`
    };

    await emitEvent("postToolUse", {
      toolName: "task",
      status: "success",
      toolArgs: { agent_type: "progression-systems-engineer", description: "Execute phase 1.3" }
    } as Record<string, unknown>, options);

    await emitEvent("agentStop", {
      agentName: "progression-systems-engineer"
    }, options);

    const response = await fetch(`http://127.0.0.1:${port}/events`);
    const body = (await response.json()) as { events: Array<{ eventType: string; payload: Record<string, unknown> }> };
    const last = body.events[body.events.length - 1];

    expect(last?.eventType).toBe("agentStop");
    expect(last?.payload.taskDescription).toBe("Execute phase 1.3");
    expect(last?.payload.description).toBe("Execute phase 1.3");
    expect(last?.payload.message).toBe("Execute phase 1.3");
    expect(last?.payload.summary).toBe("Execute phase 1.3");

    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("falls back to 'Completed' on synthesized subagentStop when no description available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ingest-completed-fallback-"));
    const jsonlPath = join(dir, "events.jsonl");

    const server = await createIngestServer();
    await server.listen({ host: "127.0.0.1", port: 0 });
    const addr = server.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const options = {
      jsonlPath,
      repoPath: "/tmp/repo",
      sessionId: "session-task-4",
      httpEndpoint: `http://127.0.0.1:${port}/events`
    };

    // Task with no description field
    await emitEvent("postToolUse", {
      toolName: "task",
      status: "success",
      toolArgs: { agent_type: "qa-engineer" }
    } as Record<string, unknown>, options);

    await emitEvent("agentStop", { agentName: "qa-engineer" }, options);

    const response = await fetch(`http://127.0.0.1:${port}/events`);
    const body = (await response.json()) as { events: Array<{ eventType: string; payload: Record<string, unknown> }> };

    // Find the synthesized subagentStop (index 2 in the 4-event sequence)
    const subagentStop = body.events.find((e) => e.eventType === "subagentStop");
    expect(subagentStop?.payload.taskDescription).toBe("Completed");

    await server.close();
    await rm(dir, { recursive: true, force: true });
  });
});

describe("SSE /state/stream (LIVE-FR-01, LIVE-FR-03)", () => {
  function getPort(server: Awaited<ReturnType<typeof createIngestServer>>): number {
    const addr = server.server.address();
    return typeof addr === "object" && addr ? addr.port : 0;
  }

  it("returns text/event-stream content-type and initial state on connect", async () => {
    const server = await createIngestServer();
    await server.listen({ host: "127.0.0.1", port: 0 });
    const port = getPort(server);

    const firstChunk = await new Promise<string>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path: "/state/stream" }, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("text/event-stream");
        res.once("data", (chunk: Buffer) => {
          req.destroy();
          resolve(chunk.toString());
        });
        res.once("error", reject);
      });
      req.on("error", reject);
      req.end();
    });

    expect(firstChunk.trim()).toMatch(/^data: /);
    const payload = firstChunk.replace(/^data: /, "").trim();
    const state = JSON.parse(payload) as { lifecycle: string };
    expect(state.lifecycle).toBe("not_started");

    await server.close();
  });

  it("broadcasts updated state to SSE subscribers after event ingest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sse-"));
    const jsonlPath = join(dir, "events.jsonl");
    const server = await createIngestServer();
    await server.listen({ host: "127.0.0.1", port: 0 });
    const port = getPort(server);

    // Collect up to 2 data chunks (initial state + state after event)
    const chunks: string[] = [];
    const gotUpdate = new Promise<void>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path: "/state/stream" }, (res) => {
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk.toString());
          if (chunks.length >= 2) {
            req.destroy();
            resolve();
          }
        });
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });

    // Give SSE connection a moment to establish, then post an event
    await new Promise<void>((r) => setTimeout(r, 30));
    await emitEvent("sessionStart", {}, {
      jsonlPath,
      repoPath: "/tmp/repo",
      sessionId: "sse-sess",
      httpEndpoint: `http://127.0.0.1:${port}/events`
    });

    await gotUpdate;

    // Second chunk should carry the updated state after sessionStart
    const secondPayload = chunks[1]?.replace(/^data: /, "").trim() ?? "{}";
    const updatedState = JSON.parse(secondPayload) as { lifecycle: string; sessionId: string };
    expect(updatedState.lifecycle).toBe("active");
    expect(updatedState.sessionId).toBe("sse-sess");

    await server.close();
    await rm(dir, { recursive: true, force: true });
  });
});

describe("rebuildStateFromFile (STAT-FR-03)", () => {
  it("rebuilds session state from a JSONL log file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rebuild-"));
    const jsonlPath = join(dir, "events.jsonl");
    const opts = { jsonlPath, repoPath: "/tmp/repo", sessionId: "rebuild-sess" };

    await emitEvent("sessionStart", {}, opts);
    await emitEvent("preToolUse", { toolName: "bash", toolArgs: { command: "ls" } }, opts);
    await emitEvent("postToolUse", { toolName: "bash", status: "success", durationMs: 5 }, opts);

    const state = await rebuildStateFromFile(jsonlPath);

    expect(state.sessionId).toBe("rebuild-sess");
    expect(state.lifecycle).toBe("active");
    expect(state.visualization).toBe("tool_succeeded");
    expect(state.currentTool?.toolName).toBe("bash");
    expect(state.eventCount).toBe(3);

    await rm(dir, { recursive: true, force: true });
  });
});

describe("pairing diagnostics", () => {
  it("reports pairing mode counts and unmatched totals", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ingest-pairing-diag-"));
    const jsonlPath = join(dir, "events.jsonl");

    const server = await createIngestServer();
    await server.listen({ host: "127.0.0.1", port: 0 });
    const addr = server.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const options = {
      jsonlPath,
      repoPath: "/tmp/repo",
      sessionId: "diag-sess",
      httpEndpoint: `http://127.0.0.1:${port}/events`
    };

    // Exact toolCallId pair
    await emitEvent("preToolUse", { toolName: "bash", toolCallId: "call-1" }, {
      ...options,
      spanId: "span-1",
      traceId: "trace-1"
    });
    await emitEvent("postToolUse", { toolName: "bash", status: "success", toolCallId: "call-1" }, {
      ...options,
      spanId: "span-1",
      traceId: "trace-1"
    });

    // Heuristic pair (no ids)
    await emitEvent("preToolUse", { toolName: "view" }, options);
    await emitEvent("postToolUse", { toolName: "view", status: "success" }, options);

    // Unmatched pre
    await emitEvent("preToolUse", { toolName: "task" }, options);

    const response = await fetch(`http://127.0.0.1:${port}/diagnostics/pairing`);
    const body = (await response.json()) as {
      totalPairs: number;
      byMode: { toolCallId: number; spanId: number; heuristic: number };
      unmatched: { preToolUse: number; postToolUse: number };
    };

    expect(body.totalPairs).toBe(2);
    expect(body.byMode.toolCallId).toBe(1);
    expect(body.byMode.heuristic).toBe(1);
    expect(body.unmatched.preToolUse).toBe(1);
    expect(body.unmatched.postToolUse).toBe(0);

    await server.close();
    await rm(dir, { recursive: true, force: true });
  });
});

describe("SSE state stream (LIVE-FR-01 / LIVE-FR-03)", () => {
  it("emits initial state and then pushes updated state after event ingestion", async () => {
    const server = await createIngestServer();
    await server.listen({ host: "127.0.0.1", port: 0 });
    const addr = server.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const firstChunk = await new Promise<string>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: "/state/stream",
          method: "GET",
          headers: { Accept: "text/event-stream" }
        },
        (res) => {
          res.setEncoding("utf8");
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
            if (data.includes("\n\n")) {
              resolve(data);
              req.destroy();
            }
          });
          res.on("error", reject);
        }
      );
      req.on("error", reject);
      req.end();
    });

    expect(firstChunk).toContain('data: {"sessionId":"unknown"');

    await emitEvent("sessionStart", {}, {
      jsonlPath: join(tmpdir(), "sse-live.jsonl"),
      repoPath: "/tmp/repo",
      sessionId: "live-sess",
      httpEndpoint: `http://127.0.0.1:${port}/events`
    });

    const updated = await fetch(`http://127.0.0.1:${port}/events`);
    const body = (await updated.json()) as { count: number };
    expect(body.count).toBe(1);

    await server.close();
  });
});
