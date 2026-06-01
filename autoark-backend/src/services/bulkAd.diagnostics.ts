export type BulkAdDiagnosticSource = 'meta' | 'autoark' | 'worker' | 'validation'
export type BulkAdDiagnosticSeverity = 'error' | 'warning'

export interface BulkAdDiagnostic {
  entityType: string
  errorCode: string
  errorMessage: string
  customerMessage: string
  operatorMessage: string
  severity: BulkAdDiagnosticSeverity
  retryable: boolean
  nextActions: string[]
  source: BulkAdDiagnosticSource
  rawCode?: number | string
  rawSubcode?: number | string
  timestamp: Date
}

export interface BulkAdTaskDiagnosticBucket {
  errorCode: string
  entityType: string
  customerMessage: string
  retryable: boolean
  source: BulkAdDiagnosticSource
  count: number
  accounts: Array<{
    accountId: string
    accountName?: string
  }>
  nextActions: string[]
}

export interface BulkAdTaskOperationalDiagnostics {
  taskId?: string
  status?: string
  health: 'healthy' | 'running' | 'retryable' | 'blocked' | 'mixed' | 'unknown'
  summary: {
    totalAccounts: number
    successAccounts: number
    failedAccounts: number
    processingAccounts: number
    pendingAccounts: number
    totalErrors: number
    retryableErrors: number
    blockedErrors: number
  }
  buckets: BulkAdTaskDiagnosticBucket[]
  topNextActions: string[]
}

interface DiagnosisTemplate {
  entityType: string
  customerMessage: string
  retryable: boolean
  nextActions: string[]
  source: BulkAdDiagnosticSource
  severity?: BulkAdDiagnosticSeverity
}

interface DiagnoseOptions {
  fallbackCode?: string
  entityType?: string
}

