import Account from '../models/Account'
import FbToken from '../models/FbToken'
import MetricsDaily from '../models/MetricsDaily'
import { fetchUserAdAccounts } from './facebook.api'
import logger from '../utils/logger'

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
          const accountData = {
            channel: 'facebook',
            accountId: acc.id.replace('act_', ''), // 统一格式，去掉前缀
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

export const getAccounts = async (filters: any = {}, pagination: { page: number, limit: number }) => {
    const query: any = {}
    
    if (filters.optimizer) {
        query.operator = { $regex: filters.optimizer, $options: 'i' }
    }
    if (filters.status) {
        query.status = filters.status
    }
    if (filters.accountId) {
        query.accountId = { $regex: filters.accountId, $options: 'i' }
    }
    if (filters.name) {
        query.name = { $regex: filters.name, $options: 'i' }
    }

    const total = await Account.countDocuments(query)
    const accounts = await Account.find(query)
        .sort({ createdAt: -1 })
        .skip((pagination.page - 1) * pagination.limit)
        .limit(pagination.limit)

    // 获取所有账户ID，用于批量查询消耗数据
    // 注意：Account 表中的 accountId 已经去掉了 "act_" 前缀
    // 但 MetricsDaily 中可能存储的是带 "act_" 前缀的，需要同时查询两种格式
    const accountIds = accounts.map(acc => acc.accountId)
    const accountIdsWithPrefix = accountIds.map(id => `act_${id}`)
    const allAccountIds = [...new Set([...accountIds, ...accountIdsWithPrefix])] // 合并去重
    
    // 计算日期范围内的消耗（如果提供了日期范围）
    let periodSpendMap: Record<string, number> = {}
    if (accountIds.length > 0 && (filters.startDate || filters.endDate)) {
        const dateQuery: any = { accountId: { $in: allAccountIds } }
        if (filters.startDate || filters.endDate) {
            dateQuery.date = {}
            if (filters.startDate) {
                dateQuery.date.$gte = filters.startDate
            }
            if (filters.endDate) {
                dateQuery.date.$lte = filters.endDate
            }
        }
        
        const periodSpendData = await MetricsDaily.aggregate([
            { $match: dateQuery },
            {
                $group: {
                    _id: '$accountId',
                    spend: { $sum: '$spendUsd' }
                }
            }
        ])
        
        periodSpendData.forEach((item: any) => {
            // 统一处理 accountId，去掉 "act_" 前缀以便匹配
            const normalizedId = item._id?.replace(/^act_/, '') || item._id
            periodSpendMap[normalizedId] = (periodSpendMap[normalizedId] || 0) + (item.spend || 0)
        })
    }
    
    // 计算所有账户的历史总消耗
    const totalSpendMap: Record<string, number> = {}
    if (accountIds.length > 0) {
        const totalSpendData = await MetricsDaily.aggregate([
            { $match: { accountId: { $in: allAccountIds } } },
            {
                $group: {
                    _id: '$accountId',
                    totalSpend: { $sum: '$spendUsd' }
                }
            }
        ])
        
        totalSpendData.forEach((item: any) => {
            // 统一处理 accountId，去掉 "act_" 前缀以便匹配
            const normalizedId = item._id?.replace(/^act_/, '') || item._id
            totalSpendMap[normalizedId] = (totalSpendMap[normalizedId] || 0) + (item.totalSpend || 0)
        })
    }
    
    // 为每个账户添加消耗和计算后的余额
    const accountsWithMetrics = accounts.map((account: any) => {
        const accountId = account.accountId
        // 只有在提供了日期范围时才计算 periodSpend，否则为 undefined
        const periodSpend = (filters.startDate || filters.endDate) ? (periodSpendMap[accountId] || 0) : undefined
        const totalSpend = totalSpendMap[accountId] || 0
        
        // Facebook API 返回的 balance 是以账户货币的最小单位（分）返回的，需要除以 100
        // 但这里假设 balance 已经是正确的单位，如果后端存储时已经转换过，就不需要再除以 100
        // 需要根据实际情况调整
        const accountBalance = account.balance ? (typeof account.balance === 'number' ? account.balance : parseFloat(account.balance)) / 100 : 0
        
        // 余额 = 账户总余额 - 历史总消耗金额
        // 注意：这里假设 spendUsd 是美元，如果账户货币不是美元，需要转换
        // 简化处理：假设都是美元，实际项目中需要根据 currency 进行转换
        const calculatedBalance = accountBalance - totalSpend
        
        const accountObj = account.toObject ? account.toObject() : account
        
        return {
            ...accountObj,
            periodSpend: periodSpend, // 日期范围内的消耗（美元）
            calculatedBalance: calculatedBalance, // 计算后的余额（美元）
            totalSpend: totalSpend // 历史总消耗（美元，用于调试）
        }
    })
    
    // 添加调试日志（仅在前几个账户时）
    if (accountsWithMetrics.length > 0 && accountsWithMetrics.length <= 3) {
        accountsWithMetrics.slice(0, 3).forEach((acc: any) => {
            logger.info(`Account ${acc.accountId}: periodSpend=${acc.periodSpend}, totalSpend=${acc.totalSpend}, calculatedBalance=${acc.calculatedBalance}`)
        })
    }

    return {
        data: accountsWithMetrics,
        pagination: {
            total,
            page: pagination.page,
            limit: pagination.limit,
            pages: Math.ceil(total / pagination.limit)
        }
  }
}
