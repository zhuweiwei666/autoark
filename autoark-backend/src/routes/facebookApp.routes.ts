import express from 'express'
import * as facebookAppController from '../controllers/facebookApp.controller'

const router = express.Router()

// App 管理
router.get('/', facebookAppController.getApps)
router.get('/stats', facebookAppController.getAppStats)
router.get('/available', facebookAppController.getAvailableApps)
router.get('/:id', facebookAppController.getApp)
router.post('/', facebookAppController.createApp)
router.put('/:id', facebookAppController.updateApp)
router.delete('/:id', facebookAppController.deleteApp)
router.post('/:id/validate', facebookAppController.validateApp)
router.post('/:id/reset-stats', facebookAppController.resetAppStats)

export default router

