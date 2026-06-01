import express from 'express'
import { authenticate, authorize } from '../middlewares/auth'
import * as controller from '../controllers/automationJob.controller'
import { UserRole } from '../models/User'

const router = express.Router()

router.use(authenticate)

const requireOrgAdmin = authorize(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)

router.get('/', requireOrgAdmin, controller.getJobs)
router.post('/', authorize(UserRole.SUPER_ADMIN), controller.createJob)
router.get('/:id', requireOrgAdmin, controller.getJob)
router.post('/:id/cancel', requireOrgAdmin, controller.cancelJob)
router.post('/:id/retry', requireOrgAdmin, controller.retryJob)

export default router
