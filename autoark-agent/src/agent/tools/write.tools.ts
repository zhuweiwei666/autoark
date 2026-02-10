/**
 * 写工具 - 不直接调 API，而是创建 Action 记录等待审批
 */
import { ToolDef, S } from '../tools'
import { Action } from '../../action/action.model'

function makeProposeTool(p: {
  name: string; desc: string; type: string
  params: any; required: string[]
}): ToolDef {
  return {
    name: p.name,
    description: p.desc + '。注意：此操作不会立即执行，会创建一条待审批记录，用户批准后才会真正执行。',
    parameters: S.obj('参数', {
      ...p.params,
      platform: S.enum('目标平台', ['facebook', 'tiktok']),
      accountId: S.str('广告账户 ID'),
      reason: S.str('操作原因（必填，解释为什么要这样做）'),
    }, [...p.required, 'platform', 'accountId', 'reason']),
    handler: async (args, ctx) => {
      const action = await Action.create({
        conversationId: ctx.conversationId,
        userId: ctx.userId,
        type: p.type,
        platform: args.platform,
        accountId: args.accountId,
        entityId: args.entityId || args.campaignId || args.adsetId,
        entityName: args.entityName || args.name,
        params: args,
        reason: args.reason,
        status: 'pending',
      })
      return {
        actionId: action._id.toString(),
        status: 'pending',
        message: `操作已提交审批：${args.reason}`,
      }
    },
  }
}

const proposeCreateCampaign = makeProposeTool({
  name: 'propose_create_campaign',
  desc: '提议创建新的广告系列',
  type: 'create_campaign',
  params: {
    name: S.str('广告系列名称'),
    objective: S.enum('广告目标', ['OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_TRAFFIC', 'OUTCOME_APP_PROMOTION']),
    dailyBudget: S.num('日预算（USD）'),
    countries: S.arr('目标国家', S.str('国家代码')),
    bidStrategy: S.enum('出价策略', ['LOWEST_COST_WITHOUT_CAP', 'COST_CAP']),
  },
  required: ['name', 'objective', 'dailyBudget'],
})

const proposeAdjustBudget = makeProposeTool({
  name: 'propose_adjust_budget',
  desc: '提议调整广告系列或广告组的日预算',
  type: 'adjust_budget',
  params: {
    entityId: S.str('广告系列或广告组 ID'),
    entityName: S.str('实体名称'),
    currentBudget: S.num('当前日预算（USD）'),
    newBudget: S.num('建议的新日预算（USD）'),
  },
  required: ['entityId', 'newBudget'],
})

const proposePause = makeProposeTool({
  name: 'propose_pause',
  desc: '提议暂停一个广告系列、广告组或广告',
  type: 'pause',
  params: {
    entityId: S.str('要暂停的实体 ID'),
    entityName: S.str('实体名称'),
    entityType: S.enum('实体类型', ['campaign', 'adset', 'ad']),
  },
  required: ['entityId', 'entityType'],
})

const proposeResume = makeProposeTool({
  name: 'propose_resume',
  desc: '提议恢复（激活）一个已暂停的广告系列、广告组或广告',
  type: 'resume',
  params: {
    entityId: S.str('要恢复的实体 ID'),
    entityName: S.str('实体名称'),
    entityType: S.enum('实体类型', ['campaign', 'adset', 'ad']),
  },
  required: ['entityId', 'entityType'],
})

export const writeTools: ToolDef[] = [
  proposeCreateCampaign,
  proposeAdjustBudget,
  proposePause,
  proposeResume,
]
