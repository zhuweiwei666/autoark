/**
 * A5 超级 Agent 工具集 — 6 个自身工具 + 4 个跨 Agent 调度工具
 *
 * A5 作为总指挥，可以调度 A1-A4 所有 Agent 的核心能力：
 * - A1 数据融合：query_campaigns
 * - A2 决策分析：run_decision
 * - A3 执行路由：execute_campaign_action
 * - A4 全局治理：check_global_roas
 */
import axios from 'axios'
import dayjs from 'dayjs'
import { ToolDef, S } from '../tools'
import { Skill, AgentSkillDoc, matchesCampaign, evaluateConditions, fillReasonTemplate } from '../skill.model'
import { Action } from '../../action/action.model'
import { Knowledge } from '../librarian.model'
import { getReflectionStats } from '../reflection'
import { runEvolution } from '../evolution'
import { log } from '../../platform/logger'
import { fuseRecords, FBSourceRecord, MBSourceRecord } from '../data-fusion'

const FB_GRAPH = 'https://graph.facebook.com/v21.0'

const HIGH_RISK_FIELDS = new Set(['enabled', 'decision.auto'])

const listSkillsTool: ToolDef = {
  name: 'list_skills',
  description: '列出指定 Agent 或全部 Agent 的 Skills 配置。不传 agentId 则列出全部。',
  parameters: S.obj('参数', {
    agentId: S.str('Agent ID (a1_fusion / a2_decision / a4_governor 等)，不传则列出全部'),
  }),
  handler: async (args) => {
    const query: any = {}
    if (args.agentId) query.agentId = args.agentId
    const skills = await Skill.find(query).sort({ agentId: 1, order: 1 }).lean() as any[]
    return {
      skills: skills.map(s => ({
        name: s.name,
        agentId: s.agentId,
        type: s.skillType || 'rule',
        enabled: s.enabled,
        description: s.description,
        stats: s.stats,
        ...(s.goal ? { goal: s.goal } : {}),
        ...(s.experience ? { experience: s.experience } : {}),
        ...(s.screening ? { screening: { conditions: s.screening.conditions, verdict: s.screening.verdict } } : {}),
        ...(s.decision ? { decision: { action: s.decision.action, auto: s.decision.auto, conditions: s.decision.conditions } } : {}),
        learnedNotes: (s.learnedNotes || []).slice(-3),
      })),
      count: skills.length,
    }
  },
}

const modifySkillTool: ToolDef = {
  name: 'modify_skill',
  description: `修改一个 Skill 的配置。低风险修改（数值阈值如 roasFloor、spendTarget）直接执行；高风险修改（enabled、decision.auto）返回确认请求。
字段路径示例: "goal.roasFloor", "goal.dailySpendTarget", "enabled", "decision.auto", "screening.conditions[0].value"`,
  parameters: S.obj('参数', {
    skillName: S.str('Skill 名称（支持模糊匹配）'),
    changes: S.str('修改内容的 JSON 字符串，格式: {"字段路径": 新值}'),
  }, ['skillName', 'changes']),
  handler: async (args) => {
    let changes: Record<string, any>
    try {
      changes = typeof args.changes === 'string' ? JSON.parse(args.changes) : args.changes
    } catch {
      return { error: '无法解析 changes JSON' }
    }

    const skill = await Skill.findOne({
      $or: [
        { name: { $regex: args.skillName, $options: 'i' } },
        { name: args.skillName },
      ],
    }).lean() as any

    if (!skill) return { error: `未找到 Skill "${args.skillName}"` }

    const isHighRisk = Object.keys(changes).some(k => HIGH_RISK_FIELDS.has(k))

    if (isHighRisk) {
      const before: Record<string, any> = {}
      for (const path of Object.keys(changes)) {
        before[path] = getNestedValue(skill, path)
      }
      return {
        needsConfirm: true,
        skillId: skill._id.toString(),
        skillName: skill.name,
        agentId: skill.agentId,
        before,
        after: changes,
        description: `高风险修改 ${skill.name}: ${Object.keys(changes).join(', ')}`,
      }
    }

    const update: Record<string, any> = {}
    for (const [path, value] of Object.entries(changes)) {
      update[path] = value
    }
    await Skill.updateOne({ _id: skill._id }, { $set: update })
    log.info(`[A5] Auto-applied skill change: ${skill.name} ${JSON.stringify(changes)}`)

    return {
      applied: true,
      skillName: skill.name,
      agentId: skill.agentId,
      changes,
      message: `已修改 ${skill.name}`,
    }
  },
}

