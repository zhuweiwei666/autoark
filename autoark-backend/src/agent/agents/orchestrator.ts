/**
 * Multi-Agent Orchestrator
 * 
 * Coordinates the specialized agents:
 * - Analyst → analyzes performance → produces recommendations
 * - Executor → takes recommendations → executes actions
 * - Planner → strategic planning → hands off to Executor
 * - Creative → material analysis → informs Planner/Executor
 * 
 * Supports two modes:
 * 1. Automated pipeline: Analyst → Executor (for scheduled runs)
 * 2. User-directed: Chat with any agent or the orchestrator
 */

import logger from '../../utils/logger'
import { AgentConfig, AgentRunResult } from '../core/agent.types'
import { runAnalyst } from './analyst.agent'
import { runExecutor } from './executor.agent'
import { runPlanner } from './planner.agent'
import { runCreativeAgent } from './creative.agent'
import { memoryService } from '../core/agent.memory'

export interface OrchestrationResult {
  analystResult?: AgentRunResult
  executorResult?: AgentRunResult
  plannerResult?: AgentRunResult
  creativeResult?: AgentRunResult
  overallStatus: 'completed' | 'partial' | 'failed'
  summary: string
}

/**
 * Run the full automated optimization pipeline:
 * 1. Analyst analyzes all campaigns
 * 2. If recommendations found, Executor executes them
 * 
 * This is what runs on the scheduled cron.
 */
export async function runOptimizationPipeline(params: {
  agentConfig: AgentConfig
  organizationId?: string
  fbToken?: string
  tiktokToken?: string
}): Promise<OrchestrationResult> {
  const { agentConfig, organizationId, fbToken, tiktokToken } = params
  const startTime = Date.now()

  logger.info(`[Orchestrator] Starting optimization pipeline for agent: ${agentConfig.name}`)

  // Step 1: Run Analyst
  const analystResult = await runAnalyst({
    agentConfig,
    organizationId,
    fbToken,
    tiktokToken,
  })

  if (analystResult.status === 'failed') {
    logger.error(`[Orchestrator] Analyst failed: ${analystResult.error}`)
    return {
      analystResult,
      overallStatus: 'failed',
      summary: `Analysis failed: ${analystResult.error}`,
    }
  }

  logger.info(
    `[Orchestrator] Analyst completed: ${analystResult.toolCalls.length} tool calls, ${analystResult.decisions.length} decisions`
  )

  // Extract recommendations from analyst output
  const recommendations = extractRecommendations(analystResult.summary)

  if (!recommendations || recommendations.length === 0) {
    logger.info('[Orchestrator] No actionable recommendations from analyst')
    return {
      analystResult,
      overallStatus: 'completed',
      summary: `Analysis completed. No actionable recommendations. ${analystResult.summary.substring(0, 500)}`,
    }
  }

  // Step 2: If in auto mode, run Executor with analyst's recommendations
  if (agentConfig.mode !== 'auto') {
    logger.info(`[Orchestrator] Mode is "${agentConfig.mode}" — skipping auto-execution`)
    return {
      analystResult,
      overallStatus: 'completed',
      summary: `Analysis completed with ${recommendations.length} recommendations. Mode is "${agentConfig.mode}" — not auto-executing.`,
    }
  }

  const executionInstructions = buildExecutionInstructions(analystResult.summary, recommendations)

  const executorResult = await runExecutor({
    agentConfig,
    organizationId,
    instructions: executionInstructions,
    fbToken,
    tiktokToken,
  })

  const overallStatus = executorResult.status === 'completed' ? 'completed' : 'partial'
  const duration = Date.now() - startTime

  logger.info(
    `[Orchestrator] Pipeline completed in ${duration}ms: analyst=${analystResult.status}, executor=${executorResult.status}`
  )

  return {
    analystResult,
    executorResult,
    overallStatus,
    summary: `Optimization pipeline completed. Analyst found ${recommendations.length} recommendations. Executor: ${executorResult.status}. Total: ${duration}ms.`,
  }
}

/**
 * Run user-directed agent interaction.
 * Routes the user's message to the appropriate agent.
 */
