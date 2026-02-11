/**
 * Agent 入口 - 初始化工具注册 + 提供对话接口
 */
import { log } from '../platform/logger'
import { registry, ToolContext } from './tools'
import { readTools } from './tools/read.tools'
import { writeTools } from './tools/write.tools'
import { memoryTools } from './tools/memory.tools'
import { toptouTools } from './tools/toptou.tools'
import { metabaseTools } from './tools/metabase.tools'
import { runAgent, AgentResult } from './runtime'
import { Token } from '../data/token.model'
import { AdAccount } from '../data/account.model'
import { Conversation } from '../conversation/conversation.model'
import { tokenPool } from '../platform/facebook/token'

let initialized = false

/**
 * 初始化 Agent 系统（注册所有工具，加载 Token 池）
 */
export async function initAgent() {
  if (initialized) return

  registry.registerAll(readTools)
  registry.registerAll(writeTools)
  registry.registerAll(memoryTools)
  registry.registerAll(toptouTools)
  registry.registerAll(metabaseTools)

  // 加载 Facebook Token 池
  const fbTokens = await Token.find({ platform: 'facebook', status: 'active' }).lean()
  tokenPool.load(fbTokens.map((t: any) => ({ id: t._id.toString(), token: t.accessToken })))

  initialized = true
  // 设置 TopTou token（如果配置了）
  if (process.env.TOPTOU_TOKEN) {
    const { setTopTouToken } = await import('../platform/toptou/client')
    setTopTouToken(process.env.TOPTOU_TOKEN)
  }

  const toolNames = [...readTools, ...writeTools, ...memoryTools, ...toptouTools, ...metabaseTools].map(t => t.name)
  log.info(`[Agent] Initialized with ${toolNames.length} tools: ${toolNames.join(', ')}`)
}

/**
 * 处理用户消息 - Agent 核心对话接口
 */
export async function chat(userId: string, conversationId: string, message: string): Promise<{
  conversationId: string
  agentResponse: string
  toolCalls: AgentResult['toolCalls']
  actionIds: string[]
  durationMs: number
}> {
  await initAgent()

  // 获取或创建对话
  let convo = conversationId
    ? await Conversation.findById(conversationId)
    : null

  if (!convo) {
    convo = await Conversation.create({
      userId,
      title: message.slice(0, 50),
      messages: [],
    })
  }

  // 构建工具上下文
  const ctx: ToolContext = {
    userId,
    conversationId: convo._id.toString(),
    getToken: async (platform, accountId) => {
      if (platform === 'facebook') {
        if (accountId) {
          const account: any = await AdAccount.findOne({ accountId, platform: 'facebook' }).lean()
          if (account?.tokenId) {
            const t: any = await Token.findById(account.tokenId).lean()
            if (t) return t.accessToken
          }
        }
        // 兜底: token pool
        return tokenPool.getNextToken()
      }
      // TikTok
      const t: any = await Token.findOne({ platform: 'tiktok', status: 'active' }).lean()
      return t?.accessToken || null
    },
  }

  // 构建历史消息（OpenAI 格式：role 只能是 user/assistant）
  const recentMessages = (convo.messages || []).slice(-20)
  const history = recentMessages.map((m: any) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content || '',
  }))

  // 运行 Agent
  const result = await runAgent(message, ctx, history)

  // 提取本轮产生的 action IDs
  const actionIds = result.toolCalls
    .filter(tc => tc.name.startsWith('propose_') && tc.result?.actionId)
    .map(tc => tc.result.actionId)

  // 保存消息到对话
  convo.messages.push(
    { role: 'user', content: message, timestamp: new Date() } as any,
    {
      role: 'agent', content: result.response,
      toolCalls: result.toolCalls.map(tc => ({ name: tc.name, args: tc.args, result: tc.result })),
      actionIds,
      timestamp: new Date(),
    } as any,
  )
  await convo.save()

  return {
    conversationId: convo._id.toString(),
    agentResponse: result.response,
    toolCalls: result.toolCalls,
    actionIds,
    durationMs: result.durationMs,
  }
}
