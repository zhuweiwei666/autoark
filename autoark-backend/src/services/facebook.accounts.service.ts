import Account from '../models/Account'
import FbToken from '../models/FbToken'
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

    return {
        data: accounts,
        pagination: {
            total,
            page: pagination.page,
            limit: pagination.limit,
            pages: Math.ceil(total / pagination.limit)
        }
  }
}