const viewReflectionStatsTool: ToolDef = {
  name: 'view_reflection_stats',
  description: '查看最近 N 天的决策反思统计：正确率、错误数、错误模式。用于发现系统哪里需要改进。',
  parameters: S.obj('参数', {
    days: S.int('统计天数（默认 7）'),
  }),
  handler: async (args) => {
    const days = args.days || 7
    const stats = await getReflectionStats(days)

    const since = dayjs().subtract(days, 'day').toDate()
    const wrongActions = await Action.find({
      status: 'executed',
      'params.reflected': true,
      'params.reflection.assessment': 'wrong',
      executedAt: { $gte: since },
    }).sort({ executedAt: -1 }).limit(10).lean()

    const wrongPatterns = wrongActions.map((a: any) => ({
      type: a.type,
      campaign: a.entityName,
      reason: a.reason?.substring(0, 60),
      reflectionReason: a.params?.reflection?.reason?.substring(0, 80),
      lesson: a.params?.reflection?.lesson?.substring(0, 80),
      skill: a.params?.skillName,
    }))

    return { stats, wrongPatterns, period: `最近 ${days} 天` }
  },
}

const triggerEvolutionTool: ToolDef = {
  name: 'trigger_evolution',
  description: '主动触发进化分析。分析最近 7 天的决策效果，发现模式，生成优化提议。提议包含自动应用的结果。',
  parameters: S.obj('参数', {}),
  handler: async () => {
    const proposals = await runEvolution()
    return {
      proposals: proposals.map(p => ({
        type: p.type,
        description: p.description,
        reason: p.reason,
        confidence: p.confidence,
      })),
      count: proposals.length,
      message: proposals.length > 0
        ? `生成 ${proposals.length} 条优化提议`
        : '当前数据不足或无需优化',
    }
  },
}

const queryKnowledgeTool: ToolDef = {
  name: 'query_knowledge',
  description: '查询知识库中的经验教训和洞察。可按标签过滤。',
  parameters: S.obj('参数', {
    category: S.str('类别过滤: decision_lesson / skill_insight / user_preference / product_pattern'),
    limit: S.int('返回数量（默认 10）'),
  }),
  handler: async (args) => {
    const query: any = { archived: { $ne: true } }
    if (args.category) query.category = args.category
    const knowledge = await Knowledge.find(query)
      .sort({ confidence: -1 })
      .limit(args.limit || 10)
      .lean()

    return {
      knowledge: knowledge.map((k: any) => ({
        key: k.key,
        category: k.category,
        content: k.content,
        confidence: k.confidence,
        validations: k.validations,
        tags: k.tags,
        updatedAt: k.updatedAt,
      })),
      count: knowledge.length,
    }
  },
}

const viewSystemStatusTool: ToolDef = {
  name: 'view_system_status',
  description: '查看系统当前状态：最近一轮循环结果、活跃 Skill 统计、全局 ROAS、最近执行的操作。',
  parameters: S.obj('参数', {}),
  handler: async () => {
    const recentActions = await Action.find({
      status: { $in: ['executed', 'approved', 'rejected', 'pending'] },
      createdAt: { $gte: dayjs().subtract(24, 'hour').toDate() },
    }).sort({ createdAt: -1 }).limit(20).lean()

    const executed = recentActions.filter((a: any) => a.status === 'executed')
    const pending = recentActions.filter((a: any) => a.status === 'pending')
    const rejected = recentActions.filter((a: any) => a.status === 'rejected')

    const enabledSkills = await Skill.countDocuments({ enabled: true })
    const totalSkills = await Skill.countDocuments({})

    const reflectionStats = await getReflectionStats(7)

    return {
      last24h: {
        executed: executed.length,
        pending: pending.length,
        rejected: rejected.length,
        recentActions: executed.slice(0, 5).map((a: any) => ({
          type: a.type,
          entity: a.entityName || a.entityId,
          reason: a.reason?.substring(0, 60),
          at: a.executedAt,
        })),
      },
      skills: { enabled: enabledSkills, total: totalSkills },
      reflectionStats,
    }
  },
}

