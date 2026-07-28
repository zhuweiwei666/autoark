import axios from 'axios'
import { createHash, createHmac, timingSafeEqual } from 'crypto'
import net from 'net'

export const MATERIAL_VARIANT_CAPABILITY = 'video_edit'
export const MATERIAL_VARIANT_PRIORITY = 20
export const MATERIAL_VARIANT_RESULT_URL_POLICY = 'permanent'
export const MATERIAL_VARIANT_CALLBACK_PATH =
  '/api/internal/generation/material-variants/callback'

const ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5', '5:4'] as const
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/

export class MaterialVariantError extends Error {
  statusCode: number
  code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

export interface MaterialVariantInput {
  sourceVideoUrl: string
  prompt: string
  negativePrompt?: string
  referenceImageUrl?: string
  durationSeconds: number
  frameRate: number
  strength: number
  preserveAudio: boolean
  aspectRatio: (typeof ASPECT_RATIOS)[number]
  seed?: number
}

interface GenerationConfig {
  baseUrl: string
  apiKey: string
  hmacSecret: string
  callbackBaseUrl: string
  timeoutMs: number
}

const stringValue = (value: unknown, maxLength: number): string => {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

const parseNumber = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number => {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new MaterialVariantError(
      400,
      'INVALID_VARIANT_INPUT',
      `${field} 必须在 ${min} 到 ${max} 之间`,
    )
  }
  return parsed
}

const isPrivateIp = (hostname: string): boolean => {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (net.isIPv4(host)) {
    const [a, b] = host.split('.').map(Number)
    return (
      a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224
    )
  }
  if (net.isIPv6(host)) {
    const normalized = host
    return (
      normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith('::ffff:127.')
      || normalized.startsWith('::ffff:10.')
      || normalized.startsWith('::ffff:192.168.')
    )
  }
  return false
}

export const normalizePublicHttpUrl = (
  value: unknown,
  field: string,
  { allowLocalDevelopment = false }: { allowLocalDevelopment?: boolean } = {},
): string => {
  const raw = stringValue(value, 4096)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new MaterialVariantError(400, 'INVALID_URL', `${field} 必须是有效的 HTTP(S) URL`)
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
  ) {
    throw new MaterialVariantError(
      400,
      'INVALID_URL',
      `${field} 必须是不含账号密码的 HTTP(S) URL`,
    )
  }

  const hostname = parsed.hostname.toLowerCase()
  const localHostname = hostname === 'localhost' || hostname.endsWith('.localhost')
  if ((!allowLocalDevelopment || process.env.NODE_ENV === 'production') && (localHostname || isPrivateIp(hostname))) {
    throw new MaterialVariantError(400, 'INVALID_URL', `${field} 不能指向本机或私有网络`)
  }

  return parsed.toString()
}

export const inferMaterialAspectRatio = (file: any): (typeof ASPECT_RATIOS)[number] => {
  const width = Number(file?.width)
  const height = Number(file?.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '9:16'
  }

  const ratio = width / height
  const candidates: Array<[(typeof ASPECT_RATIOS)[number], number]> = [
    ['9:16', 9 / 16],
    ['16:9', 16 / 9],
    ['1:1', 1],
    ['4:5', 4 / 5],
    ['5:4', 5 / 4],
  ]
  return candidates.reduce((best, current) => (
    Math.abs(current[1] - ratio) < Math.abs(best[1] - ratio) ? current : best
  ))[0]
}

