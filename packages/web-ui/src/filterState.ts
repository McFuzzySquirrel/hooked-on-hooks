import type { EventEnvelope } from "../../../shared/event-schema/src/index.js";
import type { FilterConfig } from "./types.js";

/**
 * Extract the primary actor name from an event payload (tool name or agent name).
 * Returns null for events that don't have an associated actor.
 */
function extractActorName(event: EventEnvelope): string | null {
  const p = event.payload as Record<string, unknown>;
  if (typeof p.toolName === "string")  return p.toolName;
  if (typeof p.agentName === "string") return p.agentName;
  return null;
}

/**
 * Returns true if the event satisfies all active filter constraints (LIVE-FR-05).
 *
 * - eventTypes filter: if non-empty, the event's type must be in the list.
 * - actorName filter: if non-empty, the event's actor must contain the string
 *   (case-insensitive substring match).
 *
 * An empty FilterConfig passes all events.
 */
export function matchesFilter(event: EventEnvelope, filter: FilterConfig): boolean {
  if (filter.eventTypes && filter.eventTypes.length > 0) {
    if (!filter.eventTypes.includes(event.eventType)) {
      return false;
    }
  }

  if (filter.actorName && filter.actorName.trim().length > 0) {
    const actor = extractActorName(event);
    if (!actor || !actor.toLowerCase().includes(filter.actorName.toLowerCase())) {
      return false;
    }
  }

  return true;
}

/**
 * Returns all events from `events` that pass the given filter.
 * Order is preserved. Does not mutate the input array.
 */
export function applyFilter(events: EventEnvelope[], filter: FilterConfig): EventEnvelope[] {
  return events.filter((e) => matchesFilter(e, filter));
}
