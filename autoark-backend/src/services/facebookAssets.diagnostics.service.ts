import { normalizeForStorage } from '../utils/accountId'

type ChecklistStatus = 'done' | 'warning' | 'pending' | 'blocked'
type AccountIssueCode = 'ACCOUNT_NOT_ACTIVE' | 'MISSING_PAGE' | 'MISSING_PIXEL'
type AccountIssue = {
  code: AccountIssueCode
  severity: 'blocked' | 'warning'
  message: string
  action: string
}

const TOKEN_EXPIRING_SOON_DAYS = 14
const TOKEN_STALE_CHECK_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_ACCOUNT_DETAIL_LIMIT = 100

const accountStatusLabel = (status?: number) => {
  const labels: Record<number, string> = {
    1: '活跃',
    2: '已停用',
    3: '未结算',
    7: '风险审核中',
    9: '宽限期',
  }
  return status ? labels[status] || `未知状态 ${status}` : '未知'
}

const step = (id: string, title: string, status: ChecklistStatus, metric: string, description: string) => ({
  id,
  title,
  status,
  metric,
  description,
})

const issue = (code: AccountIssueCode, message: string, action: string): AccountIssue => ({
  code,
  severity: 'blocked',
  message,
  action,
})

const mostRecentDate = (values: any[]) => {
  const timestamps = values
    .map(value => value ? new Date(value).getTime() : 0)
    .filter(value => Number.isFinite(value) && value > 0)
  if (timestamps.length === 0) return undefined
  return new Date(Math.max(...timestamps))
}

const buildTokenHealth = (tokens: any[], now = new Date()) => {
  const expiringSoonAt = new Date(now.getTime() + TOKEN_EXPIRING_SOON_DAYS * DAY_MS)
  const staleBefore = new Date(now.getTime() - TOKEN_STALE_CHECK_DAYS * DAY_MS)
  let expiredCount = 0
  let expiringSoonCount = 0
  let staleCheckCount = 0
  let missingExpiryCount = 0
  let earliestExpiresAt: Date | undefined
  let oldestCheckedAt: Date | undefined

  for (const token of tokens) {
    const expiresAt = token?.expiresAt ? new Date(token.expiresAt) : undefined
    const lastCheckedAt = token?.lastCheckedAt ? new Date(token.lastCheckedAt) : undefined

    if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
      missingExpiryCount += 1
    } else {
      if (!earliestExpiresAt || expiresAt < earliestExpiresAt) earliestExpiresAt = expiresAt
      if (expiresAt < now) expiredCount += 1
      else if (expiresAt <= expiringSoonAt) expiringSoonCount += 1
    }

    if (!lastCheckedAt || Number.isNaN(lastCheckedAt.getTime()) || lastCheckedAt < staleBefore) {
      staleCheckCount += 1
    } else if (!oldestCheckedAt || lastCheckedAt < oldestCheckedAt) {
      oldestCheckedAt = lastCheckedAt
    }
  }

  return {
    expiredCount,
    expiringSoonCount,
    staleCheckCount,
    missingExpiryCount,
    earliestExpiresAt,
    oldestCheckedAt,
  }
}

