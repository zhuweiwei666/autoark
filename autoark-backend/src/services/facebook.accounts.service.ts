import Account from '../models/Account'
import FbToken from '../models/FbToken'
import FacebookUser from '../models/FacebookUser'
import MetricsDaily from '../models/MetricsDaily'
import { fetchUserAdAccounts, fetchInsights } from './facebook.api'
import logger from '../utils/logger'
import { normalizeForStorage, getAccountIdsForQuery, normalizeFromQuery, normalizeForApi } from '../utils/accountId'
import { buildInsightsDateRequest } from '../utils/insightsDateRange'

type FacebookAccountSource = {
  id?: string
  account_id?: string
  accountId?: string
  name?: string
  account_status?: number
  status?: number
  currency?: string
  timezone_name?: string
  timezone?: string
  balance?: number
  spend_cap?: string
  amount_spent?: string
  disable_reason?: number
}

type FacebookAccountToken = {
  _id: any
  token: string
  optimizer?: string
  organizationId?: any
}

export const syncCachedAccountsForToken = async (
  tokenDoc: FacebookAccountToken,
  accounts: FacebookAccountSource[],
) => {
  const accountDataById = new Map<string, any>()

  for (const account of accounts) {
    const accountId = normalizeForStorage(
      account.accountId || account.account_id || account.id || '',
    )
    if (!accountId) continue

    const accountStatus = account.account_status ?? account.status
    const timezone = account.timezone_name ?? account.timezone
    const accountData: any = {
      channel: 'facebook',
      accountId,
      token: tokenDoc.token,
      ...(tokenDoc.organizationId && { organizationId: tokenDoc.organizationId }),
    }
    if (account.name !== undefined) accountData.name = account.name
    if (account.currency !== undefined) accountData.currency = account.currency
    if (timezone !== undefined) accountData.timezone = timezone
    if (accountStatus !== undefined) {
      accountData.status = mapAccountStatus(accountStatus)
      accountData.accountStatus = accountStatus
    }
    if (account.disable_reason !== undefined) accountData.disableReason = account.disable_reason
    if (account.balance !== undefined) accountData.balance = account.balance
    if (account.spend_cap !== undefined) accountData.spendCap = account.spend_cap
    if (account.amount_spent !== undefined) accountData.amountSpent = account.amount_spent
    if (tokenDoc.optimizer !== undefined) accountData.operator = tokenDoc.optimizer

    accountDataById.set(accountId, accountData)
  }

  const accountData = Array.from(accountDataById.values())
  if (accountData.length === 0) {
    return { syncedCount: 0, skippedCount: 0, errors: [] as Array<{ tokenId: string; optimizer?: string; error: string }> }
  }

  const existingAccounts = await Account.find({
    channel: 'facebook',
    accountId: { $in: accountData.map(account => account.accountId) },
  }).select('accountId organizationId').lean()
  const existingById = new Map(existingAccounts.map((account: any) => [account.accountId, account]))
  const tokenOrgId = tokenDoc.organizationId?.toString?.()
  const errors: Array<{ tokenId: string; optimizer?: string; error: string }> = []
  const operations: any[] = []

  for (const data of accountData) {
    const existingAccount = existingById.get(data.accountId)
    const existingOrgId = existingAccount?.organizationId?.toString?.()
    if (existingOrgId && (!tokenOrgId || existingOrgId !== tokenOrgId)) {
      const error = `广告账户 ${data.accountId} 已归属其他组织，跳过同步`
      errors.push({
        tokenId: String(tokenDoc._id),
        optimizer: tokenDoc.optimizer,
        error,
      })
      logger.warn(`[AccountSync] ${error}`)
      continue
    }

    // 把组织归属约束放进写入条件，避免两个组织并发授权时通过预检查后互相覆盖。
    const ownershipFilter = tokenDoc.organizationId
      ? {
          $or: [
            { organizationId: tokenDoc.organizationId },
            { organizationId: { $exists: false } },
            { organizationId: null },
          ],
        }
      : {
          $or: [
            { organizationId: { $exists: false } },
            { organizationId: null },
          ],
        }

    operations.push({
      updateOne: {
        filter: {
          channel: 'facebook',
          accountId: data.accountId,
          ...ownershipFilter,
        },
        update: { $set: data },
        // 若归属在预检查后被并发修改，唯一索引会把这次 upsert 变成可识别的冲突，
        // 而不是静默覆盖另一个组织的数据。
        upsert: true,
      },
    })
  }

  if (operations.length > 0) {
    try {
      await Account.bulkWrite(operations, { ordered: false })
    } catch (error: any) {
      const writeErrors = Array.isArray(error?.writeErrors) ? error.writeErrors : []
      const duplicateErrors = writeErrors.filter((writeError: any) => writeError?.code === 11000)
      const hasOnlyDuplicateErrors = writeErrors.length > 0 && duplicateErrors.length === writeErrors.length

      if (
        (writeErrors.length > 0 && !hasOnlyDuplicateErrors)
        || (writeErrors.length === 0 && error?.code !== 11000)
      ) {
        throw error
      }

      const conflictingIds = new Set<string>()
      for (const writeError of duplicateErrors) {
        const accountId = operations[writeError.index]?.updateOne?.filter?.accountId
        if (accountId) conflictingIds.add(accountId)
      }
      if (conflictingIds.size === 0 && error?.keyValue?.accountId) {
        conflictingIds.add(normalizeForStorage(error.keyValue.accountId))
      }
      if (conflictingIds.size === 0) throw error

      for (const accountId of conflictingIds) {
        const conflictError = `广告账户 ${accountId} 并发归属冲突，跳过同步`
        errors.push({
          tokenId: String(tokenDoc._id),
          optimizer: tokenDoc.optimizer,
          error: conflictError,
        })
        logger.warn(`[AccountSync] ${conflictError}`)
      }

      return {
        syncedCount: operations.length - conflictingIds.size,
        skippedCount: errors.length,
        errors,
      }
    }
  }

  return {
    syncedCount: operations.length,
    skippedCount: errors.length,
    errors,
  }
}