function getNestedValue(obj: any, path: string): any {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  let current = obj
  for (const part of parts) {
    if (current == null) return undefined
    current = current[part]
  }
  return current
}

// ==================== 跨 Agent 调度工具 ====================

const queryCampaignsTool: ToolDef = {
  name: 'query_campaigns',
  description: `[调度A1] 拉取 Facebook + Metabase 融合后的 campaign 数据。返回每个 campaign 的花费、ROAS、安装量、CPI 等。
支持按名称/状态/花费过滤。这是 A2 决策时看到的同一份数据。`,
  parameters: S.obj('参数', {
    nameFilter: S.str('按 campaign 名称过滤（模糊匹配，如 "funce"、"ydl"）'),
    statusFilter: S.enum('状态过滤', ['ACTIVE', 'PAUSED', 'ALL']),
    minSpend: S.num('最低花费过滤（美元）'),
  }),
  handler: async () => {
    const fbToken = process.env.FB_ACCESS_TOKEN
    if (!fbToken) return { error: '无 FB_ACCESS_TOKEN，无法拉取数据' }

    try {
      const { getAgentConfig } = await import('../agent-config.model')
      const fusionSkills = await Skill.find({ agentId: 'a1_fusion', enabled: true }).lean() as any[]
      const optimizerSkill = fusionSkills.find((s: any) => s.name === 'A1 优化师范围')
      const optimizers: string[] = optimizerSkill?.config?.value || ['wwz']

      const accountsRes = await axios.get(`${FB_GRAPH}/me/adaccounts`, {
        params: { fields: 'id,account_id,name', limit: 200, access_token: fbToken },
        timeout: 15000,
      })

      const fbRecords: FBSourceRecord[] = []
      for (const acc of accountsRes.data?.data || []) {
        try {
          const campRes = await axios.get(`${FB_GRAPH}/${acc.id}/campaigns`, {
            params: {
              fields: 'id,name,status,daily_budget,effective_status',
              filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] }]),
              limit: 500, access_token: fbToken,
            },
            timeout: 15000,
          })
          for (const camp of campRes.data?.data || []) {
            const parts = camp.name.split('_')
            const optimizer = (parts[0] || '').toLowerCase()
            if (!optimizers.includes(optimizer)) continue

            let spend = 0, roas = 0, conversions = 0, revenue = 0
            try {
              const insRes = await axios.get(`${FB_GRAPH}/${camp.id}/insights`, {
                params: { fields: 'spend,actions,action_values,purchase_roas', date_preset: 'today', access_token: fbToken },
                timeout: 10000,
              })
              const ins = insRes.data?.data?.[0]
              if (ins) {
                spend = Number(ins.spend || 0)
                const instAction = (ins.actions || []).find((a: any) => a.action_type === 'app_install' || a.action_type === 'omni_app_install')
                conversions = instAction ? Number(instAction.value || 0) : 0
                const purchaseRoas = ins.purchase_roas?.find((a: any) => a.action_type === 'omni_purchase')
                if (purchaseRoas) roas = Number(purchaseRoas.value || 0)
                const purchaseValue = (ins.action_values || []).find((a: any) => a.action_type === 'omni_purchase')
                if (purchaseValue) { revenue = Number(purchaseValue.value || 0); if (roas === 0 && spend > 0) roas = revenue / spend }
              }
            } catch { /* skip insights */ }

            fbRecords.push({
              campaignId: camp.id, campaignName: camp.name, accountId: acc.account_id, accountName: acc.name || '',
              status: camp.effective_status || camp.status, dailyBudget: camp.daily_budget ? Number(camp.daily_budget) / 100 : 0,
              spend, impressions: 0, clicks: 0, conversions, roas, cpi: conversions > 0 ? spend / conversions : 0,
              ctr: 0, revenue, optimizer, pkgName: parts.length >= 3 ? parts[2] : '', platform: 'facebook',
            })
          }
        } catch { /* skip account */ }
      }

      return {
        campaigns: fbRecords.map(c => ({
          id: c.campaignId, name: c.campaignName, account: c.accountId, status: c.status,
          spend: Number(c.spend.toFixed(2)), roas: Number(c.roas.toFixed(2)),
          installs: c.conversions, cpi: Number(c.cpi.toFixed(2)), budget: c.dailyBudget,
          optimizer: c.optimizer, pkg: c.pkgName,
        })),
        count: fbRecords.length,
        note: '数据来自 Facebook API 实时拉取。用 nameFilter/statusFilter/minSpend 参数在你的分析中自行过滤。',
      }
    } catch (e: any) {
      return { error: `数据拉取失败: ${e.message}` }
    }
  },
}

