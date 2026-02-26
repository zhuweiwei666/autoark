/**
 * Skill 编辑器 — 统一由 A5 管理所有 Agent 的 Skills
 *
 * 支持操作：modify / create / delete / toggle / list
 * 优先用规则匹配简单指令，复杂指令 fallback 到 LLM
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
  targetAgent?: string
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

const ALL_SKILL_AGENTS = Object.values(AGENT_ROLE_TO_SKILL_AGENT).flat()

const AGENT_ALIAS: Record<string, string> = {
  'a1': 'a1_fusion', '数据融合': 'a1_fusion', '数据': 'a1_fusion',
  'a2': 'a2_decision', '决策': 'a2_decision', '决策分析': 'a2_decision',
  'a3': 'a3_executor', '执行': 'a3_executor', '执行路由': 'a3_executor',
  'a4': 'a4_governor', '全局控制': 'a4_governor', '全局治理': 'a4_governor', '治理': 'a4_governor',
  'a5': 'a5_knowledge', '知识管理': 'a5_knowledge', '知识': 'a5_knowledge',
}

/**
 * 从用户文本中提取目标 Agent
 */
function detectTargetAgent(text: string): string | null {
  const lower = text.toLowerCase()
  for (const [alias, role] of Object.entries(AGENT_ALIAS)) {
    if (lower.includes(alias.toLowerCase())) return role
  }
  return null
}

/**
 * 获取搜索范围内的 agentIds
 */
function resolveAgentIds(targetAgent?: string | null): string[] {
  if (targetAgent && AGENT_ROLE_TO_SKILL_AGENT[targetAgent]) {
    return AGENT_ROLE_TO_SKILL_AGENT[targetAgent]
  }
  return ALL_SKILL_AGENTS
}

/**
 * 规则匹配：对简单指令直接解析，不调用 LLM
 */
function tryRuleParse(text: string): SkillIntent | null {
  const lower = text.toLowerCase()
  const raw = text

  if (/^(列出|查看|list|show|显示).*(skill|规则|技能)/i.test(text) || lower === '列出skills' || lower === 'ls') {
    return { action: 'list', raw, targetAgent: detectTargetAgent(text) || undefined }
  }

  if (/^(启用|enable)\s+/i.test(text)) {
    const name = text.replace(/^(启用|enable)\s+/i, '').trim()
    return { action: 'toggle', skillName: name, changes: { enabled: true }, raw, description: `启用 ${name}` }
  }
  if (/^(禁用|disable)\s+/i.test(text)) {
    const name = text.replace(/^(禁用|disable)\s+/i, '').trim()
    return { action: 'toggle', skillName: name, changes: { enabled: false }, raw, description: `禁用 ${name}` }
  }

  // "raos底线改成0.8" / "roas底线0.8" / "roasFloor改成0.8"
  const roasMatch = text.match(/roas.*?(?:底线|floor|阈值).*?(\d+\.?\d*)/i)
  if (roasMatch) {
    return {
      action: 'modify', raw,
      changes: { 'goal.roasFloor': parseFloat(roasMatch[1]) },
      description: `修改 ROAS 底线为 ${roasMatch[1]}`,
      targetAgent: detectTargetAgent(text) || 'a4_governor',
    }
  }

  // "花费目标改成500" / "dailySpendTarget 500"
  const spendMatch = text.match(/(?:花费|消耗|spend|budget).*?(?:目标|target).*?(\d+\.?\d*)/i)
  if (spendMatch) {
    return {
      action: 'modify', raw,
      changes: { 'goal.dailySpendTarget': parseFloat(spendMatch[1]) },
      description: `修改花费目标为 $${spendMatch[1]}`,
      targetAgent: detectTargetAgent(text) || 'a4_governor',
    }
  }

  // "改成自动/手动"
  if (/改.*?(自动|auto)/i.test(text)) {
    return {
      action: 'modify', raw,
      changes: { 'decision.auto': true },
      description: '改为自动执行',
    }
  }
  if (/改.*?(手动|manual|审批)/i.test(text)) {
    return {
      action: 'modify', raw,
      changes: { 'decision.auto': false },
      description: '改为需审批',
    }
  }

  return null
}

/**
 * 解析用户指令：规则优先，LLM 兜底
 */
