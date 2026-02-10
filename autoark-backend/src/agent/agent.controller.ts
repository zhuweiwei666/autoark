/**
 * Agent V2 API Controller
 * 
 * New endpoints for the agent-first architecture:
 * - POST /api/v2/agent/chat          — Chat with the agent (routes to appropriate sub-agent)
 * - POST /api/v2/agent/analyze        — Run analyst on all campaigns
 * - POST /api/v2/agent/plan           — Run planner for campaign strategy
 * - POST /api/v2/agent/execute        — Run executor with specific instructions
 * - POST /api/v2/agent/creative       — Run creative analysis
 * - POST /api/v2/agent/optimize       — Run full optimization pipeline (analyst → executor)
 * - GET  /api/v2/agent/sessions       — List agent sessions
 * - GET  /api/v2/agent/sessions/:id   — Get session details
 * - GET  /api/v2/agent/decisions       — List agent decisions
 * - GET  /api/v2/agent/tools          — List available tools
 */

import { Router, Request, Response } from 'express'
import { authenticate } from '../middlewares/auth'
import {
  runAnalyst,
  runExecutor,
  runPlanner,
  runCreativeAgent,
  runOptimizationPipeline,
  runUserDirected,
  toolRegistry,
} from './index'
import { AgentConfig, DEFAULT_PERMISSIONS } from './core/agent.types'
import Session from './memory/session.model'
import Decision from './memory/decision.model'
import Knowledge from './memory/knowledge.model'
import { AgentConfig as AgentConfigModel } from '../domain/agent/agent.model'
import FbToken from '../models/FbToken'
import logger from '../utils/logger'

const router = Router()

// All routes require authentication
router.use(authenticate)

/**
 * Build AgentConfig from the DB model (bridge old → new)
 */
async function buildAgentConfig(agentDoc: any): Promise<AgentConfig> {
  return {
    id: agentDoc._id.toString(),
    name: agentDoc.name,
    description: agentDoc.description,
    organizationId: agentDoc.organizationId?.toString(),
    role: 'analyst', // default, overridden per-call
    mode: agentDoc.mode || 'observe',
    status: agentDoc.status || 'active',
    permissions: {
      canPublishAds: agentDoc.permissions?.canPublishAds ?? false,
      canToggleStatus: agentDoc.permissions?.canToggleStatus ?? true,
      canAdjustBudget: agentDoc.permissions?.canAdjustBudget ?? true,
      canAdjustBid: agentDoc.permissions?.canAdjustBid ?? false,
      canPause: agentDoc.permissions?.canPause ?? true,
      canResume: agentDoc.permissions?.canResume ?? true,
      canCreateCampaigns: agentDoc.permissions?.canPublishAds ?? false,
      canModifyTargeting: agentDoc.permissions?.canPublishAds ?? false,
      canModifyCreatives: agentDoc.permissions?.canPublishAds ?? false,
    },
    scope: {
      adAccountIds: agentDoc.scope?.adAccountIds || agentDoc.accountIds || [],
      fbTokenIds: (agentDoc.scope?.fbTokenIds || []).map((id: any) => id.toString()),
      tiktokTokenIds: (agentDoc.scope?.tiktokTokenIds || []).map((id: any) => id.toString()),
      facebookAppIds: (agentDoc.scope?.facebookAppIds || []).map((id: any) => id.toString()),
    },
    objectives: {
      targetRoas: agentDoc.objectives?.targetRoas,
      maxCpa: agentDoc.objectives?.maxCpa,
      dailyBudgetLimit: agentDoc.objectives?.dailyBudgetLimit,
      monthlyBudgetLimit: agentDoc.objectives?.monthlyBudgetLimit,
    },
    maxIterations: 25,
    temperature: 0.2,
  }
}

/**
 * Resolve FB token for the agent
 */
async function resolveAgentToken(agentDoc: any): Promise<string | undefined> {
  const tokenIds = agentDoc.scope?.fbTokenIds || []
  if (tokenIds.length > 0) {
    const tokenDoc = await FbToken.findOne({
      _id: { $in: tokenIds },
      status: 'active',
    }).lean() as any
    if (tokenDoc) return tokenDoc.token
  }

  if (agentDoc.organizationId) {
    const tokenDoc = await FbToken.findOne({
      organizationId: agentDoc.organizationId,
      status: 'active',
    }).lean() as any
    if (tokenDoc) return tokenDoc.token
  }

  return undefined
}

// ==================== Chat Endpoint ====================

router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { agentId, message, agentRole } = req.body
    if (!agentId || !message) {
      return res.status(400).json({ success: false, error: 'agentId and message are required' })
    }

    const agentDoc = await AgentConfigModel.findById(agentId)
    if (!agentDoc) {
      return res.status(404).json({ success: false, error: 'Agent not found' })
    }

    const agentConfig = await buildAgentConfig(agentDoc)
    const fbToken = await resolveAgentToken(agentDoc)

    const result = await runUserDirected({
      agentConfig,
      organizationId: agentDoc.organizationId?.toString(),
      userId: (req as any).user?.id,
      message,
      agentRole,
      fbToken,
    })

    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[AgentV2] Chat error:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== Analyze Endpoint ====================

