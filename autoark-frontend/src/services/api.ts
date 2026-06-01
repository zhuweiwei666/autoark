// 在生产环境中，如果前端和后端在同一域名下，使用相对路径
// 在开发环境中，使用环境变量或默认的 localhost
const getApiBaseUrl = () => {
  const env = import.meta.env
  if (env.VITE_API_BASE_URL) {
    return env.VITE_API_BASE_URL
  }
  // 如果是生产环境且没有配置，尝试使用当前域名
  if (env.PROD) {
    return window.location.origin
  }
  // 开发环境默认
  return 'http://localhost:3001'
}

const API_BASE_URL = getApiBaseUrl()

/**
 * 获取当前认证 Token
 */
const getAuthToken = (): string | null => {
  return localStorage.getItem('auth_token')
}

/**
 * 带认证的 fetch 封装
 * 默认添加 Content-Type: application/json，可通过 options.headers 覆盖
 */
export const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = getAuthToken()
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }
  
  if (token) {
    ;(headers as Record<string, string>)['Authorization'] = `Bearer ${token}`
  }
  
  return fetch(url, { ...options, headers })
}

// === 商用 SaaS 状态 ===

export interface CommercialReadiness {
  scope: {
    mode: 'organization' | 'platform'
    organizationId?: string
    organizationName: string
  }
  plan: {
    code: string
    label: string
    billingStatus: string
    trialEndsAt?: string
    currentPeriodEndsAt?: string
    features: string[]
    limits: Record<string, number | null>
  }
  usage: Record<string, {
    used: number
    limit: number | null
    percent: number | null
    status: 'ok' | 'warning' | 'exceeded'
  }>
  metrics: Record<string, number>
  checklist: Array<{
    id: string
    title: string
    description: string
    status: 'done' | 'warning' | 'pending' | 'blocked'
    actionPath?: string
    metric?: string
  }>
  score: number
  state: {
    level: 'blocked' | 'attention' | 'ready'
    label: string
    summary: string
  }
  nextActions: Array<{
    id: string
    priority: 'critical' | 'high' | 'medium' | 'low'
    title: string
    description: string
    actionPath?: string
    owner: string
    source: 'setup' | 'facebook' | 'quota' | 'tasks' | 'team' | 'materials'
  }>
  risks: Array<{
    level: 'critical' | 'warning' | 'info'
    message: string
    actionPath?: string
  }>
  deployment: {
    corsConfigured: boolean
    oauthStateSecretConfigured: boolean
    facebookBusinessLoginConfigConfigured: boolean
    feishuWebhookConfigured: boolean
  }
}

export async function getCommercialReadiness(organizationId?: string): Promise<{
  success: boolean
  data: CommercialReadiness
}> {
  const params = new URLSearchParams()
  if (organizationId) params.append('organizationId', organizationId)
  const url = `${API_BASE_URL}/api/commercial/readiness${params.toString() ? `?${params.toString()}` : ''}`
  const response = await authFetch(url)

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || 'Failed to fetch commercial readiness')
  }

  return response.json()
}

export interface OrganizationSummary {
  _id: string
  name: string
  description?: string
  status: 'active' | 'inactive' | 'suspended' | string
  adminId?: {
    _id?: string
    username?: string
    email?: string
  } | string
  createdAt?: string
}

export async function getOrganizations(): Promise<{
  success: boolean
  data: OrganizationSummary[]
}> {
  const response = await authFetch(`${API_BASE_URL}/api/organizations`)

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || 'Failed to fetch organizations')
  }

  return response.json()
}

// === 审计日志 ===

export interface AuditLogEntry {
  _id: string
  organizationId?: string
  userId?: string
  username?: string
  userEmail?: string
  userRole?: string
  category?: string
  action: string
  status: 'success' | 'failed' | 'warning'
  targetType?: string
  targetId?: string
  summary?: string
  reason?: string
  related?: Record<string, unknown>
  metadata?: Record<string, unknown>
  requestId?: string
  ip?: string
  createdAt: string
}

export async function getAuditLogs(params?: {
  category?: string
  action?: string
  status?: string
  limit?: number
}): Promise<{ success: boolean; data: AuditLogEntry[] }> {
  const queryParams = new URLSearchParams()
  if (params?.category) queryParams.append('category', params.category)
  if (params?.action) queryParams.append('action', params.action)
  if (params?.status) queryParams.append('status', params.status)
  if (params?.limit) queryParams.append('limit', String(params.limit))

  const url = `${API_BASE_URL}/api/audit-logs${queryParams.toString() ? `?${queryParams.toString()}` : ''}`
  const response = await authFetch(url)

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || 'Failed to fetch audit logs')
  }

  return response.json()
}

export interface FbToken {
  id: string
  userId: string
  optimizer?: string
  status: 'active' | 'expired' | 'invalid'
  fbUserId?: string
  fbUserName?: string
  expiresAt?: string
  lastCheckedAt?: string
  createdAt: string
  updatedAt: string
}

export interface BindTokenRequest {
  token: string
  optimizer?: string
  userId?: string
}

export interface TokenListResponse {
  success: boolean
  data: FbToken[]
  count: number
}

export interface TokenResponse {
  success: boolean
  data: FbToken
  message?: string
}

