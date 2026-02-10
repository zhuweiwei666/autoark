/**
 * 记忆工具 - 让 Agent 能学习和回忆
 */
import { ToolDef, S } from '../tools'
import { Action } from '../../action/action.model'
import { Metrics } from '../../data/metrics.model'
import dayjs from 'dayjs'

const recallMemory: ToolDef = {
  name: 'recall_memory',
  description: '回忆之前对某个广告系列/账户做过的操作及其效果。用于避免重复操作和从历史中学习。',
  parameters: S.obj('参数', {
    entityId: S.str('要查询的实体 ID（广告系列 ID、账户 ID 等）'),
    limit: S.int('最多返回记录数（默认 10）'),
  }),
  handler: async (args) => {
    const query: any = { status: { $in: ['executed', 'approved', 'rejected'] } }
    if (args.entityId) {
      query.$or = [
        { entityId: args.entityId },
        { accountId: args.entityId },
        { 'params.campaignId': args.entityId },
      ]
    }

    const actions = await Action.find(query)
      .sort({ createdAt: -1 })
      .limit(args.limit || 10)
      .lean()

    // 对已执行的操作，尝试获取执行后的效果
    const enriched = []
    for (const action of actions) {
      const entry: any = {
        type: action.type,
        platform: action.platform,
        entityId: action.entityId,
        reason: action.reason,
        status: action.status,
        params: action.params,
        result: action.result,
        createdAt: action.createdAt,
      }

      // 如果是已执行的，查看执行后 3 天的指标变化
      if (action.status === 'executed' && action.entityId) {
        const afterDate = dayjs(action.executedAt || action.createdAt).format('YYYY-MM-DD')
        const afterEnd = dayjs(afterDate).add(3, 'day').format('YYYY-MM-DD')
        const afterMetrics = await Metrics.find({
          campaignId: action.entityId,
          date: { $gte: afterDate, $lte: afterEnd },
        }).lean()

        if (afterMetrics.length > 0) {
          const avgRoas = afterMetrics.reduce((s: number, m: any) => s + (m.roas || 0), 0) / afterMetrics.length
          entry.outcomeAfter3Days = {
            avgRoas: +avgRoas.toFixed(2),
            totalSpend: afterMetrics.reduce((s: number, m: any) => s + (m.spend || 0), 0),
            days: afterMetrics.length,
          }
        }
      }

      enriched.push(entry)
    }

    return { history: enriched, count: enriched.length }
  },
}

const storeInsight: ToolDef = {
  name: 'store_insight',
  description: '存储一条学到的经验或洞察，供未来参考。比如"账户 X 的美国市场 ROAS 通常比英国高 30%"。',
  parameters: S.obj('参数', {
    insight: S.str('要存储的经验/洞察（自然语言描述）'),
    category: S.enum('分类', ['audience', 'creative', 'budget', 'market', 'general']),
    relatedEntity: S.str('相关实体 ID（可选）'),
  }, ['insight', 'category']),
  handler: async (args, ctx) => {
    // 存为一条特殊的 Action 记录（type = 'insight'）
    // 简单方案，未来可以单独建模型
    await Action.create({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      type: 'update_creative', // reuse type field
      platform: 'facebook',
      accountId: 'system',
      entityId: args.relatedEntity || 'insight',
      params: { insight: args.insight, category: args.category },
      reason: args.insight,
      status: 'executed',
      executedAt: new Date(),
    })
    return { saved: true, message: '经验已存储' }
  },
}

export const memoryTools: ToolDef[] = [recallMemory, storeInsight]
