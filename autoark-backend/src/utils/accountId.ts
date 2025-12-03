/**
 * AccountId 格式统一处理工具
 * 
 * 规范说明：
 * 1. 数据库存储格式：统一去掉 "act_" 前缀（例如：1380155640310764）
 * 2. Facebook API 调用格式：统一添加 "act_" 前缀（例如：act_1380155640310764）
 * 3. 所有存储到数据库的数据，accountId 都应该是不带前缀的格式
 * 4. 所有调用 Facebook API 的地方，都应该使用带前缀的格式
 */

/**
 * 将 accountId 转换为数据库存储格式（去掉 act_ 前缀）
 * @param accountId - 可能是带或不带 act_ 前缀的 accountId
 * @returns 不带 act_ 前缀的 accountId
 * 
 * @example
 * normalizeForStorage('act_1380155640310764') // '1380155640310764'
 * normalizeForStorage('1380155640310764') // '1380155640310764'
 */
export function normalizeForStorage(accountId: string | null | undefined): string {
  if (!accountId) return ''
  return accountId.replace(/^act_/, '')
}

/**
 * 将 accountId 转换为 Facebook API 调用格式（添加 act_ 前缀）
 * @param accountId - 可能是带或不带 act_ 前缀的 accountId
 * @returns 带 act_ 前缀的 accountId
 * 
 * @example
 * normalizeForApi('1380155640310764') // 'act_1380155640310764'
 * normalizeForApi('act_1380155640310764') // 'act_1380155640310764'
 */
export function normalizeForApi(accountId: string | null | undefined): string {
  if (!accountId) return ''
  const normalized = normalizeForStorage(accountId)
  return normalized ? `act_${normalized}` : ''
}

/**
 * 批量将 accountId 数组转换为数据库存储格式
 * @param accountIds - accountId 数组
 * @returns 不带 act_ 前缀的 accountId 数组
 */
export function normalizeArrayForStorage(accountIds: (string | null | undefined)[]): string[] {
  return accountIds.map(normalizeForStorage).filter(Boolean)
}

/**
 * 批量将 accountId 数组转换为 Facebook API 调用格式
 * @param accountIds - accountId 数组
 * @returns 带 act_ 前缀的 accountId 数组
 */
export function normalizeArrayForApi(accountIds: (string | null | undefined)[]): string[] {
  return accountIds.map(normalizeForApi).filter(Boolean)
}

/**
 * 获取用于查询的 accountId 数组（同时包含带前缀和不带前缀的格式）
 * 用于兼容历史数据可能存在的格式不一致问题
 * @param accountIds - accountId 数组（应该是数据库存储格式，不带前缀）
 * @returns 包含两种格式的 accountId 数组
 */
export function getAccountIdsForQuery(accountIds: string[]): string[] {
  const normalized = normalizeArrayForStorage(accountIds)
  const withPrefix = normalizeArrayForApi(normalized)
  return [...new Set([...normalized, ...withPrefix])] // 合并去重
}

/**
 * 统一处理从数据库查询结果中获取的 accountId（去掉前缀以便匹配）
 * @param accountId - 可能是带或不带 act_ 前缀的 accountId
 * @returns 不带 act_ 前缀的 accountId
 */
export function normalizeFromQuery(accountId: string | null | undefined): string {
  return normalizeForStorage(accountId)
}

