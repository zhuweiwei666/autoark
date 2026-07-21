import Account from '../models/Account'
import { normalizeForStorage } from '../utils/accountId'

const TERMINAL_AUTH_PATTERNS = [
  /error validating access token/i,
  /error validating application\. application has been deleted/i,
  /api access blocked/i,
  /sessions for the user are not allowed because the user is not a confirmed user/i,
  /invalid oauth access token/i,
  /access token could not be decrypted/i,
]

export const isTerminalFacebookAccountAuthError = (error: any): boolean => {
  const message = String(error?.message || error || '')
  if (/rate[ _-]?limit|request limit|socket|timeout|timed out|econnreset/i.test(message)) {
    return false
  }

  return Number(error?.code) === 190
    || TERMINAL_AUTH_PATTERNS.some((pattern) => pattern.test(message))
}

export const quarantineTerminalFacebookAccount = async (
  accountId: string,
  error: any,
): Promise<boolean> => {
  if (!isTerminalFacebookAccountAuthError(error)) return false

  const normalizedAccountId = normalizeForStorage(accountId)
  const reason = String(error?.message || error || 'Meta authorization invalid').slice(0, 500)
  await Account.updateOne(
    {
      channel: 'facebook',
      accountId: { $in: [normalizedAccountId, `act_${normalizedAccountId}`] },
    },
    {
      $set: {
        status: 'reauth_required',
        syncBlockedAt: new Date(),
        syncBlockedReason: reason,
      },
    },
  )

  return true
}
