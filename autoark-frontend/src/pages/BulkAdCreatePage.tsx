import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Loading from '../components/Loading'
import { useAuth } from '../contexts/AuthContext'
import { authFetch } from '../services/api'

const API_BASE = '/api'
const FACEBOOK_LOGIN_URL_TIMEOUT_MS = 15000
const FACEBOOK_LOGIN_POPUP_TIMEOUT_MS = 120000
const FACEBOOK_SYNC_FAST_POLL_MS = 2000
const FACEBOOK_SYNC_SLOW_POLL_MS = 10000
const FACEBOOK_SYNC_FAST_POLL_WINDOW_MS = 30000
const ACCOUNT_PAGE_FETCH_CONCURRENCY = 6

const mapWithConcurrency = async <T, R,>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return []

  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await mapper(items[index], index)
      }
    },
  )
  await Promise.all(workers)
  return results
}

const STEPS = [
  { id: 1, title: '选择产品', description: '选择文案包(产品)' },
  { id: 2, title: '选择像素', description: '选择追踪Pixel' },
  { id: 3, title: '选择账户', description: '基于Pixel选账户' },
  { id: 4, title: '广告系列', description: '名称、预算、竞价' },
  { id: 5, title: '广告组', description: '定向、版位、排期' },
  { id: 6, title: '广告创意', description: '素材、创意组' },
  { id: 7, title: '预览发布', description: '确认并发布' },
]

interface AccountConfig {
  accountId: string
  accountName: string
  pageId: string
  pageName: string
  pixelId: string
  pixelName: string
  conversionEvent: string
}

interface AuthStatus {
  authorized: boolean
  fbUserId?: string
  fbUserName?: string
  tokenId?: string
}

interface AuthDiagnostics {
  authorized: boolean
  summary: {
    tokenCount: number
    syncedUserCount: number
    accountCount: number
    activeAccountCount: number
    inactiveAccountCount?: number
    pageLinkedAccountCount: number
    pixelLinkedAccountCount: number
    readyAccountCount: number
    accountsMissingPageCount?: number
    accountsMissingPixelCount?: number
    expiredTokenCount?: number
    expiringSoonTokenCount?: number
    staleTokenCheckCount?: number
    tokenWithoutExpiryCount?: number
    earliestTokenExpiresAt?: string
    oldestTokenCheckedAt?: string
    lastSyncedAt?: string
  }
  accounts: Array<{
    accountId: string
    name?: string
    statusLabel?: string
    pageCount: number
    pixelCount: number
    ready: boolean
    issues: string[]
    issueDetails?: Array<{
      code: string
      severity: 'blocked' | 'warning'
      message: string
      action: string
    }>
  }>
  limits?: {
    accounts?: {
      total: number
      returned: number
      maxReturned: number
      truncated: boolean
    }
  }
  risks: Array<{ level: 'critical' | 'warning' | 'info'; message: string }>
}

const assetIssueLabels: Record<string, string> = {
  ACCOUNT_NOT_ACTIVE: '账户不可投放',
  MISSING_PAGE: '缺 Page',
  MISSING_PIXEL: '缺 Pixel',
}