const runDecisionTool: ToolDef = {
  name: 'run_decision',
  description: `[调度A2] 对当前所有 campaign 跑一次 Skill 规则引擎评估（不调 LLM），返回每个 campaign 的筛选结果和建议操作。
用途：让 A5 了解 A2 的规则引擎会对哪些 campaign 触发什么操作。`,
  parameters: S.obj('参数', {
    campaignIds: S.str('指定 campaign ID 列表（逗号分隔），不传则评估全部'),
  }),
  handler: async (args) => {
    try {
      const screenerSkills = await Skill.find({ agentId: { $in: ['screener', 'a2_decision'] }, skillType: { $in: ['rule', undefined, null] }, enabled: true }).sort({ order: 1 }).lean() as AgentSkillDoc[]
      const decisionSkills = await Skill.find({ agentId: { $in: ['decision', 'a2_decision'] }, 'decision.action': { $exists: true }, enabled: true }).sort({ order: 1 }).lean() as AgentSkillDoc[]

      const filterIds = args.campaignIds ? args.campaignIds.split(',').map((s: string) => s.trim()) : null

      const recentActions = await Action.find({
        status: { $in: ['executed', 'approved'] },
        createdAt: { $gte: dayjs().subtract(2, 'hour').toDate() },
      }).lean()
      const recentIds = new Set(recentActions.map((a: any) => a.entityId).filter(Boolean))

      const results: any[] = []

      const queryCampaignResult = await queryCampaignsTool.handler({}, { userId: 'a5', conversationId: 'a5', getToken: async () => null })
      const campaigns = queryCampaignResult.campaigns || []

      for (const c of campaigns) {
        if (filterIds && !filterIds.includes(c.id)) continue
        if (recentIds.has(c.id)) { results.push({ id: c.id, name: c.name, verdict: 'cooldown', reason: '2h 内已操作' }); continue }

        const data = { ...c, todaySpend: c.spend, adjustedRoi: c.roas, todayRoas: c.roas, installs: c.installs, campaignId: c.id, campaignName: c.name, accountId: c.account }

        let matched = false
        for (const skill of screenerSkills) {
          if (skill.screening?.conditions?.length) {
            if (evaluateConditions(skill.screening.conditions, skill.screening.conditionLogic, data)) {
              results.push({ id: c.id, name: c.name, verdict: skill.screening.verdict, skill: skill.name, reason: fillReasonTemplate(skill.screening.reasonTemplate || skill.name, data) })
              matched = true
              break
            }
          }
        }
        if (matched) continue

        for (const skill of decisionSkills) {
          const d = skill.decision
          if (!d?.action) continue
          const condMatch = d.conditions?.length > 0 ? evaluateConditions(d.conditions, d.conditionLogic, data) : false
          if (condMatch) {
            results.push({ id: c.id, name: c.name, verdict: 'needs_decision', action: d.action, auto: d.auto, skill: skill.name, reason: fillReasonTemplate(d.reasonTemplate || skill.name, data) })
            matched = true
            break
          }
        }

        if (!matched) results.push({ id: c.id, name: c.name, verdict: 'watch', reason: '无 Skill 命中，默认观察' })
      }

      return { evaluations: results, count: results.length, skillsUsed: { screener: screenerSkills.length, decision: decisionSkills.length } }
    } catch (e: any) {
      return { error: `决策评估失败: ${e.message}` }
    }
  },
}

