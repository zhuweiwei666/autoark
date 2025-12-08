import { Router } from 'express'
import authController from '../controllers/auth.controller'
import { authenticate } from '../middlewares/auth'

const router = Router()

// 公开路由
router.post('/login', authController.login.bind(authController))
router.post('/logout', authController.logout.bind(authController))

// 需要认证的路由
router.get('/me', authenticate, authController.getCurrentUser.bind(authController))
router.post('/change-password', authenticate, authController.changePassword.bind(authController))

export default router
