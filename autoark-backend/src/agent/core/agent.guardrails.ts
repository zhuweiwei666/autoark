/**
 * Agent Guardrails
 * 
 * Safety middleware that checks every tool call before execution:
 * - Permission checks (RBAC)
 * - Budget limits
 * - Cooldown periods (prevent oscillation)
 * - Spend velocity monitoring
 * - Human-in-the-loop triggers
 * - Max iterations protection
 */

import logger from '../../utils/logger'
import { getRedisClient as getRedis } from '../../config/redis'
import {
  AgentContext,
  ToolDefinition,
  GuardrailCheckResult,
} from './agent.types'
import Decision from '../memory/decision.model'

const COOLDOWN_PREFIX = 'agent:cooldown:'
const TOOL_CALL_COUNT_PREFIX = 'agent:toolcalls:'

class GuardrailService {
  /**
   * Check if a tool call is allowed.
   * Returns approval status with reason.
   */
  async check(
    tool: ToolDefinition,
    args: Record<string, any>,
    context: AgentContext
  ): Promise<GuardrailCheckResult> {
    const warnings: string[] = []

    // 1. Permission check
    if (tool.guardrails?.requiredPermission) {
      const perm = tool.guardrails.requiredPermission
      if (!context.permissions[perm]) {
        return {
          approved: false,
          reason: `Permission denied: agent lacks "${perm}" permission`,
        }
      }
    }

    // 2. Mode check -- observe mode blocks all write operations
    if (context.mode === 'observe') {
      const writeTools = [
        'create_campaign', 'create_adset', 'create_ad', 'create_ad_creative',
        'update_campaign', 'update_adset', 'update_ad',
        'pause_entity', 'resume_entity', 'adjust_budget',
        'upload_image', 'upload_video',
      ]
      if (writeTools.includes(tool.name)) {
        return {
          approved: false,
          reason: `Mode "observe" does not allow write operations. Tool "${tool.name}" blocked.`,
        }
      }
    }

    // 3. Suggest mode requires human approval for write operations
    if (context.mode === 'suggest') {
      const writeTools = [
        'create_campaign', 'create_adset', 'create_ad', 'create_ad_creative',
        'update_campaign', 'update_adset', 'update_ad',
        'pause_entity', 'resume_entity', 'adjust_budget',
        'upload_image', 'upload_video',
      ]
      if (writeTools.includes(tool.name)) {
        return {
          approved: false,
          requiresHumanApproval: true,
          reason: `Mode "suggest" requires human approval for "${tool.name}".`,
        }
      }
    }

    // 4. Budget limit check
    if (tool.name === 'adjust_budget' || tool.name === 'create_campaign' || tool.name === 'create_adset') {
      const budgetCheck = await this.checkBudgetLimits(args, context)
      if (!budgetCheck.approved) return budgetCheck
      if (budgetCheck.warnings) warnings.push(...budgetCheck.warnings)
    }

    // 5. Cooldown check (prevent rapid oscillation)
    if (tool.guardrails?.cooldownMinutes) {
      const cooldownCheck = await this.checkCooldown(
        tool.name,
        args.entityId || args.campaignId || args.adsetId || args.adId,
        tool.guardrails.cooldownMinutes,
        context
      )
      if (!cooldownCheck.approved) return cooldownCheck
    }

    // 6. Max calls per run check
    if (tool.guardrails?.maxCallsPerRun) {
      const callCount = await this.getToolCallCount(tool.name, context.sessionId)
      if (callCount >= tool.guardrails.maxCallsPerRun) {
        return {
          approved: false,
          reason: `Tool "${tool.name}" has reached max calls per run (${tool.guardrails.maxCallsPerRun}).`,
        }
      }
    }

    // 7. Budget change magnitude check
    if (tool.guardrails?.maxChangePercent && args.newBudget && args.currentBudget) {
      const changePercent = Math.abs(
        ((args.newBudget - args.currentBudget) / args.currentBudget) * 100
      )
      if (changePercent > tool.guardrails.maxChangePercent) {
        return {
          approved: false,
          reason: `Budget change of ${changePercent.toFixed(1)}% exceeds max allowed ${tool.guardrails.maxChangePercent}%. Reduce the change amount.`,
        }
      }
    }

    // Increment tool call counter
    await this.incrementToolCallCount(tool.name, context.sessionId)

    return { approved: true, warnings: warnings.length > 0 ? warnings : undefined }
  }

