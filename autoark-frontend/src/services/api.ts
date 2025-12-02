const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

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