router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { agentId, message } = req.body
    if (!agentId) {
      return res.status(400).json({ success: false, error: 'agentId is required' })
    }

    const agentDoc = await AgentConfigModel.findById(agentId)
    if (!agentDoc) {
      return res.status(404).json({ success: false, error: 'Agent not found' })
    }

    const agentConfig = await buildAgentConfig(agentDoc)
    const fbToken = await resolveAgentToken(agentDoc)

    const result = await runAnalyst({
      agentConfig,
      organizationId: agentDoc.organizationId?.toString(),
      userId: (req as any).user?.id,
      userMessage: message,
      fbToken,
    })

    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[AgentV2] Analyze error:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== Plan Endpoint ====================

router.post('/plan', async (req: Request, res: Response) => {
  try {
    const { agentId, planningRequest } = req.body
    if (!agentId || !planningRequest) {
      return res.status(400).json({ success: false, error: 'agentId and planningRequest are required' })
    }

    const agentDoc = await AgentConfigModel.findById(agentId)
    if (!agentDoc) {
      return res.status(404).json({ success: false, error: 'Agent not found' })
    }

    const agentConfig = await buildAgentConfig(agentDoc)
    const fbToken = await resolveAgentToken(agentDoc)

    const result = await runPlanner({
      agentConfig,
      organizationId: agentDoc.organizationId?.toString(),
      userId: (req as any).user?.id,
      planningRequest,
      fbToken,
    })

    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[AgentV2] Plan error:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== Execute Endpoint ====================

router.post('/execute', async (req: Request, res: Response) => {
  try {
    const { agentId, instructions } = req.body
    if (!agentId || !instructions) {
      return res.status(400).json({ success: false, error: 'agentId and instructions are required' })
    }

    const agentDoc = await AgentConfigModel.findById(agentId)
    if (!agentDoc) {
      return res.status(404).json({ success: false, error: 'Agent not found' })
    }

    const agentConfig = await buildAgentConfig(agentDoc)
    const fbToken = await resolveAgentToken(agentDoc)

    const result = await runExecutor({
      agentConfig,
      organizationId: agentDoc.organizationId?.toString(),
      userId: (req as any).user?.id,
      instructions,
      fbToken,
    })

    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[AgentV2] Execute error:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== Creative Endpoint ====================

router.post('/creative', async (req: Request, res: Response) => {
  try {
    const { agentId, message } = req.body
    if (!agentId) {
      return res.status(400).json({ success: false, error: 'agentId is required' })
    }

    const agentDoc = await AgentConfigModel.findById(agentId)
    if (!agentDoc) {
      return res.status(404).json({ success: false, error: 'Agent not found' })
    }

    const agentConfig = await buildAgentConfig(agentDoc)
    const fbToken = await resolveAgentToken(agentDoc)

    const result = await runCreativeAgent({
      agentConfig,
      organizationId: agentDoc.organizationId?.toString(),
      userId: (req as any).user?.id,
      userMessage: message,
      fbToken,
    })

    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[AgentV2] Creative error:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== Full Optimization Pipeline ====================

router.post('/optimize', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.body
    if (!agentId) {
      return res.status(400).json({ success: false, error: 'agentId is required' })
    }

    const agentDoc = await AgentConfigModel.findById(agentId)
    if (!agentDoc) {
      return res.status(404).json({ success: false, error: 'Agent not found' })
    }

    const agentConfig = await buildAgentConfig(agentDoc)
    const fbToken = await resolveAgentToken(agentDoc)

    const result = await runOptimizationPipeline({
      agentConfig,
      organizationId: agentDoc.organizationId?.toString(),
      fbToken,
    })

    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[AgentV2] Optimize error:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== Session & Decision History ====================

router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const { agentId, status, limit = '20', offset = '0' } = req.query
    const query: any = {}
    if (agentId) query.agentId = agentId
    if (status) query.status = status

    const sessions = await Session.find(query)
      .select('sessionId agentId agentRole status summary totalIterations totalToolCalls durationMs createdAt inputContext')
      .sort({ createdAt: -1 })
      .skip(Number(offset))
      .limit(Number(limit))
      .lean()

    const total = await Session.countDocuments(query)
    res.json({ success: true, data: sessions, total })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.get('/sessions/:sessionId', async (req: Request, res: Response) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.sessionId }).lean()
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' })
    }
    res.json({ success: true, data: session })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.get('/decisions', async (req: Request, res: Response) => {
  try {
    const { agentId, entityId, action, limit = '50', offset = '0' } = req.query
    const query: any = {}
    if (agentId) query.agentId = agentId
    if (entityId) query.entityId = entityId
    if (action) query.action = action

    const decisions = await Decision.find(query)
      .sort({ createdAt: -1 })
      .skip(Number(offset))
      .limit(Number(limit))
      .lean()

    const total = await Decision.countDocuments(query)
    res.json({ success: true, data: decisions, total })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== Tools Info ====================

router.get('/tools', async (_req: Request, res: Response) => {
  try {
    const declarations = toolRegistry.toFunctionDeclarations()
    res.json({
      success: true,
      data: declarations.map(d => ({
        name: d.name,
        description: d.description,
        parameters: d.parameters,
      })),
      total: declarations.length,
    })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== Knowledge Base ====================

router.get('/knowledge', async (req: Request, res: Response) => {
  try {
    const { category, limit = '20' } = req.query
    const query: any = {}
    if (category) query.category = category

    const knowledge = await Knowledge.find(query)
      .sort({ confidence: -1, updatedAt: -1 })
      .limit(Number(limit))
      .lean()

    res.json({ success: true, data: knowledge })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