// 绑定 token
export async function bindToken(
  request: BindTokenRequest,
): Promise<TokenResponse> {
  const response = await authFetch(`${API_BASE_URL}/api/fb-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to bind token')
  }

  return response.json()
}

// 获取 token 列表
export async function getTokens(params?: {
  optimizer?: string
  startDate?: string
  endDate?: string
  status?: string
}): Promise<TokenListResponse> {
  const queryParams = new URLSearchParams()
  if (params?.optimizer) queryParams.append('optimizer', params.optimizer)
  if (params?.startDate) queryParams.append('startDate', params.startDate)
  if (params?.endDate) queryParams.append('endDate', params.endDate)
  if (params?.status) queryParams.append('status', params.status)

  const url = `${API_BASE_URL}/api/fb-token${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`

  const response = await authFetch(url)

  if (!response.ok) {
    throw new Error('Failed to fetch tokens')
  }

  return response.json()
}

// 获取单个 token
export async function getTokenById(id: string): Promise<TokenResponse> {
  const response = await authFetch(`${API_BASE_URL}/api/fb-token/${id}`)

  if (!response.ok) {
    throw new Error('Failed to fetch token')
  }

  return response.json()
}

// 检查 token 状态
export async function checkTokenStatus(id: string): Promise<TokenResponse> {
  const response = await authFetch(`${API_BASE_URL}/api/fb-token/${id}/check`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to check token status')
  }

  return response.json()
}

// 更新 token
export async function updateToken(
  id: string,
  data: { optimizer?: string },
): Promise<TokenResponse> {
  const response = await authFetch(`${API_BASE_URL}/api/fb-token/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to update token')
  }

  return response.json()
}

// 删除 token
export async function deleteToken(id: string): Promise<void> {
  const response = await authFetch(`${API_BASE_URL}/api/fb-token/${id}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to delete token')
  }
}

// === 账户管理 ===

export interface FbAccount {
  id: string
  accountId: string
  name: string
  status: string
  accountStatus: number
  currency: string
  balance: number
  spendCap?: string
  amountSpent?: string
  operator?: string
  token?: string
  createdAt: string
  updatedAt: string
  periodSpend?: number // 日期范围内的消耗
  calculatedBalance?: number // 计算后的余额（账户总余额 - 历史总消耗）
  totalSpend?: number // 历史总消耗（用于调试）
}

export interface AccountListResponse {
  success: boolean
  data: FbAccount[]
  pagination: {
    total: number
    page: number
    limit: number
    pages: number
  }
}

// 获取账户列表
export async function getAccounts(params?: {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  optimizer?: string
  status?: string
  accountId?: string
  name?: string
  startDate?: string
  endDate?: string
}): Promise<AccountListResponse> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.sortBy) queryParams.append('sortBy', params.sortBy)
  if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder)
  if (params?.startDate) queryParams.append('startDate', params.startDate)
  if (params?.endDate) queryParams.append('endDate', params.endDate)
  if (params?.optimizer) queryParams.append('optimizer', params.optimizer)
  if (params?.status) queryParams.append('status', params.status)
  if (params?.accountId) queryParams.append('accountId', params.accountId)
  if (params?.name) queryParams.append('name', params.name)

  // 使用 Summary API (智能路由：预聚合+实时回退)
  const url = `${API_BASE_URL}/api/summary/accounts${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`

  const response = await authFetch(url)

  if (!response.ok) {
    throw new Error('Failed to fetch accounts')
  }

  return response.json()
}

// 同步账户
export async function syncAccounts(): Promise<{
  success: boolean
  message: string
  data: { syncedCount: number; errorCount: number; errors?: Array<{ accountId?: string; tokenId?: string; optimizer?: string; error: string }> }
}> {
  const response = await authFetch(`${API_BASE_URL}/api/facebook/accounts/sync`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to sync accounts')
  }

  return response.json()
}

// === 广告系列管理 ===

export interface FbCampaignMetrics {
  spend: number
  cpm?: number
  ctr?: number
  cpc?: number
  cpi?: number // Cost Per Install
  purchase_value?: number // 购物转化价值
  roas?: number // Return on Ad Spend
  event_conversions?: number // 事件转化次数
  installs?: number // 安装量
}

export interface FbCampaign {
  id: string
  campaignId: string
  accountId: string
  name: string
  status: string
  objective?: string
  buying_type?: string
  daily_budget?: string
  budget_remaining?: string
  created_time?: string
  updated_time?: string
  metrics?: FbCampaignMetrics // 汇总指标
  // 直接从后端返回的指标字段（已合并到 campaign 对象中）
  spend?: number
  cpm?: number
  ctr?: number
  cpc?: number
  cpi?: number
  purchase_value?: number
  roas?: number
  event_conversions?: number
  installs?: number // 安装量
  raw?: any
}

export interface CampaignListResponse {
  success: boolean
  data: FbCampaign[]
  pagination: {
    total: number
    page: number
    limit: number
    pages: number
  }
}

export interface FbCountry {
  id: string
  country: string
  campaignCount: number
  spend: number
  impressions: number
  clicks: number
  cpc: number
  ctr: number
  cpm: number
  purchase_roas: number
  purchase_value: number
  mobile_app_install: number
}

export interface CountryListResponse {
  success: boolean
  data: FbCountry[]
  pagination: {
    total: number
    page: number
    limit: number
    pages: number
  }
}

// 获取广告系列列表
export async function getCampaigns(params?: {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  name?: string
  accountId?: string
  status?: string
  objective?: string
  startDate?: string
  endDate?: string
}): Promise<CampaignListResponse> {
  const queryParams = new URLSearchParams()
  if (params?.startDate) queryParams.append('startDate', params.startDate)
  if (params?.endDate) queryParams.append('endDate', params.endDate)
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.sortBy) queryParams.append('sortBy', params.sortBy)
  if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder)
  if (params?.name) queryParams.append('name', params.name)
  if (params?.accountId) queryParams.append('accountId', params.accountId)
  if (params?.status) queryParams.append('status', params.status)
  if (params?.objective) queryParams.append('objective', params.objective)

  // 使用 Summary API (智能路由：预聚合+实时回退)
  const url = `${API_BASE_URL}/api/summary/campaigns${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`

  const response = await authFetch(url)

  if (!response.ok) {
    const errorText = await response.text()
    let errorMessage = 'Failed to fetch campaigns'
    try {
      const errorJson = JSON.parse(errorText)
      errorMessage = errorJson.message || errorMessage
    } catch {
      // 如果不是 JSON，使用原始文本（可能是 HTML）
      if (errorText.includes('<!DOCTYPE')) {
        errorMessage = `服务器返回了 HTML 响应，请检查 API 路由配置。状态码: ${response.status}`
      } else {
        errorMessage = errorText || errorMessage
      }
    }
    throw new Error(errorMessage)
  }

  // 检查 Content-Type 确保是 JSON
  const contentType = response.headers.get('content-type')
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text()
    throw new Error(`服务器返回了非 JSON 响应: ${contentType}. 响应内容: ${text.substring(0, 100)}`)
  }

  return response.json()
}

// 获取国家列表
export async function getCountries(params?: {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  name?: string
  accountId?: string
  status?: string
  objective?: string
  startDate?: string
  endDate?: string
}): Promise<CountryListResponse> {
  const queryParams = new URLSearchParams()
  if (params?.startDate) queryParams.append('startDate', params.startDate)
  if (params?.endDate) queryParams.append('endDate', params.endDate)
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.sortBy) queryParams.append('sortBy', params.sortBy)
  if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder)
  if (params?.name) queryParams.append('name', params.name)
  if (params?.accountId) queryParams.append('accountId', params.accountId)
  if (params?.status) queryParams.append('status', params.status)
  if (params?.objective) queryParams.append('objective', params.objective)

  // 使用 Summary API (智能路由：预聚合+实时回退)
  const url = `${API_BASE_URL}/api/summary/countries${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`

  const response = await authFetch(url)

  if (!response.ok) {
    const errorText = await response.text()
    let errorMessage = 'Failed to fetch countries'
    try {
      const errorJson = JSON.parse(errorText)
      errorMessage = errorJson.message || errorMessage
    } catch {
      if (errorText.includes('<!DOCTYPE')) {
        errorMessage = `服务器返回了 HTML 响应，请检查 API 路由配置。状态码: ${response.status}`
      } else {
        errorMessage = errorText || errorMessage
      }
    }
    throw new Error(errorMessage)
  }

  // 检查 Content-Type 确保是 JSON
  const contentType = response.headers.get('content-type')
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text()
    throw new Error(`服务器返回了非 JSON 响应: ${contentType}. 响应内容: ${text.substring(0, 100)}`)
  }

  return response.json()
}

// 同步广告系列
export async function syncCampaigns(): Promise<{
  success: boolean
  message: string
  data: { syncedCampaigns: number; syncedMetrics: number; errorCount: number; errors?: Array<{ accountId?: string; tokenId?: string; optimizer?: string; error: string }> }
}> {
  const response = await authFetch(`${API_BASE_URL}/api/facebook/campaigns/sync`, {
    method: 'POST',
  })

  if (!response.ok) {
    const errorText = await response.text()
    let errorMessage = 'Failed to sync campaigns'
    try {
      const errorJson = JSON.parse(errorText)
      errorMessage = errorJson.message || errorMessage
    } catch {
      if (errorText.includes('<!DOCTYPE')) {
        errorMessage = `服务器返回了 HTML 响应，请检查 API 路由配置。状态码: ${response.status}`
      } else {
        errorMessage = errorText || errorMessage
      }
    }
    throw new Error(errorMessage)
  }

  // 检查 Content-Type 确保是 JSON
  const contentType = response.headers.get('content-type')
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text()
    throw new Error(`服务器返回了非 JSON 响应: ${contentType}. 响应内容: ${text.substring(0, 100)}`)
  }

  return response.json()
}

// === 仪表盘 API ===

export interface CoreMetrics {
  today: {
    spend: number
    impressions: number
    clicks: number
    installs: number
    ctr: number
    cpm: number
    cpc: number
    cpi: number
    roas: number
  }
  yesterday: {
    spend: number
    impressions: number
    clicks: number
    installs: number
  }
  sevenDays: {
    spend: number
    impressions: number
    clicks: number
    installs: number
    avgDailySpend: number
  }
}

export interface SpendTrendData {
  date: string
  spend: number
  impressions: number
  clicks: number
}

export interface CampaignRankingData {
  campaignId: string
  campaignName?: string
  spend: number
  impressions: number
  clicks: number
  installs: number
  purchase_value: number
}

export interface AccountRankingData {
  accountId: string
  accountName?: string
  spend: number
  impressions: number
  clicks: number
  installs: number
  purchase_value: number
}

// 获取核心指标 (使用 Summary API)
export async function getCoreMetrics(_startDate?: string, endDate?: string): Promise<{ success: boolean; data: CoreMetrics }> {
  // 获取今天、昨天、最近7天的汇总数据
  const today = endDate || new Date().toISOString().split('T')[0]
  // 安全计算昨天日期，避免时区问题
  const todayParts = today.split('-').map(Number)
  const todayDate = new Date(todayParts[0], todayParts[1] - 1, todayParts[2])
  todayDate.setDate(todayDate.getDate() - 1)
  const yesterday = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`
  
  const [todayRes, yesterdayRes, trendRes] = await Promise.all([
    fetch(`${API_BASE_URL}/api/summary/dashboard?date=${today}`),
    fetch(`${API_BASE_URL}/api/summary/dashboard?date=${yesterday}`),
    fetch(`${API_BASE_URL}/api/summary/dashboard/trend?days=7`)
  ])

  if (!todayRes.ok) {
    throw new Error('Failed to fetch today metrics')
  }

  const todayData = await todayRes.json()
  const yesterdayData = yesterdayRes.ok ? await yesterdayRes.json() : { data: {} }
  const trendData = trendRes.ok ? await trendRes.json() : { data: [] }
  
  // 转换为前端期望的格式
  const mapData = (summary: any) => ({
    spend: summary?.totalSpend || 0,
    impressions: summary?.totalImpressions || 0,
    clicks: summary?.totalClicks || 0,
    installs: summary?.totalInstalls || 0,
    ctr: (summary?.ctr || 0) / 100,
    cpm: summary?.cpm || 0,
    cpc: summary?.cpc || 0,
    cpi: summary?.cpi || 0,
    roas: summary?.roas || 0,
  })
  
  // 计算7天总计
  const trendDataArray = trendData.data || []
  const sevenDaysSummary = trendDataArray.reduce((acc: any, day: any) => ({
    spend: acc.spend + (day.totalSpend || 0),
    impressions: acc.impressions + (day.totalImpressions || 0),
    clicks: acc.clicks + (day.totalClicks || 0),
    installs: acc.installs + (day.totalInstalls || 0),
  }), { spend: 0, impressions: 0, clicks: 0, installs: 0 })
  
  // 计算日均
  const dayCount = trendDataArray.length || 1
  sevenDaysSummary.avgDailySpend = sevenDaysSummary.spend / dayCount

  return {
    success: true,
    data: {
      today: mapData(todayData.data),
      yesterday: mapData(yesterdayData.data),
      sevenDays: sevenDaysSummary,
    }
  }
}

// 获取消耗趋势 (使用 Summary API)
export async function getSpendTrend(startDate?: string, endDate?: string): Promise<{ success: boolean; data: SpendTrendData[] }> {
  const queryParams = new URLSearchParams()
  
  // 计算天数
  const start = startDate ? new Date(startDate) : new Date()
  const end = endDate ? new Date(endDate) : new Date()
  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
  
  queryParams.append('days', days.toString())

  const url = `${API_BASE_URL}/api/summary/dashboard/trend${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`

  const response = await authFetch(url)
  if (!response.ok) {
    throw new Error('Failed to fetch spend trend')
  }

  const result = await response.json()
  
  // 转换数据格式
  const trendData = (result.data || []).map((day: any) => ({
    date: day.date,
    spend: day.totalSpend || 0,
    impressions: day.totalImpressions || 0,
    clicks: day.totalClicks || 0,
  }))
  
  return {
    success: true,
    data: trendData
  }
}

// 获取 Campaign 消耗排行 (使用 Summary API)
export async function getCampaignRanking(limit = 10, startDate?: string, endDate?: string): Promise<{ success: boolean; data: CampaignRankingData[] }> {
  const queryParams = new URLSearchParams()
  queryParams.append('limit', limit.toString())
  queryParams.append('sortBy', 'spend')
  queryParams.append('order', 'desc')
  if (startDate) queryParams.append('startDate', startDate)
  if (endDate) queryParams.append('endDate', endDate)

  const url = `${API_BASE_URL}/api/summary/campaigns?${queryParams.toString()}`

  const response = await authFetch(url)
  if (!response.ok) {
    throw new Error('Failed to fetch campaign ranking')
  }
  
  const result = await response.json()
  
  // 转换数据格式
  const campaigns = (result.data || []).map((c: any) => ({
    campaignId: c.campaignId || c.id,
    campaignName: c.campaignName || c.name,
    spend: c.spend || 0,
    impressions: c.impressions || 0,
    clicks: c.clicks || 0,
    installs: c.installs || c.mobile_app_install || 0,
    purchase_value: c.revenue || c.purchase_value || 0,
  }))
  
  return {
    success: true,
    data: campaigns
  }
}

// 获取账户消耗排行 (使用 Summary API)
export async function getAccountRanking(limit = 10, startDate?: string, endDate?: string): Promise<{ success: boolean; data: AccountRankingData[] }> {
  const queryParams = new URLSearchParams()
  queryParams.append('limit', limit.toString())
  queryParams.append('sortBy', 'periodSpend')
  queryParams.append('order', 'desc')
  if (startDate) queryParams.append('startDate', startDate)
  if (endDate) queryParams.append('endDate', endDate)

  const url = `${API_BASE_URL}/api/summary/accounts?${queryParams.toString()}`

  const response = await authFetch(url)
  if (!response.ok) {
    throw new Error('Failed to fetch account ranking')
  }
  
  const result = await response.json()
  
  // 转换数据格式
  const accounts = (result.data || []).map((a: any) => ({
    accountId: a.accountId,
    accountName: a.name || a.accountName,
    spend: a.periodSpend || a.spend || 0,
    impressions: a.periodImpressions || a.impressions || 0,
    clicks: a.periodClicks || a.clicks || 0,
    installs: a.periodInstalls || a.installs || 0,
    purchase_value: a.periodRevenue || a.purchase_value || 0,
  }))
  
  return {
    success: true,
    data: accounts
  }
}

// === 用户设置 (自定义列) ===

export interface UserSettingsResponse {
  success: boolean
  data: string[]
  message?: string
}

// 获取用户自定义列设置
export async function getCampaignColumnSettings(): Promise<UserSettingsResponse> {
  const response = await authFetch(`${API_BASE_URL}/api/user-settings/campaign-columns`)

  if (!response.ok) {
    const errorText = await response.text()
    let errorMessage = 'Failed to fetch campaign column settings'
    try {
      const errorJson = JSON.parse(errorText)
      errorMessage = errorJson.message || errorMessage
    } catch {
      if (errorText.includes('<!DOCTYPE')) {
        errorMessage = `服务器返回了 HTML 响应，请检查 API 路由配置。状态码: ${response.status}`
      } else {
        errorMessage = errorText || errorMessage
      }
    }
    throw new Error(errorMessage)
  }

  // 检查 Content-Type 确保是 JSON
  const contentType = response.headers.get('content-type')
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text()
    throw new Error(`服务器返回了非 JSON 响应: ${contentType}. 响应内容: ${text.substring(0, 100)}`)
  }

  return response.json()
}

// 保存用户自定义列设置
export async function saveCampaignColumnSettings(columns: string[]): Promise<UserSettingsResponse> {
  const response = await authFetch(`${API_BASE_URL}/api/user-settings/campaign-columns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columns }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    let errorMessage = 'Failed to save campaign column settings'
    try {
      const errorJson = JSON.parse(errorText)
      errorMessage = errorJson.message || errorMessage
    } catch {
      if (errorText.includes('<!DOCTYPE')) {
        errorMessage = `服务器返回了 HTML 响应，请检查 API 路由配置。状态码: ${response.status}`
      } else {
        errorMessage = errorText || errorMessage
      }
    }
    throw new Error(errorMessage)
  }

  // 检查 Content-Type 确保是 JSON
  const contentType = response.headers.get('content-type')
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text()
    throw new Error(`服务器返回了非 JSON 响应: ${contentType}. 响应内容: ${text.substring(0, 100)}`)
  }

  return response.json()
}


// === Token Pool & Permissions ===

export interface PurchaseValueInfo {
  today: number
  yesterday: number
  last7d: number
  corrected: number
  lastUpdated: string
}

// 获取 Purchase 值信息（用于 Tooltip）
export async function getPurchaseValueInfo(params: {
  campaignId: string
  date: string
  country?: string
}): Promise<{ success: boolean; data: PurchaseValueInfo }> {
  const queryParams = new URLSearchParams()
  queryParams.append('campaignId', params.campaignId)
  queryParams.append('date', params.date)
  if (params.country) queryParams.append('country', params.country)

  const response = await authFetch(`${API_BASE_URL}/api/facebook/purchase-value-info?${queryParams.toString()}`)

  if (!response.ok) {
    throw new Error('Failed to fetch purchase value info')
  }

  return response.json()
}

// === Facebook OAuth ===

export interface OAuthConfig {
  configured: boolean
  missing: string[]
  redirectUri: string
}

// 获取 OAuth 配置状态
export async function getOAuthConfig(): Promise<{ success: boolean; data: OAuthConfig }> {
  const response = await authFetch(`${API_BASE_URL}/api/facebook/oauth/config`)

  if (!response.ok) {
    throw new Error('Failed to get OAuth config')
  }

  return response.json()
}

// 获取 Facebook 登录 URL
export async function getFacebookLoginUrl(state?: string): Promise<{ success: boolean; data: { loginUrl: string } }> {
  const queryParams = new URLSearchParams()
  if (state) queryParams.append('state', state)

  const url = `${API_BASE_URL}/api/facebook/oauth/login-url${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`

  const response = await authFetch(url)

  if (!response.ok) {
    throw new Error('Failed to get Facebook login URL')
  }

  return response.json()
}

// === 素材数据分析 ===

export interface MaterialMetric {
  materialKey: string
  materialId?: string
  materialType: 'image' | 'video'
  materialName?: string
  thumbnailUrl?: string
  localStorageUrl?: string  // R2 存储的 URL（优先使用）
  originalUrl?: string      // Facebook 原始 URL
  imageHash?: string
  videoId?: string
  fingerprint?: string
  hasLocalMaterial?: boolean
  localMaterialId?: string
  creativeId?: string
  
  spend: number
  impressions: number
  clicks: number
  purchaseValue: number
  installs: number
  purchases: number
  
  roas: number
  ctr: number
  cpi: number
  qualityScore: number
  
  daysActive: number
  uniqueAdsCount: number
  uniqueCampaignsCount: number
  optimizers: string[]
}

export interface MaterialRankingsResponse {
  success: boolean
  data: MaterialMetric[]
  query: {
    startDate: string
    endDate: string
    sortBy: string
    limit: string
    type?: string
  }
}

// 获取素材排行榜
export async function getMaterialRankings(params?: {
  startDate?: string
  endDate?: string
  sortBy?: 'roas' | 'spend' | 'qualityScore' | 'impressions'
  limit?: number
  type?: 'image' | 'video'
  country?: string  // 🌍 新增：国家筛选
}): Promise<MaterialRankingsResponse> {
  const queryParams = new URLSearchParams()
  if (params?.startDate) queryParams.append('startDate', params.startDate)
  if (params?.endDate) queryParams.append('endDate', params.endDate)
  if (params?.sortBy) queryParams.append('sortBy', params.sortBy)
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.type) queryParams.append('type', params.type)
  if (params?.country) queryParams.append('country', params.country)  // 🌍 添加国家参数

  const url = `${API_BASE_URL}/api/material-metrics/rankings${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`

  const response = await authFetch(url)

  if (!response.ok) {
    const errorText = await response.text()
    let errorMessage = 'Failed to fetch material rankings'
    try {
      const errorJson = JSON.parse(errorText)
      errorMessage = errorJson.message || errorMessage
    } catch {
      if (errorText.includes('<!DOCTYPE')) {
        errorMessage = `服务器返回了 HTML 响应，请检查 API 路由配置。状态码: ${response.status}`
      }
    }
    throw new Error(errorMessage)
  }

  return response.json()
}

// 获取素材推荐
export async function getMaterialRecommendations(params?: {
  type?: 'image' | 'video'
  minSpend?: number
  minRoas?: number
  limit?: number
}): Promise<{ success: boolean; data: { recommendations: MaterialMetric[]; criteria: any; totalFound: number } }> {
  const queryParams = new URLSearchParams()
  if (params?.type) queryParams.append('type', params.type)
  if (params?.minSpend) queryParams.append('minSpend', params.minSpend.toString())
  if (params?.minRoas) queryParams.append('minRoas', params.minRoas.toString())
  if (params?.limit) queryParams.append('limit', params.limit.toString())

  const url = `${API_BASE_URL}/api/material-metrics/recommendations${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`

  const response = await authFetch(url)
  if (!response.ok) throw new Error('Failed to fetch material recommendations')
  return response.json()
}

// 获取表现下滑的素材
export async function getDecliningMaterials(params?: {
  minSpend?: number
  declineThreshold?: number
  limit?: number
}): Promise<{ success: boolean; data: { decliningMaterials: any[]; threshold: any } }> {
  const queryParams = new URLSearchParams()
  if (params?.minSpend) queryParams.append('minSpend', params.minSpend.toString())
  if (params?.declineThreshold) queryParams.append('declineThreshold', params.declineThreshold.toString())
  if (params?.limit) queryParams.append('limit', params.limit.toString())

  const url = `${API_BASE_URL}/api/material-metrics/declining${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`

  const response = await authFetch(url)
  if (!response.ok) throw new Error('Failed to fetch declining materials')
  return response.json()
}

// 触发素材数据聚合
export async function aggregateMaterialMetrics(date?: string): Promise<{ success: boolean; data: any; message: string }> {
  const response = await authFetch(`${API_BASE_URL}/api/material-metrics/aggregate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date }),
  })

  if (!response.ok) throw new Error('Failed to aggregate material metrics')
  return response.json()
}

// 素材下载功能已移除 - 所有素材从素材库管理，通过 Ad.materialId 精准归因

// === Pixel 管理 ===

export interface FbPixel {
  id: string
  name: string
  owner_business?: {
    id: string
    name: string
  }
  is_created_by_business?: boolean
  creation_time?: string
  last_fired_time?: string
  data_use_setting?: string
  enable_automatic_matching?: boolean
  tokenId?: string
  fbUserId?: string
  fbUserName?: string
}

export interface PixelDetails extends FbPixel {
  code?: string
}

export interface PixelEvent {
  event_name: string
  event_time: number
  event_id?: string
  user_data?: any
  custom_data?: any
}

// 获取 Pixels 列表
export async function getPixels(params?: {
  tokenId?: string
  allTokens?: boolean
}): Promise<{ success: boolean; data: FbPixel[]; count: number }> {
  const queryParams = new URLSearchParams()
  if (params?.tokenId) queryParams.append('tokenId', params.tokenId)
  if (params?.allTokens) queryParams.append('allTokens', 'true')

  const url = `${API_BASE_URL}/api/facebook/pixels${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`

  const response = await authFetch(url)

  if (!response.ok) {
    throw new Error('Failed to fetch pixels')
  }

  return response.json()
}

// 获取 Pixel 详情
export async function getPixelDetails(
  pixelId: string,
  tokenId?: string
): Promise<{ success: boolean; data: PixelDetails }> {
  const queryParams = new URLSearchParams()
  if (tokenId) queryParams.append('tokenId', tokenId)

  const url = `${API_BASE_URL}/api/facebook/pixels/${pixelId}${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`

  const response = await authFetch(url)

  if (!response.ok) {
    throw new Error('Failed to fetch pixel details')
  }

  return response.json()
}

// 获取 Pixel 事件
export async function getPixelEvents(
  pixelId: string,
  tokenId?: string,
  limit?: number
): Promise<{ success: boolean; data: PixelEvent[]; count: number }> {
  const queryParams = new URLSearchParams()
  if (tokenId) queryParams.append('tokenId', tokenId)
  if (limit) queryParams.append('limit', limit.toString())

  const url = `${API_BASE_URL}/api/facebook/pixels/${pixelId}/events${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`

  const response = await authFetch(url)

  if (!response.ok) {
    throw new Error('Failed to fetch pixel events')
  }

  return response.json()
}

// ==================== 预聚合汇总 API（极速加载） ====================

// 汇总数据通用接口
export interface SummaryData {
  _id: string
  date: string
  spend: number
  revenue: number
  impressions: number
  clicks: number
  installs: number
  purchases: number
  roas: number
  ctr: number
  cpc: number
  cpm: number
  cpi: number
  lastUpdated: string
}

// 仪表盘汇总
export interface DashboardSummary extends SummaryData {
  totalSpend: number
  totalRevenue: number
  totalImpressions: number
  totalClicks: number
  totalInstalls: number
  totalPurchases: number
  activeAccounts: number
  activeCampaigns: number
  activeCountries: number
}

// 国家汇总
export interface CountrySummary extends SummaryData {
  country: string
  countryName: string
  campaignCount: number
  accountCount: number
}

// 广告系列汇总
export interface CampaignSummary extends SummaryData {
  campaignId: string
  campaignName: string
  accountId: string
  accountName: string
  status: string
  objective: string
}

// 素材汇总
export interface MaterialSummary extends SummaryData {
  materialKey: string
  materialType: 'image' | 'video'
  materialName?: string
  thumbnailUrl?: string
  localStorageUrl?: string
  qualityScore: number
  adCount: number
  campaignCount: number
  daysActive: number
}

// 获取仪表盘汇总（极速）
export async function getDashboardSummary(date?: string): Promise<{
  success: boolean
  data: DashboardSummary | null
  cached: boolean
  lastUpdated?: string
}> {
  const url = date
    ? `${API_BASE_URL}/api/summary/dashboard?date=${date}`
    : `${API_BASE_URL}/api/summary/dashboard`
  const response = await authFetch(url)
  if (!response.ok) throw new Error('Failed to fetch dashboard summary')
  return response.json()
}

// 获取仪表盘趋势
export async function getDashboardTrend(days?: number): Promise<{
  success: boolean
  data: DashboardSummary[]
  cached: boolean
}> {
  const url = days
    ? `${API_BASE_URL}/api/summary/dashboard/trend?days=${days}`
    : `${API_BASE_URL}/api/summary/dashboard/trend`
  const response = await authFetch(url)
  if (!response.ok) throw new Error('Failed to fetch dashboard trend')
  return response.json()
}

// 获取国家汇总（极速）
export async function getCountriesSummary(params?: {
  startDate?: string
  endDate?: string
  sortBy?: string
  order?: 'asc' | 'desc'
  limit?: number
  page?: number
}): Promise<{
  success: boolean
  data: CountrySummary[]
  pagination: { page: number; limit: number; total: number; pages: number }
  cached: boolean
}> {
  const queryParams = new URLSearchParams()
  if (params?.startDate) queryParams.append('startDate', params.startDate)
  if (params?.endDate) queryParams.append('endDate', params.endDate)
  if (params?.sortBy) queryParams.append('sortBy', params.sortBy)
  if (params?.order) queryParams.append('order', params.order)
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.page) queryParams.append('page', params.page.toString())

  const url = `${API_BASE_URL}/api/summary/countries${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`
  const response = await authFetch(url)
  if (!response.ok) throw new Error('Failed to fetch countries summary')
  return response.json()
}

// 获取广告系列汇总（极速）
export async function getCampaignsSummary(params?: {
  startDate?: string
  endDate?: string
  accountId?: string
  status?: string
  sortBy?: string
  order?: 'asc' | 'desc'
  limit?: number
  page?: number
}): Promise<{
  success: boolean
  data: CampaignSummary[]
  pagination: { page: number; limit: number; total: number; pages: number }
  cached: boolean
}> {
  const queryParams = new URLSearchParams()
  if (params?.startDate) queryParams.append('startDate', params.startDate)
  if (params?.endDate) queryParams.append('endDate', params.endDate)
  if (params?.accountId) queryParams.append('accountId', params.accountId)
  if (params?.status) queryParams.append('status', params.status)
  if (params?.sortBy) queryParams.append('sortBy', params.sortBy)
  if (params?.order) queryParams.append('order', params.order)
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.page) queryParams.append('page', params.page.toString())

  const url = `${API_BASE_URL}/api/summary/campaigns${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`
  const response = await authFetch(url)
  if (!response.ok) throw new Error('Failed to fetch campaigns summary')
  return response.json()
}

// 获取素材汇总（极速）
export async function getMaterialsSummary(params?: {
  startDate?: string
  endDate?: string
  type?: 'image' | 'video'
  sortBy?: string
  order?: 'asc' | 'desc'
  limit?: number
  page?: number
}): Promise<{
  success: boolean
  data: MaterialSummary[]
  pagination: { page: number; limit: number; total: number; pages: number }
  cached: boolean
}> {
  const queryParams = new URLSearchParams()
  if (params?.startDate) queryParams.append('startDate', params.startDate)
  if (params?.endDate) queryParams.append('endDate', params.endDate)
  if (params?.type) queryParams.append('type', params.type)
  if (params?.sortBy) queryParams.append('sortBy', params.sortBy)
  if (params?.order) queryParams.append('order', params.order)
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.page) queryParams.append('page', params.page.toString())

  const url = `${API_BASE_URL}/api/summary/materials${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`
  const response = await authFetch(url)
  if (!response.ok) throw new Error('Failed to fetch materials summary')
  return response.json()
}

// 获取汇总状态
export async function getSummaryStatus(): Promise<{
  success: boolean
  data: Record<string, {
    status: 'idle' | 'refreshing' | 'error'
    lastRefresh: string
    recordCount: number
    durationMs: number
    error?: string
  }>
}> {
  const response = await authFetch(`${API_BASE_URL}/api/summary/status`)
  if (!response.ok) throw new Error('Failed to fetch summary status')
  return response.json()
}

// 手动刷新汇总数据
export async function refreshSummary(params?: {
  date?: string
  type?: 'all' | 'dashboard' | 'country' | 'campaign' | 'material'
}): Promise<{
  success: boolean
  data?: any
  message: string
}> {
  const response = await authFetch(`${API_BASE_URL}/api/summary/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  })
  if (!response.ok) throw new Error('Failed to refresh summary')
  return response.json()
}

// ==================== AI 分析 API ====================

// 🤖 AI 分析单个素材
export async function analyzeMaterialWithAI(materialId: string): Promise<{
  success: boolean
  data?: {
    materialId: string
    materialName: string
    materialType: string
    metrics?: {
      spend: number
      revenue: number
      roas: number
      ctr: number
      impressions: number
      clicks: number
      daysActive: number
    }
    scores: {
      overall: number
      roas?: number
      efficiency?: number
      stability?: number
    }
    analysis: string
    strengths?: string[]
    weaknesses?: string[]
    recommendation: string
    actionItems?: string[]
    predictedTrend?: string
    aiPowered: boolean
    analyzedAt?: string
  }
  error?: string
}> {
  const response = await authFetch(`${API_BASE_URL}/api/agent/materials/${materialId}/analyze`)
  if (!response.ok) throw new Error('Failed to analyze material')
  return response.json()
}

// 🤖 获取 AI 推荐的素材操作
export async function getAIMaterialRecommendations(): Promise<{
  success: boolean
  data?: {
    summary?: string
    urgentActions?: string[]
    toScale: Array<{
      materialId: string
      materialName: string
      roas: number
      spend: number
      reason?: string
    }>
    toPause: Array<{
      materialId: string
      materialName: string
      roas: number
      spend: number
      reason?: string
    }>
    toWatch: Array<{
      materialId: string
      materialName: string
      roas: number
      spend: number
    }>
    scaleRecommendations?: string[]
    pauseRecommendations?: string[]
    optimizationTips?: string[]
    aiPowered: boolean
    analyzedAt?: string
  }
}> {
  const response = await authFetch(`${API_BASE_URL}/api/agent/materials/recommendations`)
  if (!response.ok) throw new Error('Failed to get AI recommendations')
  return response.json()
}

// 🤖 AI 对话
export async function chatWithAI(message: string, context?: any): Promise<{
  success: boolean
  data?: { response: string }
  error?: string
}> {
  const response = await authFetch(`${API_BASE_URL}/api/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context }),
  })
  if (!response.ok) throw new Error('Failed to chat with AI')
  return response.json()
}

