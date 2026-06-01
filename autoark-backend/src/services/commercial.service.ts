import Account from '../models/Account'
import AdDraft from '../models/AdDraft'
import AdTask from '../models/AdTask'
import FacebookApp from '../models/FacebookApp'
import FbToken from '../models/FbToken'
import Material from '../models/Material'
import Organization, {
  IOrganization,
  OrganizationBillingStatus,
  OrganizationPlan,
  OrganizationStatus,
} from '../models/Organization'
import User, { UserRole, UserStatus } from '../models/User'
import { JwtPayload } from '../utils/jwt'
import { objectIdValue } from '../utils/accessControl'

type ChecklistStatus = 'done' | 'warning' | 'pending' | 'blocked'
type ScopeMode = 'organization' | 'platform'

export const COMMERCIAL_FEATURES = [
  'facebook_oauth',
  'bulk_ad_create',
  'material_library',
  'asset_sync',
  'review_tracking',
  'automation_agent',
  'team_management',
  'audit_ready',
]

export const PLAN_DEFAULTS: Record<OrganizationPlan, {
  label: string
  limits: {
    maxMembers: number | null
    maxAdAccounts: number | null
    maxMaterials: number | null
    maxConcurrentTasks: number | null
    monthlyTaskLimit: number | null
  }
  features: string[]
}> = {
  [OrganizationPlan.TRIAL]: {
    label: '试用版',
    limits: {
      maxMembers: 3,
      maxAdAccounts: 3,
      maxMaterials: 100,
      maxConcurrentTasks: 1,
      monthlyTaskLimit: 20,
    },
    features: ['facebook_oauth', 'bulk_ad_create', 'material_library', 'team_management'],
  },
  [OrganizationPlan.STARTER]: {
    label: '标准版',
    limits: {
      maxMembers: 10,
      maxAdAccounts: 15,
      maxMaterials: 1000,
      maxConcurrentTasks: 3,
      monthlyTaskLimit: 300,
    },
    features: ['facebook_oauth', 'bulk_ad_create', 'material_library', 'asset_sync', 'team_management'],
  },
  [OrganizationPlan.GROWTH]: {
    label: '增长版',
    limits: {
      maxMembers: 30,
      maxAdAccounts: 80,
      maxMaterials: 8000,
      maxConcurrentTasks: 8,
      monthlyTaskLimit: 3000,
    },
    features: [
      'facebook_oauth',
      'bulk_ad_create',
      'material_library',
      'asset_sync',
      'review_tracking',
      'automation_agent',
      'team_management',
      'audit_ready',
    ],
  },
  [OrganizationPlan.ENTERPRISE]: {
    label: '企业版',
    limits: {
      maxMembers: null,
      maxAdAccounts: null,
      maxMaterials: null,
      maxConcurrentTasks: null,
      monthlyTaskLimit: null,
    },
    features: COMMERCIAL_FEATURES,
  },
}

const monthStart = () => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

const scoped = (organizationId?: string) => {
  return organizationId ? { organizationId: objectIdValue(organizationId) } : {}
}

const getEffectivePlan = (organization?: IOrganization | null): OrganizationPlan => {
  return (organization?.billing?.plan as OrganizationPlan) || OrganizationPlan.TRIAL
}

const getEffectiveLimits = (organization?: IOrganization | null) => {
  const plan = getEffectivePlan(organization)
  const defaults = PLAN_DEFAULTS[plan].limits
  const settings = organization?.settings || {}

  return {
    maxMembers: settings.maxMembers ?? defaults.maxMembers,
    maxAdAccounts: settings.maxAdAccounts ?? defaults.maxAdAccounts,
    maxMaterials: settings.maxMaterials ?? defaults.maxMaterials,
    maxConcurrentTasks: settings.maxConcurrentTasks ?? defaults.maxConcurrentTasks,
    monthlyTaskLimit: settings.monthlyTaskLimit ?? defaults.monthlyTaskLimit,
  }
}

const getEffectiveFeatures = (organization?: IOrganization | null) => {
  const plan = getEffectivePlan(organization)
  const configured = organization?.settings?.features || []
  return configured.length > 0 ? configured : PLAN_DEFAULTS[plan].features
}

const limitState = (used: number, limit: number | null) => {
  if (!limit) return { used, limit, percent: null, status: 'ok' }
  const percent = Math.round((used / limit) * 100)
  return {
    used,
    limit,
    percent,
    status: used > limit ? 'exceeded' : percent >= 85 ? 'warning' : 'ok',
  }
}

const step = (
  id: string,
  title: string,
  description: string,
  status: ChecklistStatus,
  actionPath?: string,
  metric?: string,
) => ({ id, title, description, status, actionPath, metric })

