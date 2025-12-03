import { Request, Response } from 'express'
import { OptimizerRunner } from '../domain/optimizer/optimizer.runner'
import { SimpleRoasPolicy } from '../domain/optimizer/policies/simpleRoas.policy'
import { StopLossPolicy } from '../domain/optimizer/policies/stopLoss.policy'
import Campaign from '../models/Campaign'
import logger from '../utils/logger'

// 初始化 Runner，注入策略
// 策略顺序很重要：先检查止损，再做常规优化
const runner = new OptimizerRunner([
  new StopLossPolicy(),
  new SimpleRoasPolicy(),
])

/**
 * 手动触发优化 (单个 Campaign)
 */
export const runOptimizationForCampaign = async (req: Request, res: Response) => {
  const { campaignId } = req.params
  
  // 异步执行
  runner.runForCampaign(campaignId).catch(err => {
    logger.error(`[Optimizer] Manual run failed for ${campaignId}:`, err)
  })

  res.json({ success: true, message: 'Optimization queued' })
}

/**
 * 批量触发优化 (所有活跃 Campaign)
 */
export const runBatchOptimization = async (req: Request, res: Response) => {
  const campaigns = await Campaign.find({ status: 'ACTIVE' }).select('campaignId').lean()
  
  logger.info(`[Optimizer] Starting batch optimization for ${campaigns.length} campaigns`)
  
  // 简单的并发控制
  const batchSize = 10
  for (let i = 0; i < campaigns.length; i += batchSize) {
    const batch = campaigns.slice(i, i + batchSize)
    await Promise.all(batch.map(c => runner.runForCampaign(c.campaignId)))
  }

  res.json({ success: true, message: `Optimization started for ${campaigns.length} campaigns` })
}

