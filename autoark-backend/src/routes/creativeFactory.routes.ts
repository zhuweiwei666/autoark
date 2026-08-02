import crypto from 'crypto'
import { NextFunction, Request, Response, Router } from 'express'
import * as controller from '../controllers/creativeFactory.controller'
import { authenticate } from '../middlewares/auth'

const router = Router()

const codexAuth = (req: Request, res: Response, next: NextFunction) => {
  const secret = process.env.CREATIVE_FACTORY_CODEX_SECRET || ''
  const signature = String(req.headers['x-codex-signature'] || '')
  if (!secret) {
    res
      .status(503)
      .json({ success: false, message: 'CREATIVE_FACTORY_CODEX_SECRET 未配置' })
    return
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body || {}))
    .digest('hex')
  const valid =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  if (!valid) {
    res.status(401).json({ success: false, message: 'Codex 签名无效' })
    return
  }
  next()
}

router.post('/codex/claim', codexAuth, controller.codexClaim)
router.post('/codex/catalog', codexAuth, controller.codexCatalog)
router.post(
  '/codex/jobs/:jobId/upload-url',
  codexAuth,
  controller.codexUploadUrl,
)
router.post('/codex/jobs/:jobId/plan', codexAuth, controller.codexPlan)
router.post('/codex/jobs/:jobId/refresh', codexAuth, controller.codexRefresh)
router.post('/codex/jobs/:jobId/complete', codexAuth, controller.codexComplete)
router.post('/codex/jobs/:jobId/fail', codexAuth, controller.codexFail)

router.use(authenticate)
router.get('/catalog', controller.catalog)
router.get('/batches', controller.listBatches)
router.post('/batches', controller.createBatch)
router.get('/batches/:batchId', controller.getBatch)
router.post('/jobs/:jobId/refresh', controller.refreshJob)

export default router
