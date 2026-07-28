import { Router } from 'express'
import { handleMaterialVariantCallback } from '../controllers/materialVariant.controller'

const router = Router()

// Public only in the HTTP sense: every payload is authenticated with the
// ai-host-v2 tenant HMAC secret before any database mutation.
router.post('/callback', handleMaterialVariantCallback)

export default router
