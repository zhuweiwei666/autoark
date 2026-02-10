/**
 * Facebook Account ID normalization.
 * Storage format: no prefix (e.g. "123456")
 * API format: with prefix (e.g. "act_123456")
 */
export function normalizeForApi(accountId: string): string {
  if (!accountId) return accountId
  return accountId.startsWith('act_') ? accountId : `act_${accountId}`
}

export function normalizeForStorage(accountId: string): string {
  if (!accountId) return accountId
  return accountId.startsWith('act_') ? accountId.replace('act_', '') : accountId
}
