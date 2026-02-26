/**
 * A5 超级 Agent — 自由对话 + 跨 Agent Skill 管理 + 自主进化
 *
 * 核心能力：
 * 1. 飞书群聊自由对话（通过 tool-calling 自主决定行动）
 * 2. 超长记忆（MongoDB 全量存储 + 滚动摘要，最大化 200K context）
 * 3. 管理所有 Agent 的 Skills
 * 4. 每轮循环后轻量自主进化
 */
import axios from 'axios'
import mongoose from 'mongoose'
import dayjs from 'dayjs'
import { env } from '../config/env'
import { log } from '../platform/logger'
import { ToolDef, ToolContext } from './tools'
import { a5Tools } from './tools/a5.tools'
import { Skill } from './skill.model'
import { Action } from '../action/action.model'
import { buildDynamicContext } from './context'

// ==================== A5 对话记忆 (MongoDB, 延迟初始化) ====================

let _A5Conversation: mongoose.Model<any> | null = null

function getA5ConversationModel() {
  if (_A5Conversation) return _A5Conversation
  try {
    _A5Conversation = mongoose.models.A5Conversation || mongoose.model('A5Conversation', new mongoose.Schema({
      chatId: { type: String, required: true, index: true },
      messages: [new mongoose.Schema({
        role: { type: String },
        content: { type: String },
        senderId: { type: String },
        timestamp: { type: Date, default: Date.now },
      }, { _id: false })],
      summary: { type: String, default: '' },
      summaryUpTo: { type: Number, default: 0 },
    }, { timestamps: true }))
  } catch (e: any) {
    log.warn(`[A5] Model init fallback: ${e.message}`)
    _A5Conversation = mongoose.models.A5Conversation
  }
  return _A5Conversation!
}

const SUMMARY_THRESHOLD = 50
const RECENT_MESSAGES_LIMIT = 50
const MAX_TOOL_ITERATIONS = 10

// ==================== System Prompt ====================

const A5_SYSTEM_PROMPT = `你是 A5 知识管理 Agent，负责管理整个 AutoArk 广告投放 AI 系统的知识和技能。你在飞书群里与团队对话。

## 你的身份
你是 5 个协作 Agent 中的 A5（知识管理），负责整个系统的"大脑"——管理策略规则、积累经验、推动进化。

## 你的能力（通过工具实现）

### 自身能力
1. **list_skills** — 查看所有 Agent 的 Skills 配置
2. **modify_skill** — 修改任何 Agent 的 Skill 参数
3. **view_reflection_stats** — 查看决策复盘统计
4. **trigger_evolution** — 触发进化分析
5. **query_knowledge** — 查询知识库经验
6. **view_system_status** — 查看系统运行状态

### 跨 Agent 调度（你是总指挥，A1-A4 都听你的）
7. **query_campaigns** — [调度A1] 拉取 Facebook 实时 campaign 数据（花费、ROAS、安装量等）
8. **run_decision** — [调度A2] 对 campaign 跑规则引擎评估，看 A2 会怎么判断
9. **execute_campaign_action** — [调度A3] 执行广告操作（暂停/恢复/调预算，需用户确认）
10. **check_global_roas** — [调度A4] 检查全局 ROAS 和产品级风控状态

## 操作原则
- 修改数值参数（ROAS 底线、花费目标、阈值）→ 直接执行，告知用户结果
- 禁用/启用 Skill、改自动/手动 → 生成确认请求，等用户确认
- 被问到系统状态时，先调用工具查数据，再基于数据回答
- 不确定时先查询再回答，不要编造数据
- 回复简洁有力，像一个专业的策略顾问

## 你知道的系统架构
- A1 数据融合：拉取 Facebook + Metabase 数据，融合成统一视图
- A2 决策分析：基于 Skills 规则 + LLM 推理，决定 campaign 的操作（暂停/加预算/降预算/恢复）
- A3 执行路由：通过 Facebook API 执行 A2 的决策
- A4 全局治理：产品级 ROAS 监控，防止整体亏损（补量/止损）
- A5 你自己：知识管理、Skill 生命周期、经验沉淀、系统进化

## 回复格式
- 用中文回复
- 执行了操作后，清晰说明做了什么、改了什么值
- 涉及数据时，用具体数字，不要含糊`

