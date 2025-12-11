import { Router, Request, Response } from 'express'
import { agentService } from './agent.service'
import { AgentConfig, AgentOperation, DailyReport, AiConversation } from './agent.model'
import logger from '../../utils/logger'

const router = Router()

// ==================== Agent 配置 CRUD ====================

// 获取所有 Agent
router.get('/agents', async (req: Request, res: Response) => {
  try {
    const agents = await agentService.getAgents()
    res.json({ success: true, data: agents })
  } catch (error: any) {
    logger.error('[AgentController] Get agents failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 获取单个 Agent
router.get('/agents/:id', async (req: Request, res: Response) => {
  try {
    const agent = await agentService.getAgentById(req.params.id)
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' })
    }
    res.json({ success: true, data: agent })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 创建 Agent
router.post('/agents', async (req: Request, res: Response) => {
  try {
    const agent = await agentService.createAgent(req.body)
    res.status(201).json({ success: true, data: agent })
  } catch (error: any) {
    logger.error('[AgentController] Create agent failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 更新 Agent
router.put('/agents/:id', async (req: Request, res: Response) => {
  try {
    const agent = await agentService.updateAgent(req.params.id, req.body)
    res.json({ success: true, data: agent })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 删除 Agent
router.delete('/agents/:id', async (req: Request, res: Response) => {
  try {
    await agentService.deleteAgent(req.params.id)
    res.json({ success: true })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 运行 Agent
router.post('/agents/:id/run', async (req: Request, res: Response) => {
  try {
    const result = await agentService.runAgent(req.params.id)
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[AgentController] Run agent failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== Agent 操作日志 ====================

// 获取待审批操作
router.get('/operations/pending', async (req: Request, res: Response) => {
  try {
    const operations = await agentService.getPendingOperations()
    res.json({ success: true, data: operations })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 获取操作历史
router.get('/operations', async (req: Request, res: Response) => {
  try {
    const { status, agentId, accountId, limit = 50 } = req.query
    const query: any = {}
    if (status) query.status = status
    if (agentId) query.agentId = agentId
    if (accountId) query.accountId = accountId
    
    const operations = await AgentOperation.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
    res.json({ success: true, data: operations })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 审批操作
router.post('/operations/:id/approve', async (req: Request, res: Response) => {
  try {
    const result = await agentService.approveOperation(req.params.id, 'user')
    res.json({ success: true, data: result })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 拒绝操作
router.post('/operations/:id/reject', async (req: Request, res: Response) => {
  try {
    const result = await agentService.rejectOperation(req.params.id, 'user', req.body.reason)
    res.json({ success: true, data: result })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 每日报告 ====================

// 生成报告
router.post('/reports/generate', async (req: Request, res: Response) => {
  try {
    const { date, accountId } = req.body
    const reportDate = date || new Date().toISOString().split('T')[0]
    const report = await agentService.generateDailyReport(reportDate, accountId)
    res.json({ success: true, data: report })
  } catch (error: any) {
    logger.error('[AgentController] Generate report failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 获取报告列表
router.get('/reports', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, accountId, limit = 30 } = req.query
    const query: any = {}
    
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate }
    } else if (startDate) {
      query.date = { $gte: startDate }
    } else if (endDate) {
      query.date = { $lte: endDate }
    }
    
    if (accountId) query.accountId = accountId
    
    const reports = await DailyReport.find(query)
      .sort({ date: -1 })
      .limit(Number(limit))
    res.json({ success: true, data: reports })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 获取单个报告
router.get('/reports/:id', async (req: Request, res: Response) => {
  try {
    const report = await DailyReport.findById(req.params.id)
    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' })
    }
    res.json({ success: true, data: report })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 获取最新报告
router.get('/reports/latest', async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    const query: any = { status: 'ready' }
    if (accountId) query.accountId = accountId
    
    const report = await DailyReport.findOne(query).sort({ date: -1 })
    res.json({ success: true, data: report })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== AI 对话 ====================

// 发送消息
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, context } = req.body
    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required' })
    }
    
    const response = await agentService.chat('default-user', message, context)
    res.json({ success: true, data: { response } })
  } catch (error: any) {
    logger.error('[AgentController] Chat failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 获取对话历史
router.get('/chat/history', async (req: Request, res: Response) => {
  try {
    const { limit = 10 } = req.query
    const conversations = await AiConversation.find({ userId: 'default-user' })
      .sort({ createdAt: -1 })
      .limit(Number(limit))
    res.json({ success: true, data: conversations })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 清除对话
router.delete('/chat/clear', async (req: Request, res: Response) => {
  try {
    await AiConversation.updateMany(
      { userId: 'default-user', status: 'active' },
      { status: 'closed' }
    )
    res.json({ success: true })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 数据分析 ====================

// 获取账户健康度分析
router.get('/analysis/health', async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    
    // 获取最近 7 天数据
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 7)
    
    const query: any = {
      date: { $gte: startDate.toISOString().split('T')[0] },
      campaignId: { $exists: true, $ne: null },
    }
    if (accountId) query.accountId = accountId
    
    const data = await require('../../models/MetricsDaily').default.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$date',
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          conversions: { $sum: { $ifNull: ['$conversions', 0] } },
        }
      },
      { $sort: { _id: 1 } },
      {
        $addFields: {
          roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
          ctr: { $cond: [{ $gt: ['$impressions', 0] }, { $divide: ['$clicks', '$impressions'] }, 0] },
        }
      }
    ])
    
    // 计算健康度评分
    const totalSpend = data.reduce((sum: number, d: any) => sum + d.spend, 0)
    const totalRevenue = data.reduce((sum: number, d: any) => sum + d.revenue, 0)
    const avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0
    
    let healthScore = 50 // 基础分
    if (avgRoas > 2) healthScore += 30
    else if (avgRoas > 1.5) healthScore += 20
    else if (avgRoas > 1) healthScore += 10
    else if (avgRoas < 0.5) healthScore -= 20
    
    // 趋势加分
    if (data.length >= 3) {
      const recent = data.slice(-3)
      const older = data.slice(0, -3)
      const recentRoas = recent.reduce((s: number, d: any) => s + d.roas, 0) / recent.length
      const olderRoas = older.length > 0 ? older.reduce((s: number, d: any) => s + d.roas, 0) / older.length : recentRoas
      if (recentRoas > olderRoas) healthScore += 10
      else if (recentRoas < olderRoas * 0.8) healthScore -= 10
    }
    
    healthScore = Math.max(0, Math.min(100, healthScore))
    
    res.json({
      success: true,
      data: {
        healthScore,
        trend: data,
        summary: {
          totalSpend,
          totalRevenue,
          avgRoas,
          days: data.length,
        },
        status: healthScore >= 70 ? 'healthy' : healthScore >= 40 ? 'attention' : 'critical',
      }
    })
  } catch (error: any) {
    logger.error('[AgentController] Health analysis failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 获取 AI 分析建议
router.post('/analysis/suggest', async (req: Request, res: Response) => {
  try {
    const { accountId, campaignId, question } = req.body
    
    const context: any = {}
    if (accountId) context.accountId = accountId
    if (campaignId) context.campaignId = campaignId
    
    const prompt = question || '请分析当前投放情况并给出优化建议'
    const response = await agentService.chat('default-user', prompt, context)
    
    res.json({ success: true, data: { response } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 素材 AI 分析 ====================

// 🤖 AI 分析单个素材
router.get('/materials/:id/analyze', async (req: Request, res: Response) => {
  try {
    const result = await agentService.analyzeMaterialWithAI(req.params.id)
    res.json(result)
  } catch (error: any) {
    logger.error('[AgentController] Material AI analysis failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 🤖 批量 AI 分析素材
router.post('/materials/analyze-batch', async (req: Request, res: Response) => {
  try {
    const { materialIds } = req.body
    if (!materialIds || !Array.isArray(materialIds)) {
      return res.status(400).json({ success: false, error: 'materialIds array is required' })
    }
    const results = await agentService.batchAnalyzeMaterials(materialIds)
    res.json({ success: true, data: results })
  } catch (error: any) {
    logger.error('[AgentController] Batch material analysis failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 🤖 获取 AI 推荐的素材操作
router.get('/materials/recommendations', async (req: Request, res: Response) => {
  try {
    const result = await agentService.getAIRecommendedActions()
    res.json(result)
  } catch (error: any) {
    logger.error('[AgentController] Get AI recommendations failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router

