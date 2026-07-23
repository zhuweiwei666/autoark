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
const FINGERPRINT_HOLDER_LOOKUP_ATTEMPTS = 3
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
  storage?: { key?: unknown; url?: unknown }
}

type OriginRecord = {
  materialId?: unknown
  lastSeenAt?: unknown
}

type OriginResolution =
  | { kind: 'resolved'; material: MaterialRecord }
  | {
      kind: 'failed'
      category: 'origin_mapping_failed' | 'origin_mapping_stale'
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

const materialStorageKey = (material: MaterialRecord): string | undefined =>
  typeof material.storage?.key === 'string' ? material.storage.key : undefined

const observationIsAtLeastAsNew = (
  mapping: OriginRecord,
  observedAt: Date,
): boolean =>
  mapping.lastSeenAt instanceof Date &&
  Number.isFinite(mapping.lastSeenAt.getTime()) &&
  mapping.lastSeenAt.getTime() >= observedAt.getTime()

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
): Promise<OriginRecord | null> => {
  const observedAt = new Date()
  const update = observationUpdate(candidate, canonical, observedAt)
  const filter = {
    ...originFilter(candidate),
    $or: [
      { lastSeenAt: { $exists: false } },
      { lastSeenAt: { $lte: observedAt } },
    ],
  }
  for (let attempt = 0; attempt < ORIGIN_UPSERT_ATTEMPTS; attempt += 1) {
    try {
      const mapping = (await MaterialOriginMapping.findOneAndUpdate(
        filter,
        update,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )) as unknown as OriginRecord | null
      if (mapping?.materialId) return mapping
    } catch (error: unknown) {
      if (errorField(error, 'code') !== 11000) {
        // Retry the same idempotent observation after transient ambiguity.
        continue
      }
    }

    try {
      const winner = (await MaterialOriginMapping.findOne(
        originFilter(candidate),
      )) as unknown as OriginRecord | null
      if (winner?.materialId && observationIsAtLeastAsNew(winner, observedAt)) {
        return winner
      }
    } catch {
      // Bounded retry also covers delayed visibility after a unique upsert race.
    }
  }
  return null
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

const mappingFailed = (
  category:
    | 'origin_mapping_failed'
    | 'origin_mapping_stale' = 'origin_mapping_failed',
): ExternalIngestionOutcome => ({
  kind: 'failed',
  retryable: true,
  category,
})

const resolveOriginMaterial = async (
  candidate: NormalizedGuangdadaAsset,
  mapping: OriginRecord,
  attemptedCanonical: MaterialRecord,
): Promise<OriginResolution> => {
  try {
    if (mapping.materialId) {
      const winner = await globalMaterialById(mapping.materialId)
      if (winner) return { kind: 'resolved', material: winner }
    }

    const attempted = await globalMaterialById(attemptedCanonical._id)
    if (!attempted) {
      return { kind: 'failed', category: 'origin_mapping_stale' }
    }

    const repairFilter: Record<string, unknown> = {
      ...originFilter(candidate),
      materialId: mapping.materialId,
      lastSeenAt:
        mapping.lastSeenAt === undefined
          ? { $exists: false }
          : mapping.lastSeenAt,
    }
    const repaired = (await MaterialOriginMapping.findOneAndUpdate(
      repairFilter as never,
      { $set: { materialId: attempted._id } } as never,
      { new: true },
    )) as unknown as OriginRecord | null
    const effective = repaired?.materialId
      ? repaired
      : ((await MaterialOriginMapping.findOne(
          originFilter(candidate),
        )) as unknown as OriginRecord | null)
    if (!effective?.materialId) {
      return { kind: 'failed', category: 'origin_mapping_stale' }
    }
    const active = await globalMaterialById(effective.materialId)
    return active
      ? { kind: 'resolved', material: active }
      : { kind: 'failed', category: 'origin_mapping_stale' }
  } catch {
    return { kind: 'failed', category: 'origin_mapping_failed' }
  }
}

const observeCanonical = async (
  candidate: NormalizedGuangdadaAsset,
  canonical: MaterialRecord,
): Promise<OriginResolution> => {
  const mapping = await upsertOrigin(candidate, canonical)
  if (!mapping) return { kind: 'failed', category: 'origin_mapping_failed' }
  return resolveOriginMaterial(candidate, mapping, canonical)
}

const mapToCanonical = async (
  candidate: NormalizedGuangdadaAsset,
  canonical: MaterialRecord,
  kind: 'contentReused' | 'created',
): Promise<ExternalIngestionOutcome> => {
  const resolution = await observeCanonical(candidate, canonical)
  if (resolution.kind === 'failed') return mappingFailed(resolution.category)
  return {
    kind:
      materialId(resolution.material) === materialId(canonical)
        ? kind
        : 'contentReused',
    materialId: materialId(resolution.material),
  }
}

const activeGlobalBySha = async (sha256: string) =>
  findMaterial(buildActiveShaQuery(undefined, sha256))

const activeGlobalByFingerprintKey = async (fingerprintKey: string) =>
  findMaterial({
    organizationId: { $in: [null] },
    status: { $in: ACTIVE_MATERIAL_STATUSES },
    fingerprintKey,
  })

const deletedGlobalByFingerprintKey = async (fingerprintKey: string) =>
  findMaterial({
    organizationId: { $in: [null] },
    status: 'deleted',
    fingerprintKey,
  })

const deletedGlobalBySha = async (sha256: string) =>
  findMaterial({
    organizationId: { $in: [null] },
    status: 'deleted',
    'fingerprint.sha256': sha256,
  })

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
    const resolution = await observeCanonical(candidate, mappedMaterial)
    if (resolution.kind === 'resolved') {
      return {
        kind: 'alreadySeen',
        materialId: materialId(resolution.material),
      }
    }
    if (resolution.category === 'origin_mapping_failed') return mappingFailed()
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

const plannedExternalStorageKey = (
  candidate: NormalizedGuangdadaAsset,
  sha256: string,
): string => {
  const assetHash = createHash('sha256')
    .update(`${candidate.provider}:${candidate.providerAssetKey}`)
    .digest('hex')
    .slice(0, 24)
  return `global/external/guangdada/${sha256}/${assetHash}`
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
  const plannedStorageKey = plannedExternalStorageKey(candidate, sha256)

  let deletedContent: MaterialRecord | null = null
  try {
    const exactCanonical = await activeGlobalByFingerprintKey(fingerprintKey)
    if (exactCanonical) {
      return mapToCanonical(candidate, exactCanonical, 'contentReused')
    }
    deletedContent = await deletedGlobalByFingerprintKey(fingerprintKey)
    if (deletedContent) {
      // The exact unique-key holder is authoritative over same-SHA legacy rows.
    } else {
      const canonical = await activeGlobalBySha(sha256)
      if (canonical)
        return mapToCanonical(candidate, canonical, 'contentReused')
      deletedContent = await deletedGlobalBySha(sha256)
    }
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
      key: plannedStorageKey,
    })
  } catch {
    return {
      kind: 'failed',
      retryable: true,
      category: 'storage_upload_failed',
    }
  }
  if (!upload.success || upload.key !== plannedStorageKey || !upload.url) {
    return {
      kind: 'failed',
      retryable: true,
      category: 'storage_upload_failed',
    }
  }

  const materialFields = createMaterialFields(
    candidate,
    downloaded,
    { key: plannedStorageKey, url: upload.url },
    sha256,
    md5,
  )

  type RestoreResult =
    | { kind: 'restored'; material: MaterialRecord }
    | { kind: 'conflict' }
    | { kind: 'failed' }

  const restoreDeletedMaterial = async (
    holder: MaterialRecord,
  ): Promise<RestoreResult> => {
    try {
      const restored = (await Material.findOneAndUpdate(
        {
          _id: holder._id,
          organizationId: { $in: [null] },
          status: 'deleted',
        } as never,
        {
          $set: materialFields,
          $unset: { deduplicatedInto: 1 },
        } as never,
        { new: true },
      )) as unknown as MaterialRecord | null
      return restored
        ? { kind: 'restored', material: restored }
        : { kind: 'conflict' }
    } catch (error: unknown) {
      return errorField(error, 'code') === 11000
        ? { kind: 'conflict' }
        : { kind: 'failed' }
    }
  }

  const reconciliationFailed = (): ExternalIngestionOutcome => ({
    kind: 'failed',
    retryable: true,
    category: 'canonical_reconciliation_failed',
  })

  const cleanupDifferentWinner = async (
    winner: MaterialRecord,
    kind: 'created' | 'contentReused' = 'contentReused',
  ): Promise<ExternalIngestionOutcome> => {
    if (materialStorageKey(winner) === plannedStorageKey) {
      return mapToCanonical(candidate, winner, 'created')
    }
    if (!(await cleanupOwnObject(plannedStorageKey))) {
      return {
        kind: 'failed',
        retryable: true,
        category: 'storage_cleanup_failed',
      }
    }
    return mapToCanonical(candidate, winner, kind)
  }

  const reconcileUnknownMaterialWrite =
    async (): Promise<ExternalIngestionOutcome> => {
      let committed: MaterialRecord | null
      let winner: MaterialRecord | null
      try {
        committed = await findMaterial({
          organizationId: { $in: [null] },
          status: { $in: ACTIVE_MATERIAL_STATUSES },
          fingerprintKey,
          'storage.key': plannedStorageKey,
        })
        if (committed) return mapToCanonical(candidate, committed, 'created')
        winner = await activeGlobalByFingerprintKey(fingerprintKey)
      } catch {
        return reconciliationFailed()
      }

      if (winner) return cleanupDifferentWinner(winner)
      // Empty snapshots cannot prove the ambiguous write did not commit.
      // Keep the deterministic key so a later retry can reconcile it safely.
      return {
        kind: 'failed',
        retryable: true,
        category: 'canonical_write_failed',
      }
    }

  const resolveLosingUpload = async (): Promise<ExternalIngestionOutcome> => {
    let reconciliationUnavailable = false
    for (
      let attempt = 0;
      attempt < FINGERPRINT_HOLDER_LOOKUP_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const activeExact = await activeGlobalByFingerprintKey(fingerprintKey)
        if (activeExact) {
          return cleanupDifferentWinner(activeExact)
        }

        const deletedExact = await deletedGlobalByFingerprintKey(fingerprintKey)
        if (deletedExact) {
          const restored = await restoreDeletedMaterial(deletedExact)
          if (restored.kind === 'restored') {
            return mapToCanonical(candidate, restored.material, 'created')
          }
          if (restored.kind === 'failed') {
            return reconcileUnknownMaterialWrite()
          }
        }
      } catch {
        reconciliationUnavailable = true
        // Bounded reread closes delayed unique-holder visibility races.
      }
    }

    let winner: MaterialRecord | null = null
    try {
      winner = await activeGlobalBySha(sha256)
    } catch {
      return reconciliationFailed()
    }
    if (winner) return cleanupDifferentWinner(winner)
    if (reconciliationUnavailable) return reconciliationFailed()
    return {
      kind: 'failed',
      retryable: true,
      category: 'canonical_conflict_unresolved',
    }
  }

  if (deletedContent) {
    const restored = await restoreDeletedMaterial(deletedContent)
    if (restored.kind === 'conflict') return resolveLosingUpload()
    if (restored.kind === 'failed') return reconcileUnknownMaterialWrite()
    return mapToCanonical(candidate, restored.material, 'created')
  }

  let created: MaterialRecord
  try {
    created = (await Material.create(
      materialFields as never,
    )) as unknown as MaterialRecord
  } catch (error: unknown) {
    if (errorField(error, 'code') === 11000) return resolveLosingUpload()
    return reconcileUnknownMaterialWrite()
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