// ==================== A5 Tool Registry ====================

function toOpenAITools(tools: ToolDef[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: convertParams(t.parameters),
    },
  }))
}

function convertParams(p: any): any {
  if (!p) return undefined
  const result: any = {}
  if (p.type) {
    const typeMap: Record<string, string> = {
      STRING: 'string', NUMBER: 'number', INTEGER: 'integer',
      BOOLEAN: 'boolean', OBJECT: 'object', ARRAY: 'array',
    }
    result.type = typeMap[p.type] || p.type.toLowerCase()
  }
  if (p.description) result.description = p.description
  if (p.enum) result.enum = p.enum
  if (p.properties) {
    result.properties = {}
    for (const [k, v] of Object.entries(p.properties)) {
      result.properties[k] = convertParams(v)
    }
  }
  if (p.required) result.required = p.required
  if (p.items) result.items = convertParams(p.items)
  return result
}

const a5ToolMap = new Map<string, ToolDef>(a5Tools.map(t => [t.name, t]))

async function executeA5Tool(name: string, args: any): Promise<any> {
  const tool = a5ToolMap.get(name)
  if (!tool) return { error: `Tool "${name}" not found` }
  const dummyCtx: ToolContext = { userId: 'a5', conversationId: 'a5', getToken: async () => null }
  try {
    return await tool.handler(args, dummyCtx)
  } catch (err: any) {
    return { error: err.message }
  }
}

// ==================== 对话记忆管理 ====================

async function loadConversation(chatId: string) {
  const Model = getA5ConversationModel()
  let convo = await Model.findOne({ chatId })
  if (!convo) {
    convo = await Model.create({ chatId, messages: [], summary: '' })
  }
  return convo
}

async function buildMessageHistory(convo: any): Promise<{ history: any[]; systemParts: string[] }> {
  const allMessages = convo.messages || []
  const systemParts: string[] = []

  if (convo.summary) {
    systemParts.push(`## 历史对话摘要\n${convo.summary}`)
  }

  const recent = allMessages.slice(-RECENT_MESSAGES_LIMIT)
  const history = recent
    .filter((m: any) => m.content && m.content.trim())
    .map((m: any) => ({
      role: m.role === 'user' ? 'user' as const : 'assistant' as const,
      content: m.content.trim(),
    }))

  return { history, systemParts }
}