export async function parseSkillIntent(text: string, agentRole?: string): Promise<SkillIntent> {
  const detectedAgent = detectTargetAgent(text)

  const ruleResult = tryRuleParse(text)
  if (ruleResult) {
    if (!ruleResult.targetAgent && detectedAgent) ruleResult.targetAgent = detectedAgent
    if (!ruleResult.targetAgent && agentRole) ruleResult.targetAgent = agentRole
    log.info(`[SkillEditor] Rule-parsed: ${ruleResult.action} target=${ruleResult.targetAgent || 'all'}`)
    return ruleResult
  }

  // LLM 解析 — 搜索全部 Skills 给 LLM 更多上下文
  const searchAgentIds = resolveAgentIds(detectedAgent || agentRole)
  const skills = await Skill.find({ agentId: { $in: searchAgentIds } }).lean() as AgentSkillDoc[]

  const skillList = skills.map(s => {
    const parts = [`agent="${(s as any).agentId}"`, `name="${s.name}"`, `enabled=${s.enabled}`, `type=${(s as any).skillType || 'rule'}`]
    if ((s as any).goal) {
      const g = (s as any).goal
      parts.push(`product=${g.product || '-'}`, `roasFloor=${g.roasFloor || '-'}`, `spendTarget=${g.dailySpendTarget || '-'}`)
    }
    if (s.screening?.conditions?.length) {
      parts.push(`conditions=${JSON.stringify(s.screening.conditions)}`)
    }
    if (s.decision?.action) {
      parts.push(`action=${s.decision.action}`, `auto=${s.decision.auto}`)
      if (s.decision.conditions?.length) parts.push(`conditions=${JSON.stringify(s.decision.conditions)}`)
    }
    return parts.join(', ')
  }).join('\n')

  const prompt = `你是广告投放 Agent 的 Skill 管理助手（A5 知识管理）。用户要修改 Agent 的规则配置。

当前所有 Agent 的 Skills 列表：
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
- "goal.roasFloor" → ROAS 底线
- "goal.dailySpendTarget" → 花费目标
- "screening.conditions[0].value" → 修改第一个条件的阈值
- "decision.auto" → 修改是否自动执行
- "enabled" → 启用/禁用

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
      return { action: 'list', raw: text, description: '无法解析指令，展示当前 skills', targetAgent: detectedAgent || agentRole || undefined }
    }

    const parsed = JSON.parse(jsonMatch[0])
    return { ...parsed, raw: text, targetAgent: detectedAgent || agentRole || undefined }
  } catch (e: any) {
    log.error(`[SkillEditor] LLM parse failed: ${e.message}`)
    return { action: 'list', raw: text, description: 'LLM 不可用，展示当前 skills', targetAgent: detectedAgent || agentRole || undefined }
  }
}

/**
 * 列出 Skills（支持指定 Agent 或全部）
 */
export async function listSkills(agentRole?: string): Promise<string> {
  const agentIds = resolveAgentIds(agentRole)
  const skills = await Skill.find({ agentId: { $in: agentIds } }).sort({ agentId: 1, order: 1 }).lean() as AgentSkillDoc[]

  if (skills.length === 0) return '当前没有配置任何 Skill'

  let currentAgent = ''
  const lines: string[] = []

  for (let i = 0; i < skills.length; i++) {
    const s = skills[i] as any
    if (s.agentId !== currentAgent) {
      currentAgent = s.agentId
      lines.push(`\n━━━ ${currentAgent} ━━━`)
    }

    const status = s.enabled ? '启用' : '禁用'
    const type = s.skillType || 'rule'
    let detail = ''

    if (type === 'experience' && s.experience) {
      detail = `场景: ${s.experience.scenario || '-'} → 教训: ${s.experience.lesson || '-'}`
    } else if (type === 'goal' && s.goal) {
      const g = s.goal
      detail = `产品: ${g.product} | 消耗目标: $${g.dailySpendTarget} | ROAS底线: ${g.roasFloor} | 策略: ${g.priority}`
    } else if (type === 'config' && s.config) {
      detail = `${s.config.key}: ${JSON.stringify(s.config.value).substring(0, 80)}`
    } else if (s.screening?.conditions?.length) {
      detail = `${s.screening.conditions.map((c: any) => `${c.field}${c.operator}${c.value}`).join(' & ')} → ${s.screening.verdict}`
    } else if (s.decision?.action) {
      detail = `${s.decision.action} ${s.decision.auto ? '(自动)' : '(审批)'}`
    }

    lines.push(`${i + 1}. [${type}] **${s.name}** [${status}]\n   ${detail}\n   ${s.description || ''}`)
  }

  return lines.join('\n')
}

/**
 * 生成修改 diff 预览（跨 Agent 搜索）
 */
export async function buildDiff(intent: SkillIntent, agentRole?: string): Promise<SkillDiff | null> {
  if (!intent.skillName && !intent.changes) return null

  const agentIds = resolveAgentIds(intent.targetAgent || agentRole)
  const skills = await Skill.find({ agentId: { $in: agentIds } }).lean() as any[]

  // 有 skillName 时按名称匹配
  let skill: any = null
  if (intent.skillName) {
    skill = skills.find(s =>
      s.name.toLowerCase().includes(intent.skillName!.toLowerCase()) ||
      intent.skillName!.toLowerCase().includes(s.name.toLowerCase())
    )
  }

  // 没有 skillName 但有 changes 时，根据 changes 的字段路径推断 Skill
  if (!skill && intent.changes) {
    const changePaths = Object.keys(intent.changes)
    if (changePaths.some(p => p.startsWith('goal.'))) {
      skill = skills.find(s => s.skillType === 'goal')
    }
  }

  if (!skill) return null

  const before: Record<string, any> = {}
  const after: Record<string, any> = {}

  for (const [path, newValue] of Object.entries(intent.changes || {})) {
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
    summary: intent.description || `修改 ${skill.name} 的 ${Object.keys(intent.changes || {}).join(', ')}`,
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