const getAssetIssueSummary = (diagnostics: AuthDiagnostics | null) => {
  if (!diagnostics) return []
  const counts = new Map<string, number>()
  for (const account of diagnostics.accounts || []) {
    for (const issue of account.issueDetails || []) {
      counts.set(issue.code, (counts.get(issue.code) || 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([code, count]) => ({ code, label: assetIssueLabels[code] || code, count }))
    .sort((a, b) => b.count - a.count)
}

interface FacebookLoginAttempt {
  clientId?: string
  redirectUri?: string
  authorizationMode?: 'business_login' | 'scope_oauth' | string
  diagnostics: string[]
  openedAt: string
}

interface PublishBlocker {
  message: string
  errorCode?: string
  details?: Record<string, any>
  nextActions: string[]
  actionPath?: string
}

interface FacebookAssetResponseMeta {
  failedTokenCount?: number
  fetchedPageCount?: number
  pageLimit?: number
  pageLimitPerToken?: number
  pageSize?: number
  paginationTruncated?: boolean
  promotePagesFailed?: boolean
  source?: 'promote_pages' | 'user_pages' | 'none' | string
}

const commercialBlockerActions: Record<string, { actions: string[]; actionPath?: string }> = {
  ORGANIZATION_NOT_ACTIVE: {
    actions: ['联系平台运营启用客户组织。', '启用后刷新页面并重新发布任务。'],
    actionPath: '/users',
  },
  BILLING_NOT_ACTIVE: {
    actions: ['处理客户续费或账单暂停问题。', '恢复账单状态后重新发布任务。'],
    actionPath: '/commercial',
  },
  FEATURE_NOT_INCLUDED: {
    actions: ['在组织管理中开启“批量建广告”功能，或升级到包含该能力的套餐。', '开启功能后刷新页面并重新发布任务。'],
    actionPath: '/organizations',
  },
  TASK_ACCOUNT_LIMIT_EXCEEDED: {
    actions: ['减少本次选择的广告账户数量。', '升级套餐或让平台运营调整单次账户额度。'],
    actionPath: '/commercial',
  },
  MAX_CONCURRENT_TASKS_REACHED: {
    actions: ['等待当前执行中的任务完成。', '降低重跑倍率或升级并发额度。'],
    actionPath: '/bulk-ad/tasks',
  },
  MONTHLY_TASK_LIMIT_REACHED: {
    actions: ['暂停本月新增发布，或升级月度任务额度。', '清理测试组织用量后再发布正式任务。'],
    actionPath: '/commercial',
  },
  DRAFT_VALIDATION_FAILED: {
    actions: ['回到对应步骤修正草稿配置。', '修正后重新点击发布，系统会重新执行预检。'],
  },
}

const buildPublishBlocker = (data: any): PublishBlocker => {
  const preset = data?.errorCode ? commercialBlockerActions[data.errorCode] : undefined
  const details = data?.details || {}
  const detailActions: string[] = []
  if (details.firstError?.message) detailActions.push(`首个错误：${details.firstError.message}`)
  if (Array.isArray(details.errorFields) && details.errorFields.length > 0) {
    detailActions.push(`涉及字段：${details.errorFields.slice(0, 5).join('、')}`)
  }
  if (details.limit !== undefined) detailActions.push(`当前额度上限：${details.limit}`)
  if (details.monthlyTaskCount !== undefined) detailActions.push(`本月已发布任务：${details.monthlyTaskCount}`)
  if (details.runningTaskCount !== undefined) detailActions.push(`当前执行中任务：${details.runningTaskCount}`)
  if (details.requestedAccounts !== undefined) detailActions.push(`本次选择账户：${details.requestedAccounts}`)
  if (details.requestedTasks !== undefined) detailActions.push(`本次请求任务数：${details.requestedTasks}`)

  return {
    message: data?.error || '发布失败',
    errorCode: data?.errorCode,
    details,
    nextActions: [...detailActions, ...(preset?.actions || ['按错误提示修正配置后重新发布。'])],
    actionPath: preset?.actionPath,
  }
}

const formatCompactDateTime = (value?: string) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const getTokenHealthItems = (diagnostics: AuthDiagnostics) => {
  const items: Array<{ label: string; value: string; tone: 'red' | 'amber' | 'slate' }> = []
  if ((diagnostics.summary.expiredTokenCount || 0) > 0) {
    items.push({ label: '已过期', value: String(diagnostics.summary.expiredTokenCount), tone: 'red' })
  }
  if ((diagnostics.summary.expiringSoonTokenCount || 0) > 0) {
    items.push({ label: '即将过期', value: String(diagnostics.summary.expiringSoonTokenCount), tone: 'amber' })
  }
  if ((diagnostics.summary.staleTokenCheckCount || 0) > 0) {
    items.push({ label: '待校验', value: String(diagnostics.summary.staleTokenCheckCount), tone: 'amber' })
  }
  if ((diagnostics.summary.tokenWithoutExpiryCount || 0) > 0) {
    items.push({ label: '无过期时间', value: String(diagnostics.summary.tokenWithoutExpiryCount), tone: 'slate' })
  }
  return items
}

const getFacebookAssetReadLimit = (meta?: FacebookAssetResponseMeta) => {
  const pageSize = Number(meta?.pageSize || 100)
  const pageLimit = Number(meta?.pageLimitPerToken || meta?.pageLimit || 10)
  return pageSize * pageLimit
}

const buildAdAccountAssetWarning = (meta?: FacebookAssetResponseMeta) => {
  const parts: string[] = []
  if ((meta?.failedTokenCount || 0) > 0) {
    parts.push(`${meta?.failedTokenCount} 个 Facebook 授权账号暂时无法读取广告账户。`)
  }
  if (meta?.paginationTruncated) {
    parts.push(`广告账户数量超过本次读取上限，最多读取前 ${getFacebookAssetReadLimit(meta)} 个/授权账号。`)
  }
  return parts.join(' ')
}

const buildPixelAssetWarning = (meta: FacebookAssetResponseMeta | undefined, accountName: string) => {
  if (!meta?.paginationTruncated) return ''
  return `账户 ${accountName} 的 Pixel 数量超过本次读取上限，最多读取前 ${getFacebookAssetReadLimit(meta)} 个。`
}

const buildPageAssetWarning = (meta: FacebookAssetResponseMeta | undefined, accountName: string) => {
  const parts: string[] = []
  if (meta?.promotePagesFailed) {
    parts.push('读取广告账户分配主页失败，已尝试回退。')
  } else if (meta?.source === 'user_pages') {
    parts.push('未从广告账户读取到 BM 分配主页，已回退到授权用户管理的主页。')
  }
  if (meta?.paginationTruncated) {
    parts.push(`主页数量超过本次读取上限，最多读取前 ${getFacebookAssetReadLimit(meta)} 个。`)
  }
  return parts.length > 0 ? `账户 ${accountName}：${parts.join(' ')}` : ''
}

function FacebookLoginAttemptPanel({
  attempt,
  onStop,
}: {
  attempt: FacebookLoginAttempt
  onStop: () => void
}) {
  const modeLabel = attempt.authorizationMode === 'business_login'
    ? 'Facebook Login for Business'
    : 'Scope OAuth 兜底'

  return (
    <div className="mx-auto mt-4 max-w-xl rounded-xl border border-blue-200 bg-white p-4 text-left shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">授权窗口已打开 · {attempt.openedAt}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            正在等待 Facebook 授权结果。关闭弹窗会自动恢复；若弹窗显示“功能不可用”，先关闭弹窗，再检查当前 App 的高级权限、Public OAuth 和 Login for Business 配置。
          </div>
        </div>
        <button
          type="button"
          onClick={onStop}
          className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-400"
        >
          停止等待
        </button>
      </div>
      <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-600 sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          模式：<span className="text-slate-950">{modeLabel}</span>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          App ID：<span className="font-mono text-slate-950">{attempt.clientId || '-'}</span>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 sm:col-span-2">
          回调：<span className="font-mono text-slate-950">{attempt.redirectUri || '-'}</span>
        </div>
      </div>
      {attempt.diagnostics.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
          {attempt.diagnostics.map((item) => (
            <div key={item}>{item}</div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BulkAdCreatePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, token } = useAuth()  // 获取当前用户信息和认证状态
  const facebookLoginCleanupRef = useRef<((options?: { closePopup?: boolean }) => void) | null>(null)
  const syncStatusPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncStatusPollGenerationRef = useRef(0)
  const authStatusCheckGenerationRef = useRef(0)
  const isMountedRef = useRef(true)
  const [currentStep, setCurrentStep] = useState(1)
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publishBlocker, setPublishBlocker] = useState<PublishBlocker | null>(null)
  
  // 授权状态
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginAttempt, setLoginAttempt] = useState<FacebookLoginAttempt | null>(null)
  const [authDiagnostics, setAuthDiagnostics] = useState<AuthDiagnostics | null>(null)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [resyncing, setResyncing] = useState(false)
  const [resyncMessage, setResyncMessage] = useState<string | null>(null)
  const [assetWarningMap, setAssetWarningMap] = useState<Record<string, string>>({})

  const clearFacebookLoginWait = (options: { closePopup?: boolean } = {}) => {
    facebookLoginCleanupRef.current?.(options)
    facebookLoginCleanupRef.current = null
  }

  const setAssetWarning = (key: string, message?: string) => {
    setAssetWarningMap(prev => {
      if (message) {
        if (prev[key] === message) return prev
        return { ...prev, [key]: message }
      }
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const clearAssetWarningsByPrefix = (prefix: string) => {
    setAssetWarningMap(prev => {
      const next = Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(prefix)))
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }

  const getAccountDisplayName = (accountId: string) => {
    const matchedAccount = accounts.find(acc => (acc.account_id || acc.id?.replace('act_', '')) === accountId)
    return matchedAccount?.name || selectedAccounts.find(acc => acc.accountId === accountId)?.accountName || accountId
  }

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      syncStatusPollGenerationRef.current += 1
      authStatusCheckGenerationRef.current += 1
      clearFacebookLoginWait()
      if (syncStatusPollTimeoutRef.current) {
        clearTimeout(syncStatusPollTimeoutRef.current)
        syncStatusPollTimeoutRef.current = null
      }
    }
  }, [])
  
  // 账户资产
  const [accounts, setAccounts] = useState<any[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  
  // 资产包
  const [targetingPackages, setTargetingPackages] = useState<any[]>([])
  const [copywritingPackages, setCopywritingPackages] = useState<any[]>([])
  const [creativeGroups, setCreativeGroups] = useState<any[]>([])

  // 选中的产品（文案包）
  const [selectedProduct, setSelectedProduct] = useState<any>(null)
  
  // 选中的 Pixel
  const [selectedPixel, setSelectedPixel] = useState<any>(null)
  const [allPixels, setAllPixels] = useState<any[]>([]) // 所有可用的 Pixels
  const [pixelsLoading, setPixelsLoading] = useState(false)
  
  // 基于 Pixel 筛选的账户
  const [filteredAccounts, setFilteredAccounts] = useState<any[]>([])
  
  // 每个账户的主页列表
  const [accountPages, setAccountPages] = useState<{ [accountId: string]: any[] }>({})
  const [selectingAccounts, setSelectingAccounts] = useState(false)
  const accountSelectionPromiseRef = useRef<Promise<void> | null>(null)
  const accountPageRequestsRef = useRef<Map<string, Promise<any[]>>>(new Map())

  // 表单数据
  const [selectedAccounts, setSelectedAccounts] = useState<AccountConfig[]>([])
  const [campaign, setCampaign] = useState({
    nameTemplate: '优化师_fb_产品名_定向包_{accountName}_{date}',
    status: 'PAUSED',
    objective: 'OUTCOME_SALES',
    budgetOptimization: true,
    budgetType: 'DAILY',
    budget: 50,
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
  })
  const [adset, setAdset] = useState({
    nameTemplate: '{campaignName}_adset',
    status: 'ACTIVE', // 默认开启
    targetingPackageId: '',
    optimizationGoal: 'OFFSITE_CONVERSIONS',
    billingEvent: 'IMPRESSIONS',
    placementType: 'AUTOMATIC',
    budget: 50, // AdSet 级别预算（非 CBO 模式时使用）
    multiplier: 1, // 广告组倍率：每个 campaign 下创建的广告组数量
    // 归因设置
    attribution: {
      clickWindow: 1,      // 点击后归因窗口（天）: 1, 7, 28
      viewWindow: 1,       // 浏览后归因窗口（天）: 1 或 0(禁用)
      engagedViewWindow: 1 // 互动观看后归因窗口（天）: 1 或 0(禁用)
    }
  })
  const [ad, setAd] = useState({
    nameTemplate: '{materialName}_{datetime}',
    status: 'ACTIVE', // 默认开启
    creativeGroupIds: [] as string[],
    copywritingPackageIds: [] as string[],
    format: 'SINGLE',
  })
  const [publishStrategy, setPublishStrategy] = useState({
    targetingLevel: 'ADSET',
    creativeLevel: 'ADSET',
    copywritingMode: 'SHARED',
    schedule: 'IMMEDIATE',
  })

  // 🎯 自动生成系列名称模板
  // 格式: autoark用户名_渠道_文案包产品名_定向包名_{accountName}_{date}
  // 定向包名称实时更新：如果已选择定向包，显示实际名称；否则显示变量占位符
  useEffect(() => {
    const username = user?.username || 'user'
    const channel = 'fb'  // 渠道固定为 fb
    const productName = selectedProduct?.product?.name || selectedProduct?.name || '产品名'
    const targetingPkg = targetingPackages.find((p: any) => p._id === adset.targetingPackageId)
    // 如果已选择定向包，使用实际名称；否则使用变量占位符（将在后端替换）
    const targetingName = targetingPkg?.name || '{targetingName}'
    
    const newTemplate = `${username}_${channel}_${productName}_${targetingName}_{accountName}_{date}`
    setCampaign(prev => ({ ...prev, nameTemplate: newTemplate }))
  }, [user?.username, selectedProduct, adset.targetingPackageId, targetingPackages])
  
  // 检查 URL 参数（OAuth 回调）
  useEffect(() => {
    const oauthSuccess = searchParams.get('oauth_success')
    const oauthError = searchParams.get('oauth_error')
    
    if (oauthSuccess === 'true') {
      // 登录成功，刷新授权状态
      checkAuthStatus()
    }
    if (oauthError) {
      setError(decodeURIComponent(oauthError))
    }
  }, [searchParams])
  
  // 初始化（token 准备好后才检查授权状态）
  useEffect(() => {
    if (token) {
      checkAuthStatus()
    }
    loadAssets()
  }, [token])
  
  // 授权后立即加载缓存的 Pixels（不等到步骤2）
  useEffect(() => {
    if (authStatus?.authorized && allPixels.length === 0 && !pixelsLoading) {
      loadCachedPixels()
    }
  }, [authStatus?.authorized])
  
  // 检查授权状态
  const checkAuthStatus = async () => {
    const checkGeneration = authStatusCheckGenerationRef.current + 1
    authStatusCheckGenerationRef.current = checkGeneration
    stopSyncStatusPolling()

    if (!token) {
      if (isMountedRef.current && authStatusCheckGenerationRef.current === checkGeneration) {
        setAuthLoading(false)
        setAuthStatus({ authorized: false })
        setResyncing(false)
      }
      return
    }
    
    setAuthLoading(true)
    try {
      const res = await authFetch(`${API_BASE}/bulk-ad/auth/status`)
      const data = await res.json()
      if (!isMountedRef.current || authStatusCheckGenerationRef.current !== checkGeneration) return
      if (data.success) {
        setAuthStatus(data.data)
        // 如果已授权，自动加载账户
        if (data.data.authorized) {
          loadAdAccounts()
          loadAuthDiagnostics()
          const syncStatus = await fetchSyncStatus()
          if (!isMountedRef.current || authStatusCheckGenerationRef.current !== checkGeneration) return
          if (syncStatus) {
            setSyncStatus(syncStatus)
            setResyncing(syncStatus.status === 'syncing')
          }
          if (!syncStatus) {
            setResyncing(true)
            setResyncMessage('暂时无法读取同步状态，系统会继续自动重试。')
            startSyncStatusPolling()
          } else if (syncStatus.status === 'syncing') {
            setResyncMessage('Facebook 资产仍在后台同步，完成前不会重复启动。')
            startSyncStatusPolling()
          } else if (syncStatus.stale) {
            setResyncMessage(syncStatus.error || '上次同步已中断，可以重新同步。')
          }
        } else {
          setResyncing(false)
        }
      }
    } catch (err) {
      console.error('Failed to check auth status:', err)
      if (isMountedRef.current && authStatusCheckGenerationRef.current === checkGeneration) {
        setAuthStatus({ authorized: false })
        setResyncing(false)
      }
    } finally {
      if (isMountedRef.current && authStatusCheckGenerationRef.current === checkGeneration) {
        setAuthLoading(false)
      }
    }
  }

  const loadAuthDiagnostics = async () => {
    setDiagnosticsLoading(true)
    try {
      const res = await authFetch(`${API_BASE}/bulk-ad/auth/diagnostics`)
      const data = await res.json()
      if (data.success) {
        setAuthDiagnostics(data.data)
      }
    } catch (err) {
      console.error('Failed to load auth diagnostics:', err)
    } finally {
      setDiagnosticsLoading(false)
    }
  }
  
  // Facebook 登录（弹窗方式）
  const handleFacebookLogin = async () => {
    clearFacebookLoginWait()
    setLoginLoading(true)
    setError(null)
    setPublishBlocker(null)
    setLoginAttempt(null)
    
    try {
      // 获取登录 URL（传递认证信息以绑定到当前用户）
      // 防止浏览器/代理缓存登录链接导致 304/旧 client_id
      const controller = new AbortController()
      const loginUrlTimeoutId = window.setTimeout(() => controller.abort(), FACEBOOK_LOGIN_URL_TIMEOUT_MS)
      const res = await (async () => {
        try {
          return await authFetch(`${API_BASE}/bulk-ad/auth/login-url?ts=${Date.now()}`, {
            cache: 'no-store',
            signal: controller.signal,
          } as RequestInit)
        } finally {
          window.clearTimeout(loginUrlTimeoutId)
        }
      })()
      const data = await res.json().catch(() => ({}))
      
      if (!res.ok || !data.success || !data.data?.loginUrl) {
        throw new Error(data.message || data.error || '获取登录链接失败')
      }
      
      const loginData = data.data
      const loginUrl = loginData.loginUrl
      setLoginAttempt({
        clientId: loginData.clientId,
        redirectUri: loginData.redirectUri,
        authorizationMode: loginData.authorizationMode,
        diagnostics: Array.isArray(loginData.diagnostics) ? loginData.diagnostics : [],
        openedAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      })
      
      // 打开弹窗进行授权
      const width = 600
      const height = 700
      const left = window.screenX + (window.outerWidth - width) / 2
      const top = window.screenY + (window.outerHeight - height) / 2
      
      const popup = window.open(
        loginUrl,
        'facebook-auth',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
      )
      
      if (!popup) {
        // 弹窗被阻止，回退到页面跳转
        setLoginLoading(false)
        setLoginAttempt(null)
        setError('浏览器拦截了 Facebook 授权弹窗，已切换为当前页面跳转。若没有跳转，请允许弹窗后重试。')
        window.location.href = loginUrl
        return
      }
      
      let settled = false
      let checkPopup: ReturnType<typeof setInterval>
      let timeoutId: ReturnType<typeof setTimeout>
      let handleMessage: (event: MessageEvent) => void
      const cleanup = (options: { closePopup?: boolean } = {}) => {
        if (settled) return
        settled = true
        clearInterval(checkPopup)
        clearTimeout(timeoutId)
        window.removeEventListener('message', handleMessage)
        if (options.closePopup && !popup.closed) {
          popup.close()
        }
        if (facebookLoginCleanupRef.current === cleanup) {
          facebookLoginCleanupRef.current = null
        }
      }

      // 监听弹窗关闭和消息
      checkPopup = setInterval(() => {
        if (popup.closed) {
          cleanup()
          setLoginLoading(false)
          setLoginAttempt(null)
          // 弹窗关闭后检查授权状态
          checkAuthStatus()
        }
      }, 500)
      
      // 监听来自弹窗的消息
      handleMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) {
          return
        }
        if (event.data?.type === 'oauth-success') {
          cleanup({ closePopup: true })
          setLoginLoading(false)
          setLoginAttempt(null)
          checkAuthStatus()
        } else if (event.data?.type === 'oauth-error') {
          cleanup({ closePopup: true })
          setLoginLoading(false)
          setLoginAttempt(null)
          setError(event.data.error || '授权失败')
        }
      }
      window.addEventListener('message', handleMessage)
      facebookLoginCleanupRef.current = cleanup
      
      // 超时处理
      timeoutId = setTimeout(() => {
        if (!popup.closed) {
          cleanup({ closePopup: true })
          setLoginLoading(false)
          setLoginAttempt(null)
          setError('Facebook 授权窗口等待超时，已自动关闭授权窗口。请重新点击登录；若弹窗显示“功能不可用”，请检查 Facebook App 的 Public OAuth 与 Login for Business 配置。')
          checkAuthStatus()
        }
      }, FACEBOOK_LOGIN_POPUP_TIMEOUT_MS)
      
    } catch (err: any) {
      const message = err.name === 'AbortError'
        ? '获取 Facebook 登录链接超时，请刷新后重试。'
        : err.message || '登录失败'
      setError(message)
      setLoginLoading(false)
      setLoginAttempt(null)
    }
  }

  const stopFacebookLoginWait = () => {
    clearFacebookLoginWait({ closePopup: true })
    setLoginLoading(false)
    setLoginAttempt(null)
    setPublishBlocker(null)
    setError('已停止等待 Facebook 授权窗口，并回查当前授权状态。若弹窗显示“功能不可用”，请到 App 管理检查 Public OAuth 与 Login for Business 配置。')
    checkAuthStatus()
  }
  
  // 加载广告账户
  const loadAdAccounts = async () => {
    setAccountsLoading(true)
    try {
      const res = await authFetch(`${API_BASE}/bulk-ad/auth/ad-accounts`)
      const data = await res.json()
      if (data.success) {
        setAccounts(data.data || [])
        setAssetWarning('ad-accounts', buildAdAccountAssetWarning(data.meta))
      }
    } catch (err) {
      console.error('Failed to load ad accounts:', err)
      setAssetWarning('ad-accounts', '广告账户读取失败，请检查 Facebook 授权后重新同步。')
    } finally {
      setAccountsLoading(false)
    }
  }
  
  // 加载账户的 Pages 和 Pixels
  
  // 同步状态
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_syncStatus, setSyncStatus] = useState<any>(null)
  
  // 加载缓存的 Pixels（快速，从数据库读取）
  const loadCachedPixels = async () => {
    setPixelsLoading(true)
    try {
      const res = await authFetch(`${API_BASE}/bulk-ad/auth/cached-pixels`)
      const data = await res.json()
      if (data.success && data.data?.length > 0) {
        const pixels = data.data
        setAllPixels(pixels)
        
        // 自动选中包含产品名的 Pixel
        autoSelectMatchingPixel(pixels)
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to load cached pixels:', err)
      return false
    } finally {
      setPixelsLoading(false)
    }
  }
  
  // 自动选中包含产品名的 Pixel
  const autoSelectMatchingPixel = (pixels: any[]) => {
    if (!selectedProduct) return
    
    const productName = (selectedProduct.product?.name || selectedProduct.name || '').toLowerCase()
    if (!productName) return
    
    // 查找名称包含产品名的 Pixel
    const matchingPixel = pixels.find(p => 
      p.name?.toLowerCase().includes(productName) ||
      productName.includes(p.name?.toLowerCase())
    )
    
    if (matchingPixel) {
      setSelectedPixel(matchingPixel)
      filterAccountsByPixel(matchingPixel)
    }
  }
  
  // 只读取同步状态；调用方确认请求仍属于当前轮询代次后再写入 React 状态。
  const fetchSyncStatus = async () => {
    try {
      const res = await authFetch(`${API_BASE}/bulk-ad/auth/sync-status`)
      const data = await res.json()
      if (data.success) {
        return data.data
      }
    } catch (err) {
      console.error('Failed to check sync status:', err)
    }
    return null
  }

  const refreshFacebookAssets = () => {
    loadCachedPixels()
    loadAdAccounts()
    loadAuthDiagnostics()
  }

  const stopSyncStatusPolling = () => {
    syncStatusPollGenerationRef.current += 1
    if (syncStatusPollTimeoutRef.current) {
      clearTimeout(syncStatusPollTimeoutRef.current)
      syncStatusPollTimeoutRef.current = null
    }
  }

  const startSyncStatusPolling = (startedAt = Date.now()) => {
    stopSyncStatusPolling()
    const pollGeneration = syncStatusPollGenerationRef.current

    const poll = async () => {
      syncStatusPollTimeoutRef.current = null
      const status = await fetchSyncStatus()
      if (
        !isMountedRef.current ||
        syncStatusPollGenerationRef.current !== pollGeneration
      ) return
      if (status) {
        setSyncStatus(status)
        setResyncing(status.status === 'syncing')
      }
      if (status?.status === 'completed') {
        authStatusCheckGenerationRef.current += 1
        syncStatusPollGenerationRef.current += 1
        setResyncing(false)
        setResyncMessage('资产同步完成，已刷新账户和 Pixel。')
        refreshFacebookAssets()
        return
      }
      if (status?.status === 'failed') {
        authStatusCheckGenerationRef.current += 1
        syncStatusPollGenerationRef.current += 1
        setResyncing(false)
        setResyncMessage(status.error || '资产同步失败，请检查 Facebook 授权后重试。')
        return
      }

      setResyncing(true)
      setResyncMessage(status
        ? '资产仍在后台同步；为避免触发 Meta 限流，完成前不会再次启动同步。'
        : '暂时无法读取同步状态，系统会继续自动重试。')
      const elapsed = Date.now() - startedAt
      const delay = elapsed < FACEBOOK_SYNC_FAST_POLL_WINDOW_MS
        ? FACEBOOK_SYNC_FAST_POLL_MS
        : FACEBOOK_SYNC_SLOW_POLL_MS
      if (syncStatusPollGenerationRef.current === pollGeneration) {
        syncStatusPollTimeoutRef.current = setTimeout(poll, delay)
      }
    }

    syncStatusPollTimeoutRef.current = setTimeout(poll, FACEBOOK_SYNC_FAST_POLL_MS)
  }
  
  // 手动触发重新同步
  const triggerResync = async () => {
    if (resyncing) return
    authStatusCheckGenerationRef.current += 1
    stopSyncStatusPolling()
    const resyncGeneration = syncStatusPollGenerationRef.current
    setResyncing(true)
    setResyncMessage('正在重新同步 Facebook 资产...')
    try {
      const res = await authFetch(`${API_BASE}/bulk-ad/auth/resync`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (
        !isMountedRef.current ||
        syncStatusPollGenerationRef.current !== resyncGeneration
      ) return
      if (!res.ok || data.success === false) {
        throw new Error(data.error || '触发同步失败')
      }
      startSyncStatusPolling()
    } catch (err: any) {
      console.error('Failed to trigger resync:', err)
      if (
        isMountedRef.current &&
        syncStatusPollGenerationRef.current === resyncGeneration
      ) {
        setResyncing(false)
        setResyncMessage(err.message || '触发同步失败，请稍后重试。')
      }
    }
  }
  
  // 传统方式加载 Pixels（作为后备）
  const loadAllPixels = async () => {
    clearAssetWarningsByPrefix('pixels:')
    // 先尝试从缓存加载
    const cached = await loadCachedPixels()
    if (cached) return
    
    // 缓存为空，实时抓取
    if (!accounts.length) return
    setPixelsLoading(true)
    try {
      const pixelMap = new Map<string, any>()
      
      for (const account of accounts) {
        const accountId = account.account_id || account.id?.replace('act_', '')
        try {
          const res = await authFetch(`${API_BASE}/bulk-ad/auth/pixels?accountId=${accountId}`)
          const data = await res.json()
          if (data.success && data.data) {
            setAssetWarning(`pixels:${accountId}`, buildPixelAssetWarning(data.meta, account.name || accountId))
            for (const pixel of data.data) {
              if (!pixelMap.has(pixel.id)) {
                pixelMap.set(pixel.id, {
                  ...pixel,
                  accounts: [{ accountId, accountName: account.name }]
                })
              } else {
                const existing = pixelMap.get(pixel.id)
                existing.accounts.push({ accountId, accountName: account.name })
              }
            }
          }
        } catch (err) {
          console.error(`Failed to load pixels for account ${accountId}:`, err)
          setAssetWarning(`pixels:${accountId}`, `账户 ${account.name || accountId} 的 Pixel 读取失败，请检查 Facebook 授权或重新同步。`)
        }
      }
      
      const pixels = Array.from(pixelMap.values())
      setAllPixels(pixels)
      autoSelectMatchingPixel(pixels)
    } catch (err) {
      console.error('Failed to load all pixels:', err)
    } finally {
      setPixelsLoading(false)
    }
  }
  
  const fetchPagesForAccount = (accountId: string, accountName: string): Promise<any[]> => {
    if (accountPages[accountId] !== undefined) {
      return Promise.resolve(accountPages[accountId])
    }

    const pendingRequest = accountPageRequestsRef.current.get(accountId)
    if (pendingRequest) return pendingRequest

    const request = (async () => {
      try {
        const res = await authFetch(`${API_BASE}/bulk-ad/auth/pages?accountId=${accountId}`)
        const data = await res.json()
        if (data.success && Array.isArray(data.data)) {
          if (isMountedRef.current) {
            setAssetWarning(`pages:${accountId}`, buildPageAssetWarning(data.meta, accountName))
          }
          return data.data
        }
      } catch (err) {
        console.error(`Failed to load pages for account ${accountId}:`, err)
      }

      if (isMountedRef.current) {
        setAssetWarning(
          `pages:${accountId}`,
          `账户 ${accountName} 的主页读取失败，请检查主页授权或重新同步。`,
        )
      }
      return []
    })()

    let trackedRequest: Promise<any[]>
    trackedRequest = request.finally(() => {
      if (accountPageRequestsRef.current.get(accountId) === trackedRequest) {
        accountPageRequestsRef.current.delete(accountId)
      }
    })
    accountPageRequestsRef.current.set(accountId, trackedRequest)
    return trackedRequest
  }

  // 根据选中的 Pixel 筛选可用账户；只筛选，不提前读取 Page
  const filterAccountsByPixel = (pixel: any) => {
    if (!pixel?.accounts) {
      setFilteredAccounts([])
      setSelectedAccounts([])
      return
    }
    
    // 找出拥有该 Pixel 的账户
    const accountIds = pixel.accounts.map((a: any) => a.accountId)
    const filtered = accounts.filter(acc => {
      const accId = acc.account_id || acc.id?.replace('act_', '')
      return accountIds.includes(accId)
    })
    setFilteredAccounts(filtered)
    setSelectedAccounts([])
  }
  
  // 批量选择多个账户（pixel 参数用于避免 React 状态异步更新问题）
  const selectMultipleAccounts = async (accountsToSelect: any[], pixelOverride?: any) => {
    if (accountSelectionPromiseRef.current) {
      return accountSelectionPromiseRef.current
    }

    const selectionOperation = (async () => {
      setSelectingAccounts(true)

      const pixel = pixelOverride || selectedPixel
      const newSelectedAccounts: AccountConfig[] = accountsToSelect.map(account => {
        const accountId = account.account_id || account.id?.replace('act_', '')
        return {
          accountId,
          accountName: account.name || accountId,
          pageId: '',
          pageName: '',
          pixelId: pixel?.pixelId || pixel?.id || '',
          pixelName: pixel?.name || '',
          conversionEvent: 'PURCHASE',
        }
      })

      // 先提交选择状态，让“已选”数量和勾选框即时响应。
      setSelectedAccounts(newSelectedAccounts)

      const loadedPageEntries = await mapWithConcurrency(
        accountsToSelect,
        ACCOUNT_PAGE_FETCH_CONCURRENCY,
        async account => {
          const accountId = account.account_id || account.id?.replace('act_', '')
          const pages = await fetchPagesForAccount(accountId, account.name || accountId)
          return [accountId, pages] as const
        },
      )
      const loadedPages = Object.fromEntries(loadedPageEntries)
      const allPages = { ...accountPages, ...loadedPages }

      if (!isMountedRef.current) return
      setAccountPages(prev => ({ ...prev, ...loadedPages }))
      setSelectedAccounts(autoAssignPages(newSelectedAccounts, allPages))
    })()

    accountSelectionPromiseRef.current = selectionOperation
    try {
      await selectionOperation
    } finally {
      if (accountSelectionPromiseRef.current === selectionOperation) {
        accountSelectionPromiseRef.current = null
        if (isMountedRef.current) setSelectingAccounts(false)
      }
    }
  }
  
  // 全选/取消全选活跃账户
  const toggleSelectAllActive = async () => {
    if (accountSelectionPromiseRef.current) return

    const activeAccounts = filteredAccounts.filter(acc => acc.account_status === 1)
    const allActiveSelected = activeAccounts.every(acc => {
      const accId = acc.account_id || acc.id?.replace('act_', '')
      return selectedAccounts.find(a => a.accountId === accId)
    })
    
    if (allActiveSelected) {
      // 取消选择所有
      setSelectedAccounts([])
    } else {
      // 全选活跃账户，传递 selectedPixel 确保 pixelId 正确
      await selectMultipleAccounts(activeAccounts, selectedPixel)
    }
  }
  
  // 获取账户状态显示
  const getAccountStatusBadge = (status: number) => {
    switch (status) {
      case 1:
        return <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">✓ 活跃</span>
      case 2:
        return <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full font-medium">✗ 已停用</span>
      case 3:
        return <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full font-medium">⚠ 未结算</span>
      case 7:
        return <span className="text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded-full font-medium">⏳ 风险审核中</span>
      case 9:
        return <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-medium">⏰ 宽限期</span>
      default:
        return <span className="text-xs px-2 py-1 bg-slate-100 text-slate-700 rounded-full font-medium">未知 ({status})</span>
    }
  }
  
  // 加载资产包
  const loadAssets = async () => {
    try {
      const [tpRes, cpRes, cgRes] = await Promise.all([
        authFetch(`${API_BASE}/bulk-ad/targeting-packages`),
        authFetch(`${API_BASE}/bulk-ad/copywriting-packages`),
        authFetch(`${API_BASE}/bulk-ad/creative-groups`),
      ])
      const tpData = await tpRes.json()
      const cpData = await cpRes.json()
      const cgData = await cgRes.json()
      if (tpData.success) setTargetingPackages(tpData.data?.list || [])
      if (cpData.success) setCopywritingPackages(cpData.data?.list || [])
      if (cgData.success) setCreativeGroups(cgData.data?.list || [])
    } catch (err) {
      console.error('Failed to load assets:', err)
    }
  }
  
  // 选择/取消选择账户
  const toggleAccount = async (account: any) => {
    if (selectingAccounts) return

    const accountId = account.account_id || account.id?.replace('act_', '')
    const exists = selectedAccounts.find(a => a.accountId === accountId)
    if (exists) {
      setSelectedAccounts(selectedAccounts.filter(a => a.accountId !== accountId))
    } else {
      // 先加载该账户的主页
      const pagesForAccount = await loadPagesForAccount(accountId)
      if (!isMountedRef.current) return
      
      // 自动设置已选的 Pixel，并自动分配主页
      const newAccount = {
        accountId: accountId,
        accountName: account.name || accountId,
        pageId: '',
        pageName: '',
        pixelId: selectedPixel?.pixelId || selectedPixel?.id || '',
        pixelName: selectedPixel?.name || '',
        conversionEvent: 'PURCHASE',
      }
      
      // 自动分配主页（均摊到各主页）
      const updatedAccounts = [...selectedAccounts, newAccount]
      const accountsWithPages = autoAssignPages(updatedAccounts, { ...accountPages, [accountId]: pagesForAccount })
      setSelectedAccounts(accountsWithPages)
    }
  }
  
  // 加载单个账户的主页
  const loadPagesForAccount = async (accountId: string): Promise<any[]> => {
    // 如果已经加载过，直接返回
    if (accountPages[accountId] !== undefined) {
      return accountPages[accountId]
    }

    const pages = await fetchPagesForAccount(accountId, getAccountDisplayName(accountId))
    if (isMountedRef.current) {
      setAccountPages(prev => ({ ...prev, [accountId]: pages }))
    }
    return pages
  }
  
  // 自动分配主页（均摊原则）
  const autoAssignPages = (accounts: AccountConfig[], allPages: { [accountId: string]: any[] }): AccountConfig[] => {
    // 统计每个主页被使用的次数
    const pageUsageCount: { [pageId: string]: number } = {}
    
    return accounts.map(acc => {
      const pagesForThisAccount = allPages[acc.accountId] || []
      
      // 如果该账户没有可用主页，保持空
      if (pagesForThisAccount.length === 0) {
        return acc
      }
      
      // 如果已经分配了主页，跳过
      if (acc.pageId) {
        pageUsageCount[acc.pageId] = (pageUsageCount[acc.pageId] || 0) + 1
        return acc
      }
      
      // 找出使用次数最少的主页
      let minUsage = Infinity
      let selectedPage = pagesForThisAccount[0]
      
      for (const page of pagesForThisAccount) {
        const usage = pageUsageCount[page.id] || 0
        if (usage < minUsage) {
          minUsage = usage
          selectedPage = page
        }
      }
      
      // 更新使用计数
      pageUsageCount[selectedPage.id] = (pageUsageCount[selectedPage.id] || 0) + 1
      
      return {
        ...acc,
        pageId: selectedPage.id,
        pageName: selectedPage.name,
      }
    })
  }
  
  
  // 更新账户配置
  const updateAccountConfig = (accountId: string, field: string, value: string) => {
    setSelectedAccounts(selectedAccounts.map(a => 
      a.accountId === accountId ? { ...a, [field]: value } : a
    ))
  }
  
  // 发布
  const handlePublish = async () => {
    setLoading(true)
    setError(null)
    setPublishBlocker(null)
    try {
      const draft = {
        name: `批量广告_${new Date().toISOString().slice(0, 10)}`,
        accounts: selectedAccounts,
        campaign, adset, ad,
        publishStrategy,
      }
      const createRes = await authFetch(`${API_BASE}/bulk-ad/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const createData = await createRes.json()
      if (!createData.success) throw new Error(createData.error || '创建草稿失败')
      
      const draftId = createData.data._id
      const validateRes = await authFetch(`${API_BASE}/bulk-ad/drafts/${draftId}/validate`, { method: 'POST' })
      const validateData = await validateRes.json()
      if (!validateData.success) {
        const blocker = buildPublishBlocker(validateData)
        setPublishBlocker(blocker)
        setError(blocker.message)
        return
      }
      if (!validateData.data.isValid) {
        const validationErrors = validateData.data?.errors || []
        const validationWarnings = validateData.data?.warnings || []
        const blocker = buildPublishBlocker({
          error: validationErrors[0]?.message
            ? `草稿预检未通过：${validationErrors[0].message}`
            : '草稿预检未通过，请按提示修正配置后重新发布。',
          errorCode: 'DRAFT_VALIDATION_FAILED',
          details: {
            errorCount: validationErrors.length,
            warningCount: validationWarnings.length,
            firstError: validationErrors[0],
            errorFields: validationErrors.map((error: any) => error.field).filter(Boolean),
            errors: validationErrors.slice(0, 10),
            warnings: validationWarnings.slice(0, 10),
          },
        })
        setPublishBlocker(blocker)
        setError(blocker.message)
        return
      }
      
      const publishRes = await authFetch(`${API_BASE}/bulk-ad/drafts/${draftId}/publish`, { method: 'POST' })
      const publishData = await publishRes.json()
      if (!publishData.success) {
        const blocker = buildPublishBlocker(publishData)
        setPublishBlocker(blocker)
        setError(blocker.message)
        return
      }
      
      navigate(`/bulk-ad/tasks?taskId=${publishData.data._id}`)
    } catch (err: any) {
      setError(err.message)
      setPublishBlocker(null)
    } finally {
      setLoading(false)
    }
  }
  
  // 预估数据
  const estimates = {
    totalAccounts: selectedAccounts.length,
    totalCampaigns: selectedAccounts.length,
    totalAdsets: selectedAccounts.length * adset.multiplier,
    totalAds: selectedAccounts.length * adset.multiplier * Math.max(1, ad.creativeGroupIds.length) * 
      (publishStrategy.copywritingMode === 'SEQUENTIAL' ? Math.max(1, ad.copywritingPackageIds.length) : 1),
    dailyBudget: campaign.budget * selectedAccounts.length,
  }
  const tokenHealthItems = authDiagnostics ? getTokenHealthItems(authDiagnostics) : []
  const assetIssueSummary = getAssetIssueSummary(authDiagnostics)
  const authDiagnosticAccountLimit = authDiagnostics?.limits?.accounts
  const authDiagnosticAccountTotal = authDiagnosticAccountLimit?.total ?? authDiagnostics?.accounts.length ?? 0
  const authDiagnosticAccountReturned = authDiagnosticAccountLimit?.returned ?? authDiagnostics?.accounts.length ?? 0
  const assetWarningEntries = Object.entries(assetWarningMap)
  const visibleAssetWarningEntries = assetWarningEntries.slice(0, 4)
  const facebookAssetsBlocked = Boolean(
    authStatus?.authorized &&
    authDiagnostics &&
    (authDiagnostics.summary.readyAccountCount || 0) <= 0
  )
  const nextDisabled = (
    (currentStep === 1 && (!authStatus?.authorized || !selectedProduct || facebookAssetsBlocked)) ||
    (currentStep === 2 && !selectedPixel) ||
    (currentStep === 3 && (selectingAccounts || selectedAccounts.length === 0 || selectedAccounts.some(acc => !acc.pageId)))
  )
  const nextDisabledTitle = currentStep === 1 && facebookAssetsBlocked
    ? '当前没有同时具备 Page 和 Pixel 的活跃广告账户，请先完成资产分配并重新同步。'
    : undefined
  
  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">批量创建广告 <span className="text-xs text-blue-500">v2</span></h1>
          <p className="text-slate-500 mt-1">按照步骤配置并批量创建 Facebook 广告</p>
        </div>
        
        {/* 错误提示 */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{publishBlocker ? '发布被阻断' : '操作失败'}</div>
                <div className="mt-1 text-sm font-medium">{error}</div>
              </div>
              <button onClick={() => { setError(null); setPublishBlocker(null) }} className="text-red-400 hover:text-red-600">✕</button>
            </div>
            {publishBlocker && (
              <div className="mt-3 rounded-lg border border-red-100 bg-white px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {publishBlocker.errorCode && (
                    <span className="rounded bg-red-100 px-2 py-0.5 font-mono text-xs font-semibold text-red-700">
                      {publishBlocker.errorCode}
                    </span>
                  )}
                  <span className="text-xs font-semibold text-slate-500">
                    {publishBlocker.errorCode === 'DRAFT_VALIDATION_FAILED' ? '发布前预检已生效' : '商业额度或账单保护已生效'}
                  </span>
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-6 text-slate-700">
                  {publishBlocker.nextActions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
                {publishBlocker.actionPath && (
                  <button
                    type="button"
                    onClick={() => navigate(publishBlocker.actionPath!)}
                    className="mt-3 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    去处理
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        
        {/* Steps indicator */}
        <div className="mb-8 flex items-center justify-between">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full font-semibold ${
                currentStep === step.id ? 'bg-blue-600 text-white' :
                currentStep > step.id ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-500'
              }`}>
                {currentStep > step.id ? '✓' : step.id}
              </div>
              <div className="ml-3 hidden md:block">
                <div className={`font-medium ${currentStep === step.id ? 'text-blue-600' : 'text-slate-700'}`}>{step.title}</div>
                <div className="text-xs text-slate-500">{step.description}</div>
              </div>
              {index < STEPS.length - 1 && <div className={`w-12 h-1 mx-4 rounded ${currentStep > step.id ? 'bg-green-500' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>
        
        {/* Step content */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 min-h-[400px]">
          {/* 步骤1: 授权 + 选择产品（文案包） */}
          {currentStep === 1 && (
            <div className="space-y-6">
              {/* 授权状态检查 - 放在最前面 */}
              {authLoading ? (
                <Loading.Overlay message="检查授权状态..." size="sm" />
              ) : !authStatus?.authorized ? (
                <div className="text-center py-8 bg-blue-50 border border-blue-200 rounded-xl mb-6">
                  <div className="w-16 h-16 bg-[#1877F2] rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-slate-800 mb-2">请先登录 Facebook</h3>
                  <p className="text-slate-500 mb-4 text-sm">登录后才能获取广告账户和 Pixel</p>
                  <button
                    onClick={handleFacebookLogin}
                    disabled={loginLoading}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-[#1877F2] text-white rounded-xl hover:bg-[#166FE5] transition-colors font-medium"
                  >
                    {loginLoading ? (
                      <Loading.Spinner size="sm" color="white" />
                    ) : (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                      </svg>
                    )}
                    {loginLoading ? (loginAttempt ? '等待 Facebook 授权结果...' : '获取 Facebook 授权链接...') : '使用 Facebook 登录'}
                  </button>
                  {loginAttempt && loginLoading && (
                    <FacebookLoginAttemptPanel attempt={loginAttempt} onStop={stopFacebookLoginWait} />
                  )}
                </div>
              ) : (
                /* 已授权 - 显示状态 + 后台加载 Pixels */
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg mb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-green-800">已授权: {authStatus.fbUserName}</span>
                        {pixelsLoading && <span className="text-xs text-green-600 ml-2">（正在加载 Pixel...）</span>}
                        {allPixels.length > 0 && <span className="text-xs text-green-600 ml-2">（已加载 {allPixels.length} 个 Pixel）</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={triggerResync}
                        disabled={resyncing}
                        className="rounded-md border border-green-300 bg-white px-3 py-1 text-xs font-semibold text-green-700 hover:bg-green-50 disabled:opacity-60"
                      >
                        {resyncing ? '同步中...' : '重新同步'}
                      </button>
                      <button
                        onClick={handleFacebookLogin}
                        disabled={loginLoading}
                        className="text-xs text-green-600 hover:underline disabled:cursor-not-allowed disabled:text-green-400 disabled:no-underline"
                      >
                        {loginLoading ? '等待授权中...' : '切换账号'}
                      </button>
                    </div>
                  </div>
                  {loginAttempt && loginLoading && (
                    <FacebookLoginAttemptPanel attempt={loginAttempt} onStop={stopFacebookLoginWait} />
                  )}
                  {resyncMessage && (
                    <div className="mt-3 rounded-lg border border-green-200 bg-white/80 px-3 py-2 text-xs font-semibold text-green-800">
                      {resyncMessage}
                    </div>
                  )}
                  {visibleAssetWarningEntries.length > 0 && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
                      <div className="flex items-center gap-2 text-amber-900">
                        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        </svg>
                        <span>资产读取提示</span>
                      </div>
                      <div className="mt-1 space-y-1">
                        {visibleAssetWarningEntries.map(([key, message]) => (
                          <div key={key}>{message}</div>
                        ))}
                        {assetWarningEntries.length > visibleAssetWarningEntries.length && (
                          <div className="text-amber-700">
                            还有 {assetWarningEntries.length - visibleAssetWarningEntries.length} 条提示未展示，可重新同步后刷新。
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {diagnosticsLoading && (
                    <div className="mt-3 text-xs font-medium text-green-700">正在检查账户、Page 和 Pixel...</div>
                  )}
                  {authDiagnostics && (
                    <div className="mt-3 border-t border-green-200 pt-3">
                      <div className="grid grid-cols-5 gap-2 text-center">
                        <div className="rounded-lg bg-white/70 px-2 py-2">
                          <div className="text-lg font-bold text-green-800">{authDiagnostics.summary.accountCount}</div>
                          <div className="text-[11px] text-green-700">已拉取账户</div>
                        </div>
                        <div className="rounded-lg bg-white/70 px-2 py-2">
                          <div className="text-lg font-bold text-green-800">{authDiagnostics.summary.readyAccountCount}</div>
                          <div className="text-[11px] text-green-700">就绪账户</div>
                        </div>
                        <div className="rounded-lg bg-white/70 px-2 py-2">
                          <div className="text-lg font-bold text-green-800">{authDiagnostics.summary.activeAccountCount}</div>
                          <div className="text-[11px] text-green-700">活跃账户</div>
                        </div>
                        <div className="rounded-lg bg-white/70 px-2 py-2">
                          <div className="text-lg font-bold text-green-800">{authDiagnostics.summary.pageLinkedAccountCount}</div>
                          <div className="text-[11px] text-green-700">Page 可用</div>
                        </div>
                        <div className="rounded-lg bg-white/70 px-2 py-2">
                          <div className="text-lg font-bold text-green-800">{authDiagnostics.summary.pixelLinkedAccountCount}</div>
                          <div className="text-[11px] text-green-700">Pixel 可用</div>
                        </div>
                      </div>
                      {tokenHealthItems.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-white/80 px-3 py-2 text-[11px] font-semibold">
                          <span className="text-slate-600">授权健康</span>
                          {tokenHealthItems.map(item => (
                            <span
                              key={item.label}
                              className={`rounded px-2 py-0.5 ${
                                item.tone === 'red'
                                  ? 'bg-red-100 text-red-700'
                                  : item.tone === 'amber'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {item.label} {item.value}
                            </span>
                          ))}
                          {authDiagnostics.summary.earliestTokenExpiresAt && (
                            <span className="text-slate-500">
                              最近过期 {formatCompactDateTime(authDiagnostics.summary.earliestTokenExpiresAt)}
                            </span>
                          )}
                        </div>
                      )}
                      {authDiagnostics.risks.length > 0 && (
                        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                          {authDiagnostics.risks[0].message}
                        </div>
                      )}
                      {assetIssueSummary.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-white/80 px-3 py-2 text-[11px] font-semibold">
                          <span className="text-slate-600">资产缺口</span>
                          {assetIssueSummary.map(item => (
                            <span key={item.code} className="rounded bg-amber-100 px-2 py-0.5 text-amber-700">
                              {item.label} {item.count}
                            </span>
                          ))}
                        </div>
                      )}
                      {authDiagnostics.accounts.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-green-800">
                            <span>账户诊断（下方仅预览前 3 条，不代表拉取总数）</span>
                            <span className="font-normal text-green-700">
                              展示 {authDiagnosticAccountReturned}/{authDiagnosticAccountTotal}
                            </span>
                          </div>
                          {authDiagnostics.accounts.slice(0, 3).map(account => (
                            <div key={account.accountId} className="rounded-lg bg-white/70 px-3 py-2">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-semibold text-slate-800">{account.name || account.accountId}</div>
                                  <div className="text-[11px] text-slate-500">{account.accountId}</div>
                                </div>
                                <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${account.ready ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {account.ready ? '可投放' : '未就绪'}
                                </span>
                              </div>
                              {account.issues.length > 0 && (
                                <div className="mt-1 text-[11px] leading-5 text-amber-700">
                                  {account.issues.join(' / ')}
                                </div>
                              )}
                              {account.issueDetails?.[0]?.action && (
                                <div className="mt-1 text-[11px] leading-5 text-slate-500">
                                  建议：{account.issueDetails[0].action}
                                </div>
                              )}
                            </div>
                          ))}
                          {authDiagnosticAccountTotal > 3 && (
                            <div className="text-[11px] text-green-700">
                              还有 {Math.max(0, authDiagnosticAccountTotal - 3)} 个账户未展示
                              {authDiagnosticAccountLimit?.truncated ? `，接口仅返回前 ${authDiagnosticAccountReturned} 个重点账户` : ''}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              
              {/* 只有授权后才显示产品选择 */}
              {authStatus?.authorized && (
                <>
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-semibold text-slate-800">选择要投放的产品</h3>
                    <p className="text-slate-500 mt-2">选择一个文案包，系统将自动匹配对应的 Pixel 和可投放账户</p>
                  </div>
                  
                  {copywritingPackages.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 rounded-xl">
                  <svg className="w-12 h-12 text-slate-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-slate-500 mb-4">还没有文案包，请先创建</p>
                  <button 
                    onClick={() => navigate('/bulk-ad/assets?tab=copywriting')}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    创建文案包
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {copywritingPackages.map(pkg => (
                    <div
                      key={pkg._id}
                      onClick={() => {
                        setSelectedProduct(pkg)
                        // 自动设置文案包ID到广告配置
                        setAd(prev => ({ ...prev, copywritingPackageIds: [pkg._id] }))
                      }}
                      className={`p-4 border-2 rounded-xl cursor-pointer transition-all ${
                        selectedProduct?._id === pkg._id 
                          ? 'border-emerald-500 bg-emerald-50 shadow-lg shadow-emerald-100' 
                          : 'border-slate-200 hover:border-slate-300 hover:shadow'
                      }`}
                    >
                      {/* 产品标签 */}
                      <div className={`-mx-4 -mt-4 px-4 py-2 rounded-t-lg mb-3 ${
                        selectedProduct?._id === pkg._id 
                          ? 'bg-gradient-to-r from-emerald-500 to-teal-500' 
                          : 'bg-gradient-to-r from-slate-400 to-slate-500'
                      }`}>
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                          </svg>
                          <span className="text-white font-semibold text-sm">
                            {pkg.product?.name || '未设置产品名'}
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-semibold text-slate-800">{pkg.name}</div>
                          <div className="text-sm text-slate-500 mt-1">
                            <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-600 rounded text-xs">{pkg.callToAction}</span>
                          </div>
                          {pkg.content?.primaryTexts?.[0] && (
                            <div className="text-sm text-slate-600 mt-2 line-clamp-2">{pkg.content.primaryTexts[0]}</div>
                          )}
                        </div>
                        {selectedProduct?._id === pkg._id && (
                          <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0 ml-3">
                            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {selectedProduct && (
                <div className="mt-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                      <div className="font-medium text-emerald-800">已选择产品</div>
                      <div className="text-sm text-emerald-600">
                        {selectedProduct.product?.name || selectedProduct.name} 
                        {selectedProduct.links?.websiteUrl && (
                          <span className="ml-2 text-emerald-500">→ {new URL(selectedProduct.links.websiteUrl).hostname}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
                </>
              )}
            </div>
          )}
          
          {/* 步骤2: 选择 Pixel */}
          {currentStep === 2 && (
            <div className="space-y-6">
              {/* 选中的产品信息 */}
              {selectedProduct && (
                <div className="p-4 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg text-white">
                  <div className="flex items-center gap-3">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                    </svg>
                    <div>
                      <div className="font-semibold">投放产品: {selectedProduct.product?.name || selectedProduct.name}</div>
                      <div className="text-sm text-white/80">选择用于追踪该产品转化的 Pixel</div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* 授权检查 */}
              {authLoading ? (
                <Loading.Overlay message="检查授权状态..." size="sm" />
              ) : accountsLoading ? (
                <Loading.Overlay message="加载账户信息..." size="sm" />
              ) : !authStatus?.authorized ? (
                <div className="text-center py-12">
                  <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg className="w-10 h-10 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-slate-800 mb-2">请先登录 Facebook</h3>
                  <p className="text-slate-500 mb-6">登录后才能获取您的 Pixel 列表</p>
                  <button onClick={handleFacebookLogin} disabled={loginLoading} className="px-6 py-3 bg-[#1877F2] text-white rounded-xl hover:bg-[#166FE5]">
                    {loginLoading ? (loginAttempt ? '等待 Facebook 授权结果...' : '获取 Facebook 授权链接...') : '使用 Facebook 登录'}
                    </button>
                  {loginAttempt && loginLoading && (
                    <FacebookLoginAttemptPanel attempt={loginAttempt} onStop={stopFacebookLoginWait} />
                  )}
                </div>
              ) : (
                <>
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-semibold text-slate-800">选择追踪 Pixel</h3>
                    <p className="text-slate-500 mt-2">Pixel 决定了哪些账户可以投放此产品</p>
                  </div>
                  
                  {/* 加载 Pixels */}
                  {allPixels.length === 0 && !pixelsLoading && (
                    <div className="text-center py-8 bg-slate-50 rounded-xl">
                      <p className="text-slate-500 mb-4">Pixel 正在后台同步中...</p>
                      <button onClick={loadAllPixels} className="px-6 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700">
                        立即加载
                      </button>
                      <button
                        onClick={triggerResync}
                        disabled={resyncing}
                        className="ml-3 px-4 py-3 text-sm text-purple-600 hover:underline disabled:text-slate-400"
                      >
                        {resyncing ? '同步中...' : '重新同步'}
                      </button>
                      {resyncMessage && (
                        <div className="mt-3 text-xs font-semibold text-slate-500">{resyncMessage}</div>
                      )}
                    </div>
                  )}
                  
                  {pixelsLoading && (
                    <Loading.Overlay message="加载 Pixel 列表..." size="sm" />
                  )}
                  
                  {allPixels.length > 0 && (
                    <div className="grid grid-cols-2 gap-4">
                      {allPixels.map(pixel => {
                        const productName = (selectedProduct?.product?.name || selectedProduct?.name || '').toLowerCase()
                        const pixelName = (pixel.name || '').toLowerCase()
                        const isMatching = productName && (pixelName.includes(productName) || productName.includes(pixelName))
                        const isSelected = (selectedPixel?.pixelId || selectedPixel?.id) === (pixel.pixelId || pixel.id)
                        
                        return (
                          <div
                            key={pixel.id}
                            onClick={() => {
                              setSelectedPixel(pixel)
                              filterAccountsByPixel(pixel)
                            }}
                            className={`p-4 border-2 rounded-xl cursor-pointer transition-all ${
                              isSelected 
                                ? 'border-emerald-500 bg-emerald-50 shadow-lg shadow-emerald-100' 
                                : isMatching
                                  ? 'border-emerald-300 bg-emerald-50/50 hover:border-emerald-400 ring-2 ring-emerald-200'
                                  : 'border-slate-200 hover:border-slate-300 hover:shadow'
                            }`}
                          >
                            {/* 推荐标签 */}
                            {isMatching && !isSelected && (
                              <div className="absolute -top-2 -right-2 px-2 py-0.5 bg-emerald-500 text-white text-xs rounded-full">
                                推荐
                              </div>
                            )}
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <svg className={`w-5 h-5 ${isSelected || isMatching ? 'text-emerald-600' : 'text-purple-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                  </svg>
                                  <div className={`font-semibold ${isSelected || isMatching ? 'text-emerald-800' : 'text-slate-800'}`}>{pixel.name}</div>
                                  {isMatching && (
                                    <span className="text-xs px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">匹配产品</span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-500 mt-1">ID: {pixel.id}</div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {pixel.accounts?.slice(0, 3).map((acc: any, idx: number) => (
                                    <span key={idx} className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                                      {acc.accountName || acc.accountId}
                                    </span>
                                  ))}
                                  {(pixel.accounts?.length || 0) > 3 && (
                                    <span className="text-xs text-slate-400">+{pixel.accounts.length - 3}</span>
                                  )}
                                </div>
                                <div className={`text-xs mt-2 ${isSelected || isMatching ? 'text-emerald-600' : 'text-purple-600'}`}>
                                  可用于 {pixel.accounts?.length || 0} 个账户
                                </div>
                              </div>
                              {isSelected && (
                                <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0">
                                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  
                  {selectedPixel && (
                    <div className="mt-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center">
                          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <div>
                          <div className="font-medium text-purple-800">已选择 Pixel: {selectedPixel.name}</div>
                          <div className="text-sm text-purple-600">
                            共 {selectedPixel.accounts?.length || 0} 个账户可使用此 Pixel 投放
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          
          {/* 步骤3: 选择账户（基于 Pixel） */}
          {currentStep === 3 && (
            <div className="space-y-6">
              {/* 已选产品和 Pixel */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <div className="text-xs text-emerald-600 mb-1">投放产品</div>
                  <div className="font-semibold text-emerald-800">{selectedProduct?.product?.name || selectedProduct?.name}</div>
                </div>
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <div className="text-xs text-purple-600 mb-1">追踪 Pixel</div>
                  <div className="font-semibold text-purple-800">{selectedPixel?.name}</div>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">选择投放账户</h3>
                  <p className="text-slate-500 text-sm">以下账户已绑定所选 Pixel，可以投放该产品</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-500">
                    已拉取总数: {accounts.length} / 当前 Pixel: {filteredAccounts.length} /
                    活跃: {filteredAccounts.filter(a => a.account_status === 1).length} /
                    已选: {selectedAccounts.length}
                  </span>
                  {filteredAccounts.length > 0 && (
                    <button
                      onClick={toggleSelectAllActive}
                      disabled={selectingAccounts}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:cursor-wait disabled:opacity-60"
                    >
                      {selectingAccounts ? '加载主页...' : filteredAccounts.filter(a => a.account_status === 1).every(acc => {
                        const accId = acc.account_id || acc.id?.replace('act_', '')
                        return selectedAccounts.find(a => a.accountId === accId)
                      }) ? '取消全选' : '全选活跃账户'}
                    </button>
                  )}
                </div>
              </div>
              
              {filteredAccounts.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 rounded-xl">
                  <svg className="w-12 h-12 text-slate-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-slate-500">没有找到绑定此 Pixel 的账户</p>
                  <button onClick={() => setCurrentStep(2)} className="mt-4 text-purple-600 hover:underline">返回选择其他 Pixel</button>
                    </div>
                  ) : (
                    <>
                  <div className="grid grid-cols-2 gap-4">
                    {filteredAccounts.map(account => {
                      const accountId = account.account_id || account.id?.replace('act_', '')
                      const isActive = account.account_status === 1
                      const isSelected = !!selectedAccounts.find(a => a.accountId === accountId)
                      return (
                        <label 
                          key={accountId} 
                          className={`flex items-center p-4 border-2 rounded-xl transition-all ${
                            !isActive 
                              ? 'border-slate-200 bg-slate-100 cursor-not-allowed opacity-60' 
                              : isSelected 
                                ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-100 cursor-pointer' 
                                : 'border-slate-200 hover:border-slate-300 hover:shadow cursor-pointer'
                          }`}
                        >
                          <input 
                            type="checkbox" 
                            checked={isSelected} 
                            onChange={() => isActive && toggleAccount(account)} 
                            disabled={!isActive || selectingAccounts}
                            className="mr-3 w-5 h-5" 
                          />
                          <div className="flex-1">
                            <div className="font-semibold text-slate-800">{account.name || accountId}</div>
                            <div className="text-sm text-slate-500">{accountId}</div>
                          </div>
                          {getAccountStatusBadge(account.account_status)}
                        </label>
                      )
                    })}
                  </div>
                      
                      {selectedAccounts.length > 0 && (
                        <div className="space-y-4 mt-6">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold">配置粉丝页（自动均摊分配）</h4>
                      </div>
                      
                      {/* 主页加载中，完成后再展示真正缺失主页的账户 */}
                      {selectingAccounts ? (
                        <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-3 text-blue-700" role="status">
                          <Loading.Spinner size="sm" />
                          <div>
                            <div className="font-semibold">正在加载已选账户的主页</div>
                            <p className="text-sm mt-1">账户已选中，主页配置完成后即可进入下一步。</p>
                          </div>
                        </div>
                      ) : selectedAccounts.some(acc => !acc.pageId) && (
                        <div className="p-4 bg-red-100 border-2 border-red-400 rounded-xl flex items-start gap-3">
                          <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          </div>
                          <div>
                            <div className="font-bold text-red-800">⚠️ 无法继续：部分账户没有可用主页</div>
                            <p className="text-sm text-red-700 mt-1">
                              以下账户在 Facebook 没有绑定可推广主页，必须取消选择才能继续：
                            </p>
                            <ul className="mt-2 space-y-1">
                              {selectedAccounts.filter(acc => !acc.pageId).map(acc => (
                                <li key={acc.accountId} className="text-sm text-red-600 flex items-center gap-2">
                                  <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                                  {acc.accountName} ({acc.accountId})
                                </li>
                              ))}
                            </ul>
                            <p className="text-xs text-red-600 mt-2">
                              请在 Facebook Business Manager 中为这些账户绑定主页，或取消选择这些账户。
                            </p>
                          </div>
                        </div>
                      )}
                      
                      {selectedAccounts.map(acc => {
                        const pagesForAccount = accountPages[acc.accountId] || []
                        const hasNoPages = pagesForAccount.length === 0 && accountPages[acc.accountId] !== undefined
                        
                        return (
                          <div key={acc.accountId} className={`p-4 border rounded-lg ${hasNoPages ? 'bg-red-50 border-red-300' : 'bg-slate-50'}`}>
                            <div className="flex items-center justify-between mb-3">
                              <div className="font-medium text-slate-700">{acc.accountName}</div>
                              {acc.pageId && (
                                <span className="text-xs px-2 py-1 bg-green-100 text-green-600 rounded">已分配主页</span>
                              )}
                              {hasNoPages && (
                                <span className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded flex items-center gap-1">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                  无可用主页
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm text-slate-600 mb-1">Facebook 主页 *</label>
                                {hasNoPages ? (
                                  <div className="px-3 py-2 border border-red-300 rounded-lg bg-red-100 text-red-600 text-sm">
                                    该账户没有可用主页
                                  </div>
                                ) : (
                                  <select
                                    value={acc.pageId} 
                                    disabled={selectingAccounts}
                                    onChange={(e) => {
                                      const page = pagesForAccount.find((p: any) => p.id === e.target.value)
                                      updateAccountConfig(acc.accountId, 'pageId', e.target.value)
                                      if (page) updateAccountConfig(acc.accountId, 'pageName', page.name)
                                    }} 
                                    className="w-full px-3 py-2 border rounded-lg"
                                  >
                                    <option value="">选择主页</option>
                                    {pagesForAccount.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                  </select>
                                )}
                                </div>
                                <div>
                                  <label className="block text-sm text-slate-600 mb-1">转化事件</label>
                                  <select
                                    value={acc.conversionEvent} 
                                    onChange={(e) => updateAccountConfig(acc.accountId, 'conversionEvent', e.target.value)} 
                                    className="w-full px-3 py-2 border rounded-lg"
                                    disabled={hasNoPages || selectingAccounts}
                                  >
                                    <option value="PURCHASE">Purchase</option>
                                    <option value="ADD_TO_CART">Add to Cart</option>
                                    <option value="INITIATE_CHECKOUT">Initiate Checkout</option>
                                    <option value="LEAD">Lead</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                        )
                      })}
                        </div>
                  )}
                </>
              )}
            </div>
          )}
          
          {currentStep === 4 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">广告系列设置</h3>
              <div className="grid grid-cols-2 gap-6">
                <div><label className="block text-sm text-slate-600 mb-1">系列名称模板</label>
                  <input type="text" value={campaign.nameTemplate} onChange={(e) => setCampaign({...campaign, nameTemplate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" />
                  <p className="text-xs text-slate-400 mt-1">自动填入: 用户名_渠道_产品名；变量: {'{targetingName}'}, {'{accountName}'}, {'{date}'}</p></div>
                <div><label className="block text-sm text-slate-600 mb-1">推广目标</label>
                  <select value={campaign.objective} onChange={(e) => setCampaign({...campaign, objective: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="OUTCOME_SALES">销量</option><option value="OUTCOME_LEADS">潜在客户</option><option value="OUTCOME_TRAFFIC">流量</option>
                  </select></div>
                <div><label className="block text-sm text-slate-600 mb-1">竞价策略</label>
                  <select value={campaign.bidStrategy} onChange={(e) => setCampaign({...campaign, bidStrategy: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="LOWEST_COST_WITHOUT_CAP">最低成本</option><option value="COST_CAP">费用上限</option>
                  </select></div>
                <div><label className="block text-sm text-slate-600 mb-1">初始状态</label>
                  <select value={campaign.status} onChange={(e) => setCampaign({...campaign, status: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="PAUSED">暂停</option><option value="ACTIVE">启用</option>
                  </select></div>
              </div>
              
              {/* CBO 预算设置 */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="font-medium text-slate-800">预算优化 (CBO)</h4>
                    <p className="text-sm text-slate-500">启用后，预算在广告系列级别设置，Facebook 自动分配到各广告组</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCampaign({...campaign, budgetOptimization: !campaign.budgetOptimization})}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${campaign.budgetOptimization ? 'bg-blue-600' : 'bg-slate-200'}`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white border border-slate-300 transition-transform ${campaign.budgetOptimization ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                    <span className="text-sm font-medium text-slate-700">{campaign.budgetOptimization ? '已启用' : '未启用'}</span>
                  </div>
                </div>
                
                {campaign.budgetOptimization && (
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-blue-200">
                    <div>
                      <label className="block text-sm text-slate-600 mb-1">预算类型</label>
                      <select value={campaign.budgetType} onChange={(e) => setCampaign({...campaign, budgetType: e.target.value})} className="w-full px-3 py-2 border rounded-lg bg-white">
                        <option value="DAILY">日预算</option><option value="LIFETIME">总预算</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-slate-600 mb-1">广告系列预算 ($)</label>
                      <input type="number" value={campaign.budget} onChange={(e) => setCampaign({...campaign, budget: Number(e.target.value)})} min="1" className="w-full px-3 py-2 border rounded-lg bg-white" />
                      <p className="text-xs text-blue-600 mt-1">此预算将由 Facebook 自动分配到各广告组</p>
                    </div>
                  </div>
                )}
                
                {!campaign.budgetOptimization && (
                  <div className="pt-4 border-t border-blue-200">
                    <p className="text-sm text-amber-600 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                      未启用 CBO，请在下一步（广告组设置）中为每个广告组设置预算
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {currentStep === 5 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">广告组设置</h3>
              <div className="grid grid-cols-2 gap-6">
                <div><label className="block text-sm text-slate-600 mb-1">广告组名称模板</label>
                  <input type="text" value={adset.nameTemplate} onChange={(e) => setAdset({...adset, nameTemplate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
                <div><label className="block text-sm text-slate-600 mb-1">初始状态</label>
                  <select value={adset.status} onChange={(e) => setAdset({...adset, status: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="ACTIVE">启用</option><option value="PAUSED">暂停</option>
                  </select></div>
                <div><label className="block text-sm text-slate-600 mb-1">定向包</label>
                  <select value={adset.targetingPackageId} onChange={(e) => {
                    const pkgId = e.target.value
                    const pkg = targetingPackages.find((p: any) => p._id === pkgId)
                    setAdset({
                      ...adset, 
                      targetingPackageId: pkgId,
                      // 从定向包同步版位和优化目标设置
                      optimizationGoal: pkg?.optimizationGoal || adset.optimizationGoal,
                      placementType: pkg?.placement?.type === 'manual' ? 'MANUAL' : 'AUTOMATIC',
                    })
                  }} className="w-full px-3 py-2 border rounded-lg">
                    <option value="">选择定向包</option>{targetingPackages.map((pkg: any) => <option key={pkg._id} value={pkg._id}>{pkg.name}</option>)}
                  </select>
                  <button onClick={() => navigate('/bulk-ad/assets?tab=targeting')} className="text-xs text-blue-500 mt-1 hover:underline">+ 新建定向包</button></div>
                <div>
                  <label className="block text-sm text-slate-600 mb-1">广告组倍率</label>
                  <select value={adset.multiplier} onChange={(e) => setAdset({...adset, multiplier: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                      <option key={n} value={n}>{n}x（每个系列 {n} 个广告组）</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">在同一个 Campaign 下创建多个相同配置的广告组</p>
                </div>
              </div>
              
              {/* 从定向包读取的配置（只读显示） */}
              {adset.targetingPackageId && (() => {
                const pkg = targetingPackages.find((p: any) => p._id === adset.targetingPackageId) as any
                return pkg ? (
                  <div className="mt-4 p-4 bg-slate-50 rounded-lg">
                    <div className="text-sm text-slate-500 mb-2">以下设置来自定向包「{pkg.name}」</div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-slate-500">版位：</span>
                        <span className="ml-1 font-medium">{pkg.placement?.type === 'manual' ? '手动版位' : '自动版位'}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">优化目标：</span>
                        <span className="ml-1 font-medium">
                          {pkg.optimizationGoal === 'OFFSITE_CONVERSIONS' ? '网站转化' : 
                           pkg.optimizationGoal === 'LINK_CLICKS' ? '链接点击' : 
                           pkg.optimizationGoal === 'LANDING_PAGE_VIEWS' ? '落地页浏览' : '网站转化'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">受众：</span>
                        <span className="ml-1 font-medium">
                          {pkg.geoLocations?.countries?.join(', ') || '全球'} / {pkg.demographics?.ageMin || 18}-{pkg.demographics?.ageMax || 65}岁
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null
              })()}
              
              {/* 归因设置 */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="flex items-center gap-2 mb-3">
                  <h4 className="font-medium text-slate-800">归因设置</h4>
                  <div className="relative group">
                    <svg className="w-4 h-4 text-slate-400 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-slate-800 text-white text-xs rounded-lg shadow-lg z-10">
                      归因设置决定广告转化如何归功于您的广告。点击归因表示用户点击广告后产生的转化，浏览归因表示用户看到广告后产生的转化。
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm text-slate-600 mb-1">点击后归因</label>
                    <select 
                      value={adset.attribution.clickWindow} 
                      onChange={(e) => setAdset({...adset, attribution: {...adset.attribution, clickWindow: Number(e.target.value)}})} 
                      className="w-full px-3 py-2 border border-blue-200 rounded-lg bg-white text-sm"
                    >
                      <option value={1}>1天</option>
                      <option value={7}>7天</option>
                      <option value={28}>28天</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 mb-1">互动观看后归因</label>
                    <select 
                      value={adset.attribution.engagedViewWindow} 
                      onChange={(e) => setAdset({...adset, attribution: {...adset.attribution, engagedViewWindow: Number(e.target.value)}})} 
                      className="w-full px-3 py-2 border border-blue-200 rounded-lg bg-white text-sm"
                    >
                      <option value={0}>不启用</option>
                      <option value={1}>1天</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 mb-1">浏览后归因</label>
                    <select 
                      value={adset.attribution.viewWindow} 
                      onChange={(e) => setAdset({...adset, attribution: {...adset.attribution, viewWindow: Number(e.target.value)}})} 
                      className="w-full px-3 py-2 border border-blue-200 rounded-lg bg-white text-sm"
                    >
                      <option value={0}>不启用</option>
                      <option value={1}>1天</option>
                    </select>
                  </div>
                </div>
                <p className="text-xs text-blue-600 mt-2">
                  当前设置：点击后{adset.attribution.clickWindow}天内
                  {adset.attribution.engagedViewWindow > 0 ? `，互动观看后${adset.attribution.engagedViewWindow}天内` : ''}
                  {adset.attribution.viewWindow > 0 ? `，浏览后${adset.attribution.viewWindow}天内` : ''}
                </p>
              </div>
              
              {/* 广告组预算（非 CBO 模式） */}
              {!campaign.budgetOptimization && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <h4 className="font-medium text-slate-800 mb-3">广告组预算</h4>
                  <p className="text-sm text-slate-500 mb-4">由于未启用 CBO，每个广告组需要单独设置预算</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-slate-600 mb-1">预算类型</label>
                      <select value={campaign.budgetType} onChange={(e) => setCampaign({...campaign, budgetType: e.target.value})} className="w-full px-3 py-2 border rounded-lg bg-white">
                        <option value="DAILY">日预算</option><option value="LIFETIME">总预算</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-slate-600 mb-1">广告组预算 ($)</label>
                      <input type="number" value={adset.budget} onChange={(e) => setAdset({...adset, budget: Number(e.target.value)})} min="1" className="w-full px-3 py-2 border rounded-lg bg-white" />
                      <p className="text-xs text-amber-600 mt-1">每个广告组将使用此预算</p>
                    </div>
                  </div>
                </div>
              )}
              
              {campaign.budgetOptimization && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2 text-green-700">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                    <span className="font-medium">已启用 CBO 预算优化</span>
                  </div>
                  <p className="text-sm text-green-600 mt-1">广告系列预算 ${campaign.budget}，Facebook 将自动分配到各广告组</p>
                </div>
              )}
            </div>
          )}
          
          {currentStep === 6 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">广告创意设置</h3>
              <div className="grid grid-cols-3 gap-6">
                <div><label className="block text-sm text-slate-600 mb-1">广告名称模板</label>
                  <input type="text" value={ad.nameTemplate} onChange={(e) => setAd({...ad, nameTemplate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
                <div><label className="block text-sm text-slate-600 mb-1">初始状态</label>
                  <select value={ad.status} onChange={(e) => setAd({...ad, status: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="ACTIVE">启用</option><option value="PAUSED">暂停</option>
                  </select></div>
                <div><label className="block text-sm text-slate-600 mb-1">广告格式</label>
                  <select value={ad.format} onChange={(e) => setAd({...ad, format: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="SINGLE">单图/视频</option><option value="CAROUSEL">轮播</option>
                  </select></div>
              </div>
              <div><label className="block text-sm text-slate-600 mb-2">选择创意组</label>
                {creativeGroups.length === 0 ? (
                  <div className="text-center py-6 border-2 border-dashed rounded-lg">
                    <p className="text-slate-500 mb-2">还没有创意组</p>
                    <button onClick={() => navigate('/bulk-ad/assets?tab=creative')} className="text-blue-500 hover:underline">+ 新建创意组</button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {creativeGroups.map(group => (
                      <label key={group._id} className={`flex items-center p-3 border rounded-lg cursor-pointer ${ad.creativeGroupIds.includes(group._id) ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                        <input type="checkbox" checked={ad.creativeGroupIds.includes(group._id)} onChange={(e) => setAd({...ad, creativeGroupIds: e.target.checked ? [...ad.creativeGroupIds, group._id] : ad.creativeGroupIds.filter(id => id !== group._id)})} className="mr-2" />
                        <div><div className="font-medium text-sm">{group.name}</div><div className="text-xs text-slate-500">{group.materials?.length || 0} 个素材</div></div>
                      </label>
                    ))}
                  </div>
                )}
                <button onClick={() => navigate('/bulk-ad/assets?tab=creative')} className="text-sm text-blue-500 mt-2 hover:underline">+ 新建创意组</button></div>
              <div><label className="block text-sm text-slate-600 mb-2">选择文案包</label>
                {copywritingPackages.length === 0 ? (
                  <div className="text-center py-6 border-2 border-dashed rounded-lg">
                    <p className="text-slate-500 mb-2">还没有文案包</p>
                    <button onClick={() => navigate('/bulk-ad/assets?tab=copywriting')} className="text-blue-500 hover:underline">+ 新建文案包</button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {copywritingPackages.map(pkg => (
                      <label key={pkg._id} className={`flex items-center p-3 border rounded-lg cursor-pointer ${ad.copywritingPackageIds.includes(pkg._id) ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                        <input type="checkbox" checked={ad.copywritingPackageIds.includes(pkg._id)} onChange={(e) => setAd({...ad, copywritingPackageIds: e.target.checked ? [...ad.copywritingPackageIds, pkg._id] : ad.copywritingPackageIds.filter(id => id !== pkg._id)})} className="mr-2" />
                        <div><div className="font-medium text-sm">{pkg.name}</div><div className="text-xs text-slate-500">{pkg.callToAction}</div></div>
                      </label>
                    ))}
                  </div>
                )}
                <button onClick={() => navigate('/bulk-ad/assets?tab=copywriting')} className="text-sm text-blue-500 mt-2 hover:underline">+ 新建文案包</button></div>
            </div>
          )}
          
          {currentStep === 7 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">发布预览</h3>
              <div className="grid grid-cols-2 gap-6">
                <div><label className="block text-sm text-slate-600 mb-1">定向分配级别</label>
                  <select value={publishStrategy.targetingLevel} onChange={(e) => setPublishStrategy({...publishStrategy, targetingLevel: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="ADSET">按广告组</option><option value="CAMPAIGN">按广告系列</option>
                  </select></div>
                <div><label className="block text-sm text-slate-600 mb-1">文案包分配方式</label>
                  <select value={publishStrategy.copywritingMode} onChange={(e) => setPublishStrategy({...publishStrategy, copywritingMode: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="SHARED">共用</option><option value="SEQUENTIAL">轮换</option>
                  </select></div>
                <div><label className="block text-sm text-slate-600 mb-1">发布计划</label>
                  <select value={publishStrategy.schedule} onChange={(e) => setPublishStrategy({...publishStrategy, schedule: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="IMMEDIATE">立即发布</option><option value="SCHEDULED">定时发布</option>
                  </select></div>
              </div>
              <div className="bg-slate-50 rounded-lg p-6">
                <h4 className="font-semibold mb-4">广告结构预览</h4>
                <div className="grid grid-cols-4 gap-4 text-center">
                  <div><div className="text-3xl font-bold text-blue-600">{estimates.totalAccounts}</div><div className="text-sm text-slate-500">账户</div></div>
                  <div><div className="text-3xl font-bold text-blue-600">{estimates.totalCampaigns}</div><div className="text-sm text-slate-500">广告系列</div></div>
                  <div><div className="text-3xl font-bold text-blue-600">{estimates.totalAdsets}</div><div className="text-sm text-slate-500">广告组</div></div>
                  <div><div className="text-3xl font-bold text-blue-600">{estimates.totalAds}</div><div className="text-sm text-slate-500">广告</div></div>
                </div>
                <div className="mt-4 pt-4 border-t text-center"><span className="text-slate-600">预估日预算: </span><span className="text-xl font-bold text-green-600">${estimates.dailyBudget}</span></div>
              </div>
            </div>
          )}
        </div>
        
        {/* Bottom buttons */}
        {currentStep === 1 && facebookAssetsBlocked && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            <div className="font-bold">暂不能进入下一步</div>
            <div className="mt-1 leading-6">
              当前没有同时具备 Page 和 Pixel 的活跃广告账户。请先在 Meta 里完成 Page/Pixel 分配，再回到 AutoArk 重新同步。
            </div>
            <button
              type="button"
              onClick={triggerResync}
              disabled={resyncing}
              className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
            >
              {resyncing ? '同步中...' : '重新同步'}
            </button>
          </div>
        )}
        <div className="flex justify-between mt-6">
          <button 
            onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))} 
            disabled={currentStep === 1 || selectingAccounts}
            className="px-6 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            上一步
          </button>
          {currentStep < STEPS.length ? (
            <button 
              onClick={() => setCurrentStep(prev => Math.min(STEPS.length, prev + 1))} 
              disabled={nextDisabled}
              title={nextDisabledTitle}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一步
            </button>
          ) : (
            <button 
              onClick={handlePublish} 
              disabled={loading || selectedAccounts.some(acc => !acc.pageId)} 
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? '发布中...' : '发布广告'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
