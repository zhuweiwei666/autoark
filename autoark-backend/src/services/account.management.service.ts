import Account, { IAccount } from '../models/Account'
import AccountGroup, { IAccountGroup } from '../models/AccountGroup'
import Organization from '../models/Organization'
import { JwtPayload } from '../utils/jwt'
import { UserRole } from '../models/User'
import logger from '../utils/logger'
import { pickSafeQueryString } from '../utils/pagination'

const ACCOUNT_CHANNELS = ['facebook', 'tiktok'] as const
const MAX_TAG_FILTERS = 20

const getUserOrgScope = (currentUser: JwtPayload): any => {
  if (currentUser.role === UserRole.SUPER_ADMIN) return {}
  if (!currentUser.organizationId) return { _id: null }
  return { organizationId: currentUser.organizationId }
}

const uniqueAccountIds = (accountIds?: string[]): string[] => {
  return Array.from(new Set((accountIds || [])
    .map(accountId => String(accountId || '').trim())
    .filter(Boolean)))
}

const pickAccountChannel = (value: any): string | undefined => {
  const channel = pickSafeQueryString(value, 20)
  return channel && (ACCOUNT_CHANNELS as readonly string[]).includes(channel) ? channel : undefined
}

const pickTagFilters = (value: any): string[] => {
  const values = Array.isArray(value) ? value : [value]
  return Array.from(new Set(values
    .map(tag => pickSafeQueryString(tag, 40))
    .filter(Boolean) as string[]))
    .slice(0, MAX_TAG_FILTERS)
}

class AccountManagementService {
  /**
   * 获取账户列表（带组织和标签信息）
   */
  async getAccounts(currentUser: JwtPayload, filters?: any): Promise<IAccount[]> {
    const query: any = { ...getUserOrgScope(currentUser) }

    // 应用过滤条件
    const channel = pickAccountChannel(filters?.channel)
    const organizationId = pickSafeQueryString(filters?.organizationId, 80)
    const groupId = pickSafeQueryString(filters?.groupId, 80)
    const tags = filters?.tags ? pickTagFilters(filters.tags) : []
    const unassigned = pickSafeQueryString(filters?.unassigned, 10)

    if (channel) {
      query.channel = channel
    }
    if (organizationId && currentUser.role === UserRole.SUPER_ADMIN) {
      query.organizationId = organizationId
    }
    if (tags.length > 0) {
      query.tags = { $in: tags }
    }
    if (groupId) {
      query.groupId = groupId
    }
    if (unassigned === 'true' && currentUser.role === UserRole.SUPER_ADMIN) {
      query.organizationId = null
    }

    const accounts = await Account.find(query)
      .select('-token')
      .populate('organizationId', 'name')
      .populate('groupId', 'name color')
      .populate('createdBy', 'username')
      .populate('assignedBy', 'username')
      .sort({ createdAt: -1 })

    return accounts
  }

  /**
   * 为账户添加标签
   */
  async addTags(
    accountId: string,
    tags: string[],
    currentUser: JwtPayload
  ): Promise<IAccount> {
    const account = await Account.findOne({ accountId, ...getUserOrgScope(currentUser) }).select('-token')
    if (!account) {
      throw new Error('账户不存在')
    }

    // 添加标签（去重）
    const existingTags = account.tags || []
    account.tags = [...new Set([...existingTags, ...tags])]
    await account.save()

    logger.info(`Tags added to account ${accountId}: ${tags.join(', ')}`)

    return account
  }

  /**
   * 移除账户标签
   */
  async removeTags(
    accountId: string,
    tags: string[],
    currentUser: JwtPayload
  ): Promise<IAccount> {
    const account = await Account.findOne({ accountId, ...getUserOrgScope(currentUser) }).select('-token')
    if (!account) {
      throw new Error('账户不存在')
    }

    // 移除标签
    account.tags = (account.tags || []).filter(tag => !tags.includes(tag))
    await account.save()

    return account
  }

  /**
   * 将账户分配给组织
   */
  async assignToOrganization(
    accountIds: string[],
    organizationId: string,
    currentUser: JwtPayload
  ): Promise<number> {
    // 只有超级管理员可以分配账户
    if (currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new Error('只有超级管理员可以分配账户')
    }

    // 验证组织是否存在
    const organization = await Organization.findById(organizationId)
    if (!organization) {
      throw new Error('组织不存在')
    }

    // 批量更新账户
    const result = await Account.updateMany(
      { accountId: { $in: accountIds } },
      {
        $set: {
          organizationId,
          assignedBy: currentUser.userId,
          assignedAt: new Date(),
        },
      }
    )

    logger.info(
      `Assigned ${result.modifiedCount} accounts to organization ${organization.name}`
    )

    return result.modifiedCount
  }

