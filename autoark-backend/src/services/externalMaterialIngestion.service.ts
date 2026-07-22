import { createHash } from 'crypto'
import path from 'path'
import type { NormalizedGuangdadaAsset } from '../integration/guangdada/types'
import Material from '../models/Material'
import MaterialOriginMapping from '../models/MaterialOriginMapping'
import {
  buildActiveShaQuery,
  buildMaterialFingerprintKey,
} from '../utils/materialContentIdentity'
import { deleteR2Object, uploadBufferToR2 } from './r2Storage.service'
import { downloadRemoteMedia } from './remoteMediaDownload.service'

export type ExternalIngestionOutcome =
  | { kind: 'alreadySeen'; materialId: string }
  | { kind: 'contentReused'; materialId: string }
  | { kind: 'created'; materialId: string }
  | { kind: 'invalid'; reason: string }
  | { kind: 'failed'; retryable: boolean; category: string }

const ACTIVE_MATERIAL_STATUSES = ['uploaded', 'ready'] as const
const ORIGIN_UPSERT_ATTEMPTS = 3
const CLEANUP_ATTEMPTS = 2
const MAX_IDENTITY_LENGTH = 512
const MAX_LABEL_LENGTH = 240
const MAX_ROLE_LENGTH = 80
const MAX_URL_LENGTH = 8192

const knownDownloadCategories = new Set([
  'invalid_url',
  'invalid_host',
  'protocol',
  'credentials',
  'dns_resolution',
  'blocked_address',
  'redirect_location',
  'redirect_limit',
  'http_status',
  'content_encoding',
  'mime_type',
  'media_signature',
  'invalid_response',
  'size_limit',
  'empty_body',
  'connect_timeout',
  'response_timeout',
  'total_timeout',
  'cancelled',
  'network',
])

const terminalDownloadCategories = new Set([
  'invalid_url',
  'invalid_host',
  'protocol',
  'credentials',
  'blocked_address',
  'redirect_location',
  'redirect_limit',
  'content_encoding',
  'mime_type',
  'media_signature',
  'invalid_response',
  'size_limit',
  'empty_body',
])

const retryableDownloadCategories = new Set([
  'dns_resolution',
  'http_status',
  'connect_timeout',
  'response_timeout',
  'total_timeout',
  'network',
])

type MaterialRecord = {
  _id: unknown
  organizationId?: unknown
  status?: string
  fingerprint?: { sha256?: unknown }
}

type OriginRecord = {
  materialId?: unknown
}

const errorField = (error: unknown, field: string): unknown => {
  if (!error || typeof error !== 'object') return undefined
  return (error as Record<string, unknown>)[field]
}

const findMaterial = async (
  filter: Record<string, unknown>,
): Promise<MaterialRecord | null> =>
  (await Material.findOne(filter as never)) as unknown as MaterialRecord | null

const materialId = (material: MaterialRecord): string =>
  String(material._id || '')

const boundedString = (
  value: unknown,
  maxLength: number,
): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) return undefined
  return normalized
}

const optionalBoundedString = (
  value: unknown,
  maxLength: number,
): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  return boundedString(value, maxLength)
}

const safeHttpsUrl = (value: unknown): string | undefined => {
  const raw = boundedString(value, MAX_URL_LENGTH)
  if (!raw) return undefined
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
      return undefined
    return raw
  } catch {
    return undefined
  }
}

const persistedHttpsUrl = (value: unknown): string | undefined => {
  const raw = safeHttpsUrl(value)
  if (!raw) return undefined
  const parsed = new URL(raw)
  return `${parsed.origin}${parsed.pathname}`
}

const optionalMetric = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined

