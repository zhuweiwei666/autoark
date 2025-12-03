import { EntitySummaryDTO } from '../../analytics/metrics.service'

export interface OptimizationContext {
  summary: EntitySummaryDTO
  currentBudget: number
  targetRoas?: number
  entityType: 'campaign' | 'adset' | 'ad'
  entityId: string
  accountId: string
}

export type OptimizationAction =
  | { type: 'ADJUST_BUDGET'; newBudget: number; reason: string }
  | { type: 'PAUSE_ENTITY'; reason: string }
  | { type: 'START_ENTITY'; reason: string }
  | { type: 'NOOP'; reason: string }

export interface OptimizationPolicy {
  name: string
  apply(ctx: OptimizationContext): Promise<OptimizationAction> | OptimizationAction
}

