/**
 * TopTou 工具 - 通过 TopTou 平台查询和操作 Facebook 广告
 * 批量激活工具使用 Facebook Marketing API 直接执行（能查到所有状态的广告）
 */
import axios from 'axios'
import { ToolDef, S } from '../tools'
import * as toptouApi from '../../platform/toptou/api'
import { log } from '../../platform/logger'

const FB_GRAPH = 'https://graph.facebook.com/v21.0'

// ==================== Facebook Marketing API 直接工具（第一优先）====================

const fb_query: ToolDef = {
  name: 'fb_query',
  description: `直接调用 Facebook Marketing API 查询任何广告信息。这是最强大的查询工具，能查到所有状态的广告。
Token 已配置，无需传入。
常用查询示例：
- 查账户列表: endpoint="me/adaccounts", fields="id,name,account_id,account_status,balance,amount_spent,currency"
- 查某账户的 campaign: endpoint="act_{accountId}/campaigns", fields="id,name,status,daily_budget,budget_remaining,created_time"
- 查某 campaign 的 adset: endpoint="{campaignId}/adsets", fields="id,name,status,daily_budget,optimization_goal"
- 查某 adset 的 ad: endpoint="{adsetId}/ads", fields="id,name,status,effective_status,creative{thumbnail_url}"
- 查某广告的审核状态: endpoint="{adId}", fields="id,name,status,effective_status,ad_review_feedback"
- 查某实体的 insights: endpoint="{entityId}/insights", fields="spend,impressions,clicks,actions,cpc,cpm,ctr", params 传 date_preset="today"
始终优先使用此工具而非 TopTou。`,
  parameters: S.obj('参数', {
    endpoint: S.str('API 端点路径，如 "me/adaccounts" 或 "{campaignId}/adsets"'),
    fields: S.str('返回字段，逗号分隔'),
    params: S.str('额外查询参数，JSON 格式，如 {"limit":"100","date_preset":"today"}'),
  }, ['endpoint']),
  handler: async (args) => {
    const fbToken = process.env.FB_ACCESS_TOKEN
    if (!fbToken) return { error: 'FB_ACCESS_TOKEN 未配置，请降级使用 toptou_* 工具' }

    try {
      const queryParams: any = { access_token: fbToken }
      if (args.fields) queryParams.fields = args.fields
      if (args.params) {
        try {
          const extra = typeof args.params === 'string' ? JSON.parse(args.params) : args.params
          Object.assign(queryParams, extra)
        } catch { /* ignore parse error */ }
      }
      if (!queryParams.limit) queryParams.limit = 200

      const res = await axios.get(`${FB_GRAPH}/${args.endpoint}`, { params: queryParams, timeout: 30000 })
      const data = res.data?.data || res.data
      const count = Array.isArray(data) ? data.length : 1
      return { data, count, hasMore: !!res.data?.paging?.next }
    } catch (e: any) {
      const errMsg = e.response?.data?.error?.message || e.message
      return { error: `Facebook API 错误: ${errMsg}。可降级使用 toptou_* 工具重试。` }
    }
  },
}

const fb_update: ToolDef = {
  name: 'fb_update',
  description: `直接通过 Facebook Marketing API 更新广告实体（campaign/adset/ad）的任何属性。
常用操作：
- 暂停: entityId="{id}", updates={"status":"PAUSED"}
- 激活: entityId="{id}", updates={"status":"ACTIVE"}
- 改预算: entityId="{id}", updates={"daily_budget":"1000"} (单位美分，$10=1000)
- 改名称: entityId="{id}", updates={"name":"新名称"}
直接执行无需审批。始终优先使用此工具。`,
  parameters: S.obj('参数', {
    entityId: S.str('要更新的实体 ID（campaign/adset/ad ID）'),
    updates: S.str('更新内容，JSON 格式，如 {"status":"ACTIVE","daily_budget":"1000"}'),
  }, ['entityId', 'updates']),
  handler: async (args) => {
    const fbToken = process.env.FB_ACCESS_TOKEN
    if (!fbToken) return { error: 'FB_ACCESS_TOKEN 未配置' }

    try {
      const params: any = { access_token: fbToken }
      const updates = typeof args.updates === 'string' ? JSON.parse(args.updates) : args.updates
      Object.assign(params, updates)

      const res = await axios.post(`${FB_GRAPH}/${args.entityId}`, null, { params, timeout: 15000 })
      if (res.data?.success) {
        log.info(`[FB_Update] Updated ${args.entityId}: ${JSON.stringify(updates)}`)
        return { success: true, entityId: args.entityId, updates }
      }
      return { success: false, response: res.data }
    } catch (e: any) {
      const errMsg = e.response?.data?.error?.message || e.message
      log.warn(`[FB_Update] Failed ${args.entityId}: ${errMsg}`)
      return { error: `Facebook API 错误: ${errMsg}` }
    }
  },
}