// ==================== 🚀 预聚合表 API（高性能） ====================

/**
 * 获取今日汇总数据（预聚合表，超快）
 */
export async function getAggToday(): Promise<{ success: boolean; data: any }> {
  const response = await authFetch(`${API_BASE_URL}/api/agg/today`)
  if (!response.ok) throw new Error('Failed to fetch today data')
  return response.json()
}

/**
 * 获取每日趋势数据（预聚合表）
 */
export async function getAggDaily(startDate?: string, endDate?: string): Promise<{ success: boolean; data: any[]; meta: any }> {
  const params = new URLSearchParams()
  if (startDate) params.append('startDate', startDate)
  if (endDate) params.append('endDate', endDate)
  
  const response = await authFetch(`${API_BASE_URL}/api/agg/daily?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch daily data')
  return response.json()
}

/**
 * 获取核心指标（使用预聚合表，最近3天实时更新）
 */
export async function getAggCoreMetrics(): Promise<{ success: boolean; data: CoreMetrics }> {
  const today = new Date().toISOString().split('T')[0]
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  
  // 并行获取今日、昨日和7天数据
  const [todayRes, dailyRes] = await Promise.all([
    fetch(`${API_BASE_URL}/api/agg/today`),
    fetch(`${API_BASE_URL}/api/agg/daily?startDate=${sevenDaysAgo}&endDate=${today}`)
  ])
  
  const todayData = await todayRes.json()
  const dailyData = await dailyRes.json()
  
  // 找出昨日数据
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const yesterdayData = (dailyData.data || []).find((d: any) => d.date === yesterday) || {}
  
  // 计算7天总计
  const sevenDaysSummary = (dailyData.data || []).reduce((acc: any, day: any) => ({
    spend: acc.spend + (day.spend || 0),
    impressions: acc.impressions + (day.impressions || 0),
    clicks: acc.clicks + (day.clicks || 0),
    installs: acc.installs + (day.installs || 0),
  }), { spend: 0, impressions: 0, clicks: 0, installs: 0 })
  
  const dayCount = (dailyData.data || []).length || 1
  sevenDaysSummary.avgDailySpend = sevenDaysSummary.spend / dayCount
  
  const mapData = (d: any) => ({
    spend: d?.spend || 0,
    impressions: d?.impressions || 0,
    clicks: d?.clicks || 0,
    installs: d?.installs || 0,
    ctr: (d?.ctr || 0) / 100,
    cpm: d?.cpm || 0,
    cpc: d?.cpc || 0,
    cpi: d?.cpi || 0,
    roas: d?.roas || 0,
  })
  
  return {
    success: true,
    data: {
      today: mapData(todayData.data),
      yesterday: mapData(yesterdayData),
      sevenDays: sevenDaysSummary,
    }
  }
}

/**
 * 获取消耗和 ROAS 趋势（预聚合表）
 */
export async function getAggTrend(days: number = 7): Promise<{ success: boolean; data: any[] }> {
  const today = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  
  const response = await authFetch(`${API_BASE_URL}/api/agg/daily?startDate=${startDate}&endDate=${today}`)
  const result = await response.json()
  
  // 转换为趋势格式
  const data = (result.data || []).map((d: any) => ({
    date: d.date,
    totalSpend: d.spend,
    totalRevenue: d.revenue,
    roas: d.roas,
    impressions: d.impressions,
    clicks: d.clicks,
  })).sort((a: any, b: any) => a.date.localeCompare(b.date))
  
  return { success: true, data }
}

/**
 * 获取广告系列排行（预聚合表）
 */
export async function getAggCampaignRanking(limit: number = 10): Promise<{ success: boolean; data: any[] }> {
  const today = new Date().toISOString().split('T')[0]
  
  const response = await authFetch(`${API_BASE_URL}/api/agg/campaigns?date=${today}`)
  const result = await response.json()
  
  // 取 Top N 并转换格式
  const data = (result.data || [])
    .slice(0, limit)
    .map((c: any) => ({
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      accountName: c.accountName,
      spend: c.spend,
      roas: c.roas,
      status: c.status,
    }))
  
  return { success: true, data }
}

/**
 * 获取账户排行（预聚合表）
 */
export async function getAggAccountRanking(limit: number = 10): Promise<{ success: boolean; data: any[] }> {
  const today = new Date().toISOString().split('T')[0]
  
  const response = await authFetch(`${API_BASE_URL}/api/agg/accounts?date=${today}`)
  const result = await response.json()
  
  // 取 Top N
  const data = (result.data || [])
    .slice(0, limit)
    .map((a: any) => ({
      accountId: a.accountId,
      accountName: a.accountName,
      spend: a.spend,
      roas: a.roas,
      campaigns: a.campaigns,
    }))
  
  return { success: true, data }
}
