import express from 'express'
import { authenticate } from '../middlewares/auth'
import * as controller from '../controllers/automationJob.controller'

const router = express.Router()

router.use(authenticate)

router.get('/', controller.getJobs)
router.post('/', controller.createJob)
router.get('/:id', controller.getJob)
router.post('/:id/cancel', controller.cancelJob)
router.post('/:id/retry', controller.retryJob)

export default router

