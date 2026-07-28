import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import {
  createMaterialVariant,
  getMaterialVariant,
  getMaterialVariantConfigStatus,
  listMaterialVariants,
  requireMaterialVariantAdmin,
} from '../controllers/materialVariant.controller'

const router = Router()

router.use(authenticate)
router.use(requireMaterialVariantAdmin)

router.get('/config-status', getMaterialVariantConfigStatus)
router.post('/', createMaterialVariant)
router.get('/', listMaterialVariants)
router.get('/:jobId', getMaterialVariant)

export default router
