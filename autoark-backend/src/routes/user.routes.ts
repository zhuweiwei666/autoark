import { Router } from 'express'
import userController from '../controllers/user.controller'
import { authenticate, authorize } from '../middlewares/auth'
import { UserRole } from '../models/User'

const router = Router()

// 所有路由都需要认证
router.use(authenticate)

// 获取用户列表（所有登录用户都可以，但返回数据根据权限过滤）
router.get('/', userController.getUsers.bind(userController))

// 获取用户详情
router.get('/:id', userController.getUserById.bind(userController))

// 创建用户（超级管理员和组织管理员）
router.post(
  '/',
  authorize(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN),
  userController.createUser.bind(userController)
)

// 更新用户信息
router.put('/:id', userController.updateUser.bind(userController))

// 删除用户（超级管理员和组织管理员）
router.delete(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN),
  userController.deleteUser.bind(userController)
)

// 更新用户状态（超级管理员和组织管理员）
router.put(
  '/:id/status',
  authorize(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN),
  userController.updateUserStatus.bind(userController)
)

// 重置用户密码（超级管理员和组织管理员）
router.post(
  '/:id/reset-password',
  authorize(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN),
  userController.resetPassword.bind(userController)
)

export default router
