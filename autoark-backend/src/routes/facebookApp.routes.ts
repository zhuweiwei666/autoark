import express from 'express'
import * as facebookAppController from '../controllers/facebookApp.controller'
import { authenticate, authorize } from '../middlewares/auth'
import { UserRole } from '../models/User'

const router = express.Router()

// App 管理（需要认证）
router.use(authenticate)
router.get('/requirements/public-oauth', facebookAppController.getPublicOAuthRequirements)
router.use(authorize(UserRole.SUPER_ADMIN))
router.get('/', facebookAppController.getApps)
router.get('/stats', facebookAppController.getAppStats)
router.get('/available', facebookAppController.getAvailableApps)
router.get('/:id', facebookAppController.getApp)
router.post('/', facebookAppController.createApp)
router.put('/:id', facebookAppController.updateApp)
router.put('/:id/compliance', facebookAppController.updateCompliance)
router.delete('/:id', facebookAppController.deleteApp)
router.post('/:id/validate', facebookAppController.validateApp)
router.post('/:id/reset-stats', facebookAppController.resetAppStats)

export default router