const DIAGNOSIS_TEMPLATES: Record<string, DiagnosisTemplate> = {
  FACEBOOK_AUTH_REQUIRED: {
    entityType: 'authorization',
    customerMessage: 'Facebook 授权不可用或已失效，系统无法继续调用广告接口。',
    retryable: false,
    source: 'meta',
    nextActions: [
      '在 Token 与像素页面重新使用 Facebook Login for Business 授权。',
      '确认授权用户仍拥有该广告账户和主页的管理权限。',
      '授权完成后重试失败项。',
    ],
  },
  FACEBOOK_PERMISSION_DENIED: {
    entityType: 'permission',
    customerMessage: '当前 Facebook App 或授权用户缺少创建广告所需权限。',
    retryable: false,
    source: 'meta',
    nextActions: [
      '确认 ads_management、ads_read、business_management、pages_show_list、pages_read_engagement、pages_manage_ads 均已高级权限通过。',
      '确认 Facebook Login for Business Configuration 已包含这些权限。',
      '重新授权后再重试失败项。',
    ],
  },
  AD_ACCOUNT_ACCESS_DENIED: {
    entityType: 'account',
    customerMessage: '授权用户无法访问该广告账户，或账户未分配给对应商务管理平台。',
    retryable: false,
    source: 'meta',
    nextActions: [
      '在 Business Manager 检查授权用户是否有该广告账户的管理员或广告管理权限。',
      '确认广告账户已绑定到当前客户组织。',
      '重新同步账户并重试失败项。',
    ],
  },
  AD_ACCOUNT_UNAVAILABLE: {
    entityType: 'account',
    customerMessage: '广告账户当前不可用于投放，可能存在封禁、风控、支付或额度问题。',
    retryable: false,
    source: 'meta',
    nextActions: [
      '打开 Meta 广告账户质量和账单页面检查账户状态。',
      '处理支付、风控或账户停用问题后再重试。',
      '必要时更换可投放广告账户。',
    ],
  },
  PAGE_ACCESS_REQUIRED: {
    entityType: 'page',
    customerMessage: '广告账户未正确配置可推广主页，或授权用户没有主页访问权限。',
    retryable: false,
    source: 'meta',
    nextActions: [
      '在广告账户资产里分配 Facebook 主页。',
      '确认授权用户有主页管理权限，且 pages_show_list、pages_read_engagement、pages_manage_ads 已授权。',
      '重新同步主页后重试失败项。',
    ],
  },
  PIXEL_ACCESS_REQUIRED: {
    entityType: 'pixel',
    customerMessage: '广告账户缺少可用 Pixel，或当前授权无法访问所选 Pixel。',
    retryable: false,
    source: 'meta',
    nextActions: [
      '在 Business Manager 将 Pixel 分配给该广告账户。',
      '在 AutoArk 重新同步 Pixel 并选择有效 Pixel。',
      '确认优化事件和转化配置可用后重试。',
    ],
  },
  BUDGET_OR_BID_INVALID: {
    entityType: 'budget',
    customerMessage: '预算、出价或投放时间配置不符合 Meta 要求。',
    retryable: false,
    source: 'validation',
    nextActions: [
      '检查广告系列或广告组预算是否低于 Meta 最低值。',
      '确认出价策略、出价金额和投放时间组合合法。',
      '修改草稿配置后重新发布任务。',
    ],
  },
  TARGETING_INVALID: {
    entityType: 'targeting',
    customerMessage: '定向配置不合法或与当前广告目标不兼容。',
    retryable: false,
    source: 'validation',
    nextActions: [
      '检查国家、地区、兴趣、版位和年龄等定向条件。',
      '确认定向包没有使用 Meta 已下线或不可用的选项。',
      '修改定向包后重新发布任务。',
    ],
  },
  CREATIVE_OR_MATERIAL_FAILED: {
    entityType: 'creative',
    customerMessage: '素材上传或广告创意创建失败，广告未能完成创建。',
    retryable: false,
    source: 'meta',
    nextActions: [
      '检查图片、视频 URL 是否可公开访问。',
      '确认素材尺寸、格式、时长和文案符合 Meta 广告规范。',
      '替换问题素材后重新发布任务。',
    ],
  },
  META_RATE_LIMIT: {
    entityType: 'rate_limit',
    customerMessage: 'Meta 接口触发限流，任务暂时无法继续。',
    retryable: true,
    source: 'meta',
    nextActions: [
      '等待数分钟后重试失败项。',
      '降低同一 App 或同一 Token 的并发任务数量。',
      '如频繁发生，拆分任务或增加可用 Facebook App。',
    ],
  },
  WORKER_TIMEOUT: {
    entityType: 'worker',
    customerMessage: '任务执行超时或 Worker 中断，本次账户执行未完成。',
    retryable: true,
    source: 'worker',
    nextActions: [
      '确认后台服务和队列正常运行。',
      '点击重试失败项重新执行该账户。',
      '如果连续超时，减少单次任务账户数或检查 Meta 接口响应。',
    ],
  },
  NO_ADS_CREATED: {
    entityType: 'ad',
    customerMessage: '本账户没有成功创建任何广告，通常是素材、创意或前置配置失败导致。',
    retryable: false,
    source: 'autoark',
    nextActions: [
      '查看素材上传、创意创建和广告创建的原始错误。',
      '确认素材组和文案包至少能组合出一个有效广告。',
      '修复配置后重新发布或重跑任务。',
    ],
  },
  META_VALIDATION_ERROR: {
    entityType: 'meta_validation',
    customerMessage: 'Meta 拒绝了当前广告配置，请按原始错误修改草稿后重试。',
    retryable: false,
    source: 'meta',
    nextActions: [
      '查看原始错误中的字段和原因。',
      '修改草稿中的对应广告系列、广告组或创意配置。',
      '重新发布任务。',
    ],
  },
  EXECUTION_ERROR: {
    entityType: 'general',
    customerMessage: '任务执行失败，系统已保留原始错误供排查。',
    retryable: true,
    source: 'autoark',
    nextActions: [
      '刷新任务详情查看最新状态。',
      '如果错误仍不明确，请联系运营或技术人员查看原始错误。',
      '确认配置无误后可重试失败项。',
    ],
  },
}

