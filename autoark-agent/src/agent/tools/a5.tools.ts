/**
 * A5 知识管理 Agent 专属工具集
 *
 * 让 A5 通过 tool-calling 自主决定何时查看数据、修改 Skill、触发进化。
 * 风险分级：低风险直接执行，高风险返回 { needsConfirm: true } 由上层发卡片。
 */
import dayjs from 'dayjs'
import { ToolDef, S } from '../tools'
import { Skill } from '../skill.model'
import { Action } from '../../action/action.model'
import { Knowledge } from '../librarian.model'
import { getReflectionStats } from '../reflection'
import { runEvolution } from '../evolution'
import { log } from '../../platform/logger'

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

export const a5Tools: ToolDef[] = [
  listSkillsTool,
  modifySkillTool,
  viewReflectionStatsTool,
  triggerEvolutionTool,
  queryKnowledgeTool,
  viewSystemStatusTool,
]
