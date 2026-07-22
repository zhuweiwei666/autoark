import User, { IUser, UserPermission, UserRole, UserStatus } from '../models/User'
import { JwtPayload } from '../utils/jwt'
import logger from '../utils/logger'
import authService from './auth.service'
import {
  sanitizeUserCreateInput,
  sanitizeUserUpdateInput,
} from '../utils/userInput'

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

class UserService {
  private sanitizeUserUpdates(updates: Partial<IUser>, currentUser: JwtPayload): Partial<IUser> {
    const sanitized: any = sanitizeUserUpdateInput(updates)

    if (currentUser.role !== UserRole.SUPER_ADMIN) {
      delete sanitized.organizationId
      delete sanitized.status
      delete sanitized.permissions
    }

    return sanitized
  }

  /**
   * 获取用户列表（带权限控制）
   */
  async getUsers(
    currentUser: JwtPayload,
    filters?: any,
    pagination: PaginationOptions = { page: 1, pageSize: 100, skip: 0 },
  ): Promise<PaginatedResult<IUser>> {
    const query: any = {}

    // 超级管理员可以看到所有用户
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      // 可以添加额外的过滤条件
      if (filters?.organizationId) {
        query.organizationId = filters.organizationId
      }
      if (filters?.role) {
        query.role = filters.role
      }
      if (filters?.status) {
        query.status = filters.status
      }
    }
    // 组织管理员只能看到自己组织的用户
    else if (currentUser.role === UserRole.ORG_ADMIN) {
      query.organizationId = currentUser.organizationId
    }
    // 普通成员只能看到自己
    else {
      query._id = currentUser.userId
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password')
        .populate('organizationId')
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.pageSize),
      User.countDocuments(query),
    ])

    return {
      data: users,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }
  }

  /**
   * 获取单个用户详情
   */
  async getUserById(
    userId: string,
    currentUser: JwtPayload
  ): Promise<IUser | null> {
    const user = await User.findById(userId)
      .select('-password')
      .populate('organizationId')

    if (!user) {
      throw new Error('用户不存在')
    }

    // 权限检查
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      // 超级管理员可以查看所有用户
      return user
    } else if (currentUser.role === UserRole.ORG_ADMIN) {
      // 组织管理员只能查看自己组织的用户
      if (user.organizationId?.toString() !== currentUser.organizationId) {
        throw new Error('无权访问此用户')
      }
      return user
    } else {
      // 普通成员只能查看自己
      if (user._id.toString() !== currentUser.userId) {
        throw new Error('无权访问此用户')
      }
      return user
    }
  }

  /**
   * 创建用户
   */
  async createUser(
    data: {
      username: string
      password: string
      email: string
      role?: UserRole
      organizationId?: string
      permissions?: UserPermission[]
    },
    currentUser: JwtPayload
  ): Promise<IUser> {
    const sanitizedData = sanitizeUserCreateInput(data)
    if (!sanitizedData.username || !sanitizedData.password || !sanitizedData.email) {
      throw new Error('用户名、邮箱不能为空，密码长度需为6-128位')
    }

    // 权限检查
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      // 超级管理员可以创建任何角色的用户
      const user = await authService.createUser(sanitizedData, currentUser.userId)
      if (sanitizedData.permissions !== undefined) {
        user.permissions = sanitizedData.permissions
        await user.save()
      }
      return user
    } else if (currentUser.role === UserRole.ORG_ADMIN) {
      // 组织管理员只能在自己的组织内创建普通成员
      const requestedRole = sanitizedData.role || UserRole.MEMBER
      if (requestedRole !== UserRole.MEMBER) {
        throw new Error('组织管理员只能创建普通成员')
      }
      if (!currentUser.organizationId) {
        throw new Error('用户未关联组织，无法创建用户')
      }
      if (sanitizedData.organizationId && sanitizedData.organizationId !== currentUser.organizationId) {
        throw new Error('只能在自己的组织内创建用户')
      }
      const memberData = {
        ...sanitizedData,
        role: UserRole.MEMBER,
        organizationId: currentUser.organizationId,
      }
      delete memberData.permissions
      return authService.createUser(
        memberData,
        currentUser.userId,
      )
    } else {
      throw new Error('权限不足')
    }
  }

  /**
   * 更新用户信息
   */
  async updateUser(
    userId: string,
    updates: Partial<IUser>,
    currentUser: JwtPayload
  ): Promise<IUser> {
    const user = await User.findById(userId)
    if (!user) {
      throw new Error('用户不存在')
    }

    const sanitizedUpdates = this.sanitizeUserUpdates(updates, currentUser)

    // 权限检查
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      // 超级管理员可以更新任何用户
    } else if (currentUser.role === UserRole.ORG_ADMIN) {
      // 组织管理员只能更新自己组织的用户
      if (user.organizationId?.toString() !== currentUser.organizationId) {
        throw new Error('无权修改此用户')
      }
      const isSelf = user._id.toString() === currentUser.userId
      if (!isSelf && user.role !== UserRole.MEMBER) {
        throw new Error('无权修改管理员用户')
      }
      // 组织管理员不能提升角色；自己的角色也不能通过资料接口变更。
      if (sanitizedUpdates.role && (isSelf || sanitizedUpdates.role !== UserRole.MEMBER)) {
        throw new Error('无权修改用户角色')
      }
    } else {
      // 普通成员只能更新自己的基本信息
      if (user._id.toString() !== currentUser.userId) {
        throw new Error('无权修改此用户')
      }
      // 普通成员不能修改角色和组织
      delete sanitizedUpdates.role
    }

    Object.assign(user, sanitizedUpdates)
    await user.save()

    logger.info(`User ${user.username} updated`)

    return user
  }

  /**
   * 删除用户
   */
  async deleteUser(userId: string, currentUser: JwtPayload): Promise<void> {
    const user = await User.findById(userId)
    if (!user) {
      throw new Error('用户不存在')
    }

    // 权限检查
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      // 超级管理员可以删除任何用户
    } else if (currentUser.role === UserRole.ORG_ADMIN) {
      // 组织管理员只能删除自己组织的普通成员
      if (user.organizationId?.toString() !== currentUser.organizationId) {
        throw new Error('无权删除此用户')
      }
      if (user.role !== UserRole.MEMBER) {
        throw new Error('无权删除管理员用户')
      }
    } else {
      throw new Error('权限不足')
    }

    await User.findByIdAndDelete(userId)

    logger.info(`User ${user.username} deleted`)
  }

  /**
   * 更新用户状态
   */
  async updateUserStatus(
    userId: string,
    status: UserStatus,
    currentUser: JwtPayload
  ): Promise<IUser> {
    const user = await User.findById(userId)
    if (!user) {
      throw new Error('用户不存在')
    }

    // 权限检查
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      // 超级管理员可以更新任何用户状态
    } else if (currentUser.role === UserRole.ORG_ADMIN) {
      // 组织管理员只能更新自己组织的用户状态
      if (user.organizationId?.toString() !== currentUser.organizationId) {
        throw new Error('无权修改此用户状态')
      }
      if (user.role !== UserRole.MEMBER) {
        throw new Error('无权修改管理员用户状态')
      }
    } else {
      throw new Error('权限不足')
    }

    return authService.updateUserStatus(userId, status)
  }

  /**
   * 重置用户密码
   */
  async resetUserPassword(
    userId: string,
    newPassword: string,
    currentUser: JwtPayload
  ): Promise<void> {
    const user = await User.findById(userId)
    if (!user) {
      throw new Error('用户不存在')
    }

    // 权限检查
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      // 超级管理员可以重置任何用户密码
    } else if (currentUser.role === UserRole.ORG_ADMIN) {
      // 组织管理员只能重置自己组织的用户密码
      if (user.organizationId?.toString() !== currentUser.organizationId) {
        throw new Error('无权重置此用户密码')
      }
      if (user.role !== UserRole.MEMBER) {
        throw new Error('无权重置管理员用户密码')
      }
    } else {
      throw new Error('权限不足')
    }

    await authService.resetPassword(userId, newPassword)
  }
}

export default new UserService()
