import { createHash } from 'crypto'
import path from 'path'
import Creative from '../models/Creative'
import Material from '../models/Material'
import { fetchImageByHash, fetchVideoSource } from '../integration/facebook/ads.api'
import { deleteFromR2, uploadToR2 } from './r2Storage.service'
import { normalizeForApi, normalizeForStorage } from '../utils/accountId'
import logger from '../utils/logger'

export type FacebookCreativeAsset = {
  type: 'image' | 'video'
  imageHash?: string
  videoId?: string
  fallbackUrl?: string
  sourceKind: string
}

type ResolvedAsset = FacebookCreativeAsset & {
  url: string
  isOriginal: boolean
  duration?: number
  width?: number
  height?: number
}

const value = (...items: unknown[]): string | undefined => {
  const found = items.find((item) => typeof item === 'string' && item.trim())
  return typeof found === 'string' ? found : undefined
}

export const extractCreativeAssets = (creative: any): FacebookCreativeAsset[] => {
  const collected: FacebookCreativeAsset[] = []
  const seen = new Set<string>()

  const add = (asset: FacebookCreativeAsset) => {
    const nativeId = asset.imageHash || asset.videoId || asset.fallbackUrl
    if (!nativeId) return
    const key = `${asset.type}:${nativeId}`
    if (seen.has(key)) return
    seen.add(key)
    collected.push(asset)
  }

  const addImage = (candidate: any, sourceKind: string, fallbackUrl?: string) => {
    const imageHash = value(candidate?.imageHash, candidate?.image_hash, candidate?.hash)
    const candidateVideoId = value(candidate?.videoId, candidate?.video_id)
    const url = value(fallbackUrl, candidate?.url, candidate?.picture, candidate?.image_url)
    if (!imageHash && candidateVideoId && sourceKind !== 'video-cover') return
    if (imageHash || url) add({ type: 'image', imageHash, fallbackUrl: url, sourceKind })
  }

  const addVideo = (candidate: any, sourceKind: string, fallbackUrl?: string) => {
    const videoId = value(candidate?.videoId, candidate?.video_id)
    if (videoId) {
      add({
        type: 'video',
        videoId,
        fallbackUrl: value(fallbackUrl, candidate?.thumbnail_url, candidate?.picture),
        sourceKind,
      })
    }
  }

  addImage(creative, 'creative', value(creative?.imageUrl, creative?.image_url))
  addVideo(creative, 'creative', value(creative?.thumbnailUrl, creative?.thumbnail_url))

  const story = creative?.object_story_spec || creative?.objectStorySpec
  const link = story?.link_data
  const photo = story?.photo_data
  const video = story?.video_data

  addImage(link, 'link', link?.picture)
  addVideo(link, 'link', link?.picture)
  addImage(photo, 'photo', photo?.url)
  addImage(video, 'video-cover', value(video?.image_url, video?.thumbnail_url))
  addVideo(video, 'video', value(video?.thumbnail_url, video?.image_url))

  for (const child of link?.child_attachments || []) {
    addImage(child, 'carousel', child?.picture)
    addVideo(child, 'carousel', child?.picture)
  }

  const assetFeed = creative?.asset_feed_spec || creative?.assetFeedSpec
  for (const image of assetFeed?.images || []) addImage(image, 'asset-feed', image?.url)
  for (const feedVideo of assetFeed?.videos || []) {
    addVideo(feedVideo, 'asset-feed', feedVideo?.thumbnail_url)
  }

  if (collected.length === 0) {
    const preview = value(
      creative?.imageUrl,
      creative?.image_url,
      creative?.thumbnailUrl,
      creative?.thumbnail_url,
    )
    if (preview) add({ type: 'image', fallbackUrl: preview, sourceKind: 'preview' })
  }

  return collected
}

