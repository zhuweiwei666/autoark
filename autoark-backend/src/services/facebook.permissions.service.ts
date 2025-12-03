import { fbClient } from './facebook.api'
import logger from '../utils/logger'
import FbToken from '../models/FbToken'

/**
 * Facebook Token 权限检测服务
 */
export interface PermissionCheckResult {
  permission: string
  status: 'granted' | 'denied' | 'unknown'
  message?: string
}

export interface TokenDiagnosisResult {
  tokenId: string
  fbUserId?: string
  fbUserName?: string
  permissions: PermissionCheckResult[]
  overall: 'healthy' | 'warning' | 'critical'
  recommendations: string[]
}

/**
 * 检测单个 Token 的权限
 */
export const diagnoseToken = async (tokenId: string): Promise<TokenDiagnosisResult> => {
  const tokenDoc = await FbToken.findById(tokenId)
  if (!tokenDoc) {
    throw new Error(`Token ${tokenId} not found`)
  }

  const permissions: PermissionCheckResult[] = []
  const recommendations: string[] = []

  try {
    // 1. 检测 ads_read 权限
    try {
      await fbClient.get('/me/adaccounts', {
        access_token: tokenDoc.token,
        limit: 1,
      })
      permissions.push({
        permission: 'ads_read',
        status: 'granted',
        message: 'Can read ad accounts',
      })
    } catch (error: any) {
      permissions.push({
        permission: 'ads_read',
        status: 'denied',
        message: error?.response?.data?.error?.message || 'Cannot read ad accounts',
      })
      recommendations.push('Grant ads_read permission to this token')
    }

    // 2. 检测 ads_management 权限
    try {
      // 尝试获取一个广告账户的 campaigns（需要 ads_management）
      const accounts = await fbClient.get('/me/adaccounts', {
        access_token: tokenDoc.token,
        limit: 1,
      })
      if (accounts.data && accounts.data.length > 0) {
        const accountId = accounts.data[0].id
        await fbClient.get(`/${accountId}/campaigns`, {
          access_token: tokenDoc.token,
          limit: 1,
        })
        permissions.push({
          permission: 'ads_management',
          status: 'granted',
          message: 'Can manage ads',
        })
      } else {
        permissions.push({
          permission: 'ads_management',
          status: 'unknown',
          message: 'No ad accounts found to test',
        })
      }
    } catch (error: any) {
      permissions.push({
        permission: 'ads_management',
        status: 'denied',
        message: error?.response?.data?.error?.message || 'Cannot manage ads',
      })
      recommendations.push('Grant ads_management permission to this token')
    }

    // 3. 检测 business_management 权限
    try {
      await fbClient.get('/me/businesses', {
        access_token: tokenDoc.token,
        limit: 1,
      })
      permissions.push({
        permission: 'business_management',
        status: 'granted',
        message: 'Can access Business Manager',
      })
    } catch (error: any) {
      permissions.push({
        permission: 'business_management',
        status: 'denied',
        message: error?.response?.data?.error?.message || 'Cannot access Business Manager',
      })
      recommendations.push('Grant business_management permission to this token')
    }

    // 4. 检测 pixel read 权限
    try {
      await fbClient.get('/me/pixels', {
        access_token: tokenDoc.token,
        limit: 1,
      })
      permissions.push({
        permission: 'pixel_read',
        status: 'granted',
        message: 'Can read pixels',
      })
    } catch (error: any) {
      permissions.push({
        permission: 'pixel_read',
        status: 'denied',
        message: error?.response?.data?.error?.message || 'Cannot read pixels',
      })
      recommendations.push('Grant pixel read permission to access purchase data')
    }

    // 5. 检测 pixel write 权限（尝试获取 pixel 列表，如果有写权限通常也能读）
    try {
      const pixels = await fbClient.get('/me/pixels', {
        access_token: tokenDoc.token,
        limit: 1,
      })
      // 如果能读取 pixels，假设有写权限（实际测试写权限需要更复杂的操作）
      permissions.push({
        permission: 'pixel_write',
        status: 'granted',
        message: 'Can manage pixels (assumed from read access)',
      })
    } catch (error: any) {
      permissions.push({
        permission: 'pixel_write',
        status: 'denied',
        message: error?.response?.data?.error?.message || 'Cannot manage pixels',
      })
      recommendations.push('Grant pixel write permission for offline conversions')
    }

    // 6. 检测 event access 权限（通过尝试获取 insights 数据）
    try {
      const accounts = await fbClient.get('/me/adaccounts', {
        access_token: tokenDoc.token,
        limit: 1,
      })
      if (accounts.data && accounts.data.length > 0) {
        const accountId = accounts.data[0].id
        await fbClient.get(`/${accountId}/insights`, {
          access_token: tokenDoc.token,
          level: 'account',
          date_preset: 'today',
          fields: 'impressions,clicks,spend',
          limit: 1,
        })
        permissions.push({
          permission: 'event_access',
          status: 'granted',
          message: 'Can access event data (insights)',
        })
      } else {
        permissions.push({
          permission: 'event_access',
          status: 'unknown',
          message: 'No ad accounts found to test',
        })
      }
    } catch (error: any) {
      permissions.push({
        permission: 'event_access',
        status: 'denied',
        message: error?.response?.data?.error?.message || 'Cannot access event data',
      })
      recommendations.push('Grant event access permission to read insights')
    }

    // 7. 检测 offline conversions 权限（通过 pixel 访问推断）
    const pixelRead = permissions.find((p) => p.permission === 'pixel_read')
    if (pixelRead?.status === 'granted') {
      permissions.push({
        permission: 'offline_conversions',
        status: 'granted',
        message: 'Can access offline conversions (inferred from pixel access)',
      })
    } else {
      permissions.push({
        permission: 'offline_conversions',
        status: 'denied',
        message: 'Cannot access offline conversions',
      })
      recommendations.push('Grant offline conversions permission for complete purchase tracking')
    }

    // 8. 检测 app-level permissions（通过 /me/permissions）
    try {
      const permissionsData = await fbClient.get('/me/permissions', {
        access_token: tokenDoc.token,
      })
      permissions.push({
        permission: 'app_permissions',
        status: 'granted',
        message: `App permissions: ${JSON.stringify(permissionsData.data || [])}`,
      })
    } catch (error: any) {
      permissions.push({
        permission: 'app_permissions',
        status: 'unknown',
        message: 'Cannot check app permissions',
      })
    }

    // 计算整体健康状态
    const deniedCount = permissions.filter((p) => p.status === 'denied').length
    const criticalPermissions = ['ads_read', 'ads_management', 'event_access']
    const criticalDenied = permissions.filter(
      (p) => criticalPermissions.includes(p.permission) && p.status === 'denied'
    ).length

    let overall: 'healthy' | 'warning' | 'critical'
    if (criticalDenied > 0) {
      overall = 'critical'
    } else if (deniedCount > 2) {
      overall = 'warning'
    } else {
      overall = 'healthy'
    }

    // 检查 purchase 相关权限
    const pixelReadStatus = permissions.find((p) => p.permission === 'pixel_read')?.status
    if (pixelReadStatus !== 'granted') {
      recommendations.push(
        '⚠️ Purchase data may be incomplete: Grant pixel_read permission to access purchase events'
      )
    }

    return {
      tokenId: tokenDoc._id.toString(),
      fbUserId: tokenDoc.fbUserId,
      fbUserName: tokenDoc.fbUserName,
      permissions,
      overall,
      recommendations,
    }
  } catch (error: any) {
    logger.error(`[Permissions] Failed to diagnose token ${tokenId}:`, error)
    throw error
  }
}

/**
 * 诊断所有 Token
 */
export const diagnoseAllTokens = async (): Promise<TokenDiagnosisResult[]> => {
  const tokens = await FbToken.find({ status: 'active' }).lean()
  const results: TokenDiagnosisResult[] = []

  for (const token of tokens) {
    try {
      const result = await diagnoseToken(token._id.toString())
      results.push(result)
    } catch (error: any) {
      logger.error(`[Permissions] Failed to diagnose token ${token._id}:`, error)
      results.push({
        tokenId: token._id.toString(),
        fbUserId: token.fbUserId,
        fbUserName: token.fbUserName,
        permissions: [],
        overall: 'critical',
        recommendations: [`Failed to diagnose: ${error.message}`],
      })
    }
  }

  return results
}