export const syncAccountsFromTokens = async () => {
  const startTime = Date.now()
  let syncedCount = 0
  let errorCount = 0
  let skippedCount = 0
  let cacheTokenCount = 0
  let liveTokenCount = 0
  const errors: Array<{ tokenId: string; optimizer?: string; error: string }> = []

  try {
    // 1. 获取所有有效的 Token
    const tokens = await FbToken.find({ status: 'active' })
    logger.info(`Starting account sync for ${tokens.length} tokens`)

    for (const tokenDoc of tokens) {
      try {
        // 优先复用 OAuth 资产同步已经落库的账户，避免重复请求 Meta。
        const cachedUser: any = await FacebookUser.findOne({ tokenId: tokenDoc._id })
          .select('adAccounts')
          .lean()
        let accounts: FacebookAccountSource[] = cachedUser?.adAccounts || []
        if (accounts.length > 0) {
          cacheTokenCount++
        } else {
          accounts = await fetchUserAdAccounts(tokenDoc.token)
          liveTokenCount++
        }

        const result = await syncCachedAccountsForToken(tokenDoc, accounts)
        syncedCount += result.syncedCount
        skippedCount += result.skippedCount
        errors.push(...result.errors)

        await FbToken.findByIdAndUpdate(tokenDoc._id, { lastAccountSyncedAt: new Date() })

      } catch (error: any) {
        errorCount++
        const errorMsg = error.message || String(error)
        errors.push({ 
          tokenId: String(tokenDoc._id), 
          optimizer: tokenDoc.optimizer,
          error: errorMsg 
        })
        logger.error(`Failed to sync accounts for token ${tokenDoc._id}: ${errorMsg}`)
        // 如果是 Token 失效，更新 Token 状态
        if (error.message?.includes('Session has expired') || error.response?.data?.error?.code === 190) {
            await FbToken.findByIdAndUpdate(tokenDoc._id, { status: 'expired' })
        }
      }
    }

    logger.info(`Account sync completed. Synced: ${syncedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}, Duration: ${Date.now() - startTime}ms`)
    return { syncedCount, skippedCount, errorCount, cacheTokenCount, liveTokenCount, errors }

  } catch (error: any) {
    logger.error('Account sync failed:', error)
    throw error
  }
}

