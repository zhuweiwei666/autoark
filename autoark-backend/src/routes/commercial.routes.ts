import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { getPlans, getReadiness } from '../controllers/commercial.controller'

const router = Router()

router.use(authenticate)

router.get('/readiness', getReadiness)
router.get('/plans', getPlans)

export default router
