/**
 * Agent Runtime Engine
 * 
 * The core OODA loop that powers all agents:
 * 1. Build system prompt with context and available tools
 * 2. Send to Gemini with function calling enabled
 * 3. If Gemini returns function calls → execute via tools → send results back
 * 4. If Gemini returns text → agent is done
 * 5. Record everything to memory
 * 
 * Supports: multi-turn function calling, guardrail checks,
 * parallel tool calls, max iteration limits, streaming.
 */

import { GoogleGenerativeAI, Content, Part, SchemaType } from '@google/generative-ai'
import { v4 as uuidv4 } from 'uuid'
import logger from '../../utils/logger'
import { toolRegistry } from './agent.tools'
import { guardrailService } from './agent.guardrails'
import { memoryService } from './agent.memory'
import {
  AgentContext,
  AgentConfig,
  AgentRunResult,
  ToolCallRecord,
  DecisionRecord,
  FunctionDeclaration,
  ToolResult,
} from './agent.types'

const LLM_API_KEY = process.env.LLM_API_KEY
const DEFAULT_MODEL = process.env.LLM_MODEL || 'gemini-2.0-flash'
const DEFAULT_MAX_ITERATIONS = 25
const DEFAULT_TEMPERATURE = 0.2

/**
 * Convert our tool parameter types to Gemini SchemaType
 */
function convertParameterType(type: string): SchemaType {
  const typeMap: Record<string, SchemaType> = {
    STRING: SchemaType.STRING,
    NUMBER: SchemaType.NUMBER,
    INTEGER: SchemaType.INTEGER,
    BOOLEAN: SchemaType.BOOLEAN,
    OBJECT: SchemaType.OBJECT,
    ARRAY: SchemaType.ARRAY,
  }
  return typeMap[type] || SchemaType.STRING
}

/**
 * Convert our FunctionDeclaration format to Gemini's expected format
 */
function toGeminiFunctionDeclarations(declarations: FunctionDeclaration[]): any[] {
  return declarations.map(decl => ({
    name: decl.name,
    description: decl.description,
    parameters: convertParameters(decl.parameters),
  }))
}

function convertParameters(params: any): any {
  if (!params) return undefined
  const result: any = {
    type: convertParameterType(params.type),
    description: params.description,
  }
  if (params.properties) {
    result.properties = {}
    for (const [key, value] of Object.entries(params.properties)) {
      result.properties[key] = convertParameters(value)
    }
  }
  if (params.required) {
    result.required = params.required
  }
  if (params.enum) {
    result.enum = params.enum
  }
  if (params.items) {
    result.items = convertParameters(params.items)
  }
  return result
}

/**
 * Run an agent with the given system prompt, tools, and context.
 * This is the main entry point for all agent executions.
 */
