import User, { IUser, UserRole, UserStatus } from '../models/User'
import { JwtPayload } from '../utils/jwt'
import logger from '../utils/logger'
import authService from './auth.service'

class UserService {
  /**
   * 获取用户列表（带权限控制）
   */
  async getUsers(currentUser: JwtPayload, filters?: any): Promise<IUser[]> {
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

    const users = await User.find(query)
      .select('-password')
      .populate('organizationId')
      .sort({ createdAt: -1 })

    return users
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
      role: UserRole
      organizationId?: string
    },
    currentUser: JwtPayload
  ): Promise<IUser> {
    // 权限检查
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      // 超级管理员可以创建任何角色的用户
      return authService.createUser(data, currentUser.userId)
    } else if (currentUser.role === UserRole.ORG_ADMIN) {
      // 组织管理员只能在自己的组织内创建普通成员
      if (data.role !== UserRole.MEMBER) {
        throw new Error('组织管理员只能创建普通成员')
      }
      if (data.organizationId !== currentUser.organizationId) {
        throw new Error('只能在自己的组织内创建用户')
      }
      return authService.createUser(data, currentUser.userId)
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

    // 权限检查
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      // 超级管理员可以更新任何用户
    } else if (currentUser.role === UserRole.ORG_ADMIN) {
      // 组织管理员只能更新自己组织的用户
      if (user.organizationId?.toString() !== currentUser.organizationId) {
        throw new Error('无权修改此用户')
      }
      // 组织管理员不能修改角色为超级管理员或组织管理员
      if (updates.role && updates.role !== UserRole.MEMBER) {
        throw new Error('无权修改用户角色')
      }
    } else {
      // 普通成员只能更新自己的基本信息
      if (user._id.toString() !== currentUser.userId) {
        throw new Error('无权修改此用户')
      }
      // 普通成员不能修改角色和组织
      delete updates.role
      delete updates.organizationId
    }

    // 不允许直接修改密码（需要通过专门的修改密码接口）
    delete updates.password

    Object.assign(user, updates)
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
    } else {
      throw new Error('权限不足')
    }

    await authService.resetPassword(userId, newPassword)
  }
}

export default new UserService()
