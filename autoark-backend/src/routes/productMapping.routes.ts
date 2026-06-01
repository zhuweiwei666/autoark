import { Router } from 'express'
import * as productMappingController from '../controllers/productMapping.controller'
import { authenticate, authorize } from '../middlewares/auth'
import { UserRole } from '../models/User'

const router = Router()

router.use(authenticate)
const requireOrgAdmin = authorize(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)

// ==================== 产品 CRUD ====================
router.get('/products', productMappingController.getProducts)
router.get('/products/:id', productMappingController.getProductById)
router.post('/products', requireOrgAdmin, productMappingController.createProduct)
router.put('/products/:id', requireOrgAdmin, productMappingController.updateProduct)

// ==================== Pixel 管理 ====================
router.post('/products/:id/pixels', requireOrgAdmin, productMappingController.addPixelToProduct)
router.delete('/products/:id/pixels/:pixelId', requireOrgAdmin, productMappingController.removePixelFromProduct)
router.put('/products/:id/primary-pixel', requireOrgAdmin, productMappingController.setPrimaryPixel)

// ==================== 账户管理 ====================
router.get('/products/:id/accounts', productMappingController.getProductAccounts)
router.post('/products/:id/accounts', requireOrgAdmin, productMappingController.addAccountToProduct)

// ==================== 自动化操作 ====================
router.post('/scan-products', requireOrgAdmin, productMappingController.scanProducts)
router.post('/match-pixels', requireOrgAdmin, productMappingController.matchPixels)
router.post('/discover-accounts', requireOrgAdmin, productMappingController.discoverAccounts)
router.post('/sync-all', requireOrgAdmin, productMappingController.syncAll)

// ==================== 查询接口 ====================
router.get('/find-by-url', productMappingController.findByUrl)
router.get('/products/:id/best-account', productMappingController.getBestAccount)
router.get('/parse-url', productMappingController.parseUrl)
router.get('/stats', productMappingController.getStats)

export default router
