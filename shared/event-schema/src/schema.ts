import { z } from "zod";

export const SCHEMA_VERSION = "1.0.0";

export const EVENT_SOURCES = ["copilot-cli", "vscode", "unknown"] as const;

export const PRIVACY_CLASSIFICATIONS = [
  "public",
  "internal",
  "confidential",
  "restricted"
] as const;

export const CONFIDENCE_LEVELS = ["exact", "inferred", "heuristic", "unknown"] as const;

export const TOOL_CALL_CATEGORIES = [
  "shell_command",
  "editor_action",
  "mcp_tool_invocation",
  "agent_delegation",
  "subagent_task_launch",
  "debug_command",
  "file_mutation",
  "model_function_call",
  "unknown"
] as const;

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
export type EventSource = (typeof EVENT_SOURCES)[number];
export type PrivacyClassification = (typeof PRIVACY_CLASSIFICATIONS)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export type ToolCallCategory = (typeof TOOL_CALL_CATEGORIES)[number];

const ConfidenceSchema = z.enum(CONFIDENCE_LEVELS);

const PrivacySchema = z.object({
  classification: z.enum(PRIVACY_CLASSIFICATIONS).default("internal"),
  locallyRedacted: z.boolean().default(false),
  rawPayloadOptIn: z.boolean().default(false),
  retention: z.enum(["ephemeral", "session", "standard", "extended"]).default("standard")
}).catchall(z.unknown());

const ToolCallFacetSchema = z.object({
  toolName: z.string().min(1),
  toolCallId: z.string().min(1).optional(),
  category: z.enum(TOOL_CALL_CATEGORIES).default("unknown"),
  status: z.enum(["requested", "success", "failure", "denied", "unknown"]).default("unknown"),
  confidence: ConfidenceSchema.default("unknown")
}).catchall(z.unknown());

const ModelUsageFacetSchema = z.object({
  model: z.string().min(1).optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  confidence: ConfidenceSchema.default("unknown")
}).catchall(z.unknown());

const TokenUsageFacetSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  confidence: ConfidenceSchema.default("unknown")
}).catchall(z.unknown());

const ContextWindowFacetSchema = z.object({
  usedTokens: z.number().int().nonnegative().optional(),
  maxTokens: z.number().int().positive().optional(),
  confidence: ConfidenceSchema.default("unknown")
}).catchall(z.unknown());

const AgentActivityFacetSchema = z.object({
  agentName: z.string().min(1).optional(),
  agentType: z.string().min(1).optional(),
  action: z.enum(["started", "stopped", "delegated", "unknown"]).default("unknown"),
  confidence: ConfidenceSchema.default("unknown")
}).catchall(z.unknown());

const DebugEventFacetSchema = z.object({
  kind: z.string().min(1),
  message: z.string().optional(),
  confidence: ConfidenceSchema.default("unknown")
}).catchall(z.unknown());

const FileTouchedFacetSchema = z.object({
  path: z.string().min(1),
  action: z.enum(["read", "write", "delete", "rename", "unknown"]).default("unknown"),
  confidence: ConfidenceSchema.default("unknown")
}).catchall(z.unknown());

const ErrorFacetSchema = z.object({
  message: z.string().min(1),
  code: z.string().optional(),
  confidence: ConfidenceSchema.default("unknown")
}).catchall(z.unknown());

const FacetsSchema = z.object({
  toolCalls: z.array(ToolCallFacetSchema).default([]),
  modelUsage: z.array(ModelUsageFacetSchema).default([]),
  tokenUsage: z.array(TokenUsageFacetSchema).default([]),
  contextWindow: z.array(ContextWindowFacetSchema).default([]),
  agentActivity: z.array(AgentActivityFacetSchema).default([]),
  subagentActivity: z.array(AgentActivityFacetSchema).default([]),
  debugEvents: z.array(DebugEventFacetSchema).default([]),
  filesTouched: z.array(FileTouchedFacetSchema).default([]),
  errors: z.array(ErrorFacetSchema).default([])
}).catchall(z.unknown());

const RawPayloadSchema = z.object({
  redacted: z.boolean().default(true),
  payload: z.record(z.string(), z.unknown()),
  retainedFor: z.enum(["replay", "debug"]).default("debug")
}).catchall(z.unknown());

const DEFAULT_PRIVACY_METADATA = {
  classification: "internal",
  locallyRedacted: false,
  rawPayloadOptIn: false,
  retention: "standard"
} as const;

const DEFAULT_FACETS = {
  toolCalls: [],
  modelUsage: [],
  tokenUsage: [],
  contextWindow: [],
  agentActivity: [],
  subagentActivity: [],
  debugEvents: [],
  filesTouched: [],
  errors: []
};

const BaseEnvelope = z.object({
  schemaVersion: z.string().min(1),
  eventId: z.string().uuid(),
  eventType: z.enum(EVENT_TYPES),
  timestamp: z.string().datetime({ offset: true }),
  sessionId: z.string().min(1),
  userId: z.string().min(1).default("unknown"),
  machineId: z.string().min(1).default("unknown"),
  source: z.enum(EVENT_SOURCES).default("copilot-cli"),
  sourceVersion: z.string().min(1).default("unknown"),
  repoPath: z.string().min(1),
  workspaceId: z.string().min(1).default("unknown"),
  workspacePath: z.string().min(1).optional(),
  privacy: PrivacySchema.default(DEFAULT_PRIVACY_METADATA),
  confidence: ConfidenceSchema.default("exact"),
  facets: FacetsSchema.default(DEFAULT_FACETS),
  rawPayload: RawPayloadSchema.optional(),
  turnId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional(),
  parentSpanId: z.string().min(1).optional()
}).catchall(z.unknown());

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
    agentType: z.string().optional(),
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

