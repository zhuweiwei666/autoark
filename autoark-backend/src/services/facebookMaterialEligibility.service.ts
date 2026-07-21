import Account from '../models/Account'
import { normalizeForStorage } from '../utils/accountId'

export const canProcessFacebookOriginalImageJob = async (accountId: string): Promise<boolean> => {
  const normalizedAccountId = normalizeForStorage(accountId)
  const account = await Account.exists({
    channel: 'facebook',
    status: 'active',
    accountId: { $in: [normalizedAccountId, `act_${normalizedAccountId}`] },
    token: { $exists: true, $nin: [null, ''] },
  })

  return Boolean(account)
}
