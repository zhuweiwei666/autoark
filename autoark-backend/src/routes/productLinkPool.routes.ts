import { Router } from 'express'
import {
  createProductLinkPool,
  deleteProductLinkPool,
  getProductLinkPool,
  listProductLinkDomains,
  listProductLinkPools,
  updateProductLinkPool,
} from '../controllers/productLinkPool.controller'
import { authenticate, authorize } from '../middlewares/auth'
import { UserRole } from '../models/User'

const router = Router()
const requireAdmin = authorize(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)

router.use(authenticate, requireAdmin)
router.get('/domains', listProductLinkDomains)
router.get('/', listProductLinkPools)
router.post('/', createProductLinkPool)
router.get('/:id', getProductLinkPool)
router.put('/:id', updateProductLinkPool)
router.delete('/:id', deleteProductLinkPool)

export default router
