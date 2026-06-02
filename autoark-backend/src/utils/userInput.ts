import { UserRole, UserStatus } from '../models/User'
import { pickSafeQueryString } from './pagination'

export const USER_USERNAME_MAX_LENGTH = 50
export const USER_EMAIL_MAX_LENGTH = 254
export const USER_PASSWORD_MAX_LENGTH = 128
export const USER_ORGANIZATION_ID_MAX_LENGTH = 40

export const pickUserRole = (value: any): UserRole | undefined => (
  typeof value === 'string' && Object.values(UserRole).includes(value as UserRole)
    ? value as UserRole
    : undefined
)

export const pickUserStatus = (value: any): UserStatus | undefined => (
  typeof value === 'string' && Object.values(UserStatus).includes(value as UserStatus)
    ? value as UserStatus
    : undefined
)

export const pickSafeUsername = (value: any): string | undefined => (
  pickSafeQueryString(value, USER_USERNAME_MAX_LENGTH)
)

export const pickSafeEmail = (value: any): string | undefined => {
  const email = pickSafeQueryString(value, USER_EMAIL_MAX_LENGTH)
  return email?.toLowerCase()
}

export const pickSafeOrganizationId = (value: any): string | undefined => (
  pickSafeQueryString(value, USER_ORGANIZATION_ID_MAX_LENGTH)
)

export const pickSafePassword = (value: any): string | undefined => {
  if (typeof value !== 'string') return undefined
  if (value.length > USER_PASSWORD_MAX_LENGTH) return undefined
  if (value.trim().length < 6) return undefined
  return value
}

export const sanitizeUserCreateInput = (body: any) => ({
  username: pickSafeUsername(body?.username),
  password: pickSafePassword(body?.password),
  email: pickSafeEmail(body?.email),
  role: pickUserRole(body?.role),
  organizationId: pickSafeOrganizationId(body?.organizationId),
})

export const sanitizeUserUpdateInput = (body: any) => {
  const update: Record<string, any> = {}

  const username = pickSafeUsername(body?.username)
  if (username) update.username = username

  const email = pickSafeEmail(body?.email)
  if (email) update.email = email

  const role = pickUserRole(body?.role)
  if (role) update.role = role

  const status = pickUserStatus(body?.status)
  if (status) update.status = status

  const organizationId = pickSafeOrganizationId(body?.organizationId)
  if (organizationId) update.organizationId = organizationId

  return update
}
