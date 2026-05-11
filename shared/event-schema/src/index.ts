import {
  EventEnvelopeSchema,
  EVENT_TYPES,
  EVENT_SOURCES,
  SCHEMA_VERSION,
  buildEventFacets,
  type ConfidenceLevel,
  type EventEnvelope,
  type EventFacets,
  type EventSource,
  type PrivacyClassification,
  type PrivacyMetadata,
  type ToolCallCategory
} from "./schema.js";

export { EVENT_TYPES, EVENT_SOURCES, SCHEMA_VERSION, EventEnvelopeSchema, buildEventFacets };
export type {
  ConfidenceLevel,
  EventEnvelope,
  EventFacets,
  EventSource,
  PrivacyClassification,
  PrivacyMetadata,
  ToolCallCategory
};

export type ParseResult =
  | { ok: true; value: EventEnvelope }
  | { ok: false; error: string };

export function parseEvent(raw: unknown): ParseResult {
  const parsed = EventEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => issue.message).join("; ")
    };
  }
  return { ok: true, value: parsed.data };
}

export function isKnownEventType(value: string): value is (typeof EVENT_TYPES)[number] {
  return EVENT_TYPES.includes(value as (typeof EVENT_TYPES)[number]);
}
