import { MetricsDaily, OpsLog, AdSet } from '../models'
import * as analyzer from './analyzer'
import * as recommender from './recommender'
import logger from '../utils/logger'

export const runAiOptimizerForAdSet = async (adsetId: string) => {
  logger.info(`[AI Optimizer] Running for AdSet: ${adsetId}`)

  // 1. Fetch last 7 days metrics
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 7)

  const metrics = await MetricsDaily.find({
    adsetId,
    date: {
      $gte: startDate.toISOString().split('T')[0],
      $lte: endDate.toISOString().split('T')[0],
    },
  }).sort({ date: 1 })

  if (metrics.length === 0) {
    logger.info(
      `[AI Optimizer] No metrics found for AdSet ${adsetId}, skipping.`,
    )
    return null
  }

  // 2. Analyze with LLM
  const analysisResult = await analyzer.analyzeMetrics(metrics)

  // 3. Generate Recommendations
  const recommendedActions = recommender.mapRecommendations(analysisResult)

  // 4. Log/Persist Results
  const decisionRecord = {
    adsetId,
    analysis: analysisResult.analysis,
    reasoning: analysisResult.reasoning,
    actions: recommendedActions,
    timestamp: new Date(),
  }

  // Log to OpsLog for visibility
  if (recommendedActions.length > 0) {
    await OpsLog.create({
      operator: 'AI_Optimizer_Agent',
      channel: metrics[0].channel || 'unknown',
      action: 'AI_PROPOSAL',
      before: {},
      after: { decision: decisionRecord },
      reason: analysisResult.analysis,
      related: {
        adsetId,
        confidence: recommendedActions.map((a) => a.confidence),
      },
    })
  }

  logger.info(
    `[AI Optimizer] Finished for AdSet ${adsetId}. Actions proposed: ${recommendedActions.length}`,
  )
  return decisionRecord
}

export const runAiOptimizerDaily = async () => {
  logger.info('Starting Daily AI Optimizer Execution...')

  // Get all active AdSets (mocking by distinct adSetIds from recent metrics for now)
  // In real implementation, query AdSet model where status = 'ACTIVE'
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  const activeAdSets = await MetricsDaily.distinct('adsetId', {
    date: yesterday,
  })

  logger.info(
    `[AI Optimizer] Found ${activeAdSets.length} active AdSets to analyze.`,
  )

  let processedCount = 0
  for (const adsetId of activeAdSets) {
    try {
      await runAiOptimizerForAdSet(adsetId)
      processedCount++
    } catch (error) {
      logger.error(`[AI Optimizer] Error processing AdSet ${adsetId}`, error)
    }
  }

  logger.info(
    `Daily AI Optimizer Execution Completed. Processed ${processedCount} AdSets.`,
  )
}
