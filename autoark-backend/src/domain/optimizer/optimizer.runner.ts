import { metricsService } from '../analytics/metrics.service'
import { executionService } from './execution.service'
import { OptimizationPolicy, OptimizationContext } from './policies/basePolicy'
import OptimizationState from '../../models/OptimizationState'
import logger from '../../utils/logger'
import Campaign from '../../models/Campaign' // 假设有 Campaign 模型获取 budget

/**
 * 优化运行器
 * 编排：获取数据 -> 应用策略 -> 执行动作
 */
export class OptimizerRunner {
  constructor(
    private policies: OptimizationPolicy[]
  ) {}

  /**
   * 运行 Campaign 优化
   */
  async runForCampaign(campaignId: string) {
    try {
      // 1. 获取聚合数据 (最近 7 天)
      const summary = await metricsService.getEntitySummary({
        entityType: 'campaign',
        entityId: campaignId,
        window: '7d',
      })

      // 2. 获取当前状态 (Budget, Target ROAS)
      // 优先从 OptimizationState 获取，如果没有则从 Campaign 表或默认值获取
      let optState = await OptimizationState.findOne({ entityType: 'campaign', entityId: campaignId }).lean()
      
      // 如果没有优化状态记录，尝试初始化
      if (!optState) {
        const campaign = await Campaign.findOne({ campaignId }).lean()
        if (campaign) {
          // 初始化默认值
          optState = {
            accountId: campaign.accountId,
            currentBudget: parseFloat(campaign.daily_budget || '0') / 100, // 分转元
            targetRoas: 1.0, // 默认 ROAS 目标
          } as any
        } else {
          logger.warn(`[Optimizer] Campaign ${campaignId} not found, skipping`)
          return
        }
      }

      // 构建上下文
      const ctx: OptimizationContext = {
        summary,
        currentBudget: optState!.currentBudget || 0,
        targetRoas: optState!.targetRoas || 1.0,
        entityType: 'campaign',
        entityId: campaignId,
        accountId: optState!.accountId,
      }

      // 3. 应用策略
      // 策略按顺序执行，一旦有一个策略返回非 NOOP 动作，即停止后续策略（优先级机制）
      // 或者也可以收集所有建议动作进行仲裁
      for (const policy of this.policies) {
        const action = await policy.apply(ctx)

        if (action.type !== 'NOOP') {
          logger.info(`[Optimizer] Policy ${policy.name} triggered action ${action.type} for ${campaignId}`)
          
          // 4. 执行动作
          await executionService.execute(
            campaignId,
            'campaign',
            action,
            optState!.accountId
          )
          
          // 仅执行一个动作，避免冲突
          break
        }
      }
    } catch (error: any) {
      logger.error(`[Optimizer] Failed to run for campaign ${campaignId}:`, error)
    }
  }
}

