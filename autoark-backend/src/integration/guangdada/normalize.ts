import { createHash } from 'node:crypto'
import {
  GuangdadaAdRecord,
  GuangdadaRawMedia,
  GuangdadaRawMediaValue,
  NormalizedGuangdadaAsset,
} from './types'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const asTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const normalized = String(value).trim()
  return normalized || undefined
}

const pickString = (source: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = asTrimmedString(source[key])
    if (value) return value
  }
  return undefined
}

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined
  }
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

const pickNumber = (primary: Record<string, unknown>, secondary: Record<string, unknown>, keys: string[]) => {
  for (const source of [primary, secondary]) {
    for (const key of keys) {
      const value = asNumber(source[key])
      if (value !== undefined) return value
    }
  }
  return undefined
}

export const normalizeHttpsMediaUrl = (value: unknown): string | undefined => {
  const raw = validatedHttpsMediaUrl(value)
  if (!raw) return undefined

  const url = new URL(raw)
  url.hash = ''
  url.searchParams.sort()
  return url.toString()
}

const providerMediaIdentityUrl = (value: unknown): string | undefined => {
  const raw = validatedHttpsMediaUrl(value)
  if (!raw) return undefined
  const url = new URL(raw)
  return `${url.origin}${url.pathname}`
}

const validatedHttpsMediaUrl = (value: unknown): string | undefined => {
  const raw = asTrimmedString(value)
  if (!raw) return undefined

  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return undefined
    if (url.username || url.password) return undefined
    return raw
  } catch {
    return undefined
  }
}

const asMediaRecord = (media: unknown): GuangdadaRawMedia | undefined => {
  if (typeof media === 'string') return { url: media }
  if (!media || typeof media !== 'object' || Array.isArray(media)) return undefined
  return media as GuangdadaRawMedia
}

const mediaUrl = (media: GuangdadaRawMedia) => validatedHttpsMediaUrl(pickString(media, [
  'url',
  'video_url',
  'image_url',
  'download_url',
  'play_url',
  'source',
  'src',
]))

const nativeMediaId = (media: GuangdadaRawMedia, mediaType: 'image' | 'video') => pickString(
  media,
  mediaType === 'video'
    ? ['video_id', 'media_id', 'asset_id', 'id']
    : ['image_id', 'media_id', 'asset_id', 'id'],
)

const nativeRecordId = (record: GuangdadaAdRecord) => pickString(record, [
  'id',
  'ad_id',
  'adId',
  'creative_id',
  'creativeId',
  'record_id',
])

const sourcePageUrl = (record: GuangdadaAdRecord) => normalizeHttpsMediaUrl(pickString(record, [
  'source_page_url',
  'sourcePageUrl',
  'detail_url',
  'ad_url',
]))

const normalizedLabelIdentity = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')

const packageIdentity = (
  record: GuangdadaAdRecord,
  labels: { packageName?: string; productName?: string; advertiserName?: string },
  recordId: string | undefined,
  normalizedUrl: string,
) => {
  const packageId = pickString(record, ['package_id', 'packageId'])
  if (packageId) return `native:${packageId}`
  if (labels.packageName) return `name:${normalizedLabelIdentity(labels.packageName)}`
  if (labels.productName) return `product:${normalizedLabelIdentity(labels.productName)}`
  if (labels.advertiserName) return `advertiser:${normalizedLabelIdentity(labels.advertiserName)}`
  if (recordId) return `record:${recordId}`
  return `media:${normalizedUrl}`
}

const fallbackRecordIdentity = (
  labels: { packageName?: string; productName?: string; advertiserName?: string },
  pageUrl: string | undefined,
) => [
  labels.packageName ? normalizedLabelIdentity(labels.packageName) : '',
  labels.productName ? normalizedLabelIdentity(labels.productName) : '',
  labels.advertiserName ? normalizedLabelIdentity(labels.advertiserName) : '',
  pageUrl ?? '',
].join('|')

