import { authFetch } from './api'

export type ProductLinkPlatform = 'ios' | 'android'
export type ProductLinkPoolStatus = 'active' | 'inactive'

export interface ProductLinkDestination {
  _id?: string
  name: string
  platform: ProductLinkPlatform
  url: string
  weight: number
  enabled: boolean
}

export interface ProductLinkPool {
  _id: string
  name: string
  description: string
  shortCode: string
  shortUrl: string
  fallbackUrl: string
  status: ProductLinkPoolStatus
  destinations: ProductLinkDestination[]
  createdAt: string
  updatedAt: string
}

export interface ProductLinkPoolInput {
  name: string
  description?: string
  fallbackUrl?: string
  status?: ProductLinkPoolStatus
  destinations?: ProductLinkDestination[]
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || payload.message || '产品池请求失败')
  }
  return payload.data as T
}

const sanitizeInput = (input: ProductLinkPoolInput): ProductLinkPoolInput => ({
  name: input.name.trim(),
  description: input.description?.trim() || '',
  fallbackUrl: input.fallbackUrl?.trim() || '',
  ...(input.status && { status: input.status }),
  ...(input.destinations && {
    destinations: input.destinations.map(destination => ({
      ...(destination._id && { _id: destination._id }),
      name: destination.name.trim(),
      platform: destination.platform,
      url: destination.url.trim(),
      weight: Number(destination.weight),
      enabled: destination.enabled,
    })),
  }),
})

export const listProductLinkPools = async (): Promise<ProductLinkPool[]> => {
  const response = await authFetch('/api/product-link-pools')
  return parseResponse<ProductLinkPool[]>(response)
}

export const createProductLinkPool = async (
  input: ProductLinkPoolInput,
): Promise<ProductLinkPool> => {
  const response = await authFetch('/api/product-link-pools', {
    method: 'POST',
    body: JSON.stringify(sanitizeInput(input)),
  })
  return parseResponse<ProductLinkPool>(response)
}

export const updateProductLinkPool = async (
  poolId: string,
  input: ProductLinkPoolInput,
): Promise<ProductLinkPool> => {
  const response = await authFetch(`/api/product-link-pools/${poolId}`, {
    method: 'PUT',
    body: JSON.stringify(sanitizeInput(input)),
  })
  return parseResponse<ProductLinkPool>(response)
}

export const deleteProductLinkPool = async (poolId: string): Promise<{ id: string }> => {
  const response = await authFetch(`/api/product-link-pools/${poolId}`, {
    method: 'DELETE',
  })
  return parseResponse<{ id: string }>(response)
}
