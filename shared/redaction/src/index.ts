import type { EventEnvelope } from "../../event-schema/src/index.js";
import { redactSensitiveStrings } from "./patterns.js";

export type { RetentionMode } from "./retention.js";
export { DEFAULT_RETENTION_MODE, getRetentionCutoff, isExpired, purgeExpiredLogs, purgeAllLogs } from "./retention.js";
export type { ExportConfig } from "./export-config.js";
export { DEFAULT_EXPORT_CONFIG, canExport } from "./export-config.js";

export interface RedactionOptions {
  /**
   * When true, prompt bodies are stored as "[REDACTED_PROMPT]".
   * When false (default), prompt bodies are removed entirely from the payload
   * before persistence, satisfying PRIV-FR-05 / SP-08.
   */
  storePrompts?: boolean;
}

/**
 * Recursively redact all sensitive string values in an event payload object.
 * Applies pattern-based redaction to every string leaf (PRIV-FR-01).
 */
function redactPayloadStrings(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = redactSensitiveStrings(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "string"
          ? redactSensitiveStrings(item)
          : item !== null && typeof item === "object"
            ? redactPayloadStrings(item as Record<string, unknown>)
            : item
      );
    } else if (value !== null && typeof value === "object") {
      result[key] = redactPayloadStrings(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Apply all redaction rules to an EventEnvelope before persistence or export.
 *
 * - Pattern-based sensitive string redaction on all payload string fields (PRIV-FR-01).
 * - Prompt content handling (PRIV-FR-05 / SP-08):
 *     storePrompts=false (default) → prompt field removed entirely.
 *     storePrompts=true            → prompt field replaced with "[REDACTED_PROMPT]".
 *
 * This function is a pure transform — it does not modify the original event.
 */
export function applyRedaction(event: EventEnvelope, options: RedactionOptions = {}): EventEnvelope {
  const { storePrompts = false } = options;

  // Apply pattern-based redaction to every string value in the payload
  const payload = redactPayloadStrings({ ...event.payload } as Record<string, unknown>);
  const facets = redactPayloadStrings({ ...event.facets } as Record<string, unknown>);
  const rawPayload = event.rawPayload
    ? {
      ...event.rawPayload,
      redacted: true,
      payload: redactPayloadStrings({ ...event.rawPayload.payload } as Record<string, unknown>)
    }
    : undefined;

  // Handle prompt storage per opt-in policy
  if (event.eventType === "userPromptSubmitted") {
    if (!storePrompts) {
      // Default: remove prompt body entirely — not even a redacted placeholder
      delete payload.prompt;
      if (rawPayload) {
        delete rawPayload.payload.prompt;
      }
    } else {
      // Opt-in: acknowledge that a prompt existed but suppress its content
      payload.prompt = "[REDACTED_PROMPT]";
      if (rawPayload) {
        rawPayload.payload.prompt = "[REDACTED_PROMPT]";
      }
    }
  }

  return {
    ...event,
    payload,
    facets,
    rawPayload,
    privacy: {
      ...event.privacy,
      locallyRedacted: true,
      rawPayloadOptIn: Boolean(rawPayload)
    }
  } as unknown as EventEnvelope;
}
