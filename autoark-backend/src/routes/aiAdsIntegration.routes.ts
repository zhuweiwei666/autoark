import { Request, Response, Router } from 'express'
import {
  authenticateAiAdsIntegration,
  rateLimitAiAdsIntegration,
} from '../middlewares/aiAdsIntegrationAuth'
import {
  AiAdsQueryError,
  getAiAdsIntegrationData,
  parseAiAdsQuery,
} from '../services/aiAdsIntegration.service'
import logger from '../utils/logger'

const router = Router()

router.use(rateLimitAiAdsIntegration, authenticateAiAdsIntegration)

router.get('/', async (req: Request, res: Response) => {
  try {
    const query = parseAiAdsQuery(req.query as Record<string, unknown>)
    const result = await getAiAdsIntegrationData(query)
    res.json(result)
  } catch (error: any) {
    if (error instanceof AiAdsQueryError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      })
      return
    }
    logger.error('[AiAdsIntegration] Query failed', {
      requestId: req.requestId,
      message: error?.message,
    })
    res.status(500).json({
      success: false,
      error: 'Failed to query AI ads data',
    })
  }
})

export default router
