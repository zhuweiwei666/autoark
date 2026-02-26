/**
 * Agent Runtime - OpenAI 兼容格式（支持 Claude / GPT / 任何 OpenAI-compatible API）
 * 
 * 核心循环: 发消息 → LLM 返回 → 有工具调用就执行 → 把结果喂回去 → 循环
 */
import axios from 'axios'
import { env } from '../config/env'
import { log } from '../platform/logger'
import { registry, ToolContext } from './tools'
import { SYSTEM_PROMPT } from './prompt'

const MAX_ITERATIONS = 20

export interface AgentResult {
  response: string
  toolCalls: Array<{ name: string; args: any; result: any }>
  iterations: number
  durationMs: number
}

/**
 * 把我们的工具定义转成 OpenAI function calling 格式
 */
function toOpenAITools() {
  return registry.toGeminiDeclarations().map(d => ({
    type: 'function' as const,
    function: {
      name: d.name,
      description: d.description,
      parameters: convertParams(d.parameters),
    },
  }))
}

/** SchemaType 枚举转小写 JSON Schema type */
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

export async function runAgent(
  userMessage: string,
  ctx: ToolContext,
  history: any[] = [],
): Promise<AgentResult> {
  if (!env.LLM_API_KEY) {
    return { response: 'LLM_API_KEY 未配置', toolCalls: [], iterations: 0, durationMs: 0 }
  }

  const startTime = Date.now()
  const allToolCalls: AgentResult['toolCalls'] = []
  const tools = toOpenAITools()

  // 构建消息历史
  const messages: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userMessage },
  ]

  let iteration = 0

  while (iteration < MAX_ITERATIONS) {
    iteration++

    // 调用 LLM
    let data: any
    try {
      const res = await axios.post(
        `${env.LLM_BASE_URL}/chat/completions`,
        {
          model: env.LLM_MODEL,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: tools.length > 0 ? 'auto' : undefined,
          temperature: 0.2,
          max_tokens: 8192,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.LLM_API_KEY}`,
          },
          timeout: 120000,
        }
      )
      data = res.data
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || err.message
      log.error('[Agent] LLM API error:', errMsg)
      return {
        response: `LLM 调用失败: ${errMsg}`,
        toolCalls: allToolCalls, iterations: iteration, durationMs: Date.now() - startTime,
      }
    }

    const choice = data.choices?.[0]
    if (!choice) {
      return {
        response: 'LLM 返回空结果',
        toolCalls: allToolCalls, iterations: iteration, durationMs: Date.now() - startTime,
      }
    }

    const msg = choice.message
    
    // 没有工具调用 → Agent 结束，返回文本
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      log.info(`[Agent] Done: ${iteration} iterations, ${allToolCalls.length} tool calls, ${Date.now() - startTime}ms`)
      return {
        response: msg.content || 'Agent 完成',
        toolCalls: allToolCalls, iterations: iteration, durationMs: Date.now() - startTime,
      }
    }

    // 有工具调用 → 执行并把结果喂回去
    log.info(`[Agent] Iteration ${iteration}: ${msg.tool_calls.length} tool call(s): ${msg.tool_calls.map((t: any) => t.function.name).join(', ')}`)

    // 先把 assistant 的完整消息加到历史（Claude 要求 content 不为空）
    const sanitizedMsg = { ...msg }
    if (!sanitizedMsg.content) sanitizedMsg.content = '(tool calling)'
    messages.push(sanitizedMsg)

    for (const tc of msg.tool_calls) {
      const fnName = tc.function.name
      let args: any = {}
      try {
        args = JSON.parse(tc.function.arguments || '{}')
      } catch { /* ignore parse error */ }

      const toolResult = await registry.execute(fnName, args, ctx)
      allToolCalls.push({ name: fnName, args, result: toolResult })

      // 把工具结果加到消息历史
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      })
    }
  }

  return {
    response: '达到最大迭代次数',
    toolCalls: allToolCalls, iterations: iteration, durationMs: Date.now() - startTime,
  }
}