const resolveAsset = async (
  asset: FacebookCreativeAsset,
  accountId: string,
  token: string,
): Promise<ResolvedAsset> => {
  if (asset.type === 'video') {
    if (!asset.videoId) throw new Error('Facebook video asset has no video ID')
    const source = await fetchVideoSource(asset.videoId, token)
    if (!source.success || !source.source) {
      throw new Error(`Facebook original video unavailable: ${source.error || 'missing source URL'}`)
    }
    return {
      ...asset,
      url: source.source,
      duration: source.length,
      isOriginal: true,
    }
  }

  if (asset.imageHash) {
    const source = await fetchImageByHash(normalizeForApi(accountId), asset.imageHash, token)
    if (source.success && source.url) {
      return {
        ...asset,
        url: source.url,
        isOriginal: true,
        width: source.width,
        height: source.height,
      }
    }
  }

  if (asset.fallbackUrl) {
    return { ...asset, url: asset.fallbackUrl, isOriginal: false }
  }

  throw new Error('Facebook original image unavailable and no preview fallback exists')
}

const getLimitBytes = (type: 'image' | 'video'): number => {
  const envName = type === 'video'
    ? 'FACEBOOK_MATERIAL_MAX_VIDEO_MB'
    : 'FACEBOOK_MATERIAL_MAX_IMAGE_MB'
  const fallbackMb = type === 'video' ? 500 : 25
  const configured = Number(process.env[envName] || fallbackMb)
  const mb = Number.isFinite(configured) && configured > 0 ? configured : fallbackMb
  return Math.floor(mb * 1024 * 1024)
}

const downloadAsset = async (asset: ResolvedAsset) => {
  const timeoutMs = Math.max(
    1000,
    Number.isFinite(Number(process.env.FACEBOOK_MATERIAL_DOWNLOAD_TIMEOUT_MS))
      ? Number(process.env.FACEBOOK_MATERIAL_DOWNLOAD_TIMEOUT_MS)
      : 60000,
  )
  const maxBytes = getLimitBytes(asset.type)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const sourceUrl = new URL(asset.url)
    if (sourceUrl.protocol !== 'https:') throw new Error('asset download requires HTTPS')
    const response = await fetch(asset.url, { signal: controller.signal })
    if (!response.ok) throw new Error(`download returned HTTP ${response.status}`)

    const declaredSize = Number(response.headers.get('content-length') || 0)
    if (declaredSize > maxBytes) {
      throw new Error(`asset exceeds ${maxBytes} byte limit`)
    }

    let buffer: Buffer
    const body: any = response.body
    if (body && typeof body[Symbol.asyncIterator] === 'function') {
      const chunks: Buffer[] = []
      let received = 0
      for await (const chunk of body) {
        const next = Buffer.from(chunk)
        received += next.length
        if (received > maxBytes) {
          controller.abort()
          throw new Error(`asset exceeds ${maxBytes} byte limit`)
        }
        chunks.push(next)
      }
      buffer = Buffer.concat(chunks, received)
    } else {
      buffer = Buffer.from(await response.arrayBuffer())
    }
    if (!buffer.length) throw new Error('download returned an empty file')
    if (buffer.length > maxBytes) throw new Error(`asset exceeds ${maxBytes} byte limit`)

    const receivedMime = (response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    const defaultMime = asset.type === 'video' ? 'video/mp4' : 'image/jpeg'
    const mimeType = !receivedMime || receivedMime === 'application/octet-stream'
      ? defaultMime
      : receivedMime

    if (asset.type === 'video' && !mimeType.startsWith('video/')) {
      throw new Error(`original video returned non-video content type ${mimeType}`)
    }
    if (asset.type === 'image' && !mimeType.startsWith('image/')) {
      throw new Error(`image asset returned non-image content type ${mimeType}`)
    }

    return { buffer, mimeType }
  } finally {
    clearTimeout(timer)
  }
}

