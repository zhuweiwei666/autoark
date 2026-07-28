import { Router } from 'express'
import { redirectProductLink } from '../controllers/productLinkPool.controller'

const router = Router()

router.get('/:shortCode', redirectProductLink)

export default router
