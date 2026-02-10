/**
 * Agent Memory Service
 * 
 * Manages three tiers of memory:
 * - Short-term: Current conversation context (in-memory per session)
 * - Working: Active campaign states, recent decisions (Redis)
 * - Long-term: Decision history + outcomes, knowledge (MongoDB)
 * 
 * Provides context building for agent prompts.
 */

import logger from '../../utils/logger'
import { getRedisClient as getRedis } from '../../config/redis'
import Decision from '../memory/decision.model'
import Knowledge from '../memory/knowledge.model'
import Session from '../memory/session.model'
import {
  AgentContext,
  ConversationMessage,
  DecisionRecord,
  KnowledgeEntry,
  ToolCallRecord,
} from './agent.types'

const WORKING_MEMORY_PREFIX = 'agent:working:'
const WORKING_MEMORY_TTL = 3600 * 4 // 4 hours

class MemoryService {
  // ==================== Short-term Memory (Session) ====================

  /**
   * Create a new session record
   */
  async createSession(params: {
    sessionId: string
    agentId: string
    organizationId?: string
    userId?: string
    triggerType: 'user_chat' | 'scheduled_run' | 'api_trigger' | 'orchestrator'
    agentRole: string
    inputContext?: string
    parentSessionId?: string
  }): Promise<void> {
    try {
      await Session.create(params)
      logger.debug(`[Memory] Created session: ${params.sessionId}`)
    } catch (error: any) {
      logger.error(`[Memory] Failed to create session:`, error.message)
    }
  }

  /**
   * Update session with results
   */
  async updateSession(
    sessionId: string,
    updates: {
      status?: string
      summary?: string
      messages?: any[]
      toolCalls?: any[]
      decisionIds?: string[]
      totalIterations?: number
      totalToolCalls?: number
      durationMs?: number
      error?: string
    }
  ): Promise<void> {
    try {
      await Session.updateOne({ sessionId }, { $set: updates })
    } catch (error: any) {
      logger.error(`[Memory] Failed to update session ${sessionId}:`, error.message)
    }
  }

  /**
   * Append tool calls to session
   */
  async appendToolCalls(sessionId: string, toolCalls: ToolCallRecord[]): Promise<void> {
    try {
      await Session.updateOne(
        { sessionId },
        {
          $push: { toolCalls: { $each: toolCalls } },
          $inc: { totalToolCalls: toolCalls.length },
        }
      )
    } catch (error: any) {
      logger.error(`[Memory] Failed to append tool calls:`, error.message)
    }
  }

  // ==================== Working Memory (Redis) ====================

