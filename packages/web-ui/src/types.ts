export type SortMode = "recent" | "events" | "size";

export interface SessionCard {
  sessionId: string;
  repository: string;
  branch: string;
  summary: string;
  eventCount: number;
  fileSizeBytes: number;
  modifiedAt: string;
  createdAt: string;
}

export interface SessionListData {
  generatedAt: string;
  source: {
    type: string;
    dbPath: string;
  };
  count: number;
  sessions: SessionCard[];
}

export interface TokenMention {
  source: string;
  value: number;
}

export interface ModelUsageEntry {
  model: string;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ReasoningEvent {
  eventType: string;
  model: string;
  snippet: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  timestamp?: string;
}

export interface ModelChangeEntry {
  timestamp: string;
  oldModel: string;
  newModel: string;
}

export interface ToolCall {
  toolName: string;
  intentionSummary?: string;
  arguments?: Record<string, string>;
  success?: boolean;
  resultSummary?: string;
}

export interface SkillInvocation {
  name: string;
  description?: string;
}

export interface AgentCall {
  agentName: string;
  task?: string;
}

export interface TurnEnrichment {
  interactionId: string;
  model?: string;
  outputTokens?: number;
  tools: ToolCall[];
  skills: SkillInvocation[];
  agents: AgentCall[];
  firstTimestamp?: string;
}

export interface SessionExport {
  sessionId: string;
  summary: string;
  repository: string;
  branch: string;
  cwd: string;
  hostType: string;
  createdAt: string;
  updatedAt: string;
  stats: {
    eventCount: number;
    turnCount: number;
    checkpointCount: number;
    fileCount: number;
    refCount: number;
    fileSizeBytes: number;
  };
  checkpoints: Array<Record<string, unknown>>;
  turns: Array<Record<string, unknown>>;
  files: Array<Record<string, unknown>>;
  refs: Array<Record<string, unknown>>;
  modelsAndTokens: {
    detectedModels: string[];
    tokenMentions: TokenMention[];
    modelUsage?: ModelUsageEntry[];
    totals?: TokenTotals;
    reasoningEvents?: ReasoningEvent[];
    modelChanges?: ModelChangeEntry[];
    notes: string[];
  };
  turnEnrichments?: TurnEnrichment[];
  searchBlob: string[];
}

export interface SessionExportData {
  exportedAt: string;
  source: {
    type: string;
    dbPath: string;
  };
  sessions: SessionExport[];
}

export type DashboardTab = "overview" | "checkpoints" | "turns" | "files" | "models" | "search";

/**
 * Legacy live-board types retained to keep existing modules compiling during migration.
 */
export type VisualStatus = "idle" | "running" | "succeeded" | "error" | "subagent_running";

export interface LaneData {
  id: string;
  label: string;
  status: VisualStatus;
  details?: string;
}

export interface FilterConfig {
  eventTypes?: string[];
  actorName?: string;
}

export interface InspectorEntry {
  eventId: string;
  eventType: string;
  timestamp: string;
  sessionId: string;
  turnId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  payload: Record<string, unknown>;
}

export type ReplaySpeed = 0.5 | 1 | 2 | 4;