export const parseMaterialVariantInput = (
  body: any,
  sourceVideoUrl: string,
  defaultAspectRatio: (typeof ASPECT_RATIOS)[number] = '9:16',
): MaterialVariantInput => {
  const prompt = stringValue(body?.prompt, 2000)
  if (prompt.length < 3) {
    throw new MaterialVariantError(
      400,
      'INVALID_VARIANT_INPUT',
      'prompt 至少需要 3 个字符',
    )
  }

  const negativePrompt = stringValue(body?.negativePrompt, 2000) || undefined
  const referenceValue = stringValue(body?.referenceImageUrl, 4096)
  const referenceImageUrl = referenceValue
    ? normalizePublicHttpUrl(referenceValue, 'referenceImageUrl')
    : undefined
  const durationSeconds = parseNumber(
    body?.durationSeconds,
    3,
    2,
    5,
    'durationSeconds',
  )
  const strength = parseNumber(body?.strength, 0.85, 0.1, 1, 'strength')
  const requestedAspectRatio = stringValue(body?.aspectRatio, 8) || defaultAspectRatio
  if (!ASPECT_RATIOS.includes(requestedAspectRatio as any)) {
    throw new MaterialVariantError(
      400,
      'INVALID_VARIANT_INPUT',
      `aspectRatio 仅支持 ${ASPECT_RATIOS.join('、')}`,
    )
  }

  let seed: number | undefined
  if (body?.seed !== undefined && body?.seed !== null && body?.seed !== '') {
    seed = parseNumber(body.seed, 0, 0, 9_999_999_999_999, 'seed')
    if (!Number.isInteger(seed)) {
      throw new MaterialVariantError(400, 'INVALID_VARIANT_INPUT', 'seed 必须是整数')
    }
  }

  return {
    sourceVideoUrl: normalizePublicHttpUrl(sourceVideoUrl, '素材视频 URL'),
    prompt,
    negativePrompt,
    referenceImageUrl,
    durationSeconds,
    frameRate: 16,
    strength,
    preserveAudio: body?.preserveAudio !== false,
    aspectRatio: requestedAspectRatio as (typeof ASPECT_RATIOS)[number],
    seed,
  }
}

export const normalizeIdempotencyKey = (value: unknown): string => {
  const key = stringValue(Array.isArray(value) ? value[0] : value, 129)
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new MaterialVariantError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      '必须提供 8-128 位的 Idempotency-Key，仅允许字母、数字、点、下划线、冒号和短横线',
    )
  }
  return key
}

export const buildMaterialVariantScopeKey = (parent: any, userId: string): string => {
  const organizationId = parent?.organizationId?.toString?.()
  return organizationId ? `org:${organizationId}` : `owner:${userId}`
}

export const buildRequestFingerprint = (
  parentMaterialId: unknown,
  input: MaterialVariantInput,
): string => createHash('sha256')
  .update(JSON.stringify({
    parentMaterialId: String(parentMaterialId),
    sourceVideoUrl: input.sourceVideoUrl,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt || '',
    referenceImageUrl: input.referenceImageUrl || '',
    durationSeconds: input.durationSeconds,
    frameRate: input.frameRate,
    strength: input.strength,
    preserveAudio: input.preserveAudio,
    aspectRatio: input.aspectRatio,
    seed: input.seed ?? null,
  }))
  .digest('hex')

export const buildUpstreamIdempotencyKey = (
  scopeKey: string,
  idempotencyKey: string,
): string => {
  const scopeHash = createHash('sha256').update(scopeKey).digest('hex').slice(0, 16)
  return `autoark:material-variant:${scopeHash}:${idempotencyKey}`
}

const normalizeBaseUrl = (
  value: unknown,
  field: string,
  allowLocalDevelopment = false,
): string => normalizePublicHttpUrl(value, field, { allowLocalDevelopment })
  .replace(/\/+$/, '')

export const getMaterialVariantGenerationConfigStatus = () => {
  const required = [
    'AI_HOST_GENERATION_BASE_URL',
    'AI_HOST_GENERATION_API_KEY',
    'AI_HOST_GENERATION_HMAC_SECRET',
    'AUTOARK_PUBLIC_BASE_URL',
  ] as const
  const missing = required.filter(name => !stringValue(process.env[name], 4096))
  const invalid: string[] = []

  if (!missing.includes('AI_HOST_GENERATION_BASE_URL')) {
    try {
      normalizeBaseUrl(
        process.env.AI_HOST_GENERATION_BASE_URL,
        'AI_HOST_GENERATION_BASE_URL',
        true,
      )
    } catch {
      invalid.push('AI_HOST_GENERATION_BASE_URL')
    }
  }
  if (!missing.includes('AUTOARK_PUBLIC_BASE_URL')) {
    try {
      normalizeBaseUrl(process.env.AUTOARK_PUBLIC_BASE_URL, 'AUTOARK_PUBLIC_BASE_URL', true)
    } catch {
      invalid.push('AUTOARK_PUBLIC_BASE_URL')
    }
  }
  if (
    !missing.includes('AI_HOST_GENERATION_HMAC_SECRET')
    && stringValue(process.env.AI_HOST_GENERATION_HMAC_SECRET, 4096).length < 16
  ) {
    invalid.push('AI_HOST_GENERATION_HMAC_SECRET')
  }

  return {
    configured: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
  }
}

