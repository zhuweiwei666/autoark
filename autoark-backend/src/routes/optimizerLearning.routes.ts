import { Router } from 'express'
import * as controller from '../controllers/optimizerLearning.controller'
import { authenticate, authorize, dataIsolation } from '../middlewares/auth'
import { UserRole } from '../models/User'

const router = Router()

router.use(authenticate)
router.use(dataIsolation)
router.use(authorize(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN))

router.get('/optimizers', controller.getOptimizers)
router.post('/optimizers/:optimizerId/playbooks', controller.createPlaybook)
router.get('/playbook-generations/:id', controller.getPlaybookGenerationById)
router.get('/playbooks', controller.getPlaybooks)
router.get('/playbooks/:id', controller.getPlaybookById)
router.get('/replica-assets', controller.getReplicaAssets)
router.post('/playbooks/:id/replicas', controller.createReplicaRun)
router.get('/replicas', controller.getReplicaRuns)
router.get('/replicas/:id', controller.getReplicaRun)
router.post('/replicas/:id/approve', controller.approveReplicaRun)
router.post('/replicas/:id/publish', controller.publishReplicaRun)
router.post('/replicas/:id/evaluate', controller.evaluateReplicaRun)

export default router
