import User, { IUser, UserRole, UserStatus } from '../models/User'
import Organization from '../models/Organization'
import { generateToken } from '../utils/jwt'
import logger from '../utils/logger'

export interface LoginCredentials {
  username: string
  password: string
}

export interface RegisterData {
  username: string
  password: string
  email: string
  role?: UserRole
  organizationId?: string
}

export interface AuthResponse {
  user: Partial<IUser>
  token: string
}

class AuthService {
  /**
   * 用户登录
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const { username, password } = credentials

    // 查找用户
    const user = await User.findOne({ username }).populate('organizationId')
    if (!user) {
      throw new Error('用户名或密码错误')
    }

    // 检查用户状态
    if (user.status !== UserStatus.ACTIVE) {
      throw new Error('账号已被禁用或冻结')
    }

    // 验证密码
    const isPasswordValid = await user.comparePassword(password)
    if (!isPasswordValid) {
      throw new Error('用户名或密码错误')
    }

    // 更新最后登录时间
    user.lastLoginAt = new Date()
    await user.save()

    // 生成 token
    const token = generateToken(user)

    logger.info(`User ${username} logged in successfully`)

    return {
      user: user.toJSON(),
      token,
    }
  }

  /**
   * 创建用户
   */
  async createUser(data: RegisterData, createdBy: string): Promise<IUser> {
    const { username, password, email, role, organizationId } = data

    // 检查用户名是否已存在
    const existingUser = await User.findOne({
      $or: [{ username }, { email }],
    })
    if (existingUser) {
      throw new Error('用户名或邮箱已存在')
    }

    // 如果不是超级管理员，必须提供 organizationId
    if (role !== UserRole.SUPER_ADMIN && !organizationId) {
      throw new Error('必须指定所属组织')
    }

    // 验证组织是否存在
    if (organizationId) {
      const organization = await Organization.findById(organizationId)
      if (!organization) {
        throw new Error('组织不存在')
      }
    }

    // 创建用户
    const user = new User({
      username,
      password,
      email,
      role: role || UserRole.MEMBER,
      organizationId,
      status: UserStatus.ACTIVE,
      createdBy,
    })

    await user.save()

    logger.info(`User ${username} created successfully`)

    return user
  }

  /**
   * 修改密码
   */
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<void> {
    const user = await User.findById(userId)
    if (!user) {
      throw new Error('用户不存在')
    }

    // 验证旧密码
    const isPasswordValid = await user.comparePassword(oldPassword)
    if (!isPasswordValid) {
      throw new Error('原密码错误')
    }

    // 更新密码
    user.password = newPassword
    await user.save()

    logger.info(`User ${user.username} changed password`)
  }

  /**
   * 重置密码（管理员操作）
   */
  async resetPassword(userId: string, newPassword: string): Promise<void> {
    const user = await User.findById(userId)
    if (!user) {
      throw new Error('用户不存在')
    }

    user.password = newPassword
    await user.save()

    logger.info(`Password reset for user ${user.username}`)
  }

  /**
   * 获取当前用户信息
   */
  async getCurrentUser(userId: string): Promise<IUser | null> {
    const user = await User.findById(userId)
      .select('-password')
      .populate('organizationId')
    return user
  }

  /**
   * 更新用户状态
   */
  async updateUserStatus(userId: string, status: UserStatus): Promise<IUser> {
    const user = await User.findByIdAndUpdate(
      userId,
      { status },
      { new: true }
    ).select('-password')

    if (!user) {
      throw new Error('用户不存在')
    }

    logger.info(`User ${user.username} status updated to ${status}`)

    return user
  }
}

export default new AuthService()
