"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const productMappingController = __importStar(require("../controllers/productMapping.controller"));
const router = (0, express_1.Router)();
// ==================== 产品 CRUD ====================
router.get('/products', productMappingController.getProducts);
router.get('/products/:id', productMappingController.getProductById);
router.post('/products', productMappingController.createProduct);
router.put('/products/:id', productMappingController.updateProduct);
// ==================== Pixel 管理 ====================
router.post('/products/:id/pixels', productMappingController.addPixelToProduct);
router.delete('/products/:id/pixels/:pixelId', productMappingController.removePixelFromProduct);
router.put('/products/:id/primary-pixel', productMappingController.setPrimaryPixel);
// ==================== 账户管理 ====================
router.get('/products/:id/accounts', productMappingController.getProductAccounts);
router.post('/products/:id/accounts', productMappingController.addAccountToProduct);
// ==================== 自动化操作 ====================
router.post('/scan-products', productMappingController.scanProducts);
router.post('/match-pixels', productMappingController.matchPixels);
router.post('/discover-accounts', productMappingController.discoverAccounts);
router.post('/sync-all', productMappingController.syncAll);
// ==================== 查询接口 ====================
router.get('/find-by-url', productMappingController.findByUrl);
router.get('/products/:id/best-account', productMappingController.getBestAccount);
router.get('/parse-url', productMappingController.parseUrl);
router.get('/stats', productMappingController.getStats);
exports.default = router;
