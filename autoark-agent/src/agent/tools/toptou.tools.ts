/**
 * TopTou 工具 - 通过 TopTou 平台查询和操作 Facebook 广告
 * 批量激活工具使用 Facebook Marketing API 直接执行（能查到所有状态的广告）
 */
import axios from 'axios'
import { ToolDef, S } from '../tools'
import * as toptouApi from '../../platform/toptou/api'
import { log } from '../../platform/logger'

const FB_GRAPH = 'https://graph.facebook.com/v21.0'

const tt_getCampaigns: ToolDef = {
  name: 'toptou_get_campaigns',
  description: '通过 TopTou 获取 Facebook 广告系列列表，返回 campaignId、accountId、名称等信息',
  parameters: S.obj('参数', {
    pageSize: S.int('每页数量（默认 50）'),
    pageNum: S.int('页码（默认 1）'),
  }),
  handler: async (args) => {
    const res = await toptouApi.getCampaignList({
      pageSize: args.pageSize || 50,
      pageNum: args.pageNum || 1,
    })
    if (res.code !== 200) return { error: res.msg }
    return { campaigns: res.data, count: res.data?.length || 0 }
  },
}

const tt_getCampaignDetails: ToolDef = {
  name: 'toptou_get_campaign_details',
  description: '通过 TopTou 获取广告系列详情，包括预算、状态、目标等',
  parameters: S.obj('参数', {
    campaignId: S.str('广告系列 ID'),
  }, ['campaignId']),
  handler: async (args) => {
    const res = await toptouApi.getCampaignDetails(args.campaignId)
    if (res.code !== 200) return { error: res.msg }
    return res.data
  },
}

const tt_getAdSets: ToolDef = {
  name: 'toptou_get_adsets',
  description: '通过 TopTou 获取某广告系列下的广告组列表',
  parameters: S.obj('参数', {
    campaignId: S.str('广告系列 ID'),
  }, ['campaignId']),
  handler: async (args) => {
    const res = await toptouApi.getAdSetsByCampaign(args.campaignId)
    if (res.code !== 200) return { error: res.msg }
    return { adsets: res.data, count: Array.isArray(res.data) ? res.data.length : 0 }
  },
}

const tt_getAdDetails: ToolDef = {
  name: 'toptou_get_ad_details',
  description: '通过 TopTou 获取广告详情',
  parameters: S.obj('参数', {
    adId: S.str('广告 ID'),
  }, ['adId']),
  handler: async (args) => {
    const res = await toptouApi.getAdDetails(args.adId)
    if (res.code !== 200) return { error: res.msg }
    return res.data
  },
}

const tt_getBaseInfo: ToolDef = {
  name: 'toptou_get_base_info',
  description: '获取 TopTou 基础信息（公司信息、权限等）',
  parameters: S.obj('参数', {}),
  handler: async () => {
    const res = await toptouApi.getBaseInfo()
    if (res.code !== 200) return { error: res.msg }
    return res.data
  },
}

const tt_updateStatus: ToolDef = {
  name: 'propose_toptou_update_status',
  description: '提议通过 TopTou 暂停或恢复广告系列/广告组/广告。操作需要审批后执行。',
  parameters: S.obj('参数', {
    level: S.enum('操作层级', ['campaign', 'adset', 'ad']),
    entityId: S.str('实体 ID'),
    accountId: S.str('广告账户 ID'),
    entityName: S.str('实体名称'),
    status: S.enum('目标状态', ['ACTIVE', 'PAUSED']),
    reason: S.str('操作原因'),
  }, ['level', 'entityId', 'accountId', 'status', 'reason']),
  handler: async (args, ctx) => {
    // 写操作走审批队列
    const { Action } = await import('../../action/action.model')
    const action = await Action.create({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      type: args.status === 'PAUSED' ? 'pause' : 'resume',
      platform: 'facebook',
      accountId: args.accountId,
      entityId: args.entityId,
      entityName: args.entityName,
      params: { level: args.level, status: args.status, source: 'toptou' },
      reason: args.reason,
      status: 'pending',
    })
    return { actionId: action._id.toString(), status: 'pending', message: `操作已提交审批：${args.reason}` }
  },
}

