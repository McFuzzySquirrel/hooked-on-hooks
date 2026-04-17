import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "../../../shared/event-schema/src/index.js";
import { parseEvent } from "../../../shared/event-schema/src/index.js";
import { initialSessionState, reduceEvent } from "../../../shared/state-machine/src/index.js";
import {
  buildReplayFrames,
  findFirstFailureIndex,
  getPlaybackIntervalMs,
  getReplayEventAt,
  getReplayStateAt,
  sortEventsForReplay,
  stepReplayIndex,
  toInspectorEntry
} from "../src/replay.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadFixture(name: string): EventEnvelope[] {
  const raw = readFileSync(join(__dirname, "../../../tests/fixtures/sessions", name), "utf8");
  return raw
    .trim()
    .split("\n")
    .map((line) => parseEvent(JSON.parse(line)))
    .filter((result): result is { ok: true; value: EventEnvelope } => result.ok)
    .map((result) => result.value);
}

function makeEvent(
  eventType: EventEnvelope["eventType"],
  timestamp: string,
  payload: Record<string, unknown>,
  originalSuffix: string
): EventEnvelope {
  return {
    schemaVersion: "1.0.0",
    eventId: `20000000-0000-4000-8000-${originalSuffix}`,
    eventType,
    timestamp,
    sessionId: "replay-test-session",
    source: "copilot-cli",
    repoPath: "/tmp/repo",
    payload
  } as EventEnvelope;
}

describe("replay chronology and controls", () => {
  it("orders replay by timestamp and falls back to original log position when timestamps match", () => {
    const sharedTs = "2026-04-12T10:00:02.000Z";
    const events: EventEnvelope[] = [
      makeEvent("postToolUse", sharedTs, { toolName: "b", status: "success" }, "000000000001"),
      makeEvent("sessionStart", "2026-04-12T10:00:00.000Z", {}, "000000000002"),
      makeEvent("preToolUse", sharedTs, { toolName: "a" }, "000000000003"),
      makeEvent("sessionEnd", "2026-04-12T10:00:05.000Z", {}, "000000000004")
    ];

    const ordered = sortEventsForReplay(events);

    expect(ordered.map((event) => event.eventType)).toEqual([
      "sessionStart",
      "postToolUse",
      "preToolUse",
      "sessionEnd"
    ]);
  });

  it("scrubbing to an index yields the same state as chronological playback up to that index", () => {
    const events = loadFixture("replay-failure-path.jsonl");
    const frames = buildReplayFrames(events);
    const scrubIndex = 3;

    const manual = sortEventsForReplay(events)
      .slice(0, scrubIndex + 1)
      .reduce(
        (state, event) => reduceEvent(state, event),
        initialSessionState(events[0].sessionId)
      );

    expect(getReplayStateAt(frames, scrubIndex)).toEqual(manual);
  });

  it("finds the first failure frame from a recorded session in one lookup", () => {
    const frames = buildReplayFrames(loadFixture("replay-failure-path.jsonl"));
    const index = findFirstFailureIndex(frames);

    expect(index).toBe(2);
    expect(getReplayEventAt(frames, index)?.eventType).toBe("postToolUseFailure");
  });

  it("creates inspector entries from replay events", () => {
    const events = loadFixture("replay-failure-path.jsonl");
    const augmented: EventEnvelope[] = events.map((event, index) =>
      index === 1
        ? {
            ...event,
            turnId: "turn-1",
            traceId: "trace-1",
            spanId: "span-1",
            parentSpanId: "span-root",
          }
        : event
    );
    const frames = buildReplayFrames(augmented);
    const entry = toInspectorEntry(getReplayEventAt(frames, 1));

    expect(entry?.eventType).toBe("preToolUse");
    expect(entry?.payload).toHaveProperty("toolName", "grep");
    expect(entry?.turnId).toBe("turn-1");
    expect(entry?.traceId).toBe("trace-1");
    expect(entry?.spanId).toBe("span-1");
    expect(entry?.parentSpanId).toBe("span-root");
  });

  it("steps playback forward and clamps at the last frame", () => {
    expect(stepReplayIndex(-1, 0)).toBe(-1);
    expect(stepReplayIndex(0, 4)).toBe(1);
    expect(stepReplayIndex(3, 4)).toBe(3);
  });

  it("maps replay speed to shorter intervals for faster playback", () => {
    expect(getPlaybackIntervalMs(4)).toBeLessThan(getPlaybackIntervalMs(2));
    expect(getPlaybackIntervalMs(2)).toBeLessThan(getPlaybackIntervalMs(1));
    expect(getPlaybackIntervalMs(1)).toBeLessThan(getPlaybackIntervalMs(0.5));
  });

  it("rebuilds 10k replay frames while remaining responsive", () => {
    const base = Date.parse("2026-04-12T10:00:00.000Z");
    const events: EventEnvelope[] = [];

    for (let index = 0; index < 10_000; index += 1) {
      const timestamp = new Date(base + index).toISOString();
      if (index === 0) {
        events.push(makeEvent("sessionStart", timestamp, {}, String(index).padStart(12, "0")));
      } else if (index === 9_999) {
        events.push(makeEvent("sessionEnd", timestamp, {}, String(index).padStart(12, "0")));
      } else if (index % 2 === 0) {
        events.push(makeEvent("preToolUse", timestamp, { toolName: `tool-${index}` }, String(index).padStart(12, "0")));
      } else {
        events.push(makeEvent("postToolUse", timestamp, { toolName: `tool-${index - 1}`, status: "success" }, String(index).padStart(12, "0")));
      }
    }

    const started = Date.now();
    const frames = buildReplayFrames(events);
    const elapsedMs = Date.now() - started;

    expect(frames).toHaveLength(10_000);
    expect(frames[9_999]?.state.lifecycle).toBe("completed");
    expect(elapsedMs).toBeLessThan(2_000);
  });
});