  /**
   * 取消账户的组织分配（回收到账户池）
   */
  async unassignFromOrganization(
    accountIds: string[],
    currentUser: JwtPayload
  ): Promise<number> {
    // 只有超级管理员可以取消分配
    if (currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new Error('只有超级管理员可以取消分配')
    }

    const result = await Account.updateMany(
      { accountId: { $in: accountIds } },
      {
        $unset: {
          organizationId: '',
          assignedBy: '',
          assignedAt: '',
        },
      }
    )

    logger.info(`Unassigned ${result.modifiedCount} accounts from organizations`)

    return result.modifiedCount
  }

  /**
   * 创建账户分组
   */
  async createGroup(
    data: {
      name: string
      description?: string
      color?: string
      organizationId?: string
      accounts?: string[]
    },
    currentUser: JwtPayload
  ): Promise<IAccountGroup> {
    const organizationId =
      currentUser.role === UserRole.SUPER_ADMIN
        ? data.organizationId
        : currentUser.organizationId
    const requestedAccountIds = uniqueAccountIds(data.accounts)

    if (currentUser.role !== UserRole.SUPER_ADMIN && !organizationId) {
      throw new Error('用户未关联组织，无法创建分组')
    }

    if (
      currentUser.role !== UserRole.SUPER_ADMIN &&
      data.organizationId &&
      data.organizationId !== currentUser.organizationId
    ) {
      throw new Error('无权为其他组织创建分组')
    }

    // 检查分组名是否已存在
    const existingGroup = await AccountGroup.findOne({ name: data.name, ...(organizationId ? { organizationId } : {}) })
    if (existingGroup) {
      throw new Error('分组名称已存在')
    }

    let scopedAccountIds: string[] = []
    if (requestedAccountIds.length > 0) {
      const accountQuery: any = { accountId: { $in: requestedAccountIds } }
      if (organizationId) {
        accountQuery.organizationId = organizationId
      }

      const scopedAccounts = await Account.find(accountQuery).select('accountId').lean()
      scopedAccountIds = scopedAccounts.map((account: any) => account.accountId).filter(Boolean)

      if (scopedAccountIds.length !== requestedAccountIds.length) {
        throw new Error('分组包含不存在或无权访问的账户')
      }
    }

    const group = new AccountGroup({
      name: data.name,
      description: data.description,
      color: data.color || '#3B82F6',
      organizationId,
      accounts: scopedAccountIds,
      createdBy: currentUser.userId,
    })

    await group.save()

    // 更新账户的 groupId
    if (scopedAccountIds.length > 0) {
      await Account.updateMany(
        { accountId: { $in: scopedAccountIds }, ...(organizationId ? { organizationId } : {}) },
        { $set: { groupId: group._id } }
      )
    }

    logger.info(`Account group ${data.name} created`)

    return group
  }

  /**
   * 获取分组列表
   */
  async getGroups(currentUser: JwtPayload, filters?: any): Promise<IAccountGroup[]> {
    const query: any = { ...getUserOrgScope(currentUser) }

    const organizationId = pickSafeQueryString(filters?.organizationId, 80)
    if (organizationId && currentUser.role === UserRole.SUPER_ADMIN) {
      query.organizationId = organizationId
    }

    const groups = await AccountGroup.find(query)
      .populate('organizationId', 'name')
      .populate('createdBy', 'username')
      .sort({ createdAt: -1 })

    return groups
  }

  /**
   * 批量更新账户备注
   */
  async updateAccountNotes(
    accountId: string,
    notes: string,
    currentUser: JwtPayload
  ): Promise<IAccount> {
    const account = await Account.findOne({ accountId, ...getUserOrgScope(currentUser) }).select('-token')
    if (!account) {
      throw new Error('账户不存在')
    }

    account.notes = notes
    await account.save()

    return account
  }

  /**
   * 获取未分配的账户（账户池）
   */
  async getUnassignedAccounts(currentUser: JwtPayload): Promise<IAccount[]> {
    // 只有超级管理员可以查看账户池
    if (currentUser.role !== UserRole.SUPER_ADMIN) {
      throw new Error('只有超级管理员可以查看账户池')
    }

    const accounts = await Account.find({
      $or: [
        { organizationId: null },
        { organizationId: { $exists: false } },
      ],
    })
      .select('-token')
      .populate('groupId', 'name color')
      .sort({ createdAt: -1 })

    return accounts
  }

  /**
   * 获取账户统计信息
   */
  async getAccountStats(currentUser: JwtPayload) {
    const query: any = { ...getUserOrgScope(currentUser) }

    const total = await Account.countDocuments(query)
    const unassigned = currentUser.role === UserRole.SUPER_ADMIN
      ? await Account.countDocuments({ organizationId: null })
      : 0
    
    // 按组织统计
    const byOrganization = await Account.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$organizationId',
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'organizations',
          localField: '_id',
          foreignField: '_id',
          as: 'organization',
        },
      },
    ])

    // 按标签统计
    const byTags = await Account.aggregate([
      { $match: query },
      { $unwind: '$tags' },
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ])

    return {
      total,
      unassigned,
      byOrganization,
      byTags,
    }
  }
}

export default new AccountManagementService()