export type EventFacets = z.infer<typeof FacetsSchema>;
export type PrivacyMetadata = z.infer<typeof PrivacySchema>;

const TOOL_CATEGORY_BY_NAME: Record<string, ToolCallCategory> = {
  bash: "shell_command",
  shell: "shell_command",
  terminal: "shell_command",
  run_command: "shell_command",
  edit_file: "editor_action",
  read_file: "editor_action",
  write_file: "file_mutation",
  apply_patch: "file_mutation",
  task: "subagent_task_launch",
  debug: "debug_command",
  mcp: "mcp_tool_invocation"
};

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function classifyTool(toolName: string, payload: Record<string, unknown>): { category: ToolCallCategory; confidence: ConfidenceLevel } {
  const normalized = toolName.toLowerCase();
  if (TOOL_CATEGORY_BY_NAME[normalized]) {
    return { category: TOOL_CATEGORY_BY_NAME[normalized], confidence: "exact" };
  }
  if (normalized.includes("mcp")) {
    return { category: "mcp_tool_invocation", confidence: "heuristic" };
  }
  if (normalized.includes("debug")) {
    return { category: "debug_command", confidence: "heuristic" };
  }
  if (normalized.includes("file") || normalized.includes("write")) {
    return { category: "file_mutation", confidence: "heuristic" };
  }

  const toolArgs = payload.toolArgs;
  if (toolArgs && typeof toolArgs === "object" && !Array.isArray(toolArgs) && "agent_type" in toolArgs) {
    return { category: "subagent_task_launch", confidence: "inferred" };
  }

  return { category: "unknown", confidence: "unknown" };
}

function toolStatus(eventType: EventType, payload: Record<string, unknown>): "requested" | "success" | "failure" | "denied" | "unknown" {
  if (eventType === "preToolUse") {
    return "requested";
  }
  if (eventType === "postToolUse") {
    return "success";
  }
  if (eventType === "postToolUseFailure") {
    return payload.status === "denied" ? "denied" : "failure";
  }
  return "unknown";
}

export function buildEventFacets(eventType: EventType, payload: Record<string, unknown>): EventFacets {
  const facets: EventFacets = {
    toolCalls: [],
    modelUsage: [],
    tokenUsage: [],
    contextWindow: [],
    agentActivity: [],
    subagentActivity: [],
    debugEvents: [],
    filesTouched: [],
    errors: []
  };

  const toolName = stringField(payload, "toolName");
  if (toolName) {
    const { category, confidence } = classifyTool(toolName, payload);
    facets.toolCalls.push({
      toolName,
      toolCallId: stringField(payload, "toolCallId"),
      category,
      status: toolStatus(eventType, payload),
      confidence
    });
  }

  const model = stringField(payload, "model");
  const inputTokens = numberField(payload, "inputTokens");
  const outputTokens = numberField(payload, "outputTokens");
  const totalTokens = numberField(payload, "totalTokens");
  if (model || inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined) {
    const confidence: ConfidenceLevel = model ? "exact" : "inferred";
    facets.modelUsage.push({ model, inputTokens, outputTokens, totalTokens, confidence });
    facets.tokenUsage.push({ inputTokens, outputTokens, totalTokens, confidence });
  }

  const usedTokens = numberField(payload, "contextUsedTokens");
  const maxTokens = numberField(payload, "contextMaxTokens");
  if (usedTokens !== undefined || maxTokens !== undefined) {
    facets.contextWindow.push({ usedTokens, maxTokens, confidence: "exact" });
  }

  const agentName = stringField(payload, "agentName");
  const agentType = stringField(payload, "agentType");
  if (eventType === "agentStop" && (agentName || agentType)) {
    facets.agentActivity.push({ agentName, agentType, action: "stopped", confidence: "exact" });
  }
  if ((eventType === "subagentStart" || eventType === "subagentStop") && (agentName || agentType)) {
    facets.subagentActivity.push({
      agentName,
      agentType,
      action: eventType === "subagentStart" ? "started" : "stopped",
      confidence: "exact"
    });
  }

  const message = stringField(payload, "message");
  if (eventType === "errorOccurred" && message) {
    facets.errors.push({ message, code: stringField(payload, "code"), confidence: "exact" });
  }
  const errorSummary = stringField(payload, "errorSummary");
  if (eventType === "postToolUseFailure" && errorSummary) {
    facets.errors.push({ message: errorSummary, confidence: "exact" });
  }

  const filePath = stringField(payload, "filePath") ?? stringField(payload, "path");
  if (filePath) {
    facets.filesTouched.push({ path: filePath, action: "unknown", confidence: "inferred" });
  }

  if (toolName && facets.toolCalls[0]?.category === "debug_command") {
    facets.debugEvents.push({ kind: toolName, message: stringField(payload, "summary"), confidence: facets.toolCalls[0].confidence });
  }

  return facets;
}
