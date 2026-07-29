import Ad from '../models/Ad'
import Creative from '../models/Creative'
import { facebookClient } from '../integration/facebook/facebookClient'
import { normalizeForApi, normalizeForStorage } from '../utils/accountId'
import { ingestCreativeAssets } from './facebookMaterialIngestion.service'

const FACEBOOK_AD_FIELDS = [
  'id',
  'name',
  'status',
  'adset_id',
  'campaign_id',
  'creative{id,name,status,image_hash,video_id,image_url,thumbnail_url,object_story_spec,asset_feed_spec}',
  'created_time',
  'updated_time',
].join(',')

const boundedInteger = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

const extractImageHashFromSpec = (spec: any): string | undefined => (
  spec?.link_data?.image_hash
  || spec?.photo_data?.image_hash
  || spec?.video_data?.image_hash
  || undefined
)

const extractVideoIdFromSpec = (spec: any): string | undefined => (
  spec?.video_data?.video_id
  || spec?.link_data?.video_id
  || undefined
)

const safeErrorMessage = (error: any): string => {
  const value = Array.isArray(error)
    ? error.join('; ')
    : error?.message || String(error || 'Facebook material ingestion failed')
  return value
    .replace(/access_token=[^&\s;]+/gi, 'access_token=[REDACTED]')
    .slice(0, 500)
}

const runBounded = async <T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<void>,
) => {
  for (let index = 0; index < items.length; index += concurrency) {
    await Promise.all(items.slice(index, index + concurrency).map(handler))
  }
}

export type FacebookAccountMaterialBackfillInput = {
  accountId: string
  organizationId: string
  token: string
  tokenId?: string
  optimizer?: string
  after?: string
  limit?: number
  concurrency?: number
}

export const backfillFacebookAccountMaterialsPage = async (
  input: FacebookAccountMaterialBackfillInput,
) => {
  const accountId = normalizeForStorage(input.accountId)
  if (!accountId) throw new Error('A Facebook account ID is required')
  if (!input.organizationId) throw new Error('An organization ID is required')
  if (!input.token) throw new Error('A Facebook access token is required')

  const limit = boundedInteger(input.limit, 20, 1, 50)
  const concurrency = boundedInteger(input.concurrency, 2, 1, 3)
  const response = await facebookClient.get(`/${normalizeForApi(accountId)}/ads`, {
    access_token: input.token,
    fields: FACEBOOK_AD_FIELDS,
    limit,
    ...(input.after ? { after: input.after } : {}),
  })
  const ads = Array.isArray(response?.data)
    ? response.data.slice(0, limit)
    : []
  const sourceSyncedAt = new Date()

  await runBounded(ads, concurrency, async (ad: any) => {
    const creativeId = ad?.creative?.id ? String(ad.creative.id) : undefined
    await Ad.findOneAndUpdate(
      { channel: 'facebook', adId: String(ad.id) },
      {
        $set: {
          adId: String(ad.id),
          adsetId: ad.adset_id,
          campaignId: ad.campaign_id,
          accountId,
          organizationId: input.organizationId,
          tokenId: input.tokenId,
          optimizer: input.optimizer,
          sourceSyncedAt,
          channel: 'facebook',
          platform: 'facebook',
          name: ad.name,
          status: ad.status,
          creativeId,
          created_time: ad.created_time,
          updated_time: ad.updated_time,
          raw: ad,
        },
      },
      { upsert: true },
    )
  })

  const creativesById = new Map<string, any>()
  for (const ad of ads) {
    const creative = ad?.creative
    if (creative?.id && !creativesById.has(String(creative.id))) {
      creativesById.set(String(creative.id), creative)
    }
  }

  let creativesSucceeded = 0
  let creativesFailed = 0
  let materialsImported = 0
  let materialsReused = 0
  const errors: Array<{ creativeId: string; error: string }> = []

  await runBounded(
    Array.from(creativesById.entries()),
    concurrency,
    async ([creativeId, creative]) => {
      const imageHash = creative.image_hash
        || extractImageHashFromSpec(creative.object_story_spec)
      const videoId = creative.video_id
        || extractVideoIdFromSpec(creative.object_story_spec)
      let creativeType = 'unknown'
      if (videoId) creativeType = 'video'
      else if (imageHash) creativeType = 'image'
      else if (creative.object_story_spec?.link_data?.child_attachments) {
        creativeType = 'carousel'
      }

      try {
        await Creative.findOneAndUpdate(
          { channel: 'facebook', creativeId },
          {
            $set: {
              creativeId,
              channel: 'facebook',
              accountId,
              organizationId: input.organizationId,
              tokenId: input.tokenId,
              optimizer: input.optimizer,
              sourceSyncedAt,
              name: creative.name,
              status: creative.status,
              type: creativeType,
              imageHash,
              videoId,
              hash: imageHash,
              imageUrl: creative.image_url,
              thumbnailUrl: creative.thumbnail_url,
              storageUrl: creative.image_url || creative.thumbnail_url,
              raw: creative,
            },
          },
          { upsert: true },
        )

        const ingestion = await ingestCreativeAssets({
          creative: {
            ...creative,
            creativeId,
            imageHash,
            videoId,
            imageUrl: creative.image_url,
            thumbnailUrl: creative.thumbnail_url,
          },
          accountId,
          organizationId: input.organizationId,
          token: input.token,
        })
        materialsImported += ingestion.imported
        materialsReused += ingestion.reused
        if (ingestion.success) {
          creativesSucceeded += 1
        } else {
          creativesFailed += 1
          if (errors.length < 50) {
            errors.push({
              creativeId,
              error: safeErrorMessage(ingestion.errors),
            })
          }
        }
      } catch (error: any) {
        creativesFailed += 1
        if (errors.length < 50) {
          errors.push({
            creativeId,
            error: safeErrorMessage(error),
          })
        }
      }
    },
  )

  const nextAfter = response?.paging?.next
    ? response?.paging?.cursors?.after
    : undefined

  return {
    status: creativesFailed > 0 ? 'partial' as const : 'complete' as const,
    accountId,
    limit,
    concurrency,
    adsProcessed: ads.length,
    adsWithoutCreative: ads.filter((ad: any) => !ad?.creative?.id).length,
    uniqueCreatives: creativesById.size,
    creativesSucceeded,
    creativesFailed,
    materialsImported,
    materialsReused,
    hasMore: Boolean(nextAfter),
    nextAfter,
    errors,
  }
}