export const getMaterialVariantGenerationConfig = (): GenerationConfig => {
  const status = getMaterialVariantGenerationConfigStatus()
  if (!status.configured) {
    throw new MaterialVariantError(
      503,
      'GENERATION_NOT_CONFIGURED',
      `AI 视频变体服务尚未配置：${[...status.missing, ...status.invalid].join('、')}`,
    )
  }

  const timeoutCandidate = Number(process.env.AI_HOST_GENERATION_TIMEOUT_MS || 20_000)
  const timeoutMs = Number.isFinite(timeoutCandidate)
    ? Math.min(60_000, Math.max(5_000, Math.floor(timeoutCandidate)))
    : 20_000

  return {
    baseUrl: normalizeBaseUrl(
      process.env.AI_HOST_GENERATION_BASE_URL,
      'AI_HOST_GENERATION_BASE_URL',
      true,
    ),
    apiKey: String(process.env.AI_HOST_GENERATION_API_KEY),
    hmacSecret: String(process.env.AI_HOST_GENERATION_HMAC_SECRET),
    callbackBaseUrl: normalizeBaseUrl(
      process.env.AUTOARK_PUBLIC_BASE_URL,
      'AUTOARK_PUBLIC_BASE_URL',
      true,
    ),
    timeoutMs,
  }
}

export const buildGenerationJobRequest = (job: any, config: GenerationConfig) => ({
  externalId: job.externalId,
  idempotencyKey: job.upstreamIdempotencyKey,
  origin: {
    userId: String(job.createdBy),
    source: 'autoark-material-variant',
  },
  capability: MATERIAL_VARIANT_CAPABILITY,
  priority: MATERIAL_VARIANT_PRIORITY,
  resultUrlPolicy: MATERIAL_VARIANT_RESULT_URL_POLICY,
  callbackUrl: `${config.callbackBaseUrl}${MATERIAL_VARIANT_CALLBACK_PATH}`,
  input: {
    sourceVideoUrl: job.input.sourceVideoUrl,
    prompt: job.input.prompt,
    ...(job.input.negativePrompt ? { negativePrompt: job.input.negativePrompt } : {}),
    ...(job.input.referenceImageUrl
      ? { referenceImageUrl: job.input.referenceImageUrl }
      : {}),
    durationSeconds: job.input.durationSeconds,
    frameRate: job.input.frameRate,
    strength: job.input.strength,
    preserveAudio: job.input.preserveAudio,
    aspectRatio: job.input.aspectRatio,
    ...(Number.isInteger(job.input.seed) ? { seed: job.input.seed } : {}),
  },
})

export const submitMaterialVariantGeneration = async (job: any) => {
  const config = getMaterialVariantGenerationConfig()
  const response = await axios.post(
    `${config.baseUrl}/api/v1/jobs`,
    buildGenerationJobRequest(job, config),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey,
      },
      timeout: config.timeoutMs,
      maxContentLength: 512 * 1024,
      maxBodyLength: 512 * 1024,
    },
  )
  const created = response.data?.data
  if (!created?.jobId || typeof created.jobId !== 'string') {
    throw new MaterialVariantError(
      502,
      'INVALID_GENERATION_RESPONSE',
      'AI 视频变体服务未返回有效 jobId',
    )
  }
  return created
}

export const isAmbiguousGenerationSubmissionError = (error: any): boolean => (
  Boolean(error?.isAxiosError)
  && !error?.response
)

export const safeGenerationError = (error: any): { code: string; message: string } => {
  const code = stringValue(
    error?.response?.data?.code || error?.code || 'GENERATION_SUBMISSION_FAILED',
    80,
  ) || 'GENERATION_SUBMISSION_FAILED'
  const message = stringValue(
    error?.response?.data?.message || error?.message || 'AI 视频变体任务提交失败',
    500,
  ) || 'AI 视频变体任务提交失败'
  return { code, message }
}

export const signMaterialVariantCallback = (
  rawBody: Buffer | string,
  secret: string,
): string => createHmac('sha256', secret).update(rawBody).digest('hex')

export const verifyMaterialVariantCallback = (
  rawBody: Buffer,
  signature: unknown,
): boolean => {
  const config = getMaterialVariantGenerationConfig()
  const provided = stringValue(Array.isArray(signature) ? signature[0] : signature, 128)
  if (!/^[a-f0-9]{64}$/i.test(provided)) return false
  const expected = signMaterialVariantCallback(rawBody, config.hmacSecret)
  return timingSafeEqual(Buffer.from(provided.toLowerCase()), Buffer.from(expected))
}