// ==================== TopTou 工具（备选，Facebook API 不可用时降级使用）====================

const tt_getCampaigns: ToolDef = {
  name: 'toptou_get_campaigns',
  description: '【备选】通过 TopTou 获取 campaign 列表。注意：只返回活跃广告，查不到已暂停的。优先使用 fb_query。',
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
  description: '【备选】通过 TopTou 获取 campaign 详情。优先使用 fb_query。',
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
  description: '【备选】通过 TopTou 获取 adset 列表。优先使用 fb_query。',
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
  description: '【备选】通过 TopTou 获取广告详情。优先使用 fb_query。',
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
  description: '【备选】通过 TopTou 提议暂停/恢复，需审批。优先使用 fb_update 直接执行。',
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
  description: '【备选】通过 TopTou 提议调预算，需审批。优先使用 fb_batch_update_budget 或 fb_update 直接执行。',
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
可传多个关键词用逗号分隔，将取交集匹配。
重要：用户已明确指示要激活，直接执行无需预览或二次确认。dryRun 默认 false。`,
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
可传多个关键词用逗号分隔，将取交集匹配。预算单位为美元（会自动转为美分传给 API）。
重要：用户已明确指示要调整，直接执行无需预览或二次确认。dryRun 默认 false。`,
  parameters: S.obj('参数', {
    keywords: S.str('逗号分隔的匹配关键词，如 "wwz,funce,0224"'),
    dailyBudgetUsd: S.num('新的日预算（美元），例如 10 表示 $10/天'),
    dryRun: S.bool('仅预览不执行（默认 false，通常不需要设为 true）'),
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

// ==================== AI 接管管理 ====================

const manageAutoOptimizers: ToolDef = {
  name: 'manage_auto_optimizers',
  description: `管理 AI 全权接管的优化师名单。被接管的优化师，其所有广告的操作（暂停、加预算、调预算、恢复）由 AI 自动执行，无需人工审批。
操作：
- action="list": 查看当前接管名单
- action="add", optimizer="wwz": 添加优化师到接管名单
- action="remove", optimizer="wwz": 从接管名单移除`,
  parameters: S.obj('参数', {
    action: S.enum('操作', ['list', 'add', 'remove']),
    optimizer: S.str('优化师缩写（add/remove 时必填）'),
  }, ['action']),
  handler: async (args) => {
    const mongoose = (await import('mongoose')).default
    const db = mongoose.connection.db
    if (!db) return { error: 'Database not connected' }

    const config = await db.collection('agentconfig2s').findOne({ agentId: 'executor' })
    const current: string[] = config?.executor?.scope?.optimizers || []

    if (args.action === 'list') {
      return {
        autoManagedOptimizers: current,
        count: current.length,
        message: current.length > 0
          ? `当前 AI 接管的优化师: ${current.join(', ')}`
          : '当前没有 AI 接管的优化师，所有操作需人工审批',
      }
    }

    if (!args.optimizer) return { error: '请指定优化师缩写' }
    const opt = args.optimizer.toLowerCase()

    if (args.action === 'add') {
      if (current.includes(opt)) return { message: `${opt} 已在接管名单中` }
      const updated = [...current, opt]
      await db.collection('agentconfig2s').updateOne(
        { agentId: 'executor' },
        { $set: { 'executor.scope.optimizers': updated } },
        { upsert: true }
      )
      log.info(`[AutoManage] Added optimizer: ${opt}`)
      return { message: `已将 ${opt} 加入 AI 接管名单，其所有广告操作将自动执行`, list: updated }
    }

    if (args.action === 'remove') {
      const updated = current.filter(o => o !== opt)
      await db.collection('agentconfig2s').updateOne(
        { agentId: 'executor' },
        { $set: { 'executor.scope.optimizers': updated } }
      )
      log.info(`[AutoManage] Removed optimizer: ${opt}`)
      return { message: `已将 ${opt} 从 AI 接管名单移除，后续操作需人工审批`, list: updated }
    }

    return { error: '未知操作' }
  },
}

export const toptouTools: ToolDef[] = [
  // Facebook API 直接工具（第一优先）
  fb_query,
  fb_update,
  tt_batchActivate,
  tt_batchBudget,
  // AI 接管管理
  manageAutoOptimizers,
  // TopTou 备选工具
  tt_getBaseInfo,
  tt_getCampaigns,
  tt_getCampaignDetails,
  tt_getAdSets,
  tt_getAdDetails,
  tt_updateStatus,
  tt_updateBudget,
]