const validateCandidate = (
  input: NormalizedGuangdadaAsset,
): NormalizedGuangdadaAsset | undefined => {
  if (!input || typeof input !== 'object' || input.provider !== 'guangdada')
    return undefined
  const providerAssetKey = boundedString(
    input.providerAssetKey,
    MAX_IDENTITY_LENGTH,
  )
  const packageKey = boundedString(input.packageKey, MAX_IDENTITY_LENGTH)
  const mediaRole = boundedString(input.mediaRole, MAX_ROLE_LENGTH)
  const mediaUrl = safeHttpsUrl(input.mediaUrl)
  const recordId = optionalBoundedString(input.recordId, MAX_IDENTITY_LENGTH)
  const packageName = optionalBoundedString(input.packageName, MAX_LABEL_LENGTH)
  const productName = optionalBoundedString(input.productName, MAX_LABEL_LENGTH)
  const advertiserName = optionalBoundedString(
    input.advertiserName,
    MAX_LABEL_LENGTH,
  )
  const heat = optionalMetric(input.heat)
  const estimatedValue = optionalMetric(input.estimatedValue)
  const sourcePageUrl = persistedHttpsUrl(input.sourcePageUrl)
  if (
    !providerAssetKey ||
    !packageKey ||
    !mediaRole ||
    !mediaUrl ||
    !['image', 'video'].includes(input.mediaType) ||
    !Number.isSafeInteger(input.mediaIndex) ||
    input.mediaIndex < 0
  )
    return undefined

  return {
    provider: 'guangdada',
    providerAssetKey,
    packageKey,
    mediaType: input.mediaType,
    mediaRole,
    mediaIndex: input.mediaIndex,
    mediaUrl,
    ...(recordId ? { recordId } : {}),
    ...(packageName ? { packageName } : {}),
    ...(productName ? { productName } : {}),
    ...(advertiserName ? { advertiserName } : {}),
    ...(heat !== undefined ? { heat } : {}),
    ...(estimatedValue !== undefined ? { estimatedValue } : {}),
    ...(sourcePageUrl ? { sourcePageUrl } : {}),
  }
}

const isActiveGlobalMaterial = (
  material: MaterialRecord | null,
): material is MaterialRecord =>
  Boolean(material) &&
  material.organizationId == null &&
  (material.status === 'uploaded' || material.status === 'ready')

const globalMaterialById = (id: unknown) =>
  findMaterial({
    _id: id,
    organizationId: { $in: [null] },
    status: { $in: ACTIVE_MATERIAL_STATUSES },
  })

const originFilter = (candidate: NormalizedGuangdadaAsset) => ({
  provider: candidate.provider,
  providerAssetKey: candidate.providerAssetKey,
})

const observationUpdate = (
  candidate: NormalizedGuangdadaAsset,
  canonical: MaterialRecord,
  observedAt: Date,
) => {
  const fields: Record<string, unknown> = {
    materialId: canonical._id,
    packageKey: candidate.packageKey,
    mediaType: candidate.mediaType,
    mediaRole: candidate.mediaRole,
    mediaIndex: candidate.mediaIndex,
    lastSeenAt: observedAt,
    lastMediaUrl: persistedHttpsUrl(candidate.mediaUrl),
  }
  if (candidate.packageName !== undefined)
    fields.packageName = candidate.packageName
  if (candidate.productName !== undefined)
    fields.productName = candidate.productName
  if (candidate.advertiserName !== undefined)
    fields.advertiserName = candidate.advertiserName
  if (candidate.heat !== undefined) fields.heat = candidate.heat
  if (candidate.estimatedValue !== undefined)
    fields.estimatedValue = candidate.estimatedValue
  if (candidate.sourcePageUrl !== undefined)
    fields.sourcePageUrl = candidate.sourcePageUrl
  return {
    $set: fields,
    $setOnInsert: {
      provider: candidate.provider,
      providerAssetKey: candidate.providerAssetKey,
      firstSeenAt: observedAt,
    },
  }
}

const upsertOrigin = async (
  candidate: NormalizedGuangdadaAsset,
  canonical: MaterialRecord,
): Promise<boolean> => {
  const observedAt = new Date()
  const update = observationUpdate(candidate, canonical, observedAt)
  for (let attempt = 0; attempt < ORIGIN_UPSERT_ATTEMPTS; attempt += 1) {
    try {
      await MaterialOriginMapping.findOneAndUpdate(
        originFilter(candidate),
        update,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      return true
    } catch {
      // Retry the same idempotent mapping write without touching media storage.
    }
  }
  return false
}

const cleanupOwnObject = async (key: string): Promise<boolean> => {
  for (let attempt = 0; attempt < CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      const result = await deleteR2Object(key)
      if (result?.success) return true
    } catch {
      // Retry once, then return a fixed redacted failure category.
    }
  }
  return false
}

const mappingFailed = (): ExternalIngestionOutcome => ({
  kind: 'failed',
  retryable: true,
  category: 'origin_mapping_failed',
})

