import express from 'express'
import { authenticate, authorize } from '../middlewares/auth'
import * as controller from '../controllers/automationJob.controller'
import { UserRole } from '../models/User'

const router = express.Router()

router.use(authenticate)

router.get('/', controller.getJobs)
router.post('/', authorize(UserRole.SUPER_ADMIN), controller.createJob)
router.get('/:id', controller.getJob)
router.post('/:id/cancel', controller.cancelJob)
router.post('/:id/retry', controller.retryJob)

export default router
