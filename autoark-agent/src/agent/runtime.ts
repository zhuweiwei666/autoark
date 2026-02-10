/**
 * Agent Runtime - Gemini 函数调用循环
 * 
 * 核心循环: 发消息 → Gemini 返回 → 有工具调用就执行 → 把结果喂回去 → 循环
 * 直到 Gemini 返回纯文本（没有工具调用）为止
 */
import { GoogleGenerativeAI, Content, Part, SchemaType } from '@google/generative-ai'
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

export async function runAgent(
  userMessage: string,
  ctx: ToolContext,
  history: Content[] = [],
): Promise<AgentResult> {
  if (!env.LLM_API_KEY) {
    return { response: 'LLM_API_KEY 未配置，无法运行 Agent', toolCalls: [], iterations: 0, durationMs: 0 }
  }

  const startTime = Date.now()
  const allToolCalls: AgentResult['toolCalls'] = []

  const genAI = new GoogleGenerativeAI(env.LLM_API_KEY)
  const declarations = registry.toGeminiDeclarations()

  const model = genAI.getGenerativeModel({
    model: env.LLM_MODEL,
    systemInstruction: SYSTEM_PROMPT,
    tools: declarations.length > 0 ? [{ functionDeclarations: declarations }] : undefined,
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
  })

  const chat = model.startChat({ history })
  let result = await chat.sendMessage(userMessage)
  let response = result.response
  let iteration = 1

  while (iteration <= MAX_ITERATIONS) {
    const functionCalls = response.functionCalls()
    if (!functionCalls || functionCalls.length === 0) break

    log.info(`[Agent] Iteration ${iteration}: ${functionCalls.length} tool call(s): ${functionCalls.map(f => f.name).join(', ')}`)

    const functionResponses: Part[] = []
    for (const fc of functionCalls) {
      const toolResult = await registry.execute(fc.name, fc.args as any, ctx)
      allToolCalls.push({ name: fc.name, args: fc.args, result: toolResult })

      functionResponses.push({
        functionResponse: { name: fc.name, response: toolResult },
      } as any)
    }

    result = await chat.sendMessage(functionResponses)
    response = result.response
    iteration++
  }

  const text = response.text() || 'Agent 完成，无文本回复。'
  const durationMs = Date.now() - startTime

  log.info(`[Agent] Done: ${iteration} iterations, ${allToolCalls.length} tool calls, ${durationMs}ms`)

  return { response: text, toolCalls: allToolCalls, iterations: iteration, durationMs }
}
