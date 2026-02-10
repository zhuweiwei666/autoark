/**
 * Agent Core Type Definitions
 * 
 * Shared types for the entire agent system:
 * - Tool definitions (input/output schemas, guardrails)
 * - Agent configuration (scope, permissions, objectives)
 * - Memory (decisions, knowledge, sessions)
 * - Runtime context
 */

// ==================== Tool Types ====================

export interface ToolParameterProperty {
  type: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'OBJECT' | 'ARRAY' | 'INTEGER'
  description: string
  enum?: string[]
  items?: ToolParameterProperty
  properties?: Record<string, ToolParameterProperty>
  required?: string[]
}

export interface ToolParameters {
  type: 'OBJECT'
  properties: Record<string, ToolParameterProperty>
  required?: string[]
}

export interface ToolGuardrails {
  maxChangePercent?: number
  minBudget?: number
  maxBudget?: number
  cooldownMinutes?: number
  requiresApproval?: boolean
  requiredPermission?: keyof AgentPermissions
  maxCallsPerRun?: number
}

export interface ToolResult {
  success: boolean
  data?: any
  error?: string
  metadata?: Record<string, any>
}

export type ToolHandler = (args: any, context: AgentContext) => Promise<ToolResult>

export interface ToolDefinition {
  name: string
  description: string
  category: 'facebook' | 'tiktok' | 'data' | 'material' | 'analysis' | 'system'
  parameters: ToolParameters
  guardrails?: ToolGuardrails
  handler: ToolHandler
}

/**
 * Gemini-compatible function declaration (no handler).
 * Used to pass tool schemas to the LLM.
 */
export interface FunctionDeclaration {
  name: string
  description: string
  parameters: ToolParameters
}

// ==================== Agent Configuration Types ====================

export type AgentMode = 'observe' | 'suggest' | 'auto'
export type AgentStatus = 'active' | 'paused' | 'disabled'
export type AgentRole = 'planner' | 'analyst' | 'executor' | 'creative' | 'orchestrator'

export interface AgentPermissions {
  canPublishAds: boolean
  canToggleStatus: boolean
  canAdjustBudget: boolean
  canAdjustBid: boolean
  canPause: boolean
  canResume: boolean
  canCreateCampaigns: boolean
  canModifyTargeting: boolean
  canModifyCreatives: boolean
}

export const DEFAULT_PERMISSIONS: AgentPermissions = {
  canPublishAds: false,
  canToggleStatus: true,
  canAdjustBudget: true,
  canAdjustBid: false,
  canPause: true,
  canResume: true,
  canCreateCampaigns: false,
  canModifyTargeting: false,
  canModifyCreatives: false,
}

export interface AgentScope {
  adAccountIds: string[]
  fbTokenIds: string[]
  tiktokTokenIds: string[]
  facebookAppIds: string[]
}

export interface AgentObjectives {
  targetRoas?: number
  maxCpa?: number
  dailyBudgetLimit?: number
  monthlyBudgetLimit?: number
  targetCountries?: string[]
  preferredPlatform?: 'facebook' | 'tiktok' | 'all'
}

export interface AgentConfig {
  id: string
  name: string
  description?: string
  organizationId?: string
  role: AgentRole
  mode: AgentMode
  status: AgentStatus
  permissions: AgentPermissions
  scope: AgentScope
  objectives: AgentObjectives
  systemPromptOverride?: string
  model?: string  // LLM model override (default: gemini-2.0-flash)
  maxIterations?: number  // max tool-call loops (default: 20)
  temperature?: number  // LLM temperature (default: 0.2 for deterministic)
}

// ==================== Runtime Context ====================

export interface AgentContext {
  agentId: string
  agentConfig: AgentConfig
  organizationId?: string
  userId?: string
  sessionId: string
  mode: AgentMode
  permissions: AgentPermissions
  scope: AgentScope
  objectives: AgentObjectives
  /** Resolved Facebook access token for the current run */
  fbToken?: string
  /** Resolved TikTok access token for the current run */
  tiktokToken?: string
  /** Additional metadata passed to the agent */
  metadata?: Record<string, any>
}

// ==================== Memory Types ====================

export interface ConversationMessage {
  role: 'user' | 'model' | 'function'
  parts: MessagePart[]
  timestamp?: Date
}

export type MessagePart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, any> } }
  | { functionResponse: { name: string; response: any } }

export interface DecisionRecord {
  agentId: string
  sessionId: string
  organizationId?: string
  toolName: string
  action: string
  entityType: string
  entityId: string
  platform: 'facebook' | 'tiktok'
  reason: string
  input: Record<string, any>
  output: Record<string, any>
  outcome?: DecisionOutcome
  createdAt: Date
}

export interface DecisionOutcome {
  evaluatedAt: Date
  metricsBefore: Record<string, number>
  metricsAfter: Record<string, number>
  assessment: 'positive' | 'negative' | 'neutral'
  notes?: string
}

export interface KnowledgeEntry {
  organizationId?: string
  category: 'product' | 'audience' | 'creative' | 'campaign' | 'general'
  key: string
  content: string
  confidence: number
  source: 'agent_learning' | 'user_input' | 'data_analysis'
  relatedEntities?: string[]
  createdAt: Date
  updatedAt: Date
}

// ==================== Guardrail Types ====================

export interface GuardrailCheckResult {
  approved: boolean
  reason?: string
  requiresHumanApproval?: boolean
  cooldownUntil?: Date
  warnings?: string[]
}

// ==================== Agent Run Types ====================

export interface AgentRunResult {
  sessionId: string
  agentId: string
  role: AgentRole
  status: 'completed' | 'failed' | 'needs_approval' | 'max_iterations'
  summary: string
  toolCalls: ToolCallRecord[]
  decisions: DecisionRecord[]
  totalIterations: number
  durationMs: number
  error?: string
}

export interface ToolCallRecord {
  toolName: string
  args: Record<string, any>
  result: ToolResult
  guardrailCheck: GuardrailCheckResult
  durationMs: number
  timestamp: Date
}
