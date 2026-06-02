import mongoose from 'mongoose'
import Organization, {
  IOrganization,
  OrganizationBillingStatus,
  OrganizationPlan,
  OrganizationStatus,
} from '../models/Organization'
import User, { UserRole } from '../models/User'
import { JwtPayload } from '../utils/jwt'
import logger from '../utils/logger'
import authService from './auth.service'
import { COMMERCIAL_FEATURE_SET } from '../config/commercialPlans'
import { sanitizeUserCreateInput } from '../utils/userInput'

const ORGANIZATION_NAME_MAX_LENGTH = 100
const ORGANIZATION_DESCRIPTION_MAX_LENGTH = 500
const ORGANIZATION_BILLING_ID_MAX_LENGTH = 160
const ORGANIZATION_MAX_SEATS = 100_000
const ORGANIZATION_SETTING_LIMITS: Record<string, number> = {
  maxMembers: 100_000,
  maxAdAccounts: 100_000,
  maxMaterials: 10_000_000,
  maxConcurrentTasks: 1_000,
  monthlyTaskLimit: 10_000_000,
}

type PaginationOptions = {
  page: number
  pageSize: number
  skip: number
}

type PaginatedResult<T> = {
  data: T[]
  total: number
  page: number
  pageSize: number
}

const pickBoundedString = (value: any, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, maxLength)
  return trimmed || undefined
}

const pickBoundedNonNegativeInt = (value: any, max: number): number | undefined => {
  if (value === undefined || value === '') return undefined
  const next = Number(value)
  if (!Number.isFinite(next) || next < 0) return undefined
  return Math.min(max, Math.floor(next))
}

const pickValidDate = (value: any): Date | undefined => {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const pickCommercialFeatures = (value: any): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  return Array.from(new Set(value
    .filter((feature: unknown) => typeof feature === 'string' && feature.trim())
    .map((feature: string) => feature.trim())
    .filter((feature: string) => COMMERCIAL_FEATURE_SET.has(feature))))
}

class OrganizationService {
  private sanitizeSettings(settings: any, { allowNullClears = false } = {}) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return undefined

    const sanitized: any = {}
    for (const [key, max] of Object.entries(ORGANIZATION_SETTING_LIMITS)) {
      const value = settings[key]
      if (value === null && allowNullClears) {
        sanitized[key] = undefined
        continue
      }

      const parsed = pickBoundedNonNegativeInt(value, max)
      if (parsed !== undefined) {
        sanitized[key] = parsed
      }
    }

    const features = pickCommercialFeatures(settings.features)
    if (features) {
      sanitized.features = features
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined
  }

  private sanitizeUpdates(updates: Partial<IOrganization>) {
    const sanitized: any = {}

    const name = pickBoundedString(updates.name, ORGANIZATION_NAME_MAX_LENGTH)
    if (name) sanitized.name = name
    if (Object.prototype.hasOwnProperty.call(updates, 'description') && typeof updates.description === 'string') {
      sanitized.description = updates.description.trim().slice(0, ORGANIZATION_DESCRIPTION_MAX_LENGTH)
    }
    if (updates.status && Object.values(OrganizationStatus).includes(updates.status as OrganizationStatus)) {
      sanitized.status = updates.status
    }

    const billing = (updates as any).billing
    if (billing && typeof billing === 'object' && !Array.isArray(billing)) {
      sanitized.billing = {}
      if (Object.values(OrganizationPlan).includes(billing.plan)) sanitized.billing.plan = billing.plan
      if (Object.values(OrganizationBillingStatus).includes(billing.status)) sanitized.billing.status = billing.status
      const seats = pickBoundedNonNegativeInt(billing.seats, ORGANIZATION_MAX_SEATS)
      const trialEndsAt = pickValidDate(billing.trialEndsAt)
      const currentPeriodEndsAt = pickValidDate(billing.currentPeriodEndsAt)
      const customerId = pickBoundedString(billing.customerId, ORGANIZATION_BILLING_ID_MAX_LENGTH)
      const subscriptionId = pickBoundedString(billing.subscriptionId, ORGANIZATION_BILLING_ID_MAX_LENGTH)
      if (seats !== undefined) sanitized.billing.seats = seats
      if (trialEndsAt) sanitized.billing.trialEndsAt = trialEndsAt
      if (currentPeriodEndsAt) sanitized.billing.currentPeriodEndsAt = currentPeriodEndsAt
      if (customerId) sanitized.billing.customerId = customerId
      if (subscriptionId) sanitized.billing.subscriptionId = subscriptionId
      if (Object.keys(sanitized.billing).length === 0) delete sanitized.billing
    }

    const settings = this.sanitizeSettings((updates as any).settings, { allowNullClears: true })
    if (settings) sanitized.settings = settings

    return sanitized
  }

