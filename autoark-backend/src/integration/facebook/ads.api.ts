import { facebookClient } from './facebookClient'

export const fetchAdSets = async (accountId: string) => {
  const res = await facebookClient.get(`/${accountId}/adsets`, {
    fields:
      'id,name,status,campaign_id,optimization_goal,billing_event,bid_amount,daily_budget,created_time,updated_time',
    limit: 1000,
  })
  return res.data || []
}

export const fetchAds = async (accountId: string, token?: string) => {
  const params: any = {
    // 增强 creative 字段，获取 image_hash, video_id 等素材标识
    fields:
      'id,name,status,adset_id,campaign_id,creative{id,name,image_hash,image_url,thumbnail_url,video_id,object_story_spec},created_time,updated_time',
    limit: 1000,
  }
  if (token) {
    params.access_token = token
  }
  const res = await facebookClient.get(`/${accountId}/ads`, params)
  return res.data || []
}

export const fetchCreatives = async (accountId: string, token?: string) => {
  const params: any = {
    // 增强字段，获取 image_hash, video_id 等素材标识
    fields: 'id,name,status,image_hash,image_url,thumbnail_url,video_id,object_story_spec,asset_feed_spec,effective_object_story_id',
    limit: 500,
  }
  if (token) {
    params.access_token = token
  }
  const res = await facebookClient.get(`/${accountId}/adcreatives`, params)
  return res.data || []
}

/**
 * 获取视频源文件 URL（用于下载原视频）
 * Facebook 视频 URL 是临时的，需要及时下载
 */
export const fetchVideoSource = async (videoId: string, token?: string) => {
  const params: any = {
    fields: 'source,picture,thumbnails,length,created_time',
  }
  if (token) {
    params.access_token = token
  }
  try {
    const res = await facebookClient.get(`/${videoId}`, params)
    return {
      success: true,
      source: res.source,        // 视频源文件 URL
      picture: res.picture,      // 封面图
      thumbnails: res.thumbnails?.data || [],
      length: res.length,        // 时长（秒）
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/**
 * 获取图片原图 URL（通过 image_hash）
 */
export const fetchImageByHash = async (accountId: string, imageHash: string, token?: string) => {
  const params: any = {
    hashes: [imageHash],
  }
  if (token) {
    params.access_token = token
  }
  try {
    const res = await facebookClient.get(`/${accountId}/adimages`, params)
    const images = res.data?.data || res.data || {}
    // 返回第一个匹配的图片
    const imageData = images[imageHash] || Object.values(images)[0]
    if (imageData) {
      return {
        success: true,
        url: imageData.url || imageData.url_128,  // url 是原图
        url_128: imageData.url_128,
        permalink_url: imageData.permalink_url,
        width: imageData.width,
        height: imageData.height,
      }
    }
    return { success: false, error: 'Image not found' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