const KNOWN_EXPLICIT_CODES = new Set([
  'WORKER_TIMEOUT',
  'NO_ADS_CREATED',
  'META_RATE_LIMIT',
  'FACEBOOK_AUTH_REQUIRED',
  'FACEBOOK_PERMISSION_DENIED',
  'AD_ACCOUNT_ACCESS_DENIED',
  'AD_ACCOUNT_UNAVAILABLE',
  'PAGE_ACCESS_REQUIRED',
  'PIXEL_ACCESS_REQUIRED',
  'BUDGET_OR_BID_INVALID',
  'TARGETING_INVALID',
  'CREATIVE_OR_MATERIAL_FAILED',
  'META_VALIDATION_ERROR',
])

const toRecord = (value: any): Record<string, any> | null => {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, any>
}

const firstDefined = (...values: any[]) => values.find(value => value !== undefined && value !== null && value !== '')

const collectCandidates = (errorLike: any): Record<string, any>[] => {
  const root = toRecord(errorLike)
  if (!root) return []

  const candidates = [
    root,
    toRecord(root.error),
    toRecord(root.response),
    toRecord(root.response?.error),
    toRecord(root.response?.data),
    toRecord(root.response?.data?.error),
    toRecord(root.details),
    toRecord(root.details?.error),
    toRecord(root.details?.data),
    toRecord(root.details?.data?.error),
  ]

  return candidates.filter(Boolean) as Record<string, any>[]
}

const extractMessage = (errorLike: any, candidates: Record<string, any>[]): string => {
  if (typeof errorLike === 'string') return errorLike

  for (const candidate of candidates) {
    const message = firstDefined(
      candidate.errorMessage,
      candidate.error_user_msg,
      candidate.error_user_title,
      candidate.userMsg,
      candidate.userMessage,
      candidate.message,
      typeof candidate.error === 'string' ? candidate.error : undefined,
    )
    if (message) return String(message)
  }

  if (errorLike instanceof Error) return errorLike.message

  try {
    return JSON.stringify(errorLike).slice(0, 500)
  } catch {
    return 'Unknown error'
  }
}

const extractRawCode = (candidates: Record<string, any>[]): number | string | undefined => {
  for (const candidate of candidates) {
    const code = firstDefined(candidate.code, candidate.rawCode)
    if (code !== undefined) return code
  }
  return undefined
}

const extractRawSubcode = (candidates: Record<string, any>[]): number | string | undefined => {
  for (const candidate of candidates) {
    const subcode = firstDefined(candidate.subcode, candidate.error_subcode, candidate.rawSubcode)
    if (subcode !== undefined) return subcode
  }
  return undefined
}

const includesAny = (text: string, patterns: string[]) => patterns.some(pattern => text.includes(pattern.toLowerCase()))