export const isTerminalMaterialVariantStatus = (status: unknown): boolean => (
  TERMINAL_STATUSES.has(String(status))
)

const filenameFromUrl = (resultUrl: string, generationJobId: string): string => {
  try {
    const name = new URL(resultUrl).pathname.split('/').filter(Boolean).pop()
    if (name && /\.[a-z0-9]{2,5}$/i.test(name)) return name.slice(0, 180)
  } catch {
    // URL was validated before this helper; retain a deterministic fallback.
  }
  return `ai-variant-${generationJobId.slice(-12)}.mp4`
}

export const buildVariantMaterialRecord = ({
  parent,
  job,
  callback,
}: {
  parent: any
  job: any
  callback: any
}) => {
  const resultUrl = normalizePublicHttpUrl(callback?.output?.resultUrl, 'output.resultUrl')
  const generationJobId = String(callback.jobId)
  const parentName = stringValue(parent?.name, 120) || '视频素材'
  const suffix = generationJobId.slice(-8)
  const rootMaterialId = parent?.variant?.rootMaterialId || parent?._id
  const tags = Array.from(new Set([
    ...(Array.isArray(parent?.tags) ? parent.tags.filter((tag: any) => typeof tag === 'string') : []),
    'AI变体',
  ])).slice(0, 20)

  return {
    organizationId: job.organizationId || parent.organizationId,
    name: `${parentName} · AI变体 ${suffix}`.slice(0, 160),
    type: 'video',
    status: 'ready',
    storage: {
      provider: 'ai-host-v2',
      url: resultUrl,
    },
    file: {
      originalName: filenameFromUrl(resultUrl, generationJobId),
      mimeType: 'video/mp4',
      width: parent?.file?.width,
      height: parent?.file?.height,
      duration: job.input.durationSeconds,
    },
    thumbnail: parent?.thumbnail,
    source: {
      type: 'ai_variant',
      platform: 'ai-host-v2',
      importedAt: new Date(),
      importedBy: String(job.createdBy),
    },
    variant: {
      parentMaterialId: parent._id,
      rootMaterialId,
      variantJobId: job._id,
      generationJobId,
      provider: callback?.output?.metadata?.provider || 'comfyui-vace',
      capability: MATERIAL_VARIANT_CAPABILITY,
      prompt: job.input.prompt,
      negativePrompt: job.input.negativePrompt,
      referenceImageUrl: job.input.referenceImageUrl,
      strength: job.input.strength,
      seed: job.input.seed,
      durationSeconds: job.input.durationSeconds,
      frameRate: job.input.frameRate,
      aspectRatio: job.input.aspectRatio,
      preserveAudio: job.input.preserveAudio,
      reviewStatus: 'pending',
      createdAt: new Date(),
    },
    tags,
    folder: parent?.folder || '默认',
    createdBy: String(job.createdBy),
    notes: 'AI 生成的视频变体；请人工审核画面、文案和平台政策后再投放。',
    autoTestStatus: 'pending',
  }
}

export const serializeMaterialVariantJob = (
  document: any,
  options: { idempotentReplay?: boolean; warning?: string } = {},
) => {
  const job = document?.toObject ? document.toObject() : document
  if (!job) return null
  return {
    _id: String(job._id),
    parentMaterialId: String(job.parentMaterialId),
    outputMaterialId: job.outputMaterialId ? String(job.outputMaterialId) : undefined,
    generationJobId: job.generationJobId,
    status: job.status,
    input: {
      prompt: job.input?.prompt,
      negativePrompt: job.input?.negativePrompt,
      referenceImageUrl: job.input?.referenceImageUrl,
      durationSeconds: job.input?.durationSeconds,
      frameRate: job.input?.frameRate,
      strength: job.input?.strength,
      preserveAudio: job.input?.preserveAudio,
      aspectRatio: job.input?.aspectRatio,
      seed: job.input?.seed,
    },
    generation: {
      service: job.generation?.service || 'ai-host-v2',
      provider: job.generation?.provider,
      capability: MATERIAL_VARIANT_CAPABILITY,
      priority: MATERIAL_VARIANT_PRIORITY,
      resultUrlPolicy: MATERIAL_VARIANT_RESULT_URL_POLICY,
    },
    output: job.output?.resultUrl
      ? { resultUrl: job.output.resultUrl, metadata: job.output.metadata }
      : undefined,
    error: job.error?.message ? job.error : undefined,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    idempotentReplay: options.idempotentReplay === true,
    warning: options.warning,
  }
}