const executeCampaignActionTool: ToolDef = {
  name: 'execute_campaign_action',
  description: `[调度A3] 通过 Facebook API 执行广告操作（暂停/恢复/调预算）。所有操作都需要用户在飞书确认后才执行（返回 needsConfirm）。`,
  parameters: S.obj('参数', {
    campaignId: S.str('Campaign ID'),
    campaignName: S.str('Campaign 名称（用于展示）'),
    action: S.enum('操作类型', ['pause', 'resume', 'adjust_budget']),
    reason: S.str('操作原因'),
    newBudget: S.num('新预算金额（adjust_budget 时必填，单位美元）'),
  }, ['campaignId', 'action', 'reason']),
  handler: async (args) => {
    return {
      needsConfirm: true,
      skillId: `action_${args.campaignId}`,
      skillName: args.campaignName || args.campaignId,
      agentId: 'a3_executor',
      before: { status: args.action === 'pause' ? 'ACTIVE' : args.action === 'resume' ? 'PAUSED' : `budget → $${args.newBudget || '?'}` },
      after: { action: args.action, ...(args.newBudget ? { newBudget: args.newBudget } : {}) },
      description: `${args.action} ${args.campaignName || args.campaignId}: ${args.reason}`,
      _executeData: { campaignId: args.campaignId, action: args.action, reason: args.reason, newBudget: args.newBudget },
    }
  },
}

const checkGlobalRoasTool: ToolDef = {
  name: 'check_global_roas',
  description: `[调度A4] 拉取 Metabase 收入数据，计算全局 ROAS，检查是否触发 A4 的止损/补量规则。返回各产品的 ROAS 明细和风控状态。`,
  parameters: S.obj('参数', {}),
  handler: async () => {
    try {
      const mbSess = await axios.post('https://meta.iohubonline.club/api/session', {
        username: process.env.METABASE_EMAIL, password: process.env.METABASE_PASSWORD,
      })
      const mbTok = mbSess.data.id

      const fusionSkills = await Skill.find({ agentId: 'a1_fusion', enabled: true }).lean() as any[]
      const optimizerSkill = fusionSkills.find((s: any) => s.name === 'A1 优化师范围')
      const optimizers: string[] = optimizerSkill?.config?.value || ['wwz']

      const mbRes = await axios.post('https://meta.iohubonline.club/api/card/3822/query', {
        parameters: [
          { type: 'text', value: 'VfuSBdaO33sklvtr', target: ['variable', ['template-tag', 'access_code']] },
          { type: 'date/single', value: dayjs().format('YYYY-MM-DD'), target: ['variable', ['template-tag', 'start_day']] },
          { type: 'date/single', value: dayjs().format('YYYY-MM-DD'), target: ['variable', ['template-tag', 'end_day']] },
          { type: 'text', value: optimizers.join(',') || 'wwz', target: ['variable', ['template-tag', 'user_name']] },
        ],
      }, { headers: { 'X-Metabase-Session': mbTok }, timeout: 30000 })

      const mbData = mbRes.data?.data
      const mbCols = (mbData?.cols || []).map((c: any) => c.name)
      const ci = (name: string) => mbCols.indexOf(name)

      let totalRevenue = 0
      const products: any[] = []
      for (const r of mbData?.rows || []) {
        const date = r[ci('日期')]
        const pkg = r[ci('包名')]
        if (!date || date === '汇总' || !pkg || pkg === 'ALL') continue
        const rev = Number(r[ci('调整的首日收入')] || 0)
        totalRevenue += rev
        products.push({ product: pkg, revenue: Number(rev.toFixed(2)) })
      }

      const a4Goals = await Skill.find({ agentId: 'a4_governor', skillType: 'goal', enabled: true }).lean() as any[]
      const goals = a4Goals.map((g: any) => ({
        name: g.name, product: g.goal?.product, roasFloor: g.goal?.roasFloor,
        spendTarget: g.goal?.dailySpendTarget, priority: g.goal?.priority,
      }))

      return {
        totalRevenue: Number(totalRevenue.toFixed(2)),
        products,
        a4Goals: goals,
        note: '花费数据需要结合 query_campaigns 的结果计算 ROAS = revenue / spend',
      }
    } catch (e: any) {
      return { error: `A4 数据拉取失败: ${e.message}` }
    }
  },
}

export const a5Tools: ToolDef[] = [
  listSkillsTool,
  modifySkillTool,
  viewReflectionStatsTool,
  triggerEvolutionTool,
  queryKnowledgeTool,
  viewSystemStatusTool,
  queryCampaignsTool,
  runDecisionTool,
  executeCampaignActionTool,
  checkGlobalRoasTool,
]
