import Account from '../models/Account'
import AdDraft from '../models/AdDraft'
import AdTask from '../models/AdTask'
import FacebookApp from '../models/FacebookApp'
import FacebookUser from '../models/FacebookUser'
import FbToken from '../models/FbToken'
import Material from '../models/Material'
import OpsLog from '../models/OpsLog'
import Organization, {
  IOrganization,
  OrganizationBillingStatus,
  OrganizationPlan,
  OrganizationStatus,
} from '../models/Organization'
import User, { UserRole, UserStatus } from '../models/User'
import { JwtPayload } from '../utils/jwt'
import { objectIdValue } from '../utils/accessControl'
import { buildFacebookAssetDiagnostics } from './facebookAssets.diagnostics.service'
import { buildTaskOperationalDiagnostics } from './bulkAd.diagnostics'

type ChecklistStatus = 'done' | 'warning' | 'pending' | 'blocked'
type ScopeMode = 'organization' | 'platform'
type RiskLevel = 'critical' | 'warning' | 'info'
type ReadinessLevel = 'blocked' | 'attention' | 'ready'

type CommercialNextAction = {
  id: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  title: string
  description: string
  actionPath?: string
  owner: string
  source: 'setup' | 'facebook' | 'quota' | 'tasks' | 'team' | 'materials'
}

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

const utcDayStart = (value = new Date()) => (
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
)

const addUtcDays = (value: Date, days: number) => {
  const next = new Date(value)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

const formatUtcDay = (value: Date) => value.toISOString().slice(0, 10)

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

const buildReadinessState = ({
  score,
  risks,
}: {
  score: number
  risks: Array<{ level: RiskLevel }>
}): { level: ReadinessLevel; label: string; summary: string } => {
  if (risks.some(risk => risk.level === 'critical')) {
    return {
      level: 'blocked',
      label: '未就绪',
      summary: '仍存在会阻断客户授权或广告发布的关键问题，暂不适合交付商用客户。',
    }
  }

  if (risks.some(risk => risk.level === 'warning') || score < 80) {
    return {
      level: 'attention',
      label: '需关注',
      summary: '核心链路可继续推进，但上线前仍建议处理风险项，降低客户交付失败率。',
    }
  }

  return {
    level: 'ready',
    label: '可商用',
    summary: '授权、资产、额度和任务闭环均已达到商用验收要求，可以进入客户交付。',
  }
}

const action = (
  id: string,
  priority: CommercialNextAction['priority'],
  title: string,
  description: string,
  actionPath: string | undefined,
  owner: string,
  source: CommercialNextAction['source'],
): CommercialNextAction => ({
  id,
  priority,
  title,
  description,
  actionPath,
  owner,
  source,
})

const limitLabel: Record<string, string> = {
  members: '团队成员',
  adAccounts: '广告账户',
  materials: '素材资产',
  monthlyTasks: '本月任务',
  concurrentTasks: '当前并发任务',
}

const taskStatusLabel: Record<string, string> = {
  pending: '等待中',
  queued: '排队中',
  processing: '执行中',
  success: '成功',
  partial_success: '部分成功',
  failed: '失败',
  cancelled: '已取消',
}

const taskStatusGroup = (status?: string) => {
  if (['pending', 'queued', 'processing'].includes(status || '')) return 'running'
  if (['success', 'partial_success'].includes(status || '')) return 'success'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return 'other'
}

const QUOTA_ERROR_CODES = [
  'ORGANIZATION_NOT_FOUND',
  'ORGANIZATION_NOT_ACTIVE',
  'BILLING_NOT_ACTIVE',
  'TASK_ACCOUNT_LIMIT_EXCEEDED',
  'MAX_CONCURRENT_TASKS_REACHED',
  'MONTHLY_TASK_LIMIT_REACHED',
]

const TOKEN_EXPIRING_SOON_DAYS = 14
const TOKEN_STALE_CHECK_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

const sentence = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /[。.!！?？]$/.test(trimmed) ? trimmed : `${trimmed}。`
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
      if (!earliestExpiresAt || expiresAt < earliestExpiresAt) {
        earliestExpiresAt = expiresAt
      }
      if (expiresAt < now) {
        expiredCount += 1
      } else if (expiresAt <= expiringSoonAt) {
        expiringSoonCount += 1
      }
    }

    if (!lastCheckedAt || Number.isNaN(lastCheckedAt.getTime()) || lastCheckedAt < staleBefore) {
      staleCheckCount += 1
    } else if (!oldestCheckedAt || lastCheckedAt < oldestCheckedAt) {
      oldestCheckedAt = lastCheckedAt
    }
  }

  return {
    total: tokens.length,
    expiredCount,
    expiringSoonCount,
    staleCheckCount,
    missingExpiryCount,
    earliestExpiresAt,
    oldestCheckedAt,
  }
}

