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
const fbTokenController = __importStar(require("../controllers/fbToken.controller"));
const auth_1 = require("../middlewares/auth");
const router = (0, express_1.Router)();
// 所有路由都需要认证
router.use(auth_1.authenticate);
// 绑定 token
router.post('/', fbTokenController.bindToken);
// 获取 token 列表（支持筛选）
router.get('/', fbTokenController.getTokens);
// 获取单个 token 详情
router.get('/:id', fbTokenController.getTokenById);
// 手动检查 token 状态
router.post('/:id/check', fbTokenController.checkTokenStatus);
// 更新 token（如更新优化师）
router.put('/:id', fbTokenController.updateToken);
// 删除 token
router.delete('/:id', fbTokenController.deleteToken);
exports.default = router;
