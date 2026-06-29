import { Router } from 'express'
import { authenticate, authorize } from '../middlewares/auth'
import { UserRole } from '../models/User'
import { getAuditLogs } from '../controllers/auditLog.controller'

const router = Router()

router.use(authenticate)
router.use(authorize(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN))

router.get('/', getAuditLogs)

export default router
