import mongoose from 'mongoose'
import Organization, { IOrganization, OrganizationStatus } from '../models/Organization'
import User, { UserRole } from '../models/User'
import { JwtPayload } from '../utils/jwt'
import logger from '../utils/logger'
import authService from './auth.service'

class OrganizationService {
  /**
   * 获取组织列表
   */
  async getOrganizations(currentUser: JwtPayload, filters?: any): Promise<IOrganization[]> {
    // 只有超级管理员可以查看所有组织
    if (currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new Error('权限不足')
    }

    const query: any = {}
    if (filters?.status) {
      query.status = filters.status
    }

    const organizations = await Organization.find(query)
      .populate('adminId', '-password')
      .populate('createdBy', '-password')
      .sort({ createdAt: -1 })

    return organizations
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

    // 检查组织名是否已存在
    const existingOrg = await Organization.findOne({ name: data.name })
    if (existingOrg) {
      throw new Error('组织名称已存在')
    }

    // 检查管理员用户名和邮箱是否已存在
    const existingUser = await User.findOne({
      $or: [{ username: data.adminUsername }, { email: data.adminEmail }],
    })
    if (existingUser) {
      throw new Error('管理员用户名或邮箱已存在')
    }

    // 先创建一个临时的占位组织 ID
    const tempOrgId = new mongoose.Types.ObjectId()

    // 创建组织管理员（使用临时 ID）
    const admin = await authService.createUser(
      {
        username: data.adminUsername,
        password: data.adminPassword,
        email: data.adminEmail,
        role: UserRole.ORG_ADMIN,
        organizationId: tempOrgId.toString(),
      },
      currentUser.userId
    )

    try {
      // 创建组织（使用真实的管理员 ID）
      const organization = new Organization({
        _id: tempOrgId,
        name: data.name,
        description: data.description,
        adminId: admin._id,
        status: OrganizationStatus.ACTIVE,
        settings: data.settings,
        createdBy: currentUser.userId,
      })

      await organization.save()

      logger.info(`Organization ${data.name} created with admin ${data.adminUsername}`)

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

    // 不允许直接修改 adminId 和 createdBy
    delete updates.adminId
    delete updates.createdBy

    Object.assign(organization, updates)
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
    currentUser: JwtPayload
  ): Promise<any[]> {
    // 权限检查：超级管理员或该组织的管理员可以查看
    if (
      currentUser.role !== UserRole.SUPER_ADMIN &&
      (currentUser.role !== UserRole.ORG_ADMIN ||
        currentUser.organizationId !== organizationId)
    ) {
      throw new Error('权限不足')
    }

    const members = await User.find({ organizationId })
      .select('-password')
      .sort({ createdAt: -1 })

    return members
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
