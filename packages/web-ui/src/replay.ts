import type { EventEnvelope } from "../../../shared/event-schema/src/index.js";
import { initialSessionState, reduceEvent, type SessionState } from "../../../shared/state-machine/src/index.js";
import type { InspectorEntry, ReplaySpeed } from "./types.js";

export interface ReplayFrame {
  index: number;
  originalIndex: number;
  event: EventEnvelope;
  state: SessionState;
  isFailure: boolean;
}

function compareReplayOrder(
  left: { event: EventEnvelope; originalIndex: number },
  right: { event: EventEnvelope; originalIndex: number }
): number {
  const leftTime = Date.parse(left.event.timestamp);
  const rightTime = Date.parse(right.event.timestamp);

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.originalIndex - right.originalIndex;
}

export function sortEventsForReplay(events: EventEnvelope[]): EventEnvelope[] {
  return events
    .map((event, originalIndex) => ({ event, originalIndex }))
    .sort(compareReplayOrder)
    .map((item) => item.event);
}

export function isFailureEvent(event: EventEnvelope): boolean {
  return event.eventType === "postToolUseFailure" || event.eventType === "errorOccurred";
}

export function buildReplayFrames(events: EventEnvelope[]): ReplayFrame[] {
  const ordered = events
    .map((event, originalIndex) => ({ event, originalIndex }))
    .sort(compareReplayOrder);

  if (ordered.length === 0) {
    return [];
  }

  let state = initialSessionState(ordered[0].event.sessionId);

  return ordered.map(({ event, originalIndex }, index) => {
    state = reduceEvent(state, event);
    return {
      index,
      originalIndex,
      event,
      state,
      isFailure: isFailureEvent(event)
    };
  });
}

export function getReplayStateAt(frames: ReplayFrame[], index: number): SessionState {
  if (frames.length === 0) {
    return initialSessionState("unknown");
  }
  if (index <= 0) {
    return frames[0].state;
  }
  if (index >= frames.length - 1) {
    return frames[frames.length - 1].state;
  }
  return frames[index].state;
}

export function getReplayEventAt(frames: ReplayFrame[], index: number): EventEnvelope | null {
  if (frames.length === 0) {
    return null;
  }
  if (index <= 0) {
    return frames[0].event;
  }
  if (index >= frames.length - 1) {
    return frames[frames.length - 1].event;
  }
  return frames[index].event;
}

export function findFirstFailureIndex(frames: ReplayFrame[]): number {
  return frames.findIndex((frame) => frame.isFailure);
}

export function stepReplayIndex(currentIndex: number, frameCount: number): number {
  if (frameCount === 0) {
    return -1;
  }
  return Math.min(currentIndex + 1, frameCount - 1);
}

export function getPlaybackIntervalMs(speed: ReplaySpeed): number {
  const baseMs = 800;
  return Math.round(baseMs / speed);
}

export function toInspectorEntry(event: EventEnvelope | null): InspectorEntry | null {
  if (!event) {
    return null;
  }

  return {
    eventId: event.eventId,
    eventType: event.eventType,
    timestamp: event.timestamp,
    sessionId: event.sessionId,
    turnId: event.turnId,
    traceId: event.traceId,
    spanId: event.spanId,
    parentSpanId: event.parentSpanId,
    payload: event.payload as Record<string, unknown>
  };
}
