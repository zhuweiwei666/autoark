import { Router } from 'express'
import * as controller from '../controllers/metaBusinessCredential.controller'
import { authenticate, authorize } from '../middlewares/auth'
import { UserRole } from '../models/User'

const router = Router()

router.use(authenticate)
router.use(authorize(UserRole.SUPER_ADMIN))

router.get('/', controller.getCredentials)
router.get('/migration-inventory', controller.getMigrationInventory)
router.get('/bootstrap-tokens', controller.getBootstrapTokens)
router.post('/discover-businesses', controller.discoverBusinesses)
router.post('/inspect-business', controller.inspectBusiness)
router.post('/provision-plan', controller.getProvisionPlan)
router.post('/provision', controller.provisionSystemUser)
router.post('/:id/validate', controller.refreshCredential)
router.post('/:id/deactivate', controller.deactivateCredential)

export default router
