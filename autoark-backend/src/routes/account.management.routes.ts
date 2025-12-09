import { Router } from 'express'
import accountManagementController from '../controllers/account.management.controller'
import { authenticate, authorize } from '../middlewares/auth'
import { UserRole } from '../models/User'

const router = Router()

// 所有路由都需要认证
router.use(authenticate)

// 获取账户列表（带组织和标签信息）
router.get(
  '/accounts',
  accountManagementController.getAccounts.bind(accountManagementController)
)

// 获取未分配的账户（账户池） - 仅超级管理员
router.get(
  '/unassigned',
  authorize(UserRole.SUPER_ADMIN),
  accountManagementController.getUnassignedAccounts.bind(accountManagementController)
)

// 添加账户标签
router.post(
  '/accounts/:accountId/tags',
  accountManagementController.addTags.bind(accountManagementController)
)

// 移除账户标签
router.delete(
  '/accounts/:accountId/tags',
  accountManagementController.removeTags.bind(accountManagementController)
)

// 更新账户备注
router.put(
  '/accounts/:accountId/notes',
  accountManagementController.updateNotes.bind(accountManagementController)
)

// 将账户分配给组织 - 仅超级管理员
router.post(
  '/assign',
  authorize(UserRole.SUPER_ADMIN),
  accountManagementController.assignToOrganization.bind(accountManagementController)
)

// 取消账户分配 - 仅超级管理员
router.post(
  '/unassign',
  authorize(UserRole.SUPER_ADMIN),
  accountManagementController.unassignFromOrganization.bind(accountManagementController)
)

// 创建账户分组
router.post(
  '/groups',
  accountManagementController.createGroup.bind(accountManagementController)
)

// 获取分组列表
router.get(
  '/groups',
  accountManagementController.getGroups.bind(accountManagementController)
)

// 获取账户统计信息
router.get(
  '/stats',
  accountManagementController.getStats.bind(accountManagementController)
)

export default router