const extensionForMime = (mimeType: string, type: 'image' | 'video') => {
  const subtype = mimeType.split('/')[1]?.split('+')[0]
  if (subtype && /^[a-z0-9]+$/i.test(subtype)) return `.${subtype === 'jpeg' ? 'jpg' : subtype}`
  return type === 'video' ? '.mp4' : '.jpg'
}

const hash = (algorithm: 'sha256' | 'md5', data: string | Buffer) =>
  createHash(algorithm).update(data).digest('hex')

const materialMapping = (
  asset: ResolvedAsset,
  accountId: string,
  creativeId: string,
) => ({
  accountId: normalizeForStorage(accountId),
  creativeId,
  imageHash: asset.imageHash,
  videoId: asset.videoId,
  sourceKind: asset.sourceKind,
  isOriginal: asset.isOriginal,
  status: 'uploaded',
})

export const ingestCreativeAssets = async (params: {
  creative: any
  accountId: string
  organizationId?: string
  token: string
}): Promise<{
  success: boolean
  materialIds: string[]
  imported: number
  reused: number
  errors: string[]
}> => {
  const { creative, accountId, organizationId, token } = params
  const creativeId = String(creative.creativeId || creative.id || '')
  if (!creativeId) {
    return { success: false, materialIds: [], imported: 0, reused: 0, errors: ['Missing creative ID'] }
  }

  await Creative.findOneAndUpdate(
    { creativeId },
    {
      $set: { ingestionStatus: 'processing', ingestionError: null },
      $inc: { ingestionAttempts: 1 },
    },
  )

  const ownerScope = organizationId
    ? `organization:${organizationId}`
    : `account:${normalizeForStorage(accountId)}`
  const ownerHash = hash('sha256', ownerScope).slice(0, 16)
  const materialIds: string[] = []
  const localAssets: Array<{ key?: string; url?: string; isOriginal: boolean }> = []
  const errors: string[] = []
  let imported = 0
  let reused = 0

  const assets = extractCreativeAssets(creative)
  if (!assets.length) errors.push('Creative contains no downloadable assets')

  for (const asset of assets) {
    try {
      const resolved = await resolveAsset(asset, accountId, token)
      const downloaded = await downloadAsset(resolved)
      const sha256 = hash('sha256', downloaded.buffer)
      const md5 = hash('md5', downloaded.buffer)
      const fingerprintKey = `fb:${ownerHash}:sha256:${sha256}`
      const materialQuery: any = { organizationId, fingerprintKey }
      if (!organizationId) delete materialQuery.organizationId
      const mapping = materialMapping(resolved, accountId, creativeId)

      const existing = await Material.findOne(materialQuery)
      if (existing) {
        const materialId = existing._id.toString()
        materialIds.push(materialId)
        localAssets.push({
          key: (existing as any).storage?.key,
          url: (existing as any).storage?.url,
          isOriginal: resolved.isOriginal,
        })
        const existingUpdate: any = {
          $addToSet: {
            facebookMappings: mapping,
            'usage.accounts': normalizeForStorage(accountId),
          },
        }
        if (resolved.isOriginal) existingUpdate.$set = { 'source.isOriginal': true }
        await Material.updateOne(
          { _id: existing._id },
          existingUpdate,
        )
        reused += 1
        continue
      }

      const extension = extensionForMime(downloaded.mimeType, resolved.type)
      const originalName = `${creativeId}-${resolved.imageHash || resolved.videoId || sha256.slice(0, 12)}${extension}`
      const upload = await uploadToR2({
        buffer: downloaded.buffer,
        originalName: path.basename(originalName),
        mimeType: downloaded.mimeType,
        folder: `tenants/${ownerHash}/facebook-imports`,
      })
      if (!upload.success || !upload.key || !upload.url) {
        throw new Error(`R2 upload failed: ${upload.error || 'missing storage result'}`)
      }

      let material: any
      let wonInsert = true
      try {
        material = await Material.findOneAndUpdate(
          materialQuery,
          {
            $setOnInsert: {
            organizationId,
            name: creative.name || `Facebook ${resolved.type} ${creativeId}`,
            type: resolved.type,
            status: 'ready',
            storage: {
              provider: 'r2',
              bucket: process.env.R2_BUCKET_NAME,
              key: upload.key,
              url: upload.url,
            },
            file: {
              originalName,
              mimeType: downloaded.mimeType,
              size: downloaded.buffer.length,
              width: resolved.width,
              height: resolved.height,
              duration: resolved.duration,
            },
            fingerprint: { md5, sha256 },
            fingerprintKey,
            facebook: {
              imageHash: resolved.imageHash,
              videoId: resolved.videoId,
              uploadedAt: new Date(),
            },
            source: {
              type: 'import',
              platform: 'facebook',
              externalCreativeId: creativeId,
              externalAccountId: normalizeForStorage(accountId),
              assetKind: resolved.sourceKind,
              isOriginal: resolved.isOriginal,
              importedAt: new Date(),
              importedBy: 'facebook-sync',
            },
            folder: 'Facebook导入',
            tags: ['facebook', 'auto-import', resolved.isOriginal ? 'original' : 'preview'],
            },
            $addToSet: {
              facebookMappings: mapping,
              'usage.accounts': normalizeForStorage(accountId),
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
      } catch (error: any) {
        if (error?.code !== 11000) throw error
        material = await Material.findOne(materialQuery)
        if (!material) throw error
        wonInsert = false
        await deleteFromR2(upload.key)
        await Material.updateOne(
          { _id: material._id },
          { $addToSet: { facebookMappings: mapping, 'usage.accounts': normalizeForStorage(accountId) } },
        )
      }

      const materialId = material._id.toString()
      materialIds.push(materialId)
      localAssets.push({
        key: wonInsert ? upload.key : material.storage?.key,
        url: wonInsert ? upload.url : material.storage?.url,
        isOriginal: resolved.isOriginal,
      })
      if (wonInsert) imported += 1
      else reused += 1
    } catch (error: any) {
      const nativeId = asset.imageHash || asset.videoId || asset.sourceKind
      errors.push(`${asset.type}:${nativeId}: ${error.message}`)
    }
  }

  const uniqueMaterialIds = [...new Set(materialIds)]
  const completed = uniqueMaterialIds.length > 0 && errors.length === 0
  const partial = uniqueMaterialIds.length > 0 && errors.length > 0
  const firstStored = localAssets.find((asset) => asset.url || asset.key)
  const allOriginal = localAssets.length > 0 && localAssets.every((asset) => asset.isOriginal)

  await Creative.findOneAndUpdate(
    { creativeId },
    {
      $set: {
        materialId: uniqueMaterialIds[0],
        organizationId,
        localStorageUrl: firstStored?.url,
        localStorageKey: firstStored?.key,
        downloaded: uniqueMaterialIds.length > 0,
        downloadedAt: uniqueMaterialIds.length > 0 ? new Date() : undefined,
        isOriginal: allOriginal,
        reusable: allOriginal,
        ingestionStatus: completed ? 'completed' : partial ? 'partial' : 'failed',
        ingestionError: errors.length ? errors.join('; ').slice(0, 2000) : null,
        ingestedAt: completed ? new Date() : undefined,
      },
      $addToSet: { materialIds: { $each: uniqueMaterialIds } },
    },
  )

  if (errors.length) {
    logger.warn('[FacebookMaterial] Creative ingestion incomplete', {
      creativeHash: hash('sha256', creativeId).slice(0, 12),
      accountHash: hash('sha256', normalizeForStorage(accountId)).slice(0, 12),
      imported,
      reused,
      failed: errors.length,
    })
  }

  return {
    success: completed,
    materialIds: uniqueMaterialIds,
    imported,
    reused,
    errors,
  }
}