  /**
   * Store a value in working memory (Redis)
   */
  async setWorking(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const redis = getRedis()
      if (!redis) return
      const fullKey = `${WORKING_MEMORY_PREFIX}${key}`
      await redis.set(fullKey, JSON.stringify(value), 'EX', ttl || WORKING_MEMORY_TTL)
    } catch (error: any) {
      logger.warn(`[Memory] Failed to set working memory:`, error.message)
    }
  }

  /**
   * Get a value from working memory
   */
  async getWorking<T = any>(key: string): Promise<T | null> {
    try {
      const redis = getRedis()
      if (!redis) return null
      const fullKey = `${WORKING_MEMORY_PREFIX}${key}`
      const data = await redis.get(fullKey)
      return data ? JSON.parse(data) : null
    } catch (error: any) {
      logger.warn(`[Memory] Failed to get working memory:`, error.message)
      return null
    }
  }

  // ==================== Long-term Memory (MongoDB) ====================

  /**
   * Record a decision to long-term memory
   */
  async recordDecision(decision: Omit<DecisionRecord, 'createdAt'>): Promise<string | null> {
    try {
      const doc = await Decision.create({ ...decision, createdAt: new Date() })
      logger.debug(`[Memory] Recorded decision: ${decision.action} on ${decision.entityId}`)
      return doc._id.toString()
    } catch (error: any) {
      logger.error(`[Memory] Failed to record decision:`, error.message)
      return null
    }
  }

  /**
   * Get recent decisions for an entity (for cooldown checks and context)
   */
  async getRecentDecisions(
    entityId: string,
    limit: number = 10,
    daysBack: number = 7
  ): Promise<any[]> {
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    return Decision.find({
      entityId,
      createdAt: { $gt: cutoff },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
  }

  /**
   * Get recent decisions for an agent (for context building)
   */
  async getAgentRecentDecisions(
    agentId: string,
    limit: number = 20,
    daysBack: number = 3
  ): Promise<any[]> {
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    return Decision.find({
      agentId,
      createdAt: { $gt: cutoff },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
  }

  /**
   * Store knowledge to long-term memory (upsert by key)
   */
  async storeKnowledge(entry: Omit<KnowledgeEntry, 'createdAt' | 'updatedAt'>): Promise<void> {
    try {
      await Knowledge.findOneAndUpdate(
        { key: entry.key, organizationId: entry.organizationId },
        {
          $set: {
            ...entry,
            updatedAt: new Date(),
            lastValidatedAt: new Date(),
          },
          $inc: { validationCount: 1 },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true, new: true }
      )
      logger.debug(`[Memory] Stored knowledge: ${entry.key}`)
    } catch (error: any) {
      logger.error(`[Memory] Failed to store knowledge:`, error.message)
    }
  }

  /**
   * Retrieve relevant knowledge for context building.
   * Searches by category, tags, and related entities.
   */
  async retrieveKnowledge(params: {
    organizationId?: string
    categories?: string[]
    tags?: string[]
    relatedEntities?: string[]
    limit?: number
  }): Promise<any[]> {
    const query: any = {}

    if (params.organizationId) {
      query.$or = [
        { organizationId: params.organizationId },
        { organizationId: { $exists: false } }, // global knowledge
      ]
    }
    if (params.categories && params.categories.length > 0) {
      query.category = { $in: params.categories }
    }
    if (params.tags && params.tags.length > 0) {
      query.tags = { $in: params.tags }
    }
    if (params.relatedEntities && params.relatedEntities.length > 0) {
      query.relatedEntities = { $in: params.relatedEntities }
    }

    return Knowledge.find(query)
      .sort({ confidence: -1, updatedAt: -1 })
      .limit(params.limit || 20)
      .lean()
  }

  // ==================== Context Building ====================

  /**
   * Build memory context string for the agent's system prompt.
   * Includes recent decisions, relevant knowledge, and working state.
   */
  async buildContextForAgent(context: AgentContext): Promise<string> {
    const parts: string[] = []

    // 1. Recent decisions by this agent
    const recentDecisions = await this.getAgentRecentDecisions(context.agentId, 10, 3)
    if (recentDecisions.length > 0) {
      parts.push('## Recent Agent Decisions (last 3 days)')
      for (const d of recentDecisions) {
        const outcome = d.outcome?.assessment ? ` → outcome: ${d.outcome.assessment}` : ''
        parts.push(
          `- [${new Date(d.createdAt).toISOString().slice(0, 16)}] ${d.action} on ${d.entityType}:${d.entityId} | Reason: ${d.reason}${outcome}`
        )
      }
    }

    // 2. Relevant knowledge
    const knowledge = await this.retrieveKnowledge({
      organizationId: context.organizationId,
      limit: 10,
    })
    if (knowledge.length > 0) {
      parts.push('\n## Accumulated Knowledge')
      for (const k of knowledge) {
        parts.push(`- [${k.category}] ${k.content} (confidence: ${k.confidence.toFixed(2)})`)
      }
    }

    // 3. Working memory state
    const workingState = await this.getWorking(`state:${context.agentId}`)
    if (workingState) {
      parts.push('\n## Current Working State')
      parts.push(JSON.stringify(workingState, null, 2))
    }

    return parts.length > 0 ? parts.join('\n') : 'No prior context available.'
  }
}

export const memoryService = new MemoryService()
export default memoryService
