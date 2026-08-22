import crypto from 'crypto'

type CreativeFactoryAction = 'catalog' | 'generate' | 'status'

const CREATIVE_FACTORY_SERVICE_ID = 'creative-factory'
const CREATIVE_FACTORY_ENVELOPE_VERSION = 'creative-factory-request-v2'

const baseUrl = () =>
  (
    process.env.AI_HOST_CREATIVE_FACTORY_URL ||
    'https://cling-ai.com/api/v1/internal/creative-factory'
  ).replace(/\/+$/, '')

const internalSecret = () => process.env.AI_HOST_INTERNAL_API_SECRET || ''

async function post<T>(
  action: CreativeFactoryAction,
  body: Record<string, unknown>,
): Promise<T> {
  const secret = internalSecret()
  if (secret.length < 32 || secret !== secret.trim()) {
    throw new Error('AI_HOST_INTERNAL_API_SECRET 未安全配置')
  }

  const serialized = JSON.stringify(body)
  const requestUrl = new URL(`${baseUrl()}/${action}`)
  const requestPath = `${requestUrl.pathname}${requestUrl.search}`
  const timestamp = String(Date.now())
  const nonce = crypto.randomBytes(16).toString('hex')
  const bodyDigest = crypto
    .createHash('sha256')
    .update(serialized)
    .digest('hex')
  const signingPayload = [
    CREATIVE_FACTORY_ENVELOPE_VERSION,
    `service:${CREATIVE_FACTORY_SERVICE_ID}`,
    'method:POST',
    `path:${requestPath}`,
    `timestamp:${timestamp}`,
    `nonce:${nonce}`,
    `body-sha256:${bodyDigest}`,
  ].join('\n')
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingPayload)
    .digest('hex')
  // Keep the legacy header during the receiver rollout. The old backend uses
  // it; the V2 backend ignores it and verifies the path-bound nonce envelope.
  const legacySignature = crypto
    .createHmac('sha256', secret)
    .update(serialized)
    .digest('hex')
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    action === 'generate' ? 12 * 60_000 : 180_000,
  )

  try {
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Creative-Factory-Id': CREATIVE_FACTORY_SERVICE_ID,
        'X-Creative-Factory-Timestamp': timestamp,
        'X-Creative-Factory-Nonce': nonce,
        'X-Creative-Factory-Signature': signature,
        'X-Internal-Signature': legacySignature,
      },
      body: serialized,
      signal: controller.signal,
    })
    const payload: any = await response.json().catch(() => ({}))
    if (!response.ok || payload?.success === false) {
      throw new Error(
        payload?.message ||
          payload?.error ||
          `ai-host 请求失败 (${response.status})`,
      )
    }
    return (payload?.data ?? payload) as T
  } finally {
    clearTimeout(timeout)
  }
}

export type AiHostGeneration = {
  externalBatchId: string
  externalVariantId: string
  generationId: string
  featureKey: string
  templateId?: string
  presetToken: string
  status: string
  mediaType: 'image' | 'video'
  resultUrl?: string | null
  genJobId?: string | null
  error?: string | null
  landingUrl?: string | null
  updatedAt?: string | null
}

export const getAiHostCreativeCatalog = (featureKey?: string) =>
  post<{ features: any[]; templates: any[] }>(
    'catalog',
    featureKey ? { featureKey } : {},
  )

export const createAiHostGeneration = (body: {
  externalBatchId: string
  externalVariantId: string
  sourceImageUrl: string
  featureKey: string
  templateId?: string
  creativeDirection?: string
  imageOperation?: 'sfw' | 'undress'
  styleReference?: {
    materialId: string
    url: string
    mediaType: 'image' | 'video'
    name?: string
  }
}) => post<AiHostGeneration>('generate', body)

export const getAiHostGenerationStatus = (body: {
  externalBatchId: string
  externalVariantId: string
  featureKey: string
}) => post<AiHostGeneration>('status', body)
