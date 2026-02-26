/**
 * Skill 编辑器 — 解析自然语言指令，生成修改预览，确认后写入
 *
 * 支持操作：modify / create / delete / toggle / list
 * 用 LLM 从用户自然语言中提取意图与参数
 */
import axios from 'axios'
import { env } from '../config/env'
import { log } from '../platform/logger'
import { Skill, AgentSkillDoc } from './skill.model'

export type SkillAction = 'modify' | 'create' | 'delete' | 'toggle' | 'list'

export interface SkillIntent {
  action: SkillAction
  skillName?: string
  changes?: Record<string, any>
  description?: string
  raw: string
}

export interface SkillDiff {
  skillId: string
  skillName: string
  agentId: string
  before: Record<string, any>
  after: Record<string, any>
  summary: string
}

const AGENT_ROLE_TO_SKILL_AGENT: Record<string, string[]> = {
  a1_fusion: ['a1_fusion'],
  a2_decision: ['a2_decision', 'screener', 'decision'],
  a3_executor: ['a3_executor', 'executor'],
  a4_governor: ['a4_governor'],
  a5_knowledge: ['a5_knowledge', 'auditor'],
}

/**
 * 用 LLM 解析用户的自然语言指令
 */
export async function parseSkillIntent(text: string, agentRole: string): Promise<SkillIntent> {
  const skillAgentIds = AGENT_ROLE_TO_SKILL_AGENT[agentRole] || ['decision']
  const skills = await Skill.find({ agentId: { $in: skillAgentIds } }).lean() as AgentSkillDoc[]

  const skillList = skills.map(s => {
    const parts = [`name="${s.name}"`, `enabled=${s.enabled}`]
    if (s.screening?.conditions?.length) {
      parts.push(`conditions=${JSON.stringify(s.screening.conditions)}`)
    }
    if (s.decision?.action) {
      parts.push(`action=${s.decision.action}`, `auto=${s.decision.auto}`)
      if (s.decision.conditions?.length) parts.push(`conditions=${JSON.stringify(s.decision.conditions)}`)
    }
    return parts.join(', ')
  }).join('\n')

  const prompt = `你是广告投放 Agent 的 Skill 管理助手。用户要修改 ${agentRole} 的规则。

当前该 Agent 的 Skills 列表：
${skillList || '(暂无 skills)'}

用户指令：${text}

请分析用户意图，输出严格 JSON：
{
  "action": "modify" | "create" | "delete" | "toggle" | "list",
  "skillName": "匹配到的 skill 名称（模糊匹配）",
  "changes": { "字段路径": "新值" },
  "description": "一句话描述这次修改"
}

字段路径示例：
- "screening.conditions[0].value" → 修改第一个条件的阈值
- "decision.auto" → 修改是否自动执行
- "enabled" → 启用/禁用
- "decision.conditions[0].value" → 修改决策条件阈值

如果是 list 操作，只需 { "action": "list" }。
如果是 toggle，changes 为 { "enabled": true/false }。
只输出 JSON，不要其他内容。`

  try {
    const res = await axios.post(
      `${env.LLM_BASE_URL}/chat/completions`,
      {
        model: env.LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 512,
      },
      {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LLM_API_KEY}` },
        timeout: 30000,
      },
    )

    const content = res.data.choices?.[0]?.message?.content || ''
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { action: 'list', raw: text, description: '无法解析指令，展示当前 skills' }
    }

    const parsed = JSON.parse(jsonMatch[0])
    return { ...parsed, raw: text }
  } catch (e: any) {
    log.error(`[SkillEditor] LLM parse failed: ${e.message}`)
    return { action: 'list', raw: text, description: 'LLM 不可用，展示当前 skills' }
  }
}

/**
 * 列出指定 Agent 角色的 Skills（格式化文本）
 */
export async function listSkills(agentRole: string): Promise<string> {
  const skillAgentIds = AGENT_ROLE_TO_SKILL_AGENT[agentRole] || ['decision']
  const skills = await Skill.find({ agentId: { $in: skillAgentIds } }).sort({ order: 1 }).lean() as AgentSkillDoc[]

  if (skills.length === 0) return '当前没有配置任何 Skill'

  return skills.map((s: any, i: number) => {
    const status = s.enabled ? '启用' : '禁用'
    const type = s.skillType || 'rule'
    let detail = ''

    if (type === 'experience' && s.experience) {
      const exp = s.experience
      detail = `场景: ${exp.scenario || '-'}\n   教训: ${exp.lesson || '-'}\n   置信: ${exp.confidence || 0.5} | 验证: ${exp.validatedCount || 0}次`
    } else if (type === 'goal' && s.goal) {
      const g = s.goal
      detail = `产品: ${g.product} | 目标消耗: $${g.dailySpendTarget} | ROAS底线: ${g.roasFloor}\n   优先级: ${g.priority} | 渠道: ${g.channels?.join(',') || 'ALL'}\n   备注: ${g.notes || '-'}`
    } else if (type === 'config' && s.config) {
      detail = `${s.config.key}: ${JSON.stringify(s.config.value).substring(0, 100)}`
    } else if (type === 'meta' && s.experience) {
      detail = `元规则: ${s.experience.lesson || s.description}`
    } else if (s.screening?.conditions?.length) {
      detail = `硬护栏: ${s.screening.conditions.map((c: any) => `${c.field}${c.operator}${c.value}`).join(' & ')} → ${s.screening.verdict}`
    }

    return `${i + 1}. [${type}] **${s.name}** [${status}]\n   ${detail}\n   ${s.description || ''}`
  }).join('\n\n')
}

/**
 * 生成修改 diff 预览
 */
export async function buildDiff(intent: SkillIntent, agentRole: string): Promise<SkillDiff | null> {
  if (!intent.skillName || !intent.changes) return null

  const skillAgentIds = AGENT_ROLE_TO_SKILL_AGENT[agentRole] || ['decision']
  const skills = await Skill.find({ agentId: { $in: skillAgentIds } }).lean() as any[]

  const skill = skills.find(s =>
    s.name.toLowerCase().includes(intent.skillName!.toLowerCase()) ||
    intent.skillName!.toLowerCase().includes(s.name.toLowerCase())
  )
  if (!skill) return null

  const before: Record<string, any> = {}
  const after: Record<string, any> = {}

  for (const [path, newValue] of Object.entries(intent.changes)) {
    const oldValue = getNestedValue(skill, path)
    before[path] = oldValue
    after[path] = newValue
  }

  return {
    skillId: skill._id.toString(),
    skillName: skill.name,
    agentId: skill.agentId,
    before,
    after,
    summary: intent.description || `修改 ${skill.name} 的 ${Object.keys(intent.changes).join(', ')}`,
  }
}

/**
 * 确认后执行写入
 */
export async function applySkillChange(skillId: string, changes: Record<string, any>): Promise<boolean> {
  try {
    const update: Record<string, any> = {}
    for (const [path, value] of Object.entries(changes)) {
      update[path] = value
    }
    await Skill.updateOne({ _id: skillId }, { $set: update })
    log.info(`[SkillEditor] Applied changes to skill ${skillId}: ${JSON.stringify(changes)}`)
    return true
  } catch (e: any) {
    log.error(`[SkillEditor] Apply failed: ${e.message}`)
    return false
  }
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