export async function runUserDirected(params: {
  agentConfig: AgentConfig
  organizationId?: string
  userId: string
  message: string
  agentRole?: 'planner' | 'analyst' | 'executor' | 'creative'
  fbToken?: string
  tiktokToken?: string
}): Promise<AgentRunResult> {
  const { agentConfig, organizationId, userId, message, agentRole, fbToken, tiktokToken } = params

  // Route to the appropriate agent
  const role = agentRole || detectAgentRole(message)

  logger.info(`[Orchestrator] Routing user message to ${role} agent`)

  switch (role) {
    case 'analyst':
      return runAnalyst({
        agentConfig,
        organizationId,
        userId,
        userMessage: message,
        fbToken,
        tiktokToken,
      })

    case 'executor':
      return runExecutor({
        agentConfig,
        organizationId,
        userId,
        instructions: message,
        fbToken,
        tiktokToken,
      })

    case 'planner':
      return runPlanner({
        agentConfig,
        organizationId,
        userId,
        planningRequest: message,
        fbToken,
        tiktokToken,
      })

    case 'creative':
      return runCreativeAgent({
        agentConfig,
        organizationId,
        userId,
        userMessage: message,
        fbToken,
      })

    default:
      // Default to analyst for general questions
      return runAnalyst({
        agentConfig,
        organizationId,
        userId,
        userMessage: message,
        fbToken,
        tiktokToken,
      })
  }
}

/**
 * Detect which agent should handle a message based on intent
 */
function detectAgentRole(message: string): 'planner' | 'analyst' | 'executor' | 'creative' {
  const lower = message.toLowerCase()

  // Planner keywords
  if (
    lower.includes('plan') || lower.includes('strategy') || lower.includes('launch') ||
    lower.includes('new campaign') || lower.includes('design') || lower.includes('structure')
  ) {
    return 'planner'
  }

  // Executor keywords
  if (
    lower.includes('pause') || lower.includes('resume') || lower.includes('create') ||
    lower.includes('adjust budget') || lower.includes('increase') || lower.includes('decrease') ||
    lower.includes('execute') || lower.includes('stop') || lower.includes('turn off')
  ) {
    return 'executor'
  }

  // Creative keywords
  if (
    lower.includes('creative') || lower.includes('material') || lower.includes('fatigue') ||
    lower.includes('image') || lower.includes('video') || lower.includes('asset')
  ) {
    return 'creative'
  }

  // Default: analyst
  return 'analyst'
}

/**
 * Extract structured recommendations from analyst output
 */
function extractRecommendations(summary: string): any[] {
  try {
    // Try to find JSON block in the summary
    const jsonMatch = summary.match(/```json\s*([\s\S]*?)```/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1])
      return parsed.recommendations || []
    }

    // Try parsing the whole thing as JSON
    const parsed = JSON.parse(summary)
    return parsed.recommendations || []
  } catch {
    // No structured JSON found — check for keyword-based recommendations
    const lines = summary.split('\n')
    const recs: any[] = []
    for (const line of lines) {
      if (line.includes('SCALE') || line.includes('PAUSE') || line.includes('REDUCE')) {
        recs.push({ action: line.trim(), priority: 'medium' })
      }
    }
    return recs
  }
}

/**
 * Build execution instructions from analyst recommendations
 */
function buildExecutionInstructions(analysisSummary: string, recommendations: any[]): string {
  const instructions = [
    'Execute the following recommendations from the performance analysis:',
    '',
    'Analysis Summary:',
    analysisSummary.substring(0, 2000),
    '',
    'Specific actions to take:',
  ]

  for (let i = 0; i < recommendations.length && i < 20; i++) {
    const rec = recommendations[i]
    if (typeof rec === 'string') {
      instructions.push(`${i + 1}. ${rec}`)
    } else {
      instructions.push(
        `${i + 1}. ${rec.action} - ${rec.entityType || ''} ${rec.entityId || ''}: ${rec.reason || rec.action}`
      )
    }
  }

  instructions.push(
    '',
    'Execute each action in order. Skip any that fail guardrail checks. Report results for each.'
  )

  return instructions.join('\n')
}

export default {
  runOptimizationPipeline,
  runUserDirected,
}
