import crypto from 'crypto'

type CreativeFactoryAction = 'catalog' | 'generate' | 'status'

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
  if (!secret) throw new Error('AI_HOST_INTERNAL_API_SECRET 未配置')

  const serialized = JSON.stringify(body)
  const signature = crypto
    .createHmac('sha256', secret)
    .update(serialized)
    .digest('hex')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180_000)

  try {
    const response = await fetch(`${baseUrl()}/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Signature': signature,
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
}) => post<AiHostGeneration>('generate', body)

export const getAiHostGenerationStatus = (body: {
  externalBatchId: string
  externalVariantId: string
  featureKey: string
}) => post<AiHostGeneration>('status', body)
