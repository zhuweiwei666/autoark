import { facebookClient } from './facebookClient'

export interface PixelInfo {
  id: string
  name: string
  owner_business?: {
    id: string
    name: string
  }
  is_created_by_business?: boolean
  creation_time?: string
  last_fired_time?: string
  data_use_setting?: string
  enable_automatic_matching?: boolean
  pixel_id?: string
  code?: string
  raw?: any
}

export interface PixelEvent {
  event_name: string
  event_time: number
  event_id?: string
  user_data?: any
  custom_data?: any
  raw?: any
}

/**
 * 获取所有 Pixels
 */
export const getPixels = async (token: string): Promise<PixelInfo[]> => {
  const response = await facebookClient.get('/me/pixels', {
    access_token: token,
    fields: [
      'id',
      'name',
      'owner_business',
      'is_created_by_business',
      'creation_time',
      'last_fired_time',
      'data_use_setting',
      'enable_automatic_matching',
    ].join(','),
  })

  return (response.data || []).map((pixel: any) => ({
    id: pixel.id,
    name: pixel.name || 'Unnamed Pixel',
    owner_business: pixel.owner_business
      ? {
          id: pixel.owner_business.id,
          name: pixel.owner_business.name || 'Unknown Business',
        }
      : undefined,
    is_created_by_business: pixel.is_created_by_business || false,
    creation_time: pixel.creation_time,
    last_fired_time: pixel.last_fired_time,
    data_use_setting: pixel.data_use_setting,
    enable_automatic_matching: pixel.enable_automatic_matching,
    raw: pixel,
  }))
}

/**
 * 获取 Pixel 详情（包括代码）
 */
export const getPixelDetails = async (
  pixelId: string,
  token: string
): Promise<PixelInfo & { code?: string }> => {
  // 获取 pixel 详情
  const pixel = await facebookClient.get(`/${pixelId}`, {
    access_token: token,
    fields: [
      'id',
      'name',
      'owner_business',
      'is_created_by_business',
      'creation_time',
      'last_fired_time',
      'data_use_setting',
      'enable_automatic_matching',
    ].join(','),
  })

  // 获取 pixel 代码（需要额外请求）
  let code: string | undefined
  try {
    const codeResponse = await facebookClient.get(`/${pixelId}`, {
      access_token: token,
      fields: 'code',
    })
    code = codeResponse.code
  } catch (error: any) {
    // console.warn(`[Pixels] Failed to fetch code for pixel ${pixelId}:`, error)
    // 代码获取失败不影响主要信息
  }

  return {
    id: pixel.id,
    name: pixel.name || 'Unnamed Pixel',
    owner_business: pixel.owner_business
      ? {
          id: pixel.owner_business.id,
          name: pixel.owner_business.name || 'Unknown Business',
        }
      : undefined,
    is_created_by_business: pixel.is_created_by_business || false,
    creation_time: pixel.creation_time,
    last_fired_time: pixel.last_fired_time,
    data_use_setting: pixel.data_use_setting,
    enable_automatic_matching: pixel.enable_automatic_matching,
    code,
    raw: pixel,
  }
}

/**
 * 获取 Pixel 事件（最近的事件）
 */
export const getPixelEvents = async (
  pixelId: string,
  token: string,
  limit: number = 100
): Promise<PixelEvent[]> => {
  const response = await facebookClient.get(`/${pixelId}/events`, {
    access_token: token,
    limit,
    fields: ['event_name', 'event_time', 'event_id', 'user_data', 'custom_data'].join(','),
  })

  return (response.data || []).map((event: any) => ({
    event_name: event.event_name,
    event_time: event.event_time,
    event_id: event.event_id,
    user_data: event.user_data,
    custom_data: event.custom_data,
    raw: event,
  }))
}

