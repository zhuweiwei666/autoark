import { Router } from 'express'
import * as productMappingController from '../controllers/productMapping.controller'

const router = Router()

// ==================== 产品 CRUD ====================
router.get('/products', productMappingController.getProducts)
router.get('/products/:id', productMappingController.getProductById)
router.post('/products', productMappingController.createProduct)
router.put('/products/:id', productMappingController.updateProduct)

// ==================== Pixel 管理 ====================
router.post('/products/:id/pixels', productMappingController.addPixelToProduct)
router.delete('/products/:id/pixels/:pixelId', productMappingController.removePixelFromProduct)
router.put('/products/:id/primary-pixel', productMappingController.setPrimaryPixel)

// ==================== 账户管理 ====================
router.get('/products/:id/accounts', productMappingController.getProductAccounts)
router.post('/products/:id/accounts', productMappingController.addAccountToProduct)

// ==================== 自动化操作 ====================
router.post('/scan-products', productMappingController.scanProducts)
router.post('/match-pixels', productMappingController.matchPixels)
router.post('/discover-accounts', productMappingController.discoverAccounts)
router.post('/sync-all', productMappingController.syncAll)

// ==================== 查询接口 ====================
router.get('/find-by-url', productMappingController.findByUrl)
router.get('/products/:id/best-account', productMappingController.getBestAccount)
router.get('/parse-url', productMappingController.parseUrl)
router.get('/stats', productMappingController.getStats)

export default router