const aggregateRecentTaskIssues = (tasks: any[]) => {
  const bucketMap = new Map<string, {
    errorCode: string
    count: number
    retryable: boolean
    customerMessage: string
  }>()

  for (const task of tasks) {
    const diagnostics = buildTaskOperationalDiagnostics(task)
    for (const bucket of diagnostics.buckets) {
      const existing = bucketMap.get(bucket.errorCode)
      if (existing) {
        existing.count += bucket.count
      } else {
        bucketMap.set(bucket.errorCode, {
          errorCode: bucket.errorCode,
          count: bucket.count,
          retryable: bucket.retryable,
          customerMessage: bucket.customerMessage,
        })
      }
    }
  }

  return Array.from(bucketMap.values()).sort((a, b) => b.count - a.count)
}

type CommercialIssueTrendAccumulator = {
  errorCode: string
  count: number
  retryable: boolean
  source: string
  customerMessage: string
  nextActions: string[]
  taskIds: Set<string>
  accountIds: Set<string>
  lastSeenAt?: Date
}

const buildCommercialIssueTrends = (tasks: any[]) => {
  const trendMap = new Map<string, CommercialIssueTrendAccumulator>()

  for (const task of tasks) {
    const diagnostics = buildTaskOperationalDiagnostics(task)
    const taskId = task?._id || task?.id ? String(task._id || task.id) : undefined
    const createdAt = task?.createdAt ? new Date(task.createdAt) : undefined

    for (const bucket of diagnostics.buckets) {
      const existing = trendMap.get(bucket.errorCode)
      if (existing) {
        existing.count += bucket.count
        existing.retryable = existing.retryable && bucket.retryable
        for (const actionText of bucket.nextActions) {
          if (actionText && !existing.nextActions.includes(actionText)) {
            existing.nextActions.push(actionText)
          }
        }
        if (createdAt && (!existing.lastSeenAt || createdAt > existing.lastSeenAt)) {
          existing.lastSeenAt = createdAt
        }
      } else {
        trendMap.set(bucket.errorCode, {
          errorCode: bucket.errorCode,
          count: bucket.count,
          retryable: bucket.retryable,
          source: bucket.source,
          customerMessage: bucket.customerMessage,
          nextActions: [...bucket.nextActions],
          taskIds: new Set<string>(),
          accountIds: new Set<string>(),
          lastSeenAt: createdAt,
        })
      }

      const trend = trendMap.get(bucket.errorCode)!
      if (taskId) trend.taskIds.add(taskId)
      for (const account of bucket.accounts) {
        if (account.accountId) trend.accountIds.add(account.accountId)
      }
    }
  }

  return Array.from(trendMap.values())
    .map(trend => ({
      errorCode: trend.errorCode,
      count: trend.count,
      taskCount: trend.taskIds.size,
      accountCount: trend.accountIds.size,
      retryable: trend.retryable,
      source: trend.source,
      customerMessage: trend.customerMessage,
      nextActions: trend.nextActions.slice(0, 3),
      lastSeenAt: trend.lastSeenAt,
    }))
    .sort((a, b) => {
      const countDiff = b.count - a.count
      if (countDiff !== 0) return countDiff
      return b.taskCount - a.taskCount
    })
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
  requestedTasks = 1,
}: {
  organizationId?: string
  requestedAccounts?: number
  requestedTasks?: number
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
  const requestedTaskCount = Math.max(1, Number(requestedTasks) || 1)

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

  if (limits.maxConcurrentTasks && runningTaskCount + requestedTaskCount > limits.maxConcurrentTasks) {
    throw new CommercialLimitError(
      'MAX_CONCURRENT_TASKS_REACHED',
      `当前已有 ${runningTaskCount} 个任务在执行，本次还将创建 ${requestedTaskCount} 个任务，超过当前套餐并发额度 ${limits.maxConcurrentTasks}。请等待任务完成后再发布。`,
      429,
      { runningTaskCount, requestedTasks: requestedTaskCount, limit: limits.maxConcurrentTasks, plan },
    )
  }

  if (limits.monthlyTaskLimit && monthlyTaskCount + requestedTaskCount > limits.monthlyTaskLimit) {
    throw new CommercialLimitError(
      'MONTHLY_TASK_LIMIT_REACHED',
      `本月已发布 ${monthlyTaskCount} 个任务，本次还将创建 ${requestedTaskCount} 个任务，超过当前套餐月度任务额度 ${limits.monthlyTaskLimit}。`,
      403,
      { monthlyTaskCount, requestedTasks: requestedTaskCount, limit: limits.monthlyTaskLimit, plan },
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
      requestedTasks: requestedTaskCount,
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
    activeTokenDocs,
    recentFailedTasks,
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
    FbToken.find({ ...orgFilter, status: 'active' })
      .select('_id fbUserId fbUserName expiresAt lastCheckedAt updatedAt')
      .sort({ updatedAt: -1 })
      .lean(),
    AdTask.find({ ...orgFilter, status: { $in: ['failed', 'partial_success'] } })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
  ])

  const tokenIds = activeTokenDocs.map((token: any) => token._id).filter(Boolean)
  const fbUserIds = activeTokenDocs.map((token: any) => token.fbUserId).filter(Boolean)
  const facebookUserFilters: any[] = tokenIds.length > 0 ? [{ tokenId: { $in: tokenIds } }] : []
  if (fbUserIds.length > 0) {
    facebookUserFilters.push({
      fbUserId: { $in: fbUserIds },
      ...(organizationId && { organizationId: objectIdValue(organizationId) }),
    })
  }
  const facebookUsers = activeTokenDocs.length > 0
    ? await FacebookUser.find({ $or: facebookUserFilters }).lean()
    : []
  const facebookAssets = buildFacebookAssetDiagnostics({
    tokens: activeTokenDocs,
    users: facebookUsers,
  })
  const tokenHealth = buildTokenHealth(activeTokenDocs)
  const recentTaskIssueBuckets = aggregateRecentTaskIssues(recentFailedTasks)

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
      'facebook_token_health',
      '授权有效性',
      '活跃授权需要定期校验，且不能处于已过期或临近过期状态。',
      activeTokenCount === 0
        ? 'blocked'
        : tokenHealth.expiredCount > 0
          ? 'blocked'
          : tokenHealth.expiringSoonCount > 0 || tokenHealth.staleCheckCount > 0
            ? 'warning'
            : 'done',
      '/fb-settings',
      `${tokenHealth.expiringSoonCount} 临期 / ${tokenHealth.staleCheckCount} 待校验`,
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
      'facebook_pages',
      'Page 资产可用',
      '批量创建广告创意前，广告账户必须能使用至少一个 Facebook Page。',
      facebookAssets.summary.pageLinkedAccountCount > 0 ? 'done' : activeTokenCount > 0 ? 'blocked' : 'pending',
      '/bulk-ad/create',
      `${facebookAssets.summary.pageLinkedAccountCount} 个账户`,
    ),
    step(
      'facebook_pixels',
      'Pixel 资产可用',
      '转化目标投放前，广告账户必须能访问 Pixel，否则发布前会被阻断。',
      facebookAssets.summary.pixelLinkedAccountCount > 0 ? 'done' : activeTokenCount > 0 ? 'blocked' : 'pending',
      '/bulk-ad/create',
      `${facebookAssets.summary.pixelLinkedAccountCount} 个账户`,
    ),
    step(
      'facebook_ready_accounts',
      '可投放账户',
      '账户同时满足活跃、Page、Pixel 后才适合交付客户批量发布。',
      facebookAssets.summary.readyAccountCount > 0 ? 'done' : activeTokenCount > 0 ? 'blocked' : 'pending',
      '/bulk-ad/create',
      `${facebookAssets.summary.readyAccountCount} 个就绪`,
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

  const risks: Array<{ level: RiskLevel; message: string; actionPath?: string }> = []
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
  if (tokenHealth.expiredCount > 0) {
    risks.push({
      level: 'critical',
      message: `${tokenHealth.expiredCount} 个活跃 Facebook 授权已过期，客户发布任务可能直接失败。`,
      actionPath: '/fb-settings',
    })
  }
  if (tokenHealth.expiringSoonCount > 0) {
    risks.push({
      level: 'warning',
      message: `${tokenHealth.expiringSoonCount} 个 Facebook 授权将在 ${TOKEN_EXPIRING_SOON_DAYS} 天内过期，请提前安排客户重新授权。`,
      actionPath: '/fb-settings',
    })
  }
  if (tokenHealth.staleCheckCount > 0) {
    risks.push({
      level: 'warning',
      message: `${tokenHealth.staleCheckCount} 个 Facebook 授权超过 ${TOKEN_STALE_CHECK_DAYS} 天未完成有效性校验，建议先刷新校验状态。`,
      actionPath: '/fb-settings',
    })
  }
  if (activeTokenCount > 0 && facebookAssets.summary.pageLinkedAccountCount === 0) {
    risks.push({
      level: 'critical',
      message: 'Facebook 授权存在，但没有任何广告账户可使用 Page，客户无法创建广告创意。',
      actionPath: '/bulk-ad/create',
    })
  }
  if (activeTokenCount > 0 && facebookAssets.summary.pixelLinkedAccountCount === 0) {
    risks.push({
      level: 'critical',
      message: 'Facebook 授权存在，但没有任何广告账户可使用 Pixel，转化目标投放会被阻断。',
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
    const primaryIssue = recentTaskIssueBuckets[0]
    risks.push({
      level: 'warning',
      message: primaryIssue
        ? `失败任务数高于成功任务数，最近主因是 ${primaryIssue.errorCode}（${primaryIssue.count} 次）：${primaryIssue.customerMessage}`
        : '失败任务数高于成功任务数，建议先排查账户、Page、Pixel 或素材合规问题。',
      actionPath: '/bulk-ad/tasks',
    })
  } else if (recentTaskIssueBuckets.length > 0) {
    const primaryIssue = recentTaskIssueBuckets[0]
    risks.push({
      level: 'info',
      message: `最近任务仍出现 ${primaryIssue.errorCode}（${primaryIssue.count} 次），建议在任务管理中清理尾部问题。`,
      actionPath: '/bulk-ad/tasks',
    })
  }

  const checklistScore = computeScore(checklist)
  const score = risks.some(risk => risk.level === 'critical')
    ? Math.min(checklistScore, 49)
    : risks.some(risk => risk.level === 'warning')
      ? Math.min(checklistScore, 79)
      : checklistScore
  const state = buildReadinessState({ score, risks })
  const nextActions: CommercialNextAction[] = []

  if (mode === 'organization' && organization?.status !== OrganizationStatus.ACTIVE) {
    nextActions.push(action(
      'activate_organization',
      'critical',
      '启用客户组织',
      '组织未启用时客户无法稳定登录和发布任务，先在用户/组织管理里恢复服务状态。',
      '/users',
      '平台运营',
      'setup',
    ))
  }

  if (publicOauthAppCount === 0) {
    nextActions.push(action(
      'complete_public_oauth_app',
      'critical',
      '完成 Facebook App 公开授权',
      '确认 App 已上线，并且 Login for Business 配置、Marketing API 权限和 Public OAuth 检查都已通过。',
      '/fb-apps',
      '平台运营',
      'setup',
    ))
  }

  if (mode === 'organization' && activeTokenCount === 0) {
    nextActions.push(action(
      'connect_facebook_authorization',
      'critical',
      '让客户重新授权 Facebook',
      '客户需要使用 Facebook Login for Business 登录并授予广告账户、Page、Pixel 相关权限。',
      '/bulk-ad/create',
      '客户管理员',
      'facebook',
    ))
  }
  if (tokenHealth.expiredCount > 0) {
    nextActions.push(action(
      'renew_expired_facebook_tokens',
      'critical',
      '重新授权已过期 Facebook Token',
      '活跃授权中存在已过期 Token，请让客户管理员重新完成 Facebook Login for Business 授权后再发布任务。',
      '/fb-settings',
      '客户管理员',
      'facebook',
    ))
  }
  if (tokenHealth.expiringSoonCount > 0) {
    nextActions.push(action(
      'renew_expiring_facebook_tokens',
      'high',
      '安排临期授权续期',
      `有 ${tokenHealth.expiringSoonCount} 个 Facebook 授权将在 ${TOKEN_EXPIRING_SOON_DAYS} 天内过期，建议上线前先重新授权，避免客户投放中断。`,
      '/fb-settings',
      '客户管理员',
      'facebook',
    ))
  }
  if (tokenHealth.staleCheckCount > 0) {
    nextActions.push(action(
      'refresh_facebook_token_checks',
      'medium',
      '刷新 Facebook 授权校验',
      `有 ${tokenHealth.staleCheckCount} 个授权超过 ${TOKEN_STALE_CHECK_DAYS} 天未校验，先在 Token 与像素页面检查状态，再继续客户交付。`,
      '/fb-settings',
      '平台运营',
      'facebook',
    ))
  }

  if (activeTokenCount > 0 && facebookAssets.summary.pageLinkedAccountCount === 0) {
    nextActions.push(action(
      'assign_facebook_page',
      'critical',
      '给广告账户分配可用 Page',
      '在 Meta Business Manager 中把主页授权给对应广告账户，然后回到 AutoArk 重新同步资产。',
      '/bulk-ad/create',
      'Meta BM 管理员',
      'facebook',
    ))
  }

  if (activeTokenCount > 0 && facebookAssets.summary.pixelLinkedAccountCount === 0) {
    nextActions.push(action(
      'assign_facebook_pixel',
      'critical',
      '给广告账户分配 Pixel',
      '转化目标投放依赖 Pixel 权限。请在 Business Manager 中把 Pixel 共享给广告账户，并重新同步资产。',
      '/bulk-ad/create',
      'Meta BM 管理员',
      'facebook',
    ))
  }

  if (
    activeTokenCount > 0 &&
    facebookAssets.summary.pageLinkedAccountCount > 0 &&
    facebookAssets.summary.pixelLinkedAccountCount > 0 &&
    facebookAssets.summary.readyAccountCount === 0
  ) {
    nextActions.push(action(
      'repair_facebook_asset_mapping',
      'high',
      '校准账户、Page、Pixel 关联',
      'Page 和 Pixel 已同步，但没有同时满足三者的可投放账户，需要检查资产是否分配到同一个广告账户。',
      '/bulk-ad/create',
      'Meta BM 管理员',
      'facebook',
    ))
  }

  if (materialCount === 0) {
    nextActions.push(action(
      'prepare_materials',
      'medium',
      '补齐投放素材',
      '上传视频、图片或导入素材库，确保批量创建广告时有可用创意资产。',
      '/bulk-ad/materials',
      '投放运营',
      'materials',
    ))
  }

  if (draftCount === 0 && taskCount === 0) {
    nextActions.push(action(
      'run_first_publish_flow',
      'medium',
      '跑通一次批量投放流程',
      '先创建草稿并发布一次小批量任务，用真实链路验证账户、素材和权限组合。',
      '/bulk-ad/create',
      '投放运营',
      'tasks',
    ))
  } else if (successfulTaskCount === 0) {
    nextActions.push(action(
      'complete_successful_publish',
      'high',
      '完成一次真实成功任务',
      '当前还没有成功或部分成功的发布记录，先修复任务错误并用小预算账户验证闭环。',
      '/bulk-ad/tasks',
      '投放运营',
      'tasks',
    ))
  }

  if (failedTaskCount > successfulTaskCount && taskCount > 0) {
    const primaryIssue = recentTaskIssueBuckets[0]
    nextActions.push(action(
      'resolve_recent_task_failures',
      primaryIssue?.retryable ? 'medium' : 'high',
      primaryIssue ? `处理任务失败主因：${primaryIssue.errorCode}` : '处理最近任务失败',
      primaryIssue
        ? `${sentence(primaryIssue.customerMessage)}先按任务诊断处理不可重试项，再重新发布或重试。`
        : '失败任务高于成功任务，先从任务管理页查看诊断并处理账户、Page、Pixel 或素材问题。',
      '/bulk-ad/tasks',
      '投放运营',
      'tasks',
    ))
  } else if (recentTaskIssueBuckets.length > 0) {
    const primaryIssue = recentTaskIssueBuckets[0]
    nextActions.push(action(
      'review_recent_task_warnings',
      'low',
      `复盘最近任务提示：${primaryIssue.errorCode}`,
      `${sentence(primaryIssue.customerMessage)}该问题当前没有阻断商用评分，但建议上线前复盘并清理失败项。`,
      '/bulk-ad/tasks',
      '投放运营',
      'tasks',
    ))
  }

  for (const [key, value] of Object.entries(usage)) {
    if (value.status === 'exceeded' || value.status === 'warning') {
      nextActions.push(action(
        `review_quota_${key}`,
        value.status === 'exceeded' ? 'critical' : 'medium',
        `${limitLabel[key] || key}额度${value.status === 'exceeded' ? '已超限' : '接近上限'}`,
        value.status === 'exceeded'
          ? '当前使用量已经超过套餐限制，需要升级套餐、释放资源或联系平台运营调整额度。'
          : '使用率超过 85%，建议提前准备套餐升级或运营扩容，避免客户发布时被限流。',
        mode === 'platform' ? '/organizations' : '/users',
        '平台运营',
        'quota',
      ))
    }
  }

  if (mode === 'organization' && memberCount < 2) {
    nextActions.push(action(
      'invite_team_member',
      'low',
      '补充客户团队成员',
      '商用客户建议至少有组织管理员和投放成员，便于权限隔离、审计和交接。',
      '/users',
      '客户管理员',
      'team',
    ))
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
      facebookPageAccounts: facebookAssets.summary.pageLinkedAccountCount,
      facebookPixelAccounts: facebookAssets.summary.pixelLinkedAccountCount,
      facebookReadyAccounts: facebookAssets.summary.readyAccountCount,
      recentTaskIssueTypes: recentTaskIssueBuckets.length,
      expiredTokens: tokenHealth.expiredCount,
      expiringSoonTokens: tokenHealth.expiringSoonCount,
      staleTokenChecks: tokenHealth.staleCheckCount,
      tokensWithoutExpiry: tokenHealth.missingExpiryCount,
    },
    checklist,
    score,
    state,
    nextActions,
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

export async function getCommercialUsageLedger(
  user: JwtPayload,
  requestedOrganizationId?: string,
) {
  const { mode, organizationId, organization } = await resolveScope(user, requestedOrganizationId)
  const orgFilter = scoped(organizationId)
  const userFilter = mode === 'organization' ? { organizationId: objectIdValue(organizationId) } : {}
  const currentMonthStart = monthStart()
  const todayStart = utcDayStart()
  const dailyStart = addUtcDays(todayStart, -13)
  const issueWindowStart = addUtcDays(todayStart, -29)

  const plan = mode === 'platform' ? OrganizationPlan.ENTERPRISE : getEffectivePlan(organization)
  const limits = mode === 'platform' ? PLAN_DEFAULTS[OrganizationPlan.ENTERPRISE].limits : getEffectiveLimits(organization)
  const billingStatus = mode === 'platform' ? OrganizationBillingStatus.ACTIVE : organization?.billing?.status || (
    plan === OrganizationPlan.TRIAL
      ? OrganizationBillingStatus.TRIALING
      : OrganizationBillingStatus.ACTIVE
  )

  const [
    memberCount,
    adAccountCount,
    materialCount,
    runningTaskCount,
    monthlyTaskCount,
    statusRows,
    dailyRows,
    recentTaskDocs,
    quotaEventDocs,
    issueTrendDocs,
  ] = await Promise.all([
    User.countDocuments(userFilter),
    Account.countDocuments({ ...orgFilter, status: { $ne: 'disabled' } }),
    Material.countDocuments({ ...orgFilter, status: { $ne: 'deleted' } }),
    AdTask.countDocuments({ ...orgFilter, status: { $in: ['pending', 'queued', 'processing'] } }),
    AdTask.countDocuments({ ...orgFilter, createdAt: { $gte: currentMonthStart } }),
    AdTask.aggregate([
      { $match: { ...orgFilter, createdAt: { $gte: currentMonthStart } } },
      {
        $project: {
          status: 1,
          accountCount: { $size: { $ifNull: ['$items', []] } },
        },
      },
      {
        $group: {
          _id: '$status',
          tasks: { $sum: 1 },
          accounts: { $sum: '$accountCount' },
        },
      },
      { $sort: { tasks: -1 } },
    ]),
    AdTask.aggregate([
      { $match: { ...orgFilter, createdAt: { $gte: dailyStart } } },
      {
        $project: {
          status: 1,
          day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
          accountCount: { $size: { $ifNull: ['$items', []] } },
        },
      },
      {
        $group: {
          _id: { day: '$day', status: '$status' },
          tasks: { $sum: 1 },
          accounts: { $sum: '$accountCount' },
        },
      },
      { $sort: { '_id.day': 1 } },
    ]),
    AdTask.find(orgFilter)
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
    OpsLog.find({
      ...orgFilter,
      category: 'bulk_ad',
      status: 'failed',
      'metadata.errorCode': { $in: QUOTA_ERROR_CODES },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('action status summary reason metadata requestId createdAt username userId userRole')
      .lean(),
    AdTask.find({
      ...orgFilter,
      status: { $in: ['failed', 'partial_success'] },
      createdAt: { $gte: issueWindowStart },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
  ])

  const usage = {
    members: limitState(memberCount, limits.maxMembers),
    adAccounts: limitState(adAccountCount, limits.maxAdAccounts),
    materials: limitState(materialCount, limits.maxMaterials),
    monthlyTasks: limitState(monthlyTaskCount, limits.monthlyTaskLimit),
    concurrentTasks: limitState(runningTaskCount, limits.maxConcurrentTasks),
  }

  const dayMap = new Map<string, {
    date: string
    totalTasks: number
    successTasks: number
    failedTasks: number
    runningTasks: number
    cancelledTasks: number
    accountExecutions: number
  }>()
  for (let offset = 0; offset < 14; offset += 1) {
    const date = formatUtcDay(addUtcDays(dailyStart, offset))
    dayMap.set(date, {
      date,
      totalTasks: 0,
      successTasks: 0,
      failedTasks: 0,
      runningTasks: 0,
      cancelledTasks: 0,
      accountExecutions: 0,
    })
  }

  for (const row of dailyRows as any[]) {
    const date = row._id?.day
    if (!date || !dayMap.has(date)) continue
    const item = dayMap.get(date)!
    const tasks = Number(row.tasks || 0)
    const group = taskStatusGroup(row._id?.status)
    item.totalTasks += tasks
    item.accountExecutions += Number(row.accounts || 0)
    if (group === 'success') item.successTasks += tasks
    else if (group === 'failed') item.failedTasks += tasks
    else if (group === 'running') item.runningTasks += tasks
    else if (group === 'cancelled') item.cancelledTasks += tasks
  }

  const recentTasks = (recentTaskDocs as any[]).map(task => {
    const diagnostics = buildTaskOperationalDiagnostics(task)
    return {
      taskId: String(task._id),
      taskName: task.name,
      status: task.status,
      statusLabel: taskStatusLabel[task.status] || task.status,
      createdAt: task.createdAt,
      accountCount: task.items?.length || task.progress?.totalAccounts || 0,
      createdAds: task.progress?.createdAds || 0,
      health: diagnostics.health,
      totalErrors: diagnostics.summary.totalErrors,
      topIssue: diagnostics.buckets[0]
        ? {
          errorCode: diagnostics.buckets[0].errorCode,
          count: diagnostics.buckets[0].count,
          retryable: diagnostics.buckets[0].retryable,
          customerMessage: diagnostics.buckets[0].customerMessage,
        }
        : null,
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      mode,
      organizationId,
      organizationName: organization?.name || 'AutoArk Platform',
    },
    period: {
      currentMonthStart: currentMonthStart.toISOString(),
      dailyStart: dailyStart.toISOString(),
      dailyEnd: todayStart.toISOString(),
      issueWindowStart: issueWindowStart.toISOString(),
    },
    plan: {
      code: plan,
      label: mode === 'platform' ? '平台运营' : PLAN_DEFAULTS[plan].label,
      billingStatus,
      limits,
    },
    usage,
    taskStatusBreakdown: (statusRows as any[]).map(row => ({
      status: row._id || 'unknown',
      label: taskStatusLabel[row._id] || row._id || '未知',
      tasks: Number(row.tasks || 0),
      accountExecutions: Number(row.accounts || 0),
    })),
    dailyTaskCounts: Array.from(dayMap.values()),
    quotaEvents: (quotaEventDocs as any[]).map(log => ({
      action: log.action,
      status: log.status,
      summary: log.summary,
      reason: log.reason,
      errorCode: log.metadata?.errorCode,
      details: log.metadata?.details,
      requestId: log.requestId,
      createdAt: log.createdAt,
      operator: log.username || log.userId || 'anonymous',
      userRole: log.userRole,
    })),
    issueTrends: buildCommercialIssueTrends(issueTrendDocs as any[]).slice(0, 8),
    recentTasks,
  }
}

export async function getCommercialOrganizationReadiness(user: JwtPayload) {
  if (user.role !== UserRole.SUPER_ADMIN) {
    throw new Error('无权查看全平台客户商用状态')
  }

  const organizations = await Organization.find({})
    .select('_id name status billing updatedAt createdAt')
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean()

  const stateRank: Record<ReadinessLevel, number> = {
    blocked: 0,
    attention: 1,
    ready: 2,
  }

  const items = await Promise.all(organizations.map(async (organization: any) => {
    const readiness = await getCommercialReadiness(user, String(organization._id))
    const firstAction = readiness.nextActions[0]

    return {
      organizationId: String(organization._id),
      organizationName: organization.name,
      organizationStatus: organization.status,
      plan: readiness.plan,
      score: readiness.score,
      state: readiness.state,
      firstAction: firstAction
        ? {
          id: firstAction.id,
          priority: firstAction.priority,
          title: firstAction.title,
          owner: firstAction.owner,
          actionPath: firstAction.actionPath,
          source: firstAction.source,
        }
        : null,
      metrics: {
        activeTokens: readiness.metrics.activeTokens || 0,
        expiredTokens: readiness.metrics.expiredTokens || 0,
        expiringSoonTokens: readiness.metrics.expiringSoonTokens || 0,
        staleTokenChecks: readiness.metrics.staleTokenChecks || 0,
        adAccounts: readiness.metrics.adAccounts || 0,
        facebookReadyAccounts: readiness.metrics.facebookReadyAccounts || 0,
        materials: readiness.metrics.materials || 0,
        successfulTasks: readiness.metrics.successfulTasks || 0,
        failedTasks: readiness.metrics.failedTasks || 0,
      },
      updatedAt: organization.updatedAt,
    }
  }))

  return items.sort((a, b) => {
    const stateDiff = stateRank[a.state.level] - stateRank[b.state.level]
    if (stateDiff !== 0) return stateDiff
    return a.score - b.score
  })
}

export async function getCommercialSupportPackage(
  user: JwtPayload,
  requestedOrganizationId?: string,
) {
  const { mode, organizationId, organization } = await resolveScope(user, requestedOrganizationId)
  const orgFilter = scoped(organizationId)
  const readiness = await getCommercialReadiness(user, organizationId)

  const activeTokenDocs = await FbToken.find({ ...orgFilter, status: 'active' })
    .select('_id fbUserId fbUserName expiresAt updatedAt')
    .sort({ updatedAt: -1 })
    .lean()
  const tokenIds = activeTokenDocs.map((token: any) => token._id).filter(Boolean)
  const fbUserIds = activeTokenDocs.map((token: any) => token.fbUserId).filter(Boolean)
  const facebookUserFilters: any[] = tokenIds.length > 0 ? [{ tokenId: { $in: tokenIds } }] : []
  if (fbUserIds.length > 0) {
    facebookUserFilters.push({
      fbUserId: { $in: fbUserIds },
      ...(organizationId && { organizationId: objectIdValue(organizationId) }),
    })
  }
  const facebookUsers = activeTokenDocs.length > 0
    ? await FacebookUser.find({ $or: facebookUserFilters }).lean()
    : []
  const facebookAssets = buildFacebookAssetDiagnostics({
    tokens: activeTokenDocs,
    users: facebookUsers,
  })

  const recentTasks = await AdTask.find({
    ...orgFilter,
    status: { $in: ['failed', 'partial_success', 'cancelled'] },
  })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean()

  const recentTaskDiagnostics = recentTasks.map((task: any) => {
    const diagnostics = buildTaskOperationalDiagnostics(task)
    return {
      taskId: String(task._id),
      taskName: task.name || '',
      status: task.status,
      createdAt: task.createdAt,
      health: diagnostics.health,
      summary: diagnostics.summary,
      topIssue: diagnostics.buckets[0]
        ? {
          errorCode: diagnostics.buckets[0].errorCode,
          count: diagnostics.buckets[0].count,
          retryable: diagnostics.buckets[0].retryable,
          customerMessage: diagnostics.buckets[0].customerMessage,
          nextActions: diagnostics.buckets[0].nextActions.slice(0, 3),
        }
        : null,
    }
  })

  const recentAuditLogs = await OpsLog.find({
    ...(organizationId ? { organizationId: objectIdValue(organizationId) } : {}),
  })
    .select('category action status summary reason requestId createdAt')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean()

  return {
    supportId: `AUTOARK-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${String(organizationId || 'platform').slice(-6)}`,
    generatedAt: new Date().toISOString(),
    scope: {
      mode,
      organizationId,
      organizationName: organization?.name || 'AutoArk Platform',
      organizationStatus: organization?.status,
    },
    readiness: {
      score: readiness.score,
      state: readiness.state,
      risks: readiness.risks.slice(0, 5),
      nextActions: readiness.nextActions.slice(0, 5),
      metrics: readiness.metrics,
    },
    facebookAssets: {
      summary: facebookAssets.summary,
      risks: facebookAssets.risks,
      checklist: facebookAssets.checklist,
      accounts: facebookAssets.accounts.slice(0, 20).map((account: any) => ({
        accountId: account.accountId,
        name: account.name,
        status: account.status,
        statusLabel: account.statusLabel,
        ready: account.ready,
        issues: account.issues,
        pageCount: account.pageCount,
        pixelCount: account.pixelCount,
      })),
    },
    recentTasks: recentTaskDiagnostics,
    recentAuditLogs,
  }
}

export function getCommercialPlans() {
  return Object.entries(PLAN_DEFAULTS).map(([code, config]) => ({
    code,
    ...config,
  }))
}
