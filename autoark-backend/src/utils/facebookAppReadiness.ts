export const PUBLIC_OAUTH_REQUIRED_PERMISSIONS = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_ads',
]

export type PublicOAuthGapSeverity = 'critical' | 'warning'

export interface PublicOAuthGap {
  code: string
  label: string
  detail: string
  severity: PublicOAuthGapSeverity
}

export interface PublicOAuthReadiness {
  ready: boolean
  complianceReady: boolean
  runtimeReady: boolean
  permissionsReady: boolean
  businessLoginConfigured: boolean
  requiredPermissions: string[]
  missingPermissions: string[]
  gaps: PublicOAuthGap[]
}

export const getGlobalBusinessLoginConfigId = (): string => (
  process.env.FACEBOOK_BUSINESS_LOGIN_CONFIG_ID ||
  process.env.FACEBOOK_CONFIG_ID ||
  ''
)

const text = (value: unknown): string => String(value || '').trim()

const hasBusinessLoginConfig = (app: any, globalBusinessLoginConfigId = getGlobalBusinessLoginConfigId()): boolean => (
  Boolean(text(app?.config?.businessLoginConfigId)) || Boolean(text(globalBusinessLoginConfigId))
)

export const buildPublicOAuthReadiness = (
  app: any,
  options: { globalBusinessLoginConfigId?: string } = {},
): PublicOAuthReadiness => {
  const gaps: PublicOAuthGap[] = []
  const permissions = Array.isArray(app?.compliance?.permissions) ? app.compliance.permissions : []
  const permissionMap = new Map<string, any>(permissions.map((permission: any) => [String(permission.name), permission]))
  const missingPermissions = PUBLIC_OAUTH_REQUIRED_PERMISSIONS.filter((name) => {
    const permission = permissionMap.get(name)
    return !(permission?.access === 'advanced' && permission.status === 'approved')
  })
  const permissionsReady = missingPermissions.length === 0

  if (app?.status !== 'active') {
    gaps.push({
      code: 'APP_NOT_ACTIVE',
      label: 'App 未启用',
      detail: 'Facebook App 必须保持 active，客户才可以稳定走公开授权。',
      severity: 'critical',
    })
  }

  if (!app?.validation?.isValid) {
    gaps.push({
      code: 'APP_SECRET_NOT_VALIDATED',
      label: 'App Secret 未验证',
      detail: '先在 App 管理页点击验证，确认 App ID 和 Secret 可以换取 app token。',
      severity: 'critical',
    })
  }

  if (app?.config?.enabledForBulkAds === false) {
    gaps.push({
      code: 'BULK_AD_DISABLED',
      label: '批量广告未启用',
      detail: '该 App 被关闭了批量广告用途，不应进入客户授权或发布池。',
      severity: 'critical',
    })
  }

  if (app?.compliance?.appMode !== 'live') {
    gaps.push({
      code: 'APP_MODE_NOT_LIVE',
      label: 'App Mode 非 Live',
      detail: 'Meta Developer 后台需要把应用切到 Live，非管理员客户才可授权。',
      severity: 'critical',
    })
  }

  if (app?.compliance?.businessVerification !== 'verified') {
    gaps.push({
      code: 'BUSINESS_NOT_VERIFIED',
      label: 'Business 未验证',
      detail: '商务验证需为 verified，否则公开客户授权和 Marketing API 使用可能受限。',
      severity: 'critical',
    })
  }

  if (app?.compliance?.appReview !== 'approved') {
    gaps.push({
      code: 'APP_REVIEW_NOT_APPROVED',
      label: 'App Review 未通过',
      detail: '应用审核需为 approved，且权限状态必须为 Advanced + Approved。',
      severity: 'critical',
    })
  }

  for (const permissionName of missingPermissions) {
    const permission = permissionMap.get(permissionName)
    gaps.push({
      code: `PERMISSION_${permissionName.toUpperCase()}_NOT_READY`,
      label: `${permissionName} 未通过`,
      detail: `当前 access=${permission?.access || 'missing'}，status=${permission?.status || 'missing'}；需要 Advanced + Approved。`,
      severity: 'critical',
    })
  }

  const businessLoginConfigured = hasBusinessLoginConfig(app, options.globalBusinessLoginConfigId)
  if (!businessLoginConfigured) {
    gaps.push({
      code: 'BUSINESS_LOGIN_CONFIG_MISSING',
      label: '缺少 config_id',
      detail: '需要配置 Facebook Login for Business Configuration ID，避免退回普通 scope OAuth。',
      severity: 'critical',
    })
  }

  const complianceReady = permissionsReady &&
    app?.compliance?.appMode === 'live' &&
    app?.compliance?.businessVerification === 'verified' &&
    app?.compliance?.appReview === 'approved'
  const runtimeReady = app?.status === 'active' &&
    Boolean(app?.validation?.isValid) &&
    app?.config?.enabledForBulkAds !== false &&
    businessLoginConfigured

  return {
    ready: complianceReady && runtimeReady,
    complianceReady,
    runtimeReady,
    permissionsReady,
    businessLoginConfigured,
    requiredPermissions: PUBLIC_OAUTH_REQUIRED_PERMISSIONS,
    missingPermissions,
    gaps,
  }
}

export const computePublicOauthComplianceReady = (app: any): boolean => (
  buildPublicOAuthReadiness(app).complianceReady
)

export const computePublicOauthRuntimeReady = (
  app: any,
  options: { globalBusinessLoginConfigId?: string } = {},
): boolean => buildPublicOAuthReadiness(app, options).ready

