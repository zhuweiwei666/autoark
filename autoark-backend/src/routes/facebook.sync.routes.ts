import { Router } from 'express'
import * as facebookSyncController from '../controllers/facebook.sync.controller'
import { authenticate, authorize } from '../middlewares/auth'
import { UserRole } from '../models/User'

const router = Router()

// Protect these endpoints: full sync is expensive and should not be public.
router.use(authenticate)
router.use(authorize(UserRole.SUPER_ADMIN))

router.get('/sync/run', facebookSyncController.runSync)
router.get('/sync/status', facebookSyncController.getStatus)

export default router