export function buildFacebookAssetDiagnostics({
  tokens,
  users,
  accountLimit = DEFAULT_ACCOUNT_DETAIL_LIMIT,
}: {
  tokens: any[]
  users: any[]
  accountLimit?: number
}) {
  const accountMap = new Map<string, any>()
  const pageMap = new Map<string, any[]>()
  const pixelMap = new Map<string, any[]>()

  for (const user of users) {
    const userAccountIds = new Set<string>()
    for (const account of user.adAccounts || []) {
      const accountId = normalizeForStorage(account.accountId)
      if (!accountId) continue
      userAccountIds.add(accountId)
      const existing = accountMap.get(accountId) || {}
      accountMap.set(accountId, {
        accountId,
        name: account.name || existing.name || accountId,
        status: account.status ?? existing.status,
        currency: account.currency || existing.currency,
        timezone: account.timezone || existing.timezone,
      })
    }

    for (const page of user.pages || []) {
      const linkedAccountIds = new Set<string>()
      for (const account of page.accounts || []) {
        const accountId = normalizeForStorage(account.accountId)
        if (accountId) linkedAccountIds.add(accountId)
      }
      if (
        page.pageId &&
        typeof page.accessToken === 'string' &&
        page.accessToken.trim().length > 0
      ) {
        for (const accountId of userAccountIds) {
          linkedAccountIds.add(accountId)
        }
      }
      for (const accountId of linkedAccountIds) {
        if (!page.pageId) continue
        const pages = pageMap.get(accountId) || []
        if (!pages.some(existing => existing.pageId === page.pageId)) {
          pages.push({ pageId: page.pageId, name: page.name })
        }
        pageMap.set(accountId, pages)
      }
    }

    for (const pixel of user.pixels || []) {
      for (const account of pixel.accounts || []) {
        const accountId = normalizeForStorage(account.accountId)
        if (!pixel.pixelId || !accountId) continue
        const pixels = pixelMap.get(accountId) || []
        if (!pixels.some(existing => existing.pixelId === pixel.pixelId)) {
          pixels.push({ pixelId: pixel.pixelId, name: pixel.name })
        }
        pixelMap.set(accountId, pixels)
      }
    }
  }

  const accounts = Array.from(accountMap.values()).map(account => {
    const pages = pageMap.get(account.accountId) || []
    const pixels = pixelMap.get(account.accountId) || []
    const isActive = account.status === 1
    const isReady = isActive && pages.length > 0 && pixels.length > 0
    const issueDetails: AccountIssue[] = []

    if (!isActive) {
      issueDetails.push(issue(
        'ACCOUNT_NOT_ACTIVE',
        `账户状态：${accountStatusLabel(account.status)}`,
        '请在 Meta 广告账户中恢复账户状态，或改用其他活跃广告账户。',
      ))
    }
    if (pages.length === 0) {
      issueDetails.push(issue(
        'MISSING_PAGE',
        '没有可用 Page',
        '请确认登录用户拥有主页管理权限，并在商务管理平台中把主页分配给该广告账户。',
      ))
    }
    if (pixels.length === 0) {
      issueDetails.push(issue(
        'MISSING_PIXEL',
        '没有可用 Pixel',
        '请在 Meta 事件管理工具或商务管理平台中把 Pixel 分配给该广告账户，再回到 AutoArk 重新同步。',
      ))
    }

    return {
      ...account,
      statusLabel: accountStatusLabel(account.status),
      pageCount: pages.length,
      pixelCount: pixels.length,
      ready: isReady,
      issues: issueDetails.map(item => item.message),
      issueDetails,
    }
  })
  const sortedAccounts = [...accounts].sort((a, b) => {
    if (a.ready !== b.ready) return a.ready ? 1 : -1
    if (a.issueDetails.length !== b.issueDetails.length) return b.issueDetails.length - a.issueDetails.length
    return String(a.name || a.accountId).localeCompare(String(b.name || b.accountId))
  })
  const visibleAccountLimit = Number.isFinite(accountLimit) && accountLimit > 0
    ? Math.floor(accountLimit)
    : DEFAULT_ACCOUNT_DETAIL_LIMIT
  const visibleAccounts = sortedAccounts.slice(0, visibleAccountLimit)

  const activeAccountCount = accounts.filter(account => account.status === 1).length
  const pageLinkedAccountCount = accounts.filter(account => account.pageCount > 0).length
  const pixelLinkedAccountCount = accounts.filter(account => account.pixelCount > 0).length
  const readyAccountCount = accounts.filter(account => account.ready).length
  const inactiveAccountCount = accounts.filter(account => account.status !== 1).length
  const accountsMissingPageCount = accounts.filter(account => account.pageCount === 0).length
  const accountsMissingPixelCount = accounts.filter(account => account.pixelCount === 0).length
  const completedSyncCount = users.filter(user => user.syncStatus === 'completed').length
  const syncingCount = users.filter(user => user.syncStatus === 'syncing').length
  const failedSyncCount = users.filter(user => user.syncStatus === 'failed').length
  const tokenHealth = buildTokenHealth(tokens)

  const checklist = [
    step(
      'authorization',
      'Facebook 授权',
      tokens.length > 0 ? 'done' : 'blocked',
      `${tokens.length} 个授权`,
      tokens.length > 0 ? '已有可用授权。' : '还没有可用 Facebook 授权。',
    ),
    step(
      'token_health',
      '授权有效性',
      tokens.length === 0
        ? 'blocked'
        : tokenHealth.expiredCount > 0
          ? 'blocked'
          : tokenHealth.expiringSoonCount > 0 || tokenHealth.staleCheckCount > 0
            ? 'warning'
            : 'done',
      `${tokenHealth.expiringSoonCount} 临期 / ${tokenHealth.staleCheckCount} 待校验`,
      '授权过期或长期未校验会导致广告账户、Page、Pixel 读取和发布失败。',
    ),
    step(
      'asset_sync',
      '资产同步',
      completedSyncCount > 0 ? 'done' : syncingCount > 0 ? 'pending' : users.length > 0 ? 'warning' : 'blocked',
      `${completedSyncCount}/${users.length} 已完成`,
      failedSyncCount > 0 ? `${failedSyncCount} 个授权资产同步失败。` : '同步完成后才能稳定选择账户、Page 和 Pixel。',
    ),
    step(
      'ad_accounts',
      '广告账户',
      activeAccountCount > 0 ? 'done' : accounts.length > 0 ? 'warning' : 'blocked',
      `${activeAccountCount}/${accounts.length} 活跃`,
      '只有活跃广告账户可以发布任务。',
    ),
    step(
      'pages',
      'Page 权限',
      pageLinkedAccountCount > 0 ? 'done' : accounts.length > 0 ? 'blocked' : 'pending',
      `${pageLinkedAccountCount} 个账户已绑定 Page`,
      '创建广告创意需要账户可推广的 Facebook Page。',
    ),
    step(
      'pixels',
      'Pixel 权限',
      pixelLinkedAccountCount > 0 ? 'done' : accounts.length > 0 ? 'blocked' : 'pending',
      `${pixelLinkedAccountCount} 个账户已绑定 Pixel`,
      '转化目标投放需要广告账户可访问 Pixel。',
    ),
    step(
      'ready_accounts',
      '可投放账户',
      readyAccountCount > 0 ? 'done' : accounts.length > 0 ? 'blocked' : 'pending',
      `${readyAccountCount} 个就绪`,
      '账户同时满足活跃、Page、Pixel 后才适合批量发布。',
    ),
  ]

  const risks: Array<{ level: 'critical' | 'warning' | 'info'; message: string }> = []
  if (tokens.length === 0) {
    risks.push({ level: 'critical', message: '还没有 Facebook 授权，无法同步资产或创建广告。' })
  }
  if (tokenHealth.expiredCount > 0) {
    risks.push({ level: 'critical', message: `${tokenHealth.expiredCount} 个 Facebook 授权已经过期，请重新授权后再创建广告。` })
  }
  if (tokenHealth.expiringSoonCount > 0) {
    risks.push({ level: 'warning', message: `${tokenHealth.expiringSoonCount} 个 Facebook 授权将在 ${TOKEN_EXPIRING_SOON_DAYS} 天内过期，建议提前重新授权。` })
  }
  if (tokenHealth.staleCheckCount > 0) {
    risks.push({ level: 'warning', message: `${tokenHealth.staleCheckCount} 个 Facebook 授权超过 ${TOKEN_STALE_CHECK_DAYS} 天未校验，建议先检查授权状态。` })
  }
  if (users.length > 0 && completedSyncCount === 0) {
    risks.push({ level: 'warning', message: '授权存在但资产未同步完成，建议点击重新同步。' })
  }
  if (accounts.length > 0 && readyAccountCount === 0) {
    risks.push({ level: 'critical', message: '当前没有同时具备 Page 和 Pixel 的活跃广告账户。' })
  }

  return {
    authorized: tokens.length > 0,
    summary: {
      tokenCount: tokens.length,
      syncedUserCount: completedSyncCount,
      accountCount: accounts.length,
      activeAccountCount,
      inactiveAccountCount,
      pageLinkedAccountCount,
      pixelLinkedAccountCount,
      readyAccountCount,
      accountsMissingPageCount,
      accountsMissingPixelCount,
      expiredTokenCount: tokenHealth.expiredCount,
      expiringSoonTokenCount: tokenHealth.expiringSoonCount,
      staleTokenCheckCount: tokenHealth.staleCheckCount,
      tokenWithoutExpiryCount: tokenHealth.missingExpiryCount,
      earliestTokenExpiresAt: tokenHealth.earliestExpiresAt,
      oldestTokenCheckedAt: tokenHealth.oldestCheckedAt,
      lastSyncedAt: mostRecentDate(users.map(user => user.lastSyncedAt)),
    },
    checklist,
    accounts: visibleAccounts,
    limits: {
      accounts: {
        total: accounts.length,
        returned: visibleAccounts.length,
        maxReturned: visibleAccountLimit,
        truncated: accounts.length > visibleAccounts.length,
      },
    },
    risks,
  }
}
