import { authFetch } from './api'

const MATERIAL_VARIANT_API = '/api/material-variants'

export type MaterialVariantStatus =
  | 'submitting'
  | 'submission_unknown'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface MaterialVariantJob {
  _id: string
  parentMaterialId: string
  outputMaterialId?: string
  generationJobId?: string
  status: MaterialVariantStatus
  input: {
    prompt: string
    negativePrompt?: string
    referenceImageUrl?: string
    durationSeconds: number
    frameRate: number
    strength: number
    preserveAudio: boolean
    aspectRatio: string
    seed?: number
  }
  generation: {
    service: string
    provider?: string
    capability: 'video_edit'
    priority: number
    resultUrlPolicy: 'permanent'
  }
  output?: {
    resultUrl: string
    metadata?: Record<string, unknown>
  }
  error?: {
    code?: string
    message?: string
  }
  idempotentReplay?: boolean
  warning?: string
  createdAt?: string
  updatedAt?: string
}

export interface CreateMaterialVariantInput {
  parentMaterialId: string
  prompt: string
  negativePrompt?: string
  referenceImageUrl?: string
  durationSeconds: number
  strength: number
  preserveAudio: boolean
  aspectRatio?: string
}

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

const readEnvelope = async <T>(response: Response): Promise<T> => {
  const body = await response.json() as ApiEnvelope<T>
  if (!response.ok || !body.success || body.data === undefined) {
    throw new Error(body.error || body.message || 'AI 视频变体请求失败')
  }
  return body.data
}

export const createMaterialVariant = async (
  input: CreateMaterialVariantInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<MaterialVariantJob> => {
  const response = await authFetch(MATERIAL_VARIANT_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
    signal,
  })
  return readEnvelope<MaterialVariantJob>(response)
}

export const getMaterialVariant = async (
  jobId: string,
  signal?: AbortSignal,
): Promise<MaterialVariantJob> => {
  const response = await authFetch(
    `${MATERIAL_VARIANT_API}/${encodeURIComponent(jobId)}`,
    { signal },
  )
  return readEnvelope<MaterialVariantJob>(response)
}

export const getMaterialVariantConfigStatus = async (
  signal?: AbortSignal,
): Promise<{ configured: boolean; missing: string[]; invalid: string[] }> => {
  const response = await authFetch(`${MATERIAL_VARIANT_API}/config-status`, { signal })
  return readEnvelope(response)
}

export const createMaterialVariantIdempotencyKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `variant-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export const isMaterialVariantTerminal = (status: MaterialVariantStatus): boolean => (
  status === 'completed' || status === 'failed' || status === 'cancelled'
)