const mapToCanonical = async (
  candidate: NormalizedGuangdadaAsset,
  canonical: MaterialRecord,
  kind: 'contentReused' | 'created',
): Promise<ExternalIngestionOutcome> => {
  if (!(await upsertOrigin(candidate, canonical))) return mappingFailed()
  return { kind, materialId: materialId(canonical) }
}

const activeGlobalBySha = async (sha256: string) =>
  findMaterial(buildActiveShaQuery(undefined, sha256))

const preDownloadMapping = async (
  candidate: NormalizedGuangdadaAsset,
): Promise<ExternalIngestionOutcome | undefined> => {
  const mapping = (await MaterialOriginMapping.findOne(
    originFilter(candidate),
  )) as unknown as OriginRecord | null
  if (!mapping?.materialId) return undefined

  const mappedMaterial = await findMaterial({
    _id: mapping.materialId,
  })
  if (isActiveGlobalMaterial(mappedMaterial)) {
    if (!(await upsertOrigin(candidate, mappedMaterial))) return mappingFailed()
    const stillActive = await globalMaterialById(mappedMaterial._id)
    if (stillActive) {
      return { kind: 'alreadySeen', materialId: materialId(stillActive) }
    }
  }

  const staleSha = boundedString(mappedMaterial?.fingerprint?.sha256, 128)
  if (!staleSha) return undefined
  const winner = await activeGlobalBySha(staleSha)
  if (!winner) return undefined
  return mapToCanonical(candidate, winner, 'contentReused')
}

const downloadFailure = (error: unknown): ExternalIngestionOutcome => {
  const reportedCategory = errorField(error, 'category')
  const unsafeCategory =
    typeof reportedCategory === 'string' ? reportedCategory : ''
  const category = knownDownloadCategories.has(unsafeCategory)
    ? unsafeCategory
    : 'failed'
  if (terminalDownloadCategories.has(category)) {
    return { kind: 'invalid', reason: 'invalid_media' }
  }
  return {
    kind: 'failed',
    retryable: retryableDownloadCategories.has(category),
    category: `download_${category}`,
  }
}

const createMaterialFields = (
  candidate: NormalizedGuangdadaAsset,
  downloaded: { buffer: Buffer; mimeType: string; filename: string },
  upload: { key: string; url: string },
  sha256: string,
  md5: string,
) => {
  const label = candidate.productName || candidate.packageName || 'Guangdada'
  const originalName =
    path.basename(downloaded.filename).slice(0, 160) || `${sha256}.bin`
  return {
    name: `${label} ${candidate.mediaType}`.slice(0, MAX_LABEL_LENGTH),
    type: candidate.mediaType,
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
    },
    fingerprint: { sha256, md5 },
    fingerprintKey: buildMaterialFingerprintKey(undefined, sha256),
    source: {
      type: 'import',
      platform: candidate.provider,
      externalCreativeId: candidate.providerAssetKey,
      assetKind: candidate.mediaRole,
      isOriginal: true,
      importedAt: new Date(),
      importedBy: 'external-material-sync',
    },
    tags: ['guangdada', 'external', 'auto-import'],
  }
}