const classifyErrorCode = (
  message: string,
  rawCode?: number | string,
  explicitCode?: string,
): string => {
  if (explicitCode && KNOWN_EXPLICIT_CODES.has(explicitCode)) {
    return explicitCode
  }

  const text = message.toLowerCase()
  const code = Number(rawCode)

  if (includesAny(text, ['timeout', 'timed out', 'worker crashed', '执行超时', '中断'])) {
    return 'WORKER_TIMEOUT'
  }
  if ([4, 17, 613].includes(code) || includesAny(text, ['rate limit', 'request limit', 'too many calls', '限流', '请求次数'])) {
    return 'META_RATE_LIMIT'
  }
  if ([190, 102].includes(code) || includesAny(text, ['access token', 'invalid oauth', 'oauth', 'token has expired', 'token expired', 'facebook token', '登录', '授权'])) {
    return 'FACEBOOK_AUTH_REQUIRED'
  }
  if (includesAny(text, ['pixel', 'promoted_object', 'custom conversion', '像素', '转化事件'])) {
    return 'PIXEL_ACCESS_REQUIRED'
  }
  if (includesAny(text, ['promote_pages', 'page id', 'page_id', 'object_story_spec', 'facebook page', '主页', '公共主页'])) {
    return 'PAGE_ACCESS_REQUIRED'
  }
  if (includesAny(text, ['creative', 'adcreative', 'image', 'video', 'thumbnail', 'hash', 'upload', 'file_url', '素材', '创意', '图片', '视频'])) {
    return 'CREATIVE_OR_MATERIAL_FAILED'
  }
  if (includesAny(text, ['ad account', 'act_', '广告账户', 'account has been disabled', 'disabled ad account', 'no permission to access ad account'])) {
    if (includesAny(text, ['disabled', 'payment', 'billing', 'spend cap', 'risk', '封禁', '停用', '支付', '账单', '风控'])) {
      return 'AD_ACCOUNT_UNAVAILABLE'
    }
    return 'AD_ACCOUNT_ACCESS_DENIED'
  }
  if ([10, 200].includes(code) || includesAny(text, ['permission', 'permissions', 'not authorized', 'ads_management', 'pages_manage_ads', 'business_management', '权限'])) {
    return 'FACEBOOK_PERMISSION_DENIED'
  }
  if (includesAny(text, ['budget', 'bid', 'daily_budget', 'lifetime_budget', 'spend_cap', '预算', '出价'])) {
    return 'BUDGET_OR_BID_INVALID'
  }
  if (includesAny(text, ['targeting', 'geo_locations', 'audience', 'interest', 'location', '定向', '受众', '地区', '国家'])) {
    return 'TARGETING_INVALID'
  }
  if (Number.isFinite(code) && code === 100) {
    return 'META_VALIDATION_ERROR'
  }

  return explicitCode || 'EXECUTION_ERROR'
}