async function generateSummary(messages: any[]): Promise<string> {
  if (!env.LLM_API_KEY || messages.length === 0) return ''

  const text = messages.map((m: any) =>
    `${m.role === 'user' ? '用户' : 'A5'}: ${(m.content || '').substring(0, 200)}`
  ).join('\n')

  try {
    const res = await axios.post(
      `${env.LLM_BASE_URL}/chat/completions`,
      {
        model: env.LLM_MODEL,
        messages: [{ role: 'user', content: `请用 3-5 句话概括以下对话的关键信息（操作、决定、重要数据）：\n\n${text}` }],
        temperature: 0,
        max_tokens: 500,
      },
      {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LLM_API_KEY}` },
        timeout: 30000,
      },
    )
    return res.data.choices?.[0]?.message?.content || ''
  } catch {
    return `[${messages.length} 条消息未能摘要]`
  }
}

async function maybeCompressSummary(convo: any): Promise<void> {
  const allMessages = convo.messages || []
  const unsummarized = allMessages.length - (convo.summaryUpTo || 0)

  if (unsummarized < SUMMARY_THRESHOLD) return

  const toSummarize = allMessages.slice(convo.summaryUpTo || 0, allMessages.length - RECENT_MESSAGES_LIMIT)
  if (toSummarize.length === 0) return

  const newSummary = await generateSummary(toSummarize)
  const combined = convo.summary
    ? `${convo.summary}\n\n---\n${newSummary}`
    : newSummary

  convo.summary = combined
  convo.summaryUpTo = allMessages.length - RECENT_MESSAGES_LIMIT
  await convo.save()
  log.info(`[A5] Compressed ${toSummarize.length} messages into summary (total: ${allMessages.length})`)
}

// ==================== A5 Agent 主入口 ====================

export interface A5Response {
  text: string
  confirmCard?: {
    skillId: string
    skillName: string
    agentId: string
    before: Record<string, any>
    after: Record<string, any>
    description: string
  }
}

export async function runA5Agent(
  userMessage: string,
  senderId: string,
  chatId: string,
): Promise<A5Response> {
  log.info(`[A5] runA5Agent called: chatId=${chatId}, msg="${userMessage.substring(0, 50)}"`)

  try {
    return await _runA5AgentInner(userMessage, senderId, chatId)
  } catch (e: any) {
    log.error(`[A5] FATAL: ${e.message}\n${e.stack?.substring(0, 300)}`)
    return { text: `A5 内部错误: ${e.message?.substring(0, 100)}` }
  }
}

async function _runA5AgentInner(
  userMessage: string,
  senderId: string,
  chatId: string,
): Promise<A5Response> {
  const startTime = Date.now()

  log.info(`[A5] Loading conversation...`)
  const convo = await loadConversation(chatId)

  // 清理历史中的空消息（防止 Claude API "text content blocks must be non-empty" 报错）
  const validMessages = (convo.messages || []).filter((m: any) => m.content && m.content.trim())
  if (validMessages.length !== (convo.messages || []).length) {
    convo.messages = validMessages
  }

  convo.messages.push({ role: 'user', content: userMessage, senderId, timestamp: new Date() })

  await maybeCompressSummary(convo)

  const { history, systemParts } = await buildMessageHistory(convo)

  log.info(`[A5] Building context (${history.length} msgs in history)...`)
  const dynamicContext = await buildDynamicContext()
  systemParts.push(dynamicContext)

  const systemPrompt = [A5_SYSTEM_PROMPT, ...systemParts].join('\n\n')
  const tools = toOpenAITools(a5Tools)

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history,
  ]

  let confirmCard: A5Response['confirmCard'] | undefined
  const allToolCalls: Array<{ name: string; args: any; result: any }> = []

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    let data: any
    try {
      const res = await axios.post(
        `${env.LLM_BASE_URL}/chat/completions`,
        {
          model: env.LLM_MODEL,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: tools.length > 0 ? 'auto' : undefined,
          temperature: 0.3,
          max_tokens: 4096,
        },
        {
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LLM_API_KEY}` },
          timeout: 120000,
        },
      )
      data = res.data
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || err.message
      log.error(`[A5] LLM error: ${errMsg}`)
      const response = `抱歉，LLM 调用失败: ${errMsg.substring(0, 100)}`
      convo.messages.push({ role: 'assistant', content: response, timestamp: new Date() })
      await convo.save()
      return { text: response }
    }

    const choice = data.choices?.[0]
    if (!choice) break

    const msg = choice.message

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const response = msg.content || '处理完成'
      convo.messages.push({ role: 'assistant', content: response, timestamp: new Date() })
      await convo.save()
      log.info(`[A5] Done: ${iteration + 1} iterations, ${allToolCalls.length} tools, ${Date.now() - startTime}ms`)
      return { text: response, confirmCard }
    }

    // Claude 要求 content 不为空，tool_calls 时 content 可能是 null
    const sanitizedMsg = { ...msg }
    if (!sanitizedMsg.content) sanitizedMsg.content = '(tool calling)'
    messages.push(sanitizedMsg)

    for (const tc of msg.tool_calls) {
      const fnName = tc.function.name
      let args: any = {}
      try { args = JSON.parse(tc.function.arguments || '{}') } catch {}

      log.info(`[A5] Tool call: ${fnName}(${JSON.stringify(args).substring(0, 100)})`)
      const result = await executeA5Tool(fnName, args)
      allToolCalls.push({ name: fnName, args, result })

      if (result?.needsConfirm) {
        confirmCard = {
          skillId: result.skillId,
          skillName: result.skillName,
          agentId: result.agentId,
          before: result.before,
          after: result.after,
          description: result.description,
        }
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      })
    }
  }

  const fallback = '达到最大工具调用次数，请重试或简化请求。'
  convo.messages.push({ role: 'assistant', content: fallback, timestamp: new Date() })
  await convo.save()
  return { text: fallback }
}