const tt_updateBudget: ToolDef = {
  name: 'propose_toptou_update_budget',
  description: '提议通过 TopTou 调整广告系列/广告组的日预算。操作需要审批后执行。',
  parameters: S.obj('参数', {
    level: S.enum('操作层级', ['campaign', 'adset']),
    entityId: S.str('实体 ID'),
    accountId: S.str('广告账户 ID'),
    entityName: S.str('实体名称'),
    currentBudget: S.num('当前日预算（USD 分）'),
    newBudget: S.num('新日预算（USD 分）'),
    reason: S.str('调整原因'),
  }, ['level', 'entityId', 'accountId', 'newBudget', 'reason']),
  handler: async (args, ctx) => {
    const { Action } = await import('../../action/action.model')
    const action = await Action.create({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      type: 'adjust_budget',
      platform: 'facebook',
      accountId: args.accountId,
      entityId: args.entityId,
      entityName: args.entityName,
      params: { level: args.level, newBudget: args.newBudget, currentBudget: args.currentBudget, source: 'toptou' },
      reason: args.reason,
      status: 'pending',
    })
    return { actionId: action._id.toString(), status: 'pending', message: `预算调整已提交审批：${args.reason}` }
  },
}

const tt_batchActivate: ToolDef = {
  name: 'toptou_batch_activate',
  description: `按名称关键词批量激活（打开）campaign。使用 Facebook Marketing API 直接执行，能查到所有状态的广告（包括已暂停/已关闭的）。
campaign 命名规范：{优化师}_fb_{产品}_{地区}_{其他}_{日期}
例如：wwz_fb_funce_ios_0224 表示优化师 wwz、产品 funce、2月24日。
可传多个关键词用逗号分隔，将取交集匹配。激活操作直接执行无需审批。`,
  parameters: S.obj('参数', {
    keywords: S.str('逗号分隔的匹配关键词，如 "wwz,funce,0224"。所有关键词必须同时命中才匹配。'),
    dryRun: S.bool('仅预览匹配结果不执行（默认 false）'),
  }, ['keywords']),
  handler: async (args) => {
    const fbToken = process.env.FB_ACCESS_TOKEN
    if (!fbToken) return { error: 'FB_ACCESS_TOKEN 未配置' }

    const keywords = (args.keywords as string).split(',').map((k: string) => k.trim().toLowerCase()).filter(Boolean)
    if (keywords.length === 0) return { error: '请提供至少一个匹配关键词' }

    const { campaigns: matched, accounts } = await fbSearchCampaigns(fbToken, keywords)

    if (matched.length === 0) {
      return { matched: 0, message: `在 ${accounts} 个账户中未找到同时包含 [${keywords.join(', ')}] 的广告` }
    }

    if (args.dryRun) {
      return {
        dryRun: true,
        matched: matched.length,
        campaigns: matched.map((c: any) => ({ id: c.id, name: c.name, status: c.status, account: c.accountName })),
      }
    }

    // 通过 Facebook API 激活
    const activated: any[] = []
    const failed: any[] = []
    const skipped: any[] = []

    for (const c of matched) {
      if (c.status === 'ACTIVE') {
        skipped.push({ id: c.id, name: c.name, reason: '已经是 ACTIVE 状态' })
        continue
      }
      try {
        await axios.post(`${FB_GRAPH}/${c.id}`, null, {
          params: { status: 'ACTIVE', access_token: fbToken },
        })
        activated.push({ id: c.id, name: c.name, account: c.accountName })
        log.info(`[BatchActivate] Activated: ${c.name} (${c.id})`)
      } catch (e: any) {
        const errMsg = e.response?.data?.error?.message || e.message
        failed.push({ id: c.id, name: c.name, error: errMsg })
        log.warn(`[BatchActivate] Failed: ${c.name} - ${errMsg}`)
      }
    }

    return {
      matched: matched.length,
      activated: activated.length,
      skipped: skipped.length,
      failed: failed.length,
      activatedCampaigns: activated.map((c: any) => c.name),
      skippedCampaigns: skipped,
      failedCampaigns: failed,
      message: `匹配 ${matched.length} 个 campaign，激活 ${activated.length} 个${skipped.length > 0 ? `，跳过 ${skipped.length} 个（已是活跃状态）` : ''}${failed.length > 0 ? `，失败 ${failed.length} 个` : ''}`,
    }
  },
}

// ==================== Facebook API: 批量调预算 ====================

