import { UserPermission, UserRole } from '../models/User'
import type { JwtPayload } from './jwt'

type ExternalMaterialPermissionUser = Pick<JwtPayload, 'role' | 'permissions'>

export const canManageExternalMaterials = (user: ExternalMaterialPermissionUser): boolean => (
  user.role === UserRole.SUPER_ADMIN
  || user.permissions?.includes(UserPermission.MATERIALS_EXTERNAL_MANAGE) === true
)

export const canReadExternalMaterials = (user: ExternalMaterialPermissionUser): boolean => (
  canManageExternalMaterials(user)
  || user.permissions?.includes(UserPermission.MATERIALS_EXTERNAL_READ) === true
)
