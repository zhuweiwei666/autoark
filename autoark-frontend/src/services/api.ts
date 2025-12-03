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
  const response = await fetch(`${API_BASE_URL}/api/fb-token`, {
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

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error('Failed to fetch tokens')
  }

  return response.json()
}

// 获取单个 token
export async function getTokenById(id: string): Promise<TokenResponse> {
  const response = await fetch(`${API_BASE_URL}/api/fb-token/${id}`)

  if (!response.ok) {
    throw new Error('Failed to fetch token')
  }

  return response.json()
}

// 检查 token 状态
export async function checkTokenStatus(id: string): Promise<TokenResponse> {
  const response = await fetch(`${API_BASE_URL}/api/fb-token/${id}/check`, {
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
  const response = await fetch(`${API_BASE_URL}/api/fb-token/${id}`, {
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
  const response = await fetch(`${API_BASE_URL}/api/fb-token/${id}`, {
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
  if (params?.startDate) queryParams.append('startDate', params.startDate)
  if (params?.endDate) queryParams.append('endDate', params.endDate)
  if (params?.optimizer) queryParams.append('optimizer', params.optimizer)
  if (params?.status) queryParams.append('status', params.status)
  if (params?.accountId) queryParams.append('accountId', params.accountId)
  if (params?.name) queryParams.append('name', params.name)

  const url = `${API_BASE_URL}/api/facebook/accounts-list${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`

  const response = await fetch(url)

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
  const response = await fetch(`${API_BASE_URL}/api/facebook/accounts/sync`, {
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

  const url = `${API_BASE_URL}/api/facebook/campaigns-list${
    queryParams.toString() ? `?${queryParams.toString()}` : ''
  }`

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error('Failed to fetch campaigns')
  }

  return response.json()
}

// 同步广告系列
export async function syncCampaigns(): Promise<{
  success: boolean
  message: string
  data: { syncedCampaigns: number; syncedMetrics: number; errorCount: number; errors?: Array<{ accountId?: string; tokenId?: string; optimizer?: string; error: string }> }
}> {
  const response = await fetch(`${API_BASE_URL}/api/facebook/campaigns/sync`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to sync campaigns')
  }

  return response.json()
}

// === 用户设置 (自定义列) ===

export interface UserSettingsResponse {
  success: boolean
  data: string[]
  message?: string
}

// 获取用户自定义列设置
export async function getCampaignColumnSettings(): Promise<UserSettingsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/user-settings/campaign-columns`)

  if (!response.ok) {
    throw new Error('Failed to fetch campaign column settings')
  }

  return response.json()
}

// 保存用户自定义列设置
export async function saveCampaignColumnSettings(columns: string[]): Promise<UserSettingsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/user-settings/campaign-columns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columns }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to save campaign column settings')
  }

  return response.json()
}

