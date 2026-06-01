import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { getOrganizationReadiness, getPlans, getReadiness, getSupportPackage, getUsageLedger } from '../controllers/commercial.controller'

const router = Router()

router.use(authenticate)

router.get('/readiness', getReadiness)
router.get('/organizations/readiness', getOrganizationReadiness)
router.get('/support-package', getSupportPackage)
router.get('/usage-ledger', getUsageLedger)
router.get('/plans', getPlans)

export default router