  /**
   * 获取组织列表
   */
  async getOrganizations(
    currentUser: JwtPayload,
    filters?: any,
    pagination: PaginationOptions = { page: 1, pageSize: 100, skip: 0 },
  ): Promise<PaginatedResult<IOrganization>> {
    // 只有超级管理员可以查看所有组织
    if (currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new Error('权限不足')
    }

    const query: any = {}
    if (filters?.status) {
      query.status = filters.status
    }

    const [organizations, total] = await Promise.all([
      Organization.find(query)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.pageSize)
        .populate('adminId', '-password')
        .populate('createdBy', '-password'),
      Organization.countDocuments(query),
    ])

    return {
      data: organizations,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }
  }

  /**
   * 获取单个组织详情
   */
  async getOrganizationById(
    organizationId: string,
    currentUser: JwtPayload
  ): Promise<IOrganization | null> {
    const organization = await Organization.findById(organizationId)
      .populate('adminId', '-password')
      .populate('createdBy', '-password')

    if (!organization) {
      throw new Error('组织不存在')
    }

    // 权限检查：超级管理员或该组织的成员可以查看
    if (
      currentUser.role !== UserRole.SUPER_ADMIN &&
      currentUser.organizationId !== organizationId
    ) {
      throw new Error('无权访问此组织')
    }

    return organization
  }

  /**
   * 创建组织
   */
  async createOrganization(
    data: {
      name: string
      description?: string
      adminUsername: string
      adminPassword: string
      adminEmail: string
      settings?: {
        maxMembers?: number
        features?: string[]
      }
    },
    currentUser: JwtPayload
  ): Promise<{ organization: IOrganization; admin: any }> {
    // 只有超级管理员可以创建组织
    if (currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new Error('权限不足')
    }

    const name = pickBoundedString(data.name, ORGANIZATION_NAME_MAX_LENGTH)
    const description = pickBoundedString(data.description, ORGANIZATION_DESCRIPTION_MAX_LENGTH)
    const settings = this.sanitizeSettings(data.settings)
    const adminInput = sanitizeUserCreateInput({
      username: data.adminUsername,
      password: data.adminPassword,
      email: data.adminEmail,
      role: UserRole.ORG_ADMIN,
    })
    if (!name) {
      throw new Error('组织名称不能为空')
    }
    if (!adminInput.username || !adminInput.password || !adminInput.email) {
      throw new Error('管理员用户名、邮箱不能为空，密码长度需为6-128位')
    }

    // 检查组织名是否已存在
    const existingOrg = await Organization.findOne({ name })
    if (existingOrg) {
      throw new Error('组织名称已存在')
    }

    // 检查管理员用户名和邮箱是否已存在
    const existingUser = await User.findOne({
      $or: [{ username: adminInput.username }, { email: adminInput.email }],
    })
    if (existingUser) {
      throw new Error('管理员用户名或邮箱已存在')
    }

    // 先创建一个临时的占位组织 ID
    const tempOrgId = new mongoose.Types.ObjectId()

    // 创建组织管理员（使用临时 ID，跳过组织验证）
    const admin = await authService.createUser(
      {
        username: adminInput.username,
        password: adminInput.password,
        email: adminInput.email,
        role: UserRole.ORG_ADMIN,
        organizationId: tempOrgId.toString(),
        skipOrgValidation: true, // 跳过组织存在性验证
      },
      currentUser.userId
    )

    try {
      // 创建组织（使用真实的管理员 ID）
      const organization = new Organization({
        _id: tempOrgId,
        name,
        description,
        adminId: admin._id,
        status: OrganizationStatus.ACTIVE,
        settings,
        createdBy: currentUser.userId,
      })

      await organization.save()

      logger.info(`Organization ${name} created with admin ${adminInput.username}`)

      return {
        organization,
        admin: admin.toJSON(),
      }
    } catch (error) {
      // 如果创建组织失败，删除已创建的管理员
      await User.findByIdAndDelete(admin._id)
      throw error
    }
  }

  /**
   * 更新组织信息
   */
  async updateOrganization(
    organizationId: string,
    updates: Partial<IOrganization>,
    currentUser: JwtPayload
  ): Promise<IOrganization> {
    // 只有超级管理员可以更新组织
    if (currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new Error('权限不足')
    }

    const organization = await Organization.findById(organizationId)
    if (!organization) {
      throw new Error('组织不存在')
    }

    const sanitized = this.sanitizeUpdates(updates)
    const billingUpdates = sanitized.billing
    const settingsUpdates = sanitized.settings
    delete sanitized.billing
    delete sanitized.settings

    Object.assign(organization, sanitized)
    if (billingUpdates) {
      const billingTarget = (organization as any).billing || ((organization as any).billing = {})
      Object.assign(billingTarget, billingUpdates)
    }
    if (settingsUpdates) {
      if (!(organization as any).settings) {
        ;(organization as any).settings = {}
      }
      for (const [key, value] of Object.entries(settingsUpdates)) {
        organization.set(`settings.${key}`, value)
      }
    }
    await organization.save()

    logger.info(`Organization ${organization.name} updated`)

    return organization
  }

  /**
   * 删除组织
   */
  async deleteOrganization(
    organizationId: string,
    currentUser: JwtPayload
  ): Promise<void> {
    // 只有超级管理员可以删除组织
    if (currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new Error('权限不足')
    }

    const organization = await Organization.findById(organizationId)
    if (!organization) {
      throw new Error('组织不存在')
    }

    // 检查组织下是否还有用户
    const userCount = await User.countDocuments({ organizationId })
    if (userCount > 0) {
      throw new Error('组织下还有用户，无法删除')
    }

    await Organization.findByIdAndDelete(organizationId)

    logger.info(`Organization ${organization.name} deleted`)
  }

  /**
   * 更新组织状态
   */
  async updateOrganizationStatus(
    organizationId: string,
    status: OrganizationStatus,
    currentUser: JwtPayload
  ): Promise<IOrganization> {
    // 只有超级管理员可以更新组织状态
    if (currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new Error('权限不足')
    }

    const organization = await Organization.findByIdAndUpdate(
      organizationId,
      { status },
      { new: true }
    )

    if (!organization) {
      throw new Error('组织不存在')
    }

    logger.info(`Organization ${organization.name} status updated to ${status}`)

    return organization
  }

  /**
   * 获取组织的成员列表
   */
  async getOrganizationMembers(
    organizationId: string,
    currentUser: JwtPayload,
    pagination: PaginationOptions = { page: 1, pageSize: 100, skip: 0 },
  ): Promise<PaginatedResult<any>> {
    // 权限检查：超级管理员或该组织的管理员可以查看
    if (
      currentUser.role !== UserRole.SUPER_ADMIN &&
      (currentUser.role !== UserRole.ORG_ADMIN ||
        currentUser.organizationId !== organizationId)
    ) {
      throw new Error('权限不足')
    }

    const [members, total] = await Promise.all([
      User.find({ organizationId })
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.pageSize),
      User.countDocuments({ organizationId }),
    ])

    return {
      data: members,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }
  }

  /**
   * 转移组织管理员
   */
  async transferAdmin(
    organizationId: string,
    newAdminId: string,
    currentUser: JwtPayload
  ): Promise<IOrganization> {
    // 只有超级管理员可以转移组织管理员
    if (currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new Error('权限不足')
    }

    const organization = await Organization.findById(organizationId)
    if (!organization) {
      throw new Error('组织不存在')
    }

    const newAdmin = await User.findById(newAdminId)
    if (!newAdmin) {
      throw new Error('新管理员不存在')
    }

    if (newAdmin.organizationId?.toString() !== organizationId) {
      throw new Error('新管理员不属于此组织')
    }

    // 更新新管理员的角色
    newAdmin.role = UserRole.ORG_ADMIN
    await newAdmin.save()

    // 如果有旧管理员，将其角色改为普通成员
    if (organization.adminId) {
      const oldAdmin = await User.findById(organization.adminId)
      if (oldAdmin) {
        oldAdmin.role = UserRole.MEMBER
        await oldAdmin.save()
      }
    }

    // 更新组织的管理员
    organization.adminId = newAdmin._id
    await organization.save()

    logger.info(
      `Organization ${organization.name} admin transferred to ${newAdmin.username}`
    )

    return organization
  }
}

export default new OrganizationService()
