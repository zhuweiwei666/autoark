import Account from '../models/Account'
import FbToken from '../models/FbToken'
import MetricsDaily from '../models/MetricsDaily'
import { fetchUserAdAccounts, fetchInsights } from './facebook.api'
import logger from '../utils/logger'
import { normalizeForStorage, getAccountIdsForQuery, normalizeFromQuery, normalizeForApi } from '../utils/accountId'

export const syncAccountsFromTokens = async () => {
  const startTime = Date.now()
  let syncedCount = 0
  let errorCount = 0
  const errors: Array<{ tokenId: string; optimizer?: string; error: string }> = []

  try {
    // 1. 获取所有有效的 Token
    const tokens = await FbToken.find({ status: 'active' })
    logger.info(`Starting account sync for ${tokens.length} tokens`)

    for (const tokenDoc of tokens) {
      try {
        // 2. 拉取该 Token 下的广告账户
        const accounts = await fetchUserAdAccounts(tokenDoc.token)
        
        // 3. 更新数据库
        for (const acc of accounts) {
          const accountData: any = {
            channel: 'facebook',
            accountId: normalizeForStorage(acc.id), // 统一格式：数据库存储时去掉前缀
            name: acc.name,
            currency: acc.currency,
            status: mapAccountStatus(acc.account_status),
            accountStatus: acc.account_status,
            disableReason: acc.disable_reason,
            balance: acc.balance, // 注意：FB 返回的 balance 通常是分，需要确认单位
            spendCap: acc.spend_cap,
            amountSpent: acc.amount_spent,
            token: tokenDoc.token, // 关联的 Token
            operator: tokenDoc.optimizer, // 关联的优化师
          }
          
          // 从 Token 继承 organizationId（组织隔离）
          if (tokenDoc.organizationId) {
            accountData.organizationId = tokenDoc.organizationId
          }

          await Account.findOneAndUpdate(
            { accountId: accountData.accountId },
            accountData,
            { upsert: true, new: true }
          )
          syncedCount++
        }
        
        // 更新 Token 的最后检查时间
        await FbToken.findByIdAndUpdate(tokenDoc._id, { lastCheckedAt: new Date() })

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

    logger.info(`Account sync completed. Synced: ${syncedCount}, Errors: ${errorCount}, Duration: ${Date.now() - startTime}ms`)
    return { syncedCount, errorCount, errors }

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
    
    // 构建日期参数
    let datePreset = 'today'
    let timeRange: { since: string; until: string } | undefined
    
    if (filters.startDate && filters.endDate) {
        timeRange = { since: filters.startDate, until: filters.endDate }
        datePreset = ''
    } else if (filters.startDate) {
        timeRange = { since: filters.startDate, until: new Date().toISOString().split('T')[0] }
        datePreset = ''
    } else if (filters.endDate) {
        timeRange = { since: '2020-01-01', until: filters.endDate }
        datePreset = ''
    }
    
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
        
        return {
            ...accountObj,
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
