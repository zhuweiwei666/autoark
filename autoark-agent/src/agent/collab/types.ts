import dayjs from 'dayjs'

export type AgentId = 'agent1_data_fusion' | 'agent2_decision' | 'agent3_executor' | 'agent4_governor' | 'agent5_skill_kb'

export interface AgentTask<T = any> {
  traceId: string
  from: AgentId
  to: AgentId
  taskType: string
  payload: T
  createdAt: string
}

export interface AgentResult<T = any> {
  traceId: string
  agentId: AgentId
  success: boolean
  payload: T
  confidence: number
  createdAt: string
}

export interface HandoverPayload<T = any> {
  traceId: string
  from: AgentId
  to: AgentId
  snapshotId?: string
  data: T
}

export interface ConflictRecord {
  field: string
  preferredSource: 'facebook' | 'metabase' | 'toptou'
  fallbackSource?: 'facebook' | 'metabase' | 'toptou'
  reason: string
}

export interface AgentStep {
  agentId: AgentId
  title: string
  conclusion: string
  confidence: number
  evidence?: string[]
  details?: string[]
  timestamp: string
}

export interface DecisionTrace {
  traceId: string
  heartbeatAt: string
  trigger: 'cron' | 'manual' | 'event'
  steps: AgentStep[]
}

export function createDecisionTrace(traceId: string, trigger: 'cron' | 'manual' | 'event'): DecisionTrace {
  return {
    traceId,
    heartbeatAt: dayjs().toISOString(),
    trigger,
    steps: [],
  }
}

export function appendTraceStep(trace: DecisionTrace, step: Omit<AgentStep, 'timestamp'>): void {
  trace.steps.push({
    ...step,
    timestamp: dayjs().toISOString(),
  })
}

export function createAgentTask<T>(traceId: string, from: AgentId, to: AgentId, taskType: string, payload: T): AgentTask<T> {
  return {
    traceId,
    from,
    to,
    taskType,
    payload,
    createdAt: dayjs().toISOString(),
  }
}

export function createAgentResult<T>(traceId: string, agentId: AgentId, payload: T, confidence: number, success = true): AgentResult<T> {
  return {
    traceId,
    agentId,
    success,
    payload,
    confidence,
    createdAt: dayjs().toISOString(),
  }
}
