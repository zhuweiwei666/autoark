import { Router } from 'express'
import organizationController from '../controllers/organization.controller'
import { authenticate, authorize } from '../middlewares/auth'
import { UserRole } from '../models/User'

const router = Router()

// 所有路由都需要认证
router.use(authenticate)

// 获取组织列表（仅超级管理员）
router.get(
  '/',
  authorize(UserRole.SUPER_ADMIN),
  organizationController.getOrganizations.bind(organizationController)
)

// 获取组织详情（超级管理员或组织成员）
router.get(
  '/:id',
  organizationController.getOrganizationById.bind(organizationController)
)

// 创建组织（仅超级管理员）
router.post(
  '/',
  authorize(UserRole.SUPER_ADMIN),
  organizationController.createOrganization.bind(organizationController)
)

// 更新组织信息（仅超级管理员）
router.put(
  '/:id',
  authorize(UserRole.SUPER_ADMIN),
  organizationController.updateOrganization.bind(organizationController)
)

// 删除组织（仅超级管理员）
router.delete(
  '/:id',
  authorize(UserRole.SUPER_ADMIN),
  organizationController.deleteOrganization.bind(organizationController)
)

// 更新组织状态（仅超级管理员）
router.put(
  '/:id/status',
  authorize(UserRole.SUPER_ADMIN),
  organizationController.updateOrganizationStatus.bind(organizationController)
)

// 获取组织成员列表（超级管理员或组织管理员）
router.get(
  '/:id/members',
  authorize(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN),
  organizationController.getOrganizationMembers.bind(organizationController)
)

// 转移组织管理员（仅超级管理员）
router.post(
  '/:id/transfer-admin',
  authorize(UserRole.SUPER_ADMIN),
  organizationController.transferAdmin.bind(organizationController)
)

export default router