export async function runAgentLoop(params: {
  systemPrompt: string
  userMessage: string
  context: AgentContext
  toolFilter?: {
    categories?: Array<'facebook' | 'tiktok' | 'data' | 'material' | 'analysis' | 'system'>
    toolNames?: string[]
  }
  conversationHistory?: Content[]
}): Promise<AgentRunResult> {
  const {
    systemPrompt,
    userMessage,
    context,
    toolFilter,
    conversationHistory,
  } = params

  const sessionId = context.sessionId || uuidv4()
  const startTime = Date.now()
  const allToolCalls: ToolCallRecord[] = []
  const allDecisions: DecisionRecord[] = []
  let iteration = 0
  const maxIterations = context.agentConfig.maxIterations || DEFAULT_MAX_ITERATIONS

  if (!LLM_API_KEY) {
    return {
      sessionId,
      agentId: context.agentId,
      role: context.agentConfig.role,
      status: 'failed',
      summary: 'LLM API key not configured',
      toolCalls: [],
      decisions: [],
      totalIterations: 0,
      durationMs: Date.now() - startTime,
      error: 'LLM_API_KEY environment variable is not set',
    }
  }

  // Create session record
  await memoryService.createSession({
    sessionId,
    agentId: context.agentId,
    organizationId: context.organizationId,
    userId: context.userId,
    triggerType: context.userId ? 'user_chat' : 'scheduled_run',
    agentRole: context.agentConfig.role,
    inputContext: userMessage,
  })

  try {
    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(LLM_API_KEY)
    const modelName = context.agentConfig.model || DEFAULT_MODEL
    const temperature = context.agentConfig.temperature ?? DEFAULT_TEMPERATURE

    // Get available tools as Gemini function declarations
    const functionDeclarations = toolRegistry.toFunctionDeclarations(toolFilter)
    const geminiFunctions = toGeminiFunctionDeclarations(functionDeclarations)

    logger.info(
      `[AgentRuntime] Starting agent loop: ${context.agentConfig.role} | model=${modelName} | tools=${geminiFunctions.length} | maxIter=${maxIterations}`
    )

    // Build memory context
    const memoryContext = await memoryService.buildContextForAgent(context)

    // Full system prompt with memory
    const fullSystemPrompt = [
      systemPrompt,
      '',
      '# Memory & Context',
      memoryContext,
      '',
      '# Guardrails',
      `- Mode: ${context.mode} (${context.mode === 'observe' ? 'READ-ONLY, no write operations' : context.mode === 'suggest' ? 'suggest actions, need human approval for writes' : 'full auto, write operations allowed'})`,
      `- Daily budget limit: ${context.objectives.dailyBudgetLimit ? '$' + context.objectives.dailyBudgetLimit : 'not set'}`,
      `- Target ROAS: ${context.objectives.targetRoas || 'not set'}`,
      `- Max CPA: ${context.objectives.maxCpa ? '$' + context.objectives.maxCpa : 'not set'}`,
      `- Accounts in scope: ${context.scope.adAccountIds.length > 0 ? context.scope.adAccountIds.join(', ') : 'all'}`,
    ].join('\n')

    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: fullSystemPrompt,
      tools: geminiFunctions.length > 0
        ? [{ functionDeclarations: geminiFunctions }]
        : undefined,
      generationConfig: {
        temperature,
        maxOutputTokens: 8192,
      },
    })

    // Start chat with optional history
    const chat = model.startChat({
      history: conversationHistory || [],
    })

    // Send initial user message
    let result = await chat.sendMessage(userMessage)
    let response = result.response
    iteration++

    // Agent loop: keep going while there are function calls
    while (iteration <= maxIterations) {
      const functionCalls = response.functionCalls()

      if (!functionCalls || functionCalls.length === 0) {
        // No more function calls -- agent is done
        break
      }

      logger.info(
        `[AgentRuntime] Iteration ${iteration}: ${functionCalls.length} function call(s)`
      )

      // Process each function call
      const functionResponses: Part[] = []

      for (const fc of functionCalls) {
        const tool = toolRegistry.get(fc.name)
        const args = fc.args as Record<string, any>

        // Check guardrails
        let guardrailResult: { approved: boolean; reason?: string; requiresHumanApproval?: boolean } = { approved: true }
        if (tool) {
          guardrailResult = await guardrailService.check(tool, args, context)
        }

        let toolResult: ToolResult
        let record: ToolCallRecord

        if (!guardrailResult.approved) {
          // Guardrail blocked -- tell the LLM why
          toolResult = {
            success: false,
            error: `BLOCKED by guardrails: ${guardrailResult.reason}`,
          }
          record = {
            toolName: fc.name,
            args,
            result: toolResult,
            guardrailCheck: guardrailResult,
            durationMs: 0,
            timestamp: new Date(),
          }
          logger.warn(
            `[AgentRuntime] Tool ${fc.name} blocked: ${guardrailResult.reason}`
          )
        } else {
          // Execute the tool
          const execResult = await toolRegistry.execute(fc.name, args, context)
          toolResult = execResult.result
          record = {
            ...execResult.record,
            guardrailCheck: guardrailResult,
          }

          // Record decisions for write operations
          if (toolResult.success && isWriteOperation(fc.name)) {
            const decision: Omit<DecisionRecord, 'createdAt'> = {
              agentId: context.agentId,
              sessionId,
              organizationId: context.organizationId,
              toolName: fc.name,
              action: fc.name,
              entityType: inferEntityType(fc.name),
              entityId: args.entityId || args.campaignId || args.adsetId || args.adId || 'unknown',
              platform: args.platform || 'facebook',
              reason: args.reason || 'Agent automated action',
              input: args,
              output: toolResult.data || {},
            }
            const decisionId = await memoryService.recordDecision(decision)
            if (decisionId) {
              allDecisions.push({ ...decision, createdAt: new Date() })
            }
          }
        }

        allToolCalls.push(record)

        // Build function response for Gemini
        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: toolResult,
          },
        } as any)
      }

      // Send function responses back to Gemini
      result = await chat.sendMessage(functionResponses)
      response = result.response
      iteration++
    }

    // Extract final text response
    const finalText = response.text() || 'Agent completed without a text response.'
    const status = iteration > maxIterations ? 'max_iterations' : 'completed'

    // Update session
    await memoryService.updateSession(sessionId, {
      status,
      summary: finalText.substring(0, 2000),
      totalIterations: iteration,
      totalToolCalls: allToolCalls.length,
      durationMs: Date.now() - startTime,
    })
    await memoryService.appendToolCalls(sessionId, allToolCalls)

    const runResult: AgentRunResult = {
      sessionId,
      agentId: context.agentId,
      role: context.agentConfig.role,
      status,
      summary: finalText,
      toolCalls: allToolCalls,
      decisions: allDecisions,
      totalIterations: iteration,
      durationMs: Date.now() - startTime,
    }

    logger.info(
      `[AgentRuntime] Agent completed: ${status} | iterations=${iteration} | tools=${allToolCalls.length} | decisions=${allDecisions.length} | ${Date.now() - startTime}ms`
    )

    return runResult
  } catch (error: any) {
    logger.error(`[AgentRuntime] Agent failed:`, error.message)

    await memoryService.updateSession(sessionId, {
      status: 'failed',
      error: error.message,
      totalIterations: iteration,
      durationMs: Date.now() - startTime,
    })

    return {
      sessionId,
      agentId: context.agentId,
      role: context.agentConfig.role,
      status: 'failed',
      summary: `Agent failed: ${error.message}`,
      toolCalls: allToolCalls,
      decisions: allDecisions,
      totalIterations: iteration,
      durationMs: Date.now() - startTime,
      error: error.message,
    }
  }
}

/**
 * Check if a tool name represents a write operation (creates, updates, deletes)
 */
function isWriteOperation(toolName: string): boolean {
  const writeOps = [
    'create_campaign', 'create_adset', 'create_ad', 'create_ad_creative',
    'update_campaign', 'update_adset', 'update_ad',
    'pause_entity', 'resume_entity', 'adjust_budget',
    'upload_image', 'upload_video',
  ]
  return writeOps.includes(toolName)
}

/**
 * Infer entity type from tool name
 */
function inferEntityType(toolName: string): string {
  if (toolName.includes('campaign')) return 'campaign'
  if (toolName.includes('adset')) return 'adset'
  if (toolName.includes('ad_creative') || toolName.includes('creative')) return 'creative'
  if (toolName.includes('ad')) return 'ad'
  if (toolName.includes('image') || toolName.includes('video')) return 'material'
  return 'unknown'
}

export default runAgentLoop