async function fbSearchCampaigns(fbToken: string, keywords: string[]): Promise<{ campaigns: any[]; accounts: number }> {
  const accountsRes = await axios.get(`${FB_GRAPH}/me/adaccounts`, {
    params: { fields: 'id,account_id,name', limit: 200, access_token: fbToken },
  })
  const accounts = accountsRes.data?.data || []
  const allCampaigns: any[] = []

  for (const acc of accounts) {
    try {
      const campRes = await axios.get(`${FB_GRAPH}/${acc.id}/campaigns`, {
        params: { fields: 'id,name,status,daily_budget', limit: 500, access_token: fbToken },
      })
      const camps = (campRes.data?.data || []).map((c: any) => ({ ...c, accountId: acc.account_id, accountName: acc.name }))
      allCampaigns.push(...camps)
    } catch { /* skip */ }
  }

  const matched = allCampaigns.filter((c: any) => {
    const name = (c.name || '').toLowerCase()
    return keywords.every((kw: string) => name.includes(kw))
  })

  return { campaigns: matched, accounts: accounts.length }
}

const tt_batchBudget: ToolDef = {
  name: 'fb_batch_update_budget',
  description: `按名称关键词批量调整 campaign 日预算。使用 Facebook Marketing API 直接执行。
campaign 命名规范：{优化师}_fb_{产品}_{地区}_{其他}_{日期}
可传多个关键词用逗号分隔，将取交集匹配。预算单位为美元（会自动转为美分传给 API）。直接执行无需审批。`,
  parameters: S.obj('参数', {
    keywords: S.str('逗号分隔的匹配关键词，如 "wwz,funce,0224"'),
    dailyBudgetUsd: S.num('新的日预算（美元），例如 10 表示 $10/天'),
    dryRun: S.bool('仅预览匹配结果不执行（默认 false）'),
  }, ['keywords', 'dailyBudgetUsd']),
  handler: async (args) => {
    const fbToken = process.env.FB_ACCESS_TOKEN
    if (!fbToken) return { error: 'FB_ACCESS_TOKEN 未配置' }

    const keywords = (args.keywords as string).split(',').map((k: string) => k.trim().toLowerCase()).filter(Boolean)
    if (keywords.length === 0) return { error: '请提供至少一个匹配关键词' }

    const budgetUsd = Number(args.dailyBudgetUsd)
    if (!budgetUsd || budgetUsd <= 0) return { error: '预算必须大于 0' }
    const budgetCents = Math.round(budgetUsd * 100)

    const { campaigns: matched, accounts } = await fbSearchCampaigns(fbToken, keywords)

    if (matched.length === 0) {
      return { matched: 0, message: `在 ${accounts} 个账户中未找到同时包含 [${keywords.join(', ')}] 的 campaign` }
    }

    if (args.dryRun) {
      return {
        dryRun: true,
        matched: matched.length,
        newBudget: `$${budgetUsd}/day`,
        campaigns: matched.map((c: any) => ({
          name: c.name, status: c.status, account: c.accountName,
          currentBudget: c.daily_budget ? `$${(Number(c.daily_budget) / 100).toFixed(2)}` : 'unknown',
        })),
      }
    }

    const updated: any[] = []
    const failed: any[] = []

    for (const c of matched) {
      try {
        await axios.post(`${FB_GRAPH}/${c.id}`, null, {
          params: { daily_budget: budgetCents, access_token: fbToken },
        })
        const oldBudget = c.daily_budget ? `$${(Number(c.daily_budget) / 100).toFixed(2)}` : '?'
        updated.push({ id: c.id, name: c.name, account: c.accountName, oldBudget, newBudget: `$${budgetUsd}` })
        log.info(`[BatchBudget] Updated: ${c.name} → $${budgetUsd}/day`)
      } catch (e: any) {
        const errMsg = e.response?.data?.error?.message || e.message
        failed.push({ id: c.id, name: c.name, error: errMsg })
        log.warn(`[BatchBudget] Failed: ${c.name} - ${errMsg}`)
      }
    }

    return {
      matched: matched.length,
      updated: updated.length,
      failed: failed.length,
      newBudget: `$${budgetUsd}/day`,
      updatedCampaigns: updated.map((c: any) => `${c.name} (${c.oldBudget} → ${c.newBudget})`),
      failedCampaigns: failed,
      message: `匹配 ${matched.length} 个 campaign，已将 ${updated.length} 个的日预算调整为 $${budgetUsd}${failed.length > 0 ? `，${failed.length} 个失败` : ''}`,
    }
  },
}

export const toptouTools: ToolDef[] = [
  tt_getBaseInfo,
  tt_getCampaigns,
  tt_getCampaignDetails,
  tt_getAdSets,
  tt_getAdDetails,
  tt_updateStatus,
  tt_updateBudget,
  tt_batchActivate,
  tt_batchBudget,
]