const providerAssetKey = (options: {
  mediaId?: string
  recordId?: string
  fallbackRecordId: string
  mediaType: 'image' | 'video'
  mediaIndex: number
  mediaUrl: string
}) => {
  if (options.mediaId && options.recordId) {
    return `sha256:${sha256([
      'native',
      options.recordId,
      options.mediaType,
      options.mediaId,
    ].join('|'))}`
  }
  if (options.mediaId) return `${options.mediaType}:${options.mediaId}`
  const input = [
    options.recordId ?? options.fallbackRecordId,
    options.mediaType,
    String(options.mediaIndex),
    options.mediaUrl,
  ].join('|')
  return `sha256:${sha256(input)}`
}

const normalizeMedia = (
  record: GuangdadaAdRecord,
  mediaValue: GuangdadaRawMediaValue,
  mediaType: 'image' | 'video',
  mediaIndex: number,
  context: {
    recordId?: string
    packageName?: string
    productName?: string
    advertiserName?: string
    sourcePageUrl?: string
  },
): NormalizedGuangdadaAsset | undefined => {
  const media = asMediaRecord(mediaValue)
  if (!media) return undefined
  const originalUrl = mediaUrl(media)
  if (!originalUrl) return undefined
  const normalizedUrl = normalizeHttpsMediaUrl(originalUrl)
  const identityUrl = providerMediaIdentityUrl(originalUrl)
  if (!normalizedUrl || !identityUrl) return undefined

  const labels = {
    packageName: context.packageName,
    productName: context.productName,
    advertiserName: context.advertiserName,
  }
  const mediaId = nativeMediaId(media, mediaType)
  const role = pickString(media, ['role', 'media_role']) ?? mediaType
  const heat = pickNumber(media, record, ['heat'])
  const estimatedValue = pickNumber(media, record, ['estimated_value', 'estimatedValue'])

  return {
    provider: 'guangdada',
    providerAssetKey: providerAssetKey({
      mediaId,
      recordId: context.recordId,
      fallbackRecordId: fallbackRecordIdentity(
        labels,
        providerMediaIdentityUrl(context.sourcePageUrl),
      ),
      mediaType,
      mediaIndex,
      mediaUrl: identityUrl,
    }),
    packageKey: `pkg_${sha256(packageIdentity(record, labels, context.recordId, identityUrl))}`,
    mediaType,
    mediaRole: role,
    mediaIndex,
    mediaUrl: originalUrl,
    ...(context.recordId ? { recordId: context.recordId } : {}),
    ...(context.packageName ? { packageName: context.packageName } : {}),
    ...(context.productName ? { productName: context.productName } : {}),
    ...(context.advertiserName ? { advertiserName: context.advertiserName } : {}),
    ...(heat !== undefined ? { heat } : {}),
    ...(estimatedValue !== undefined ? { estimatedValue } : {}),
    ...(context.sourcePageUrl ? { sourcePageUrl: context.sourcePageUrl } : {}),
  }
}

export const normalizeGuangdadaAds = (
  records: GuangdadaAdRecord[],
): NormalizedGuangdadaAsset[] => {
  const assets: NormalizedGuangdadaAsset[] = []

  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue
    const context = {
      recordId: nativeRecordId(record),
      packageName: pickString(record, ['package_name', 'packageName']),
      productName: pickString(record, ['product_name', 'productName']),
      advertiserName: pickString(record, ['advertiser_name', 'advertiserName']),
      sourcePageUrl: sourcePageUrl(record),
    }

    const groups: Array<['video' | 'image', GuangdadaRawMediaValue[]]> = [
      ['video', Array.isArray(record.videos) ? record.videos : []],
      ['image', Array.isArray(record.images) ? record.images : []],
    ]
    for (const [mediaType, mediaValues] of groups) {
      mediaValues.forEach((media, mediaIndex) => {
        const normalized = normalizeMedia(record, media, mediaType, mediaIndex, context)
        if (normalized) assets.push(normalized)
      })
    }
  }

  return assets.sort((left, right) => (
    (right.estimatedValue ?? Number.NEGATIVE_INFINITY) -
      (left.estimatedValue ?? Number.NEGATIVE_INFINITY) ||
    (right.heat ?? Number.NEGATIVE_INFINITY) -
      (left.heat ?? Number.NEGATIVE_INFINITY)
  ))
}
