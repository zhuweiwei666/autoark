import { Router } from 'express'
import * as facebookSyncController from '../controllers/facebook.sync.controller'

const router = Router()

router.get('/sync/run', facebookSyncController.runSync)
router.get('/sync/status', facebookSyncController.getStatus)

export default router