const ingestValidatedCandidate = async (
  candidate: NormalizedGuangdadaAsset,
): Promise<ExternalIngestionOutcome> => {
  try {
    const preDownload = await preDownloadMapping(candidate)
    if (preDownload) return preDownload
  } catch {
    return {
      kind: 'failed',
      retryable: true,
      category: 'database_lookup_failed',
    }
  }

  let downloaded: Awaited<ReturnType<typeof downloadRemoteMedia>>
  try {
    downloaded = await downloadRemoteMedia(candidate.mediaUrl)
  } catch (error: unknown) {
    return downloadFailure(error)
  }

  if (
    !Buffer.isBuffer(downloaded.buffer) ||
    downloaded.buffer.length === 0 ||
    (candidate.mediaType === 'image' &&
      !downloaded.mimeType.startsWith('image/')) ||
    (candidate.mediaType === 'video' &&
      !downloaded.mimeType.startsWith('video/'))
  ) {
    return { kind: 'invalid', reason: 'invalid_media' }
  }

  const sha256 = createHash('sha256').update(downloaded.buffer).digest('hex')
  const md5 = createHash('md5').update(downloaded.buffer).digest('hex')
  const fingerprintKey = buildMaterialFingerprintKey(undefined, sha256)

  let deletedContent: MaterialRecord | null = null
  try {
    const canonical = await activeGlobalBySha(sha256)
    if (canonical) return mapToCanonical(candidate, canonical, 'contentReused')
    deletedContent = await findMaterial({
      organizationId: { $in: [null] },
      status: 'deleted',
      $or: [{ fingerprintKey }, { 'fingerprint.sha256': sha256 }],
    })
  } catch {
    return {
      kind: 'failed',
      retryable: true,
      category: 'database_lookup_failed',
    }
  }

  let upload: Awaited<ReturnType<typeof uploadBufferToR2>>
  try {
    upload = await uploadBufferToR2({
      buffer: downloaded.buffer,
      originalName: path.basename(downloaded.filename),
      mimeType: downloaded.mimeType,
      folder: 'global/external/guangdada',
    })
  } catch {
    return {
      kind: 'failed',
      retryable: true,
      category: 'storage_upload_failed',
    }
  }
  if (!upload.success || !upload.key || !upload.url) {
    if (upload.key && !(await cleanupOwnObject(upload.key))) {
      return {
        kind: 'failed',
        retryable: true,
        category: 'storage_cleanup_failed',
      }
    }
    return {
      kind: 'failed',
      retryable: true,
      category: 'storage_upload_failed',
    }
  }

  const materialFields = createMaterialFields(
    candidate,
    downloaded,
    { key: upload.key, url: upload.url },
    sha256,
    md5,
  )

  const resolveLosingUpload = async (): Promise<ExternalIngestionOutcome> => {
    let winner: MaterialRecord | null = null
    try {
      winner = await activeGlobalBySha(sha256)
    } catch {
      // Cleanup is still mandatory for the upload owned by this attempt.
    }
    if (!(await cleanupOwnObject(upload.key))) {
      return {
        kind: 'failed',
        retryable: true,
        category: 'storage_cleanup_failed',
      }
    }
    if (!winner) {
      return {
        kind: 'failed',
        retryable: true,
        category: 'canonical_conflict_unresolved',
      }
    }
    return mapToCanonical(candidate, winner, 'contentReused')
  }

  if (deletedContent) {
    let rehydrated: MaterialRecord | null
    try {
      rehydrated = (await Material.findOneAndUpdate(
        {
          _id: deletedContent._id,
          organizationId: { $in: [null] },
          status: 'deleted',
        } as never,
        { $set: materialFields } as never,
        { new: true },
      )) as unknown as MaterialRecord | null
    } catch (error: unknown) {
      if (errorField(error, 'code') === 11000) return resolveLosingUpload()
      if (!(await cleanupOwnObject(upload.key))) {
        return {
          kind: 'failed',
          retryable: true,
          category: 'storage_cleanup_failed',
        }
      }
      return {
        kind: 'failed',
        retryable: true,
        category: 'canonical_write_failed',
      }
    }
    if (!rehydrated) return resolveLosingUpload()
    return mapToCanonical(candidate, rehydrated, 'created')
  }

  let created: MaterialRecord
  try {
    created = (await Material.create(
      materialFields as never,
    )) as unknown as MaterialRecord
  } catch (error: unknown) {
    if (errorField(error, 'code') === 11000) return resolveLosingUpload()

    if (!(await cleanupOwnObject(upload.key))) {
      return {
        kind: 'failed',
        retryable: true,
        category: 'storage_cleanup_failed',
      }
    }
    return {
      kind: 'failed',
      retryable: true,
      category: 'canonical_write_failed',
    }
  }

  return mapToCanonical(candidate, created, 'created')
}

export const ingestExternalMaterial = async (
  input: NormalizedGuangdadaAsset,
): Promise<ExternalIngestionOutcome> => {
  const candidate = validateCandidate(input)
  if (!candidate) return { kind: 'invalid', reason: 'invalid_candidate' }
  try {
    return await ingestValidatedCandidate(candidate)
  } catch {
    return {
      kind: 'failed',
      retryable: true,
      category: 'unexpected_ingestion_failure',
    }
  }
}

export const ingestExternalMaterials = async (
  candidates: NormalizedGuangdadaAsset[],
): Promise<ExternalIngestionOutcome[]> => {
  const outcomes: ExternalIngestionOutcome[] = []
  for (const candidate of candidates) {
    outcomes.push(await ingestExternalMaterial(candidate))
  }
  return outcomes
}
