import { EventEnvelopeSchema, EVENT_TYPES, SCHEMA_VERSION, type EventEnvelope } from "./schema.js";

export { EVENT_TYPES, SCHEMA_VERSION, EventEnvelopeSchema };
export type { EventEnvelope };

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
