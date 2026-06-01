import { Request } from 'express'
import mongoose from 'mongoose'
import { UserRole } from '../models/User'

export const emptyAccessFilter = { _id: null }

export const isSuperAdmin = (req: Request): boolean => {
  return req.user?.role === UserRole.SUPER_ADMIN
}

export const getRequestUserId = (req: Request): string | undefined => {
  return req.user?.userId
}

export const getRequestOrgId = (req: Request): string | undefined => {
  return req.user?.organizationId
}

export const userIdVariants = (userId?: string): any[] => {
  if (!userId) return []
  const variants: any[] = [userId]
  if (mongoose.Types.ObjectId.isValid(userId)) {
    variants.push(new mongoose.Types.ObjectId(userId))
  }
  return variants
}

export const objectIdValue = (id?: string): any => {
  if (!id) return id
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id
}

export const combineFilters = (...filters: any[]): any => {
  const normalized = filters.filter((filter) => filter && Object.keys(filter).length > 0)
  if (normalized.length === 0) return {}
  if (normalized.length === 1) return normalized[0]
  return { $and: normalized }
}

export const scopedOrgFilter = (req: Request, orgField = 'organizationId'): any => {
  if (!req.user) return emptyAccessFilter
  if (isSuperAdmin(req)) return {}

  const organizationId = getRequestOrgId(req)
  if (!organizationId) return emptyAccessFilter

  return { [orgField]: objectIdValue(organizationId) }
}

export const scopedOwnerFilter = (
  req: Request,
  {
    orgField = 'organizationId',
    ownerField = 'createdBy',
    memberOwnOnly = false,
  }: { orgField?: string; ownerField?: string; memberOwnOnly?: boolean } = {},
): any => {
  if (!req.user) return emptyAccessFilter
  if (isSuperAdmin(req)) return {}

  const organizationId = getRequestOrgId(req)
  const userId = getRequestUserId(req)

  if (memberOwnOnly && req.user.role === UserRole.MEMBER) {
    const ownerVariants = userIdVariants(userId)
    return ownerVariants.length > 0 ? { [ownerField]: { $in: ownerVariants } } : emptyAccessFilter
  }

  if (organizationId) {
    return { [orgField]: objectIdValue(organizationId) }
  }

  const ownerVariants = userIdVariants(userId)
  return ownerVariants.length > 0 ? { [ownerField]: { $in: ownerVariants } } : emptyAccessFilter
}

export const scopedIdFilter = (
  req: Request,
  id: string,
  scopeFilter: any = scopedOrgFilter(req),
): any => {
  return combineFilters({ _id: id }, scopeFilter)
}

export const scopedTokenFilter = (req: Request): any => {
  if (!req.user) return emptyAccessFilter
  if (isSuperAdmin(req)) return {}

  if (req.user.role === UserRole.ORG_ADMIN && req.user.organizationId) {
    return { organizationId: objectIdValue(req.user.organizationId) }
  }

  return req.user.userId ? { userId: req.user.userId } : emptyAccessFilter
}

export const scopedCreatedByFilter = (req: Request, ownerField = 'createdBy'): any => {
  if (!req.user) return emptyAccessFilter
  if (isSuperAdmin(req)) return {}

  const variants = userIdVariants(req.user.userId)
  return variants.length > 0 ? { [ownerField]: { $in: variants } } : emptyAccessFilter
}

export const sanitizeScopedUpdate = (data: any): any => {
  const update = { ...(data || {}) }
  delete update._id
  delete update.id
  delete update.userId
  delete update.createdBy
  delete update.organizationId
  delete update.createdAt
  delete update.updatedAt
  return update
}