const computeScore = (items: Array<{ status: ChecklistStatus }>) => {
  const score = items.reduce((total, item) => {
    if (item.status === 'done') return total + 1
    if (item.status === 'warning') return total + 0.5
    return total
  }, 0)

  return Math.round((score / Math.max(items.length, 1)) * 100)
}

export class CommercialLimitError extends Error {
  code: string
  statusCode: number
  details?: Record<string, any>

  constructor(code: string, message: string, statusCode = 403, details?: Record<string, any>) {
    super(message)
    this.name = 'CommercialLimitError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }
}

export async function assertBulkAdPublishAllowed({
  organizationId,
  requestedAccounts = 1,
}: {
  organizationId?: string
  requestedAccounts?: number
}) {
  if (!organizationId) {
    return {
      allowed: true,
      plan: OrganizationPlan.ENTERPRISE,
      billingStatus: OrganizationBillingStatus.ACTIVE,
      limits: PLAN_DEFAULTS[OrganizationPlan.ENTERPRISE].limits,
    }
  }

  const organization = await Organization.findById(organizationId)
  if (!organization) {
    throw new CommercialLimitError('ORGANIZATION_NOT_FOUND', '组织不存在或已被移除，无法发布任务。', 403)
  }

  if (organization.status !== OrganizationStatus.ACTIVE) {
    throw new CommercialLimitError(
      'ORGANIZATION_NOT_ACTIVE',
      '当前组织未启用，无法发布新的批量广告任务。',
      403,
      { organizationStatus: organization.status },
    )
  }

  const plan = getEffectivePlan(organization)
  const billingStatus = organization.billing?.status || (
    plan === OrganizationPlan.TRIAL
      ? OrganizationBillingStatus.TRIALING
      : OrganizationBillingStatus.ACTIVE
  )
  if ([
    OrganizationBillingStatus.PAST_DUE,
    OrganizationBillingStatus.PAUSED,
    OrganizationBillingStatus.CANCELED,
  ].includes(billingStatus)) {
    throw new CommercialLimitError(
      'BILLING_NOT_ACTIVE',
      '当前组织账单状态不可用，请处理续费或账单问题后再发布任务。',
      402,
      { billingStatus, plan },
    )
  }

  const limits = getEffectiveLimits(organization)
  const requestedAccountCount = Math.max(1, Number(requestedAccounts) || 1)

  if (limits.maxAdAccounts && requestedAccountCount > limits.maxAdAccounts) {
    throw new CommercialLimitError(
      'TASK_ACCOUNT_LIMIT_EXCEEDED',
      `本次选择了 ${requestedAccountCount} 个广告账户，超过当前套餐单次可发布账户额度 ${limits.maxAdAccounts}。`,
      403,
      { requestedAccounts: requestedAccountCount, limit: limits.maxAdAccounts, plan },
    )
  }

  const orgFilter = scoped(organizationId)
  const [runningTaskCount, monthlyTaskCount] = await Promise.all([
    AdTask.countDocuments({ ...orgFilter, status: { $in: ['pending', 'queued', 'processing'] } }),
    AdTask.countDocuments({ ...orgFilter, createdAt: { $gte: monthStart() } }),
  ])

  if (limits.maxConcurrentTasks && runningTaskCount >= limits.maxConcurrentTasks) {
    throw new CommercialLimitError(
      'MAX_CONCURRENT_TASKS_REACHED',
      `当前已有 ${runningTaskCount} 个任务在执行，已达到当前套餐并发额度 ${limits.maxConcurrentTasks}。请等待任务完成后再发布。`,
      429,
      { runningTaskCount, limit: limits.maxConcurrentTasks, plan },
    )
  }

  if (limits.monthlyTaskLimit && monthlyTaskCount >= limits.monthlyTaskLimit) {
    throw new CommercialLimitError(
      'MONTHLY_TASK_LIMIT_REACHED',
      `本月已发布 ${monthlyTaskCount} 个任务，已达到当前套餐月度任务额度 ${limits.monthlyTaskLimit}。`,
      403,
      { monthlyTaskCount, limit: limits.monthlyTaskLimit, plan },
    )
  }

  return {
    allowed: true,
    plan,
    billingStatus,
    limits,
    usage: {
      runningTaskCount,
      monthlyTaskCount,
      requestedAccounts: requestedAccountCount,
    },
  }
}

const resolveScope = async (
  user: JwtPayload,
  requestedOrganizationId?: string,
): Promise<{ mode: ScopeMode; organizationId?: string; organization: IOrganization | null }> => {
  if (user.role === UserRole.SUPER_ADMIN && !requestedOrganizationId) {
    return { mode: 'platform', organization: null }
  }

  const organizationId = user.role === UserRole.SUPER_ADMIN
    ? requestedOrganizationId
    : user.organizationId

  if (!organizationId) {
    throw new Error('当前用户未关联组织')
  }

  const organization = await Organization.findById(organizationId)
  if (!organization) {
    throw new Error('组织不存在')
  }

  if (user.role !== UserRole.SUPER_ADMIN && user.organizationId !== organizationId) {
    throw new Error('无权访问该组织')
  }

  return { mode: 'organization', organizationId, organization }
}

export async function getCommercialReadiness(
  user: JwtPayload,
  requestedOrganizationId?: string,
) {
  const { mode, organizationId, organization } = await resolveScope(user, requestedOrganizationId)
  const orgFilter = scoped(organizationId)
  const thisMonth = monthStart()

  const [
    memberCount,
    activeUserCount,
    adAccountCount,
    activeTokenCount,
    materialCount,
    draftCount,
    taskCount,
    successfulTaskCount,
    runningTaskCount,
    failedTaskCount,
    monthlyTaskCount,
    publicOauthAppCount,
    healthyAppCount,
  ] = await Promise.all([
    User.countDocuments(mode === 'organization' ? { organizationId: objectIdValue(organizationId) } : {}),
    User.countDocuments(mode === 'organization'
      ? { organizationId: objectIdValue(organizationId), status: UserStatus.ACTIVE }
      : { status: UserStatus.ACTIVE }),
    Account.countDocuments({ ...orgFilter, status: { $ne: 'disabled' } }),
    FbToken.countDocuments({ ...orgFilter, status: 'active' }),
    Material.countDocuments({ ...orgFilter, status: { $ne: 'deleted' } }),
    AdDraft.countDocuments(orgFilter),
    AdTask.countDocuments(orgFilter),
    AdTask.countDocuments({ ...orgFilter, status: { $in: ['success', 'partial_success'] } }),
    AdTask.countDocuments({ ...orgFilter, status: { $in: ['pending', 'queued', 'processing'] } }),
    AdTask.countDocuments({ ...orgFilter, status: 'failed' }),
    AdTask.countDocuments({ ...orgFilter, createdAt: { $gte: thisMonth } }),
    FacebookApp.countDocuments({
      status: 'active',
      'validation.isValid': true,
      'compliance.publicOauthReady': true,
    }),
    FacebookApp.countDocuments({
      status: 'active',
      'validation.isValid': true,
    }),
  ])

  const plan = mode === 'platform' ? OrganizationPlan.ENTERPRISE : getEffectivePlan(organization)
  const limits = mode === 'platform' ? PLAN_DEFAULTS[OrganizationPlan.ENTERPRISE].limits : getEffectiveLimits(organization)
  const features = mode === 'platform' ? COMMERCIAL_FEATURES : getEffectiveFeatures(organization)
  const billingStatus = mode === 'platform' ? OrganizationBillingStatus.ACTIVE : organization?.billing?.status || (
    plan === OrganizationPlan.TRIAL
      ? OrganizationBillingStatus.TRIALING
      : OrganizationBillingStatus.ACTIVE
  )

  const usage = {
    members: limitState(memberCount, limits.maxMembers),
    adAccounts: limitState(adAccountCount, limits.maxAdAccounts),
    materials: limitState(materialCount, limits.maxMaterials),
    monthlyTasks: limitState(monthlyTaskCount, limits.monthlyTaskLimit),
    concurrentTasks: limitState(runningTaskCount, limits.maxConcurrentTasks),
  }

  const checklist = [
    step(
      'organization',
      mode === 'platform' ? '平台管理模式' : '组织已启用',
      mode === 'platform' ? '超级管理员可查看全平台商用状态。' : '组织处于可服务状态，用户可以登录使用。',
      mode === 'platform' || organization?.status === OrganizationStatus.ACTIVE ? 'done' : 'blocked',
      mode === 'platform' ? '/organizations' : '/users',
      mode === 'platform' ? `${activeUserCount} 个活跃用户` : organization?.status,
    ),
    step(
      'public_oauth_app',
      'Facebook 公开授权 App',
      '需要至少一个 Live、验证通过且权限 Advanced + Approved 的 Facebook App。',
      publicOauthAppCount > 0 ? 'done' : healthyAppCount > 0 ? 'warning' : 'blocked',
      '/fb-apps',
      `${publicOauthAppCount}/${healthyAppCount} 可公开授权`,
    ),
    step(
      'facebook_authorization',
      '客户 Facebook 授权',
      '客户完成 OAuth 授权后，AutoArk 才能读取广告账户、Page 和 Pixel。',
      activeTokenCount > 0 ? 'done' : 'blocked',
      '/bulk-ad/create',
      `${activeTokenCount} 个活跃授权`,
    ),
    step(
      'ad_accounts',
      '广告账户可用',
      '组织需要至少一个已同步且可投放的广告账户。',
      adAccountCount > 0 ? 'done' : activeTokenCount > 0 ? 'pending' : 'blocked',
      '/fb-accounts',
      `${adAccountCount} 个账户`,
    ),
    step(
      'materials',
      '素材库准备',
      '批量创建广告前，需要先上传或导入可投放素材。',
      materialCount > 0 ? 'done' : 'pending',
      '/bulk-ad/materials',
      `${materialCount} 个素材`,
    ),
    step(
      'draft_flow',
      '投放流程跑通',
      '至少创建过一个广告草稿或任务，表示工作台已开始使用。',
      draftCount > 0 || taskCount > 0 ? 'done' : 'pending',
      '/bulk-ad/create',
      `${draftCount} 草稿 / ${taskCount} 任务`,
    ),
    step(
      'successful_publish',
      '真实任务成功',
      '至少一次任务成功或部分成功，才算完成商用闭环。',
      successfulTaskCount > 0 ? 'done' : taskCount > 0 ? 'warning' : 'pending',
      '/bulk-ad/tasks',
      `${successfulTaskCount} 个成功任务`,
    ),
    step(
      'team',
      '团队账号',
      '商用客户应有组织管理员与成员账号，便于权限和责任归属。',
      memberCount >= 2 ? 'done' : mode === 'platform' ? 'done' : 'warning',
      '/users',
      `${memberCount} 个成员`,
    ),
  ]

  const risks: Array<{ level: 'critical' | 'warning' | 'info'; message: string; actionPath?: string }> = []
  if (publicOauthAppCount === 0) {
    risks.push({
      level: 'critical',
      message: '没有可公开授权的 Facebook App，客户授权可能会失败或只对管理员可用。',
      actionPath: '/fb-apps',
    })
  }
  if (mode === 'organization' && activeTokenCount === 0) {
    risks.push({
      level: 'critical',
      message: '该组织还没有活跃 Facebook 授权，无法拉取资产或创建广告。',
      actionPath: '/bulk-ad/create',
    })
  }
  if (!process.env.OAUTH_STATE_SECRET) {
    risks.push({
      level: 'warning',
      message: '生产建议配置 OAUTH_STATE_SECRET，避免 OAuth state 只依赖兜底密钥。',
    })
  }
  for (const [key, value] of Object.entries(usage)) {
    if (value.status === 'exceeded') {
      risks.push({ level: 'critical', message: `${key} 已超过当前套餐额度。` })
    } else if (value.status === 'warning') {
      risks.push({ level: 'warning', message: `${key} 使用率已超过 85%，需要准备升级或扩容。` })
    }
  }
  if (failedTaskCount > successfulTaskCount && taskCount > 0) {
    risks.push({
      level: 'warning',
      message: '失败任务数高于成功任务数，建议先排查账户、Page、Pixel 或素材合规问题。',
      actionPath: '/bulk-ad/tasks',
    })
  }

  return {
    scope: {
      mode,
      organizationId,
      organizationName: organization?.name || 'AutoArk Platform',
    },
    plan: {
      code: plan,
      label: mode === 'platform' ? '平台运营' : PLAN_DEFAULTS[plan].label,
      billingStatus,
      trialEndsAt: organization?.billing?.trialEndsAt,
      currentPeriodEndsAt: organization?.billing?.currentPeriodEndsAt,
      features,
      limits,
    },
    usage,
    metrics: {
      activeUsers: activeUserCount,
      members: memberCount,
      adAccounts: adAccountCount,
      activeTokens: activeTokenCount,
      materials: materialCount,
      drafts: draftCount,
      tasks: taskCount,
      successfulTasks: successfulTaskCount,
      runningTasks: runningTaskCount,
      failedTasks: failedTaskCount,
      monthlyTasks: monthlyTaskCount,
      publicOauthApps: publicOauthAppCount,
      healthyApps: healthyAppCount,
    },
    checklist,
    score: computeScore(checklist),
    risks,
    deployment: {
      corsConfigured: Boolean(process.env.CORS_ALLOWED_ORIGINS),
      oauthStateSecretConfigured: Boolean(process.env.OAUTH_STATE_SECRET),
      facebookBusinessLoginConfigConfigured: Boolean(process.env.FACEBOOK_BUSINESS_LOGIN_CONFIG_ID),
      feishuWebhookConfigured: Boolean(
        process.env.FEISHU_WEBHOOK_VERIFICATION_TOKEN ||
        process.env.FEISHU_WEBHOOK_SIGNING_SECRET ||
        process.env.FEISHU_VERIFICATION_TOKEN ||
        process.env.FEISHU_BOT_SECRET,
      ),
    },
  }
}

export function getCommercialPlans() {
  return Object.entries(PLAN_DEFAULTS).map(([code, config]) => ({
    code,
    ...config,
  }))
}