// Facebook 账户状态映射
// 1 = ACTIVE, 2 = DISABLED, 3 = UNSETTLED, 7 = PENDING_RISK_REVIEW, 8 = IN_GRACE_PERIOD, 9 = PENDING_CLOSURE, 100 = CLOSED, 101 = PENDING_CLOSURE, 201 = ANY_ACTIVE, 202 = ANY_CLOSED
const mapAccountStatus = (status: number): string => {
  switch (status) {
    case 1: return 'active'
    case 2: return 'disabled'
    case 3: return 'unsettled'
    case 7: return 'review'
    case 100: return 'closed'
    default: return `status_${status}`
  }
}

export const getAccounts = async (filters: any = {}, pagination: { page: number, limit: number, sortBy?: string, sortOrder?: 'asc' | 'desc' }, organizationId?: string) => {
    const query: any = {}
    
    // 组织隔离过滤
    if (organizationId) {
        query.organizationId = organizationId
    }
    
    // 用户隔离：限制只能看到关联的账户
    if (filters.accountIds && Array.isArray(filters.accountIds)) {
        if (filters.accountIds.length === 0) {
            // 用户没有关联任何账户，返回空结果
            return { data: [], total: 0, page: pagination.page, limit: pagination.limit }
        }
        query.accountId = { $in: filters.accountIds }
    }
    
    if (filters.optimizer) {
        query.operator = { $regex: filters.optimizer, $options: 'i' }
    }
    if (filters.status) {
        query.status = filters.status
    }
    if (filters.accountId && !filters.accountIds) {
        // 只有在没有 accountIds 限制时才按关键字搜索
        query.accountId = { $regex: filters.accountId, $options: 'i' }
    } else if (filters.accountId && filters.accountIds) {
        // 有 accountIds 限制时，在限制范围内搜索
        query.$and = [
            { accountId: { $in: filters.accountIds } },
            { accountId: { $regex: filters.accountId, $options: 'i' } }
        ]
        delete query.accountId
    }
    if (filters.name) {
        query.name = { $regex: filters.name, $options: 'i' }
    }

    // 先获取所有符合条件的账户（用于排序）
    const allAccounts = await Account.find(query).lean()
    const total = allAccounts.length

    // 获取所有账户ID
    const accountIds = allAccounts.map(acc => acc.accountId)
    
    // 直接从 Facebook Insights API 获取消耗数据（更准确）
    let periodSpendMap: Record<string, number> = {}
    
    const { datePreset, timeRange } = buildInsightsDateRequest(filters)
    
    // 为每个账户使用其关联的 token（更准确，避免用“任意一个 active token”导致无权限/数据不更新）
    const accountTokenMap: Record<string, string> = {}
    for (const acc of allAccounts as any[]) {
        if (acc?.accountId && acc?.token) {
            accountTokenMap[acc.accountId] = acc.token
        }
    }
    
    if (accountIds.length > 0) {
        // 并发获取所有账户的 insights（限制并发数）
        const batchSize = 10
        for (let i = 0; i < accountIds.length; i += batchSize) {
            const batch = accountIds.slice(i, i + batchSize)
            const promises = batch.map(async (accountId) => {
                try {
                    const token = accountTokenMap[accountId]
                    if (!token) {
                        return { accountId, spend: 0 }
                    }
                    const accountIdForApi = normalizeForApi(accountId)
                    const insights = await fetchInsights(
                        accountIdForApi,
                        'account',
                        datePreset || undefined,
                        token,
                        undefined,
                        timeRange
                    )
                    if (insights && insights.length > 0) {
                        const spend = parseFloat(insights[0].spend || '0')
                        return { accountId, spend }
                    }
                    return { accountId, spend: 0 }
                } catch (error) {
                    logger.warn(`Failed to fetch insights for account ${accountId}`)
                    return { accountId, spend: 0 }
                }
            })
            
            const results = await Promise.all(promises)
            results.forEach(({ accountId, spend }) => {
                periodSpendMap[accountId] = spend
            })
        }
    }
    
    // 为每个账户添加消耗和计算后的余额
    const accountsWithMetrics = allAccounts.map((account: any) => {
        const accountId = account.accountId
        
        // periodSpend: 来自 Facebook Insights API 的消耗（日期范围内或今天）
        const periodSpend = periodSpendMap[accountId] || 0
        
        // Facebook API 返回的 amount_spent 是以账户货币的最小单位（分）返回的
        const amountSpentRaw = account.amountSpent ? 
            (typeof account.amountSpent === 'string' ? parseFloat(account.amountSpent) : account.amountSpent) : 0
        const amountSpentUsd = amountSpentRaw / 100 // Facebook API 返回的是美分
        
        // Facebook API 返回的 balance 也是以账户货币的最小单位（分）返回的
        const balanceRaw = account.balance ? 
            (typeof account.balance === 'string' ? parseFloat(account.balance) : account.balance) : 0
        const balanceUsd = balanceRaw / 100 // 转换为美元
        
        const accountObj = account.toObject ? account.toObject() : account
        const { token: _internalToken, ...publicAccount } = accountObj
        
        return {
            ...publicAccount,
            periodSpend: periodSpend, // 日期范围/当日消耗（来自 Facebook Insights API）
            calculatedBalance: balanceUsd, // 账户余额（美元）
            totalSpend: amountSpentUsd, // 账户历史总消耗（来自 Facebook API amount_spent）
        }
    })
    
    // 排序逻辑：如果指定了排序字段，对所有数据进行排序
    if (pagination.sortBy) {
        const sortField = pagination.sortBy
        const sortOrder = pagination.sortOrder === 'desc' ? -1 : 1
        
        accountsWithMetrics.sort((a: any, b: any) => {
            const aValue = a[sortField]
            const bValue = b[sortField]
            
            // 处理 null/undefined 值
            if (aValue == null && bValue == null) return 0
            if (aValue == null) return 1 // null 值排在后面
            if (bValue == null) return -1
            
            // 处理数字比较
            if (typeof aValue === 'number' && typeof bValue === 'number') {
                return sortOrder * (aValue - bValue)
            }
            
            // 处理字符串比较
            if (typeof aValue === 'string' && typeof bValue === 'string') {
                return sortOrder * aValue.localeCompare(bValue)
            }
            
            // 默认比较
            return sortOrder * (aValue > bValue ? 1 : aValue < bValue ? -1 : 0)
        })
    } else {
        // 默认按 createdAt 降序
        accountsWithMetrics.sort((a: any, b: any) => {
            const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0
            const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0
            return bDate - aDate
        })
    }
    
    // 分页
    const startIndex = (pagination.page - 1) * pagination.limit
    const paginatedAccounts = accountsWithMetrics.slice(startIndex, startIndex + pagination.limit)
    
    // 添加调试日志（仅在前几个账户时）
    if (paginatedAccounts.length > 0 && paginatedAccounts.length <= 3) {
        paginatedAccounts.slice(0, 3).forEach((acc: any) => {
            logger.info(`Account ${acc.accountId}: periodSpend=${acc.periodSpend}, totalSpend=${acc.totalSpend}, calculatedBalance=${acc.calculatedBalance}`)
        })
    }

    return {
        data: paginatedAccounts,
        pagination: {
            total,
            page: pagination.page,
            limit: pagination.limit,
            pages: Math.ceil(total / pagination.limit)
        }
  }
}
