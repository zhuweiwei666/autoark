import { Router } from 'express'
import * as fbTokenController from '../controllers/fbToken.controller'
import { authenticate } from '../middlewares/auth'

const router = Router()

// 所有路由都需要认证
router.use(authenticate)

// 绑定 token
router.post('/', fbTokenController.bindToken)

// 获取 token 列表（支持筛选）
router.get('/', fbTokenController.getTokens)

// 获取单个 token 详情
router.get('/:id', fbTokenController.getTokenById)

// 手动检查 token 状态
router.post('/:id/check', fbTokenController.checkTokenStatus)

// 更新 token（如更新优化师）
router.put('/:id', fbTokenController.updateToken)

// 删除 token
router.delete('/:id', fbTokenController.deleteToken)

export default router