// ==================== A5 自主进化（每轮循环调用）====================

export interface QuickEvolveResult {
  actions: string[]
  confirmCards: Array<{
    skillName: string
    agentId: string
    before: Record<string, any>
    after: Record<string, any>
    description: string
  }>
}

export async function a5QuickEvolve(): Promise<QuickEvolveResult> {
  const actions: string[] = []
  const confirmCards: QuickEvolveResult['confirmCards'] = []

  try {
    // 1. 检查连续命中但效果差的 Skills
    const skills = await Skill.find({ enabled: true }).lean() as any[]
    for (const skill of skills) {
      const stats = skill.stats || {}
      const total = (stats.correct || 0) + (stats.wrong || 0)
      if (total < 5) continue
      const accuracy = (stats.correct || 0) / total

      if (accuracy < 0.4 && total >= 8) {
        await Skill.updateOne({ _id: skill._id }, { $set: { enabled: false } })
        actions.push(`自动禁用 "${skill.name}": 准确率 ${Math.round(accuracy * 100)}% (${stats.correct}/${total})`)
        log.warn(`[A5 Evolve] Auto-disabled: ${skill.name} (accuracy ${Math.round(accuracy * 100)}%)`)
      } else if (accuracy < 0.6 && total >= 6 && skill.decision?.auto) {
        await Skill.updateOne({ _id: skill._id }, { $set: { 'decision.auto': false } })
        actions.push(`"${skill.name}" 降级为需审批: 准确率 ${Math.round(accuracy * 100)}%`)
        log.info(`[A5 Evolve] Downgraded to manual: ${skill.name}`)
      }
    }

    // 2. 检查被拒绝的操作模式
    const recentRejected = await Action.countDocuments({
      status: 'rejected',
      createdAt: { $gte: dayjs().subtract(24, 'hour').toDate() },
    })
    const recentTotal = await Action.countDocuments({
      status: { $in: ['executed', 'approved', 'rejected'] },
      createdAt: { $gte: dayjs().subtract(24, 'hour').toDate() },
    })

    if (recentTotal >= 5 && recentRejected / recentTotal > 0.3) {
      const autoSkills = await Skill.find({
        enabled: true,
        'decision.auto': true,
        'decision.action': { $exists: true },
      }).lean() as any[]

      for (const skill of autoSkills) {
        const s = skill.stats || {}
        const t = (s.correct || 0) + (s.wrong || 0)
        if (t >= 3 && (s.correct || 0) / t < 0.7) {
          confirmCards.push({
            skillName: skill.name,
            agentId: skill.agentId,
            before: { 'decision.auto': true },
            after: { 'decision.auto': false },
            description: `拒绝率 ${Math.round(recentRejected / recentTotal * 100)}%，建议将 "${skill.name}" 改为需审批`,
          })
        }
      }
    }

    // 3. 高准确率 Skill 晋升
    for (const skill of skills) {
      const stats = skill.stats || {}
      const total = (stats.correct || 0) + (stats.wrong || 0)
      if (total >= 15 && (stats.correct || 0) / total >= 0.85 && !skill.decision?.auto && skill.decision?.action) {
        confirmCards.push({
          skillName: skill.name,
          agentId: skill.agentId,
          before: { 'decision.auto': false },
          after: { 'decision.auto': true },
          description: `"${skill.name}" 准确率 ${Math.round((stats.correct || 0) / total * 100)}%，建议晋升为自动执行`,
        })
      }
    }
  } catch (e: any) {
    log.error(`[A5 Evolve] Error: ${e.message}`)
  }

  if (actions.length > 0 || confirmCards.length > 0) {
    log.info(`[A5 Evolve] ${actions.length} auto-applied, ${confirmCards.length} need confirmation`)
  }

  return { actions, confirmCards }
}