  /**
   * Check if the budget change is within organization limits
   */
  private async checkBudgetLimits(
    args: Record<string, any>,
    context: AgentContext
  ): Promise<GuardrailCheckResult> {
    const warnings: string[] = []
    const dailyLimit = context.objectives.dailyBudgetLimit

    if (dailyLimit && args.dailyBudget) {
      if (args.dailyBudget > dailyLimit) {
        return {
          approved: false,
          reason: `Daily budget $${args.dailyBudget} exceeds limit of $${dailyLimit}`,
        }
      }
      if (args.dailyBudget > dailyLimit * 0.8) {
        warnings.push(`Daily budget $${args.dailyBudget} is above 80% of limit ($${dailyLimit})`)
      }
    }

    // Check minimum budget
    const minBudget = 5 // $5 minimum
    if (args.dailyBudget && args.dailyBudget < minBudget) {
      return {
        approved: false,
        reason: `Daily budget $${args.dailyBudget} is below minimum of $${minBudget}`,
      }
    }

    return { approved: true, warnings: warnings.length > 0 ? warnings : undefined }
  }

  /**
   * Check cooldown period for an entity+action combination.
   * Prevents rapid oscillation (e.g., pause then resume within minutes).
   */
  private async checkCooldown(
    toolName: string,
    entityId: string | undefined,
    cooldownMinutes: number,
    context: AgentContext
  ): Promise<GuardrailCheckResult> {
    if (!entityId) return { approved: true }

    try {
      const redis = getRedis()
      if (!redis) {
        // If Redis is not available, fall back to MongoDB check
        return this.checkCooldownFromDb(toolName, entityId, cooldownMinutes, context)
      }

      const key = `${COOLDOWN_PREFIX}${entityId}:${toolName}`
      const existing = await redis.get(key)

      if (existing) {
        const cooldownUntil = new Date(existing)
        return {
          approved: false,
          reason: `Cooldown active for "${toolName}" on entity ${entityId}. Available after ${cooldownUntil.toISOString()}.`,
          cooldownUntil,
        }
      }

      // Set cooldown
      const cooldownUntil = new Date(Date.now() + cooldownMinutes * 60 * 1000)
      await redis.set(key, cooldownUntil.toISOString(), 'EX', cooldownMinutes * 60)

      return { approved: true }
    } catch (error) {
      logger.warn('[Guardrails] Redis cooldown check failed, falling back to DB:', error)
      return this.checkCooldownFromDb(toolName, entityId, cooldownMinutes, context)
    }
  }

  /**
   * Fallback cooldown check using MongoDB
   */
  private async checkCooldownFromDb(
    toolName: string,
    entityId: string,
    cooldownMinutes: number,
    _context: AgentContext
  ): Promise<GuardrailCheckResult> {
    const cutoff = new Date(Date.now() - cooldownMinutes * 60 * 1000)
    const recentDecision = await Decision.findOne({
      entityId,
      toolName,
      createdAt: { $gt: cutoff },
      status: { $in: ['executed', 'approved'] },
    }).lean()

    if (recentDecision) {
      const cooldownUntil = new Date(
        new Date(recentDecision.createdAt).getTime() + cooldownMinutes * 60 * 1000
      )
      return {
        approved: false,
        reason: `Cooldown active for "${toolName}" on entity ${entityId}. Last action at ${new Date(recentDecision.createdAt).toISOString()}.`,
        cooldownUntil,
      }
    }

    return { approved: true }
  }

  /**
   * Get tool call count for this session
   */
  private async getToolCallCount(toolName: string, sessionId: string): Promise<number> {
    try {
      const redis = getRedis()
      if (!redis) return 0
      const key = `${TOOL_CALL_COUNT_PREFIX}${sessionId}:${toolName}`
      const count = await redis.get(key)
      return count ? parseInt(count, 10) : 0
    } catch {
      return 0
    }
  }

  /**
   * Increment tool call counter for this session
   */
  private async incrementToolCallCount(toolName: string, sessionId: string): Promise<void> {
    try {
      const redis = getRedis()
      if (!redis) return
      const key = `${TOOL_CALL_COUNT_PREFIX}${sessionId}:${toolName}`
      await redis.incr(key)
      await redis.expire(key, 3600) // 1 hour TTL
    } catch {
      // Non-critical, ignore
    }
  }
}

export const guardrailService = new GuardrailService()
export default guardrailService
