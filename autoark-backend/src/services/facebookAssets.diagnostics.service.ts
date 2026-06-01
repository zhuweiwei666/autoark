type ChecklistStatus = 'done' | 'warning' | 'pending' | 'blocked'

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

const mostRecentDate = (values: any[]) => {
  const timestamps = values
    .map(value => value ? new Date(value).getTime() : 0)
    .filter(value => Number.isFinite(value) && value > 0)
  if (timestamps.length === 0) return undefined
  return new Date(Math.max(...timestamps))
}

export function buildFacebookAssetDiagnostics({
  tokens,
  users,
}: {
  tokens: any[]
  users: any[]
}) {
  const accountMap = new Map<string, any>()
  const pageMap = new Map<string, any[]>()
  const pixelMap = new Map<string, any[]>()

  for (const user of users) {
    for (const account of user.adAccounts || []) {
      if (!account.accountId) continue
      const existing = accountMap.get(account.accountId) || {}
      accountMap.set(account.accountId, {
        accountId: account.accountId,
        name: account.name || existing.name || account.accountId,
        status: account.status ?? existing.status,
        currency: account.currency || existing.currency,
        timezone: account.timezone || existing.timezone,
      })
    }

    for (const page of user.pages || []) {
      for (const account of page.accounts || []) {
        if (!page.pageId || !account.accountId) continue
        const pages = pageMap.get(account.accountId) || []
        if (!pages.some(existing => existing.pageId === page.pageId)) {
          pages.push({ pageId: page.pageId, name: page.name })
        }
        pageMap.set(account.accountId, pages)
      }
    }

    for (const pixel of user.pixels || []) {
      for (const account of pixel.accounts || []) {
        if (!pixel.pixelId || !account.accountId) continue
        const pixels = pixelMap.get(account.accountId) || []
        if (!pixels.some(existing => existing.pixelId === pixel.pixelId)) {
          pixels.push({ pixelId: pixel.pixelId, name: pixel.name })
        }
        pixelMap.set(account.accountId, pixels)
      }
    }
  }

  const accounts = Array.from(accountMap.values()).map(account => {
    const pages = pageMap.get(account.accountId) || []
    const pixels = pixelMap.get(account.accountId) || []
    const isActive = account.status === 1
    const isReady = isActive && pages.length > 0 && pixels.length > 0
    const issues: string[] = []

    if (!isActive) issues.push(`账户状态：${accountStatusLabel(account.status)}`)
    if (pages.length === 0) issues.push('没有可用 Page')
    if (pixels.length === 0) issues.push('没有可用 Pixel')

    return {
      ...account,
      statusLabel: accountStatusLabel(account.status),
      pageCount: pages.length,
      pixelCount: pixels.length,
      ready: isReady,
      issues,
    }
  })

  const activeAccountCount = accounts.filter(account => account.status === 1).length
  const pageLinkedAccountCount = accounts.filter(account => account.pageCount > 0).length
  const pixelLinkedAccountCount = accounts.filter(account => account.pixelCount > 0).length
  const readyAccountCount = accounts.filter(account => account.ready).length
  const completedSyncCount = users.filter(user => user.syncStatus === 'completed').length
  const syncingCount = users.filter(user => user.syncStatus === 'syncing').length
  const failedSyncCount = users.filter(user => user.syncStatus === 'failed').length

  const checklist = [
    step(
      'authorization',
      'Facebook 授权',
      tokens.length > 0 ? 'done' : 'blocked',
      `${tokens.length} 个授权`,
      tokens.length > 0 ? '已有可用授权。' : '还没有可用 Facebook 授权。',
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
      pageLinkedAccountCount,
      pixelLinkedAccountCount,
      readyAccountCount,
      lastSyncedAt: mostRecentDate(users.map(user => user.lastSyncedAt)),
    },
    checklist,
    accounts,
    risks,
  }
}
