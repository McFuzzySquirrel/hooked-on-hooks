import { z } from "zod";

export const SCHEMA_VERSION = "1.0.0";

export const EVENT_TYPES = [
  "sessionStart",
  "sessionEnd",
  "userPromptSubmitted",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "subagentStart",
  "subagentStop",
  "agentStop",
  "notification",
  "errorOccurred"
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const BaseEnvelope = z.object({
  schemaVersion: z.string().min(1),
  eventId: z.string().uuid(),
  eventType: z.enum(EVENT_TYPES),
  timestamp: z.string().datetime({ offset: true }),
  sessionId: z.string().min(1),
  source: z.literal("copilot-cli"),
  repoPath: z.string().min(1),
  turnId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional(),
  parentSpanId: z.string().min(1).optional()
});

const PayloadSchemas = {
  sessionStart: z.object({}).catchall(z.unknown()),
  sessionEnd: z.object({}).catchall(z.unknown()),
  userPromptSubmitted: z.object({
    prompt: z.string().optional()
  }).catchall(z.unknown()),
  preToolUse: z.object({
    toolName: z.string().min(1),
    toolArgs: z.record(z.string(), z.unknown()).optional(),
    toolCallId: z.string().min(1).optional()
  }).catchall(z.unknown()),
  postToolUse: z.object({
    toolName: z.string().min(1),
    status: z.literal("success"),
    durationMs: z.number().int().nonnegative().optional(),
    toolCallId: z.string().min(1).optional()
  }).catchall(z.unknown()),
  postToolUseFailure: z.object({
    toolName: z.string().min(1),
    status: z.literal("failure"),
    durationMs: z.number().int().nonnegative().optional(),
    errorSummary: z.string().optional(),
    toolCallId: z.string().min(1).optional()
  }).catchall(z.unknown()),
  subagentStart: z.object({
    agentName: z.string().min(1),
    agentDisplayName: z.string().optional(),
    agentDescription: z.string().optional(),
    taskDescription: z.string().optional(),
    message: z.string().optional(),
    summary: z.string().optional()
  }).catchall(z.unknown()),
  subagentStop: z.object({
    agentName: z.string().min(1),
    taskDescription: z.string().optional(),
    message: z.string().optional(),
    summary: z.string().optional(),
    result: z.string().optional()
  }).catchall(z.unknown()),
  agentStop: z.object({
    agentName: z.string().optional(),
    reason: z.string().optional(),
    message: z.string().optional(),
    summary: z.string().optional()
  }).catchall(z.unknown()),
  notification: z.object({
    notificationType: z.string().min(1),
    title: z.string().min(1),
    message: z.string().min(1)
  }).catchall(z.unknown()),
  errorOccurred: z.object({
    message: z.string().min(1),
    code: z.string().optional()
  }).catchall(z.unknown())
};

export const EventEnvelopeSchema = z.discriminatedUnion("eventType", [
  BaseEnvelope.extend({ eventType: z.literal("sessionStart"), payload: PayloadSchemas.sessionStart }),
  BaseEnvelope.extend({ eventType: z.literal("sessionEnd"), payload: PayloadSchemas.sessionEnd }),
  BaseEnvelope.extend({ eventType: z.literal("userPromptSubmitted"), payload: PayloadSchemas.userPromptSubmitted }),
  BaseEnvelope.extend({ eventType: z.literal("preToolUse"), payload: PayloadSchemas.preToolUse }),
  BaseEnvelope.extend({ eventType: z.literal("postToolUse"), payload: PayloadSchemas.postToolUse }),
  BaseEnvelope.extend({ eventType: z.literal("postToolUseFailure"), payload: PayloadSchemas.postToolUseFailure }),
  BaseEnvelope.extend({ eventType: z.literal("subagentStart"), payload: PayloadSchemas.subagentStart }),
  BaseEnvelope.extend({ eventType: z.literal("subagentStop"), payload: PayloadSchemas.subagentStop }),
  BaseEnvelope.extend({ eventType: z.literal("agentStop"), payload: PayloadSchemas.agentStop }),
  BaseEnvelope.extend({ eventType: z.literal("notification"), payload: PayloadSchemas.notification }),
  BaseEnvelope.extend({ eventType: z.literal("errorOccurred"), payload: PayloadSchemas.errorOccurred })
]);

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