const normalizeTimestamp = (value: any): Date => {
  if (!value) return new Date()
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

export const diagnoseBulkAdError = (
  errorLike: any,
  options: DiagnoseOptions = {},
): BulkAdDiagnostic => {
  const root = toRecord(errorLike)
  const candidates = collectCandidates(errorLike)
  const message = extractMessage(errorLike, candidates)
  const rawCode = extractRawCode(candidates)
  const rawSubcode = extractRawSubcode(candidates)
  const explicitCode = firstDefined(root?.errorCode, options.fallbackCode)
  const errorCode = classifyErrorCode(message, rawCode, explicitCode)
  const template = DIAGNOSIS_TEMPLATES[errorCode] || DIAGNOSIS_TEMPLATES.EXECUTION_ERROR

  const codeSuffix = [rawCode ? `Meta code ${rawCode}` : '', rawSubcode ? `subcode ${rawSubcode}` : '']
    .filter(Boolean)
    .join(', ')
  const operatorMessage = root?.operatorMessage
    || (codeSuffix ? `原始错误：${message}（${codeSuffix}）` : `原始错误：${message}`)

  return {
    entityType: options.entityType || root?.entityType || template.entityType,
    errorCode,
    errorMessage: root?.errorMessage || message,
    customerMessage: root?.customerMessage || template.customerMessage,
    operatorMessage,
    severity: root?.severity || template.severity || 'error',
    retryable: typeof root?.retryable === 'boolean' ? root.retryable : template.retryable,
    nextActions: Array.isArray(root?.nextActions) && root.nextActions.length > 0 ? root.nextActions : template.nextActions,
    source: root?.source || template.source,
    rawCode,
    rawSubcode,
    timestamp: normalizeTimestamp(root?.timestamp),
  }
}

export const normalizeTaskErrors = (
  errors: any,
  options: DiagnoseOptions = {},
): BulkAdDiagnostic[] => {
  const errorList = Array.isArray(errors) ? errors : errors ? [errors] : []
  return errorList
    .filter(Boolean)
    .map(error => diagnoseBulkAdError(error, options))
}

export const enrichTaskDiagnostics = (task: any) => {
  const output = typeof task?.toObject === 'function' ? task.toObject({ virtuals: true }) : task
  if (!output || !Array.isArray(output.items)) return output

  output.items = output.items.map((item: any) => {
    const existingErrors = Array.isArray(item.errors) && item.errors.length === 0 && item.error
      ? [item.error]
      : item.errors

    return {
      ...item,
      errors: normalizeTaskErrors(existingErrors, { entityType: item.status === 'failed' ? 'general' : undefined }),
    }
  })

  return output
}

const addUnique = (values: string[], nextValues: string[]) => {
  for (const value of nextValues) {
    if (value && !values.includes(value)) values.push(value)
  }
}

const getTaskId = (task: any) => {
  const id = task?._id || task?.id
  return id ? String(id) : undefined
}

const buildSyntheticItemError = (item: any) => diagnoseBulkAdError(
  item.error || item.status || 'Task item failed without structured error',
  {
    fallbackCode: 'EXECUTION_ERROR',
    entityType: 'general',
  },
)

export const buildTaskOperationalDiagnostics = (task: any): BulkAdTaskOperationalDiagnostics => {
  const enriched = enrichTaskDiagnostics(task)
  const items = Array.isArray(enriched?.items) ? enriched.items : []
  const buckets = new Map<string, BulkAdTaskDiagnosticBucket>()
  const topNextActions: string[] = []

  let retryableErrors = 0
  let blockedErrors = 0
  let totalErrors = 0

  for (const item of items) {
    const itemErrors = Array.isArray(item.errors) && item.errors.length > 0
      ? item.errors
      : item.status === 'failed'
        ? [buildSyntheticItemError(item)]
        : []

    for (const error of itemErrors) {
      const diagnosis = diagnoseBulkAdError(error)
      totalErrors += 1
      if (diagnosis.retryable) retryableErrors += 1
      else blockedErrors += 1

      const existing = buckets.get(diagnosis.errorCode)
      const account = {
        accountId: item.accountId,
        accountName: item.accountName,
      }

      if (existing) {
        existing.count += 1
        if (account.accountId && !existing.accounts.some(existingAccount => existingAccount.accountId === account.accountId)) {
          existing.accounts.push(account)
        }
        addUnique(existing.nextActions, diagnosis.nextActions)
      } else {
        buckets.set(diagnosis.errorCode, {
          errorCode: diagnosis.errorCode,
          entityType: diagnosis.entityType,
          customerMessage: diagnosis.customerMessage,
          retryable: diagnosis.retryable,
          source: diagnosis.source,
          count: 1,
          accounts: account.accountId ? [account] : [],
          nextActions: [...diagnosis.nextActions],
        })
      }

      addUnique(topNextActions, diagnosis.nextActions)
    }
  }

  const successAccounts = items.filter((item: any) => ['success', 'completed'].includes(item.status)).length
  const failedAccounts = items.filter((item: any) => item.status === 'failed').length
  const processingAccounts = items.filter((item: any) => item.status === 'processing').length
  const pendingAccounts = items.filter((item: any) => ['pending', 'queued'].includes(item.status)).length

  let health: BulkAdTaskOperationalDiagnostics['health'] = 'unknown'
  if (items.length === 0) health = 'unknown'
  else if (processingAccounts > 0 || pendingAccounts > 0) health = 'running'
  else if (failedAccounts === 0 && totalErrors === 0) health = 'healthy'
  else if (blockedErrors === 0 && retryableErrors > 0) health = 'retryable'
  else if (retryableErrors === 0 && blockedErrors > 0) health = 'blocked'
  else health = 'mixed'

  return {
    taskId: getTaskId(enriched),
    status: enriched?.status,
    health,
    summary: {
      totalAccounts: items.length,
      successAccounts,
      failedAccounts,
      processingAccounts,
      pendingAccounts,
      totalErrors,
      retryableErrors,
      blockedErrors,
    },
    buckets: Array.from(buckets.values()).sort((a, b) => b.count - a.count),
    topNextActions: topNextActions.slice(0, 6),
  }
}
