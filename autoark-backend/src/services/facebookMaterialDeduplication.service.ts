import Material from '../models/Material'
import Creative from '../models/Creative'
import Ad from '../models/Ad'
import AdMaterialMapping from '../models/AdMaterialMapping'
import MaterialMetrics from '../models/MaterialMetrics'
import AdTask from '../models/AdTask'
import { buildMaterialFingerprintKey } from '../utils/materialContentIdentity'

const CONFIRMATION = 'DEDUPLICATE_FACEBOOK_MATERIALS'
const DEFAULT_MAX_GROUPS = 1000
const MAX_GROUPS = 5000

type MaterialSnapshot = {
  _id: any
  createdAt?: Date
  fingerprintKey?: string
  fingerprint?: { sha256?: string; md5?: string }
  storage?: { key?: string; url?: string }
  source?: { platform?: string; isOriginal?: boolean }
  facebookMappings?: any[]
  usage?: { accounts?: string[] }
  tags?: string[]
}

type DedupGroup = {
  sha256: string
  fingerprintKey: string
  canonical: MaterialSnapshot
  duplicates: MaterialSnapshot[]
  mappings: any[]
  accounts: string[]
  tags: string[]
  isOriginal: boolean
}

const idString = (value: any): string => value?.toString?.() || String(value)

const mappingKey = (mapping: any): string => [
  mapping?.accountId,
  mapping?.creativeId,
  mapping?.imageHash,
  mapping?.videoId,
  mapping?.sourceKind,
].map(value => String(value || '')).join('|')

const mergeMappings = (materials: MaterialSnapshot[]): any[] => {
  const mappings = new Map<string, any>()
  for (const material of materials) {
    for (const mapping of material.facebookMappings || []) {
      const key = mappingKey(mapping)
      const existing = mappings.get(key)
      if (!existing || (!existing.isOriginal && mapping?.isOriginal)) {
        mappings.set(key, mapping)
      }
    }
  }
  return [...mappings.values()]
}

export const buildFacebookMaterialDedupGroups = (
  materials: MaterialSnapshot[],
): DedupGroup[] => {
  const bySha = new Map<string, MaterialSnapshot[]>()
  for (const material of materials) {
    const sha256 = material.fingerprint?.sha256
    if (!sha256) continue
    const group = bySha.get(sha256) || []
    group.push(material)
    bySha.set(sha256, group)
  }

  return [...bySha.entries()].map(([sha256, group]) => {
    const fingerprintKey = buildMaterialFingerprintKey(undefined, sha256)
    const ordered = [...group].sort((left, right) => {
      const leftGlobal = left.fingerprintKey === fingerprintKey ? 1 : 0
      const rightGlobal = right.fingerprintKey === fingerprintKey ? 1 : 0
      if (leftGlobal !== rightGlobal) return rightGlobal - leftGlobal
      const leftOriginal = left.source?.isOriginal ? 1 : 0
      const rightOriginal = right.source?.isOriginal ? 1 : 0
      if (leftOriginal !== rightOriginal) return rightOriginal - leftOriginal
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0
      if (leftTime !== rightTime) return leftTime - rightTime
      return idString(left._id).localeCompare(idString(right._id))
    })
    const accounts = new Set<string>()
    const tags = new Set<string>()
    for (const material of ordered) {
      for (const account of material.usage?.accounts || []) accounts.add(String(account))
      for (const mapping of material.facebookMappings || []) {
        if (mapping?.accountId) accounts.add(String(mapping.accountId))
      }
      for (const tag of material.tags || []) tags.add(String(tag))
    }
    return {
      sha256,
      fingerprintKey,
      canonical: ordered[0],
      duplicates: ordered.slice(1),
      mappings: mergeMappings(ordered),
      accounts: [...accounts].sort(),
      tags: [...tags].sort(),
      isOriginal: ordered.some(material => material.source?.isOriginal === true),
    }
  })
}

const referenceCounts = async (materialIds: any[]) => {
  if (!materialIds.length) {
    return { ads: 0, mappings: 0, metrics: 0, tasks: 0 }
  }
  const filter = { $in: materialIds }
  const [ads, mappings, metrics, tasks] = await Promise.all([
    Ad.countDocuments({ materialId: filter }),
    AdMaterialMapping.countDocuments({ materialId: filter }),
    MaterialMetrics.countDocuments({ materialId: filter }),
    AdTask.countDocuments({ 'items.ads.materialId': filter }),
  ])
  return { ads, mappings, metrics, tasks }
}

const referenceTotal = (counts: Awaited<ReturnType<typeof referenceCounts>>) =>
  counts.ads + counts.mappings + counts.metrics + counts.tasks

const repointCreatives = async (group: DedupGroup): Promise<number> => {
  const allIds = [group.canonical._id, ...group.duplicates.map(item => item._id)]
  const duplicateIdSet = new Set(group.duplicates.map(item => idString(item._id)))
  const groupIdSet = new Set(allIds.map(idString))
  const creatives: any[] = await Creative.find({
    $or: [
      { materialId: { $in: allIds } },
      { materialIds: { $in: allIds } },
    ],
  }).lean()

  let updated = 0
  for (const creative of creatives) {
    const changes: any = {}
    if (duplicateIdSet.has(idString(creative.materialId))) {
      changes.materialId = group.canonical._id
      changes.localStorageKey = group.canonical.storage?.key
      changes.localStorageUrl = group.canonical.storage?.url
    }
    if (Array.isArray(creative.materialIds)) {
      const materialIds = creative.materialIds.map((materialId: any) =>
        groupIdSet.has(idString(materialId)) ? group.canonical._id : materialId)
      const unique = new Map(materialIds.map((materialId: any) => [idString(materialId), materialId]))
      changes.materialIds = [...unique.values()]
    }
    if (Object.keys(changes).length > 0) {
      await Creative.updateOne({ _id: creative._id }, { $set: changes })
      updated += 1
    }
  }
  return updated
}

export const deduplicateFacebookMaterials = async (options: {
  dryRun?: boolean
  confirmation?: string
  maxGroups?: number
} = {}) => {
  const dryRun = options.dryRun !== false
  if (!dryRun && options.confirmation !== CONFIRMATION) {
    throw new Error(`Destructive Facebook material deduplication requires confirmation=${CONFIRMATION}`)
  }

  const maxGroups = Math.min(
    Math.max(1, Math.floor(options.maxGroups || DEFAULT_MAX_GROUPS)),
    MAX_GROUPS,
  )
  const materials: MaterialSnapshot[] = await Material.find({
    'source.platform': 'facebook',
    organizationId: { $in: [null] },
    'fingerprint.sha256': { $exists: true, $nin: [null, ''] },
    status: { $ne: 'deleted' },
  })
    .select('_id createdAt fingerprintKey fingerprint storage source facebookMappings usage tags')
    .sort({ createdAt: 1, _id: 1 })
    .lean()

  const allGroups = buildFacebookMaterialDedupGroups(materials)
  const actionableGroups = allGroups.filter(group =>
    group.duplicates.length > 0
    || group.canonical.fingerprintKey !== group.fingerprintKey)
  const groups = actionableGroups.slice(0, maxGroups)
  const duplicateGroups = groups.filter(group => group.duplicates.length > 0)
  const duplicateIds = duplicateGroups.flatMap(group => group.duplicates.map(item => item._id))
  const [creativeReferences, externalReferences] = await Promise.all([
    duplicateIds.length > 0
      ? Creative.countDocuments({
          $or: [
            { materialId: { $in: duplicateIds } },
            { materialIds: { $in: duplicateIds } },
          ],
        })
      : 0,
    referenceCounts(duplicateIds),
  ])

  const result = {
    dryRun,
    totalMaterials: materials.length,
    distinctFiles: allGroups.length,
    selectedGroups: groups.length,
    truncated: actionableGroups.length > groups.length,
    duplicateGroups: duplicateGroups.length,
    duplicateDocuments: duplicateIds.length,
    creativeReferences,
    externalReferences,
    mergedGroups: 0,
    archivedDocuments: 0,
    deletedDocuments: 0,
    rekeyedCanonicalDocuments: 0,
    repointedCreatives: 0,
    skippedReferencedGroups: 0,
    skippedRaceGroups: 0,
  }
  if (dryRun) return result

  for (const group of groups) {
    const groupDuplicateIds = group.duplicates.map(item => item._id)
    if (groupDuplicateIds.length > 0) {
      const groupReferences = await referenceCounts(groupDuplicateIds)
      if (referenceTotal(groupReferences) > 0) {
        result.skippedReferencedGroups += 1
        continue
      }
    }

    try {
      const set: any = { fingerprintKey: group.fingerprintKey }
      if (group.duplicates.length > 0) {
        set.facebookMappings = group.mappings
        set['usage.accounts'] = group.accounts
        set.tags = group.tags
        set['source.isOriginal'] = group.isOriginal
      }
      const canonicalUpdate = await Material.updateOne(
        { _id: group.canonical._id, status: { $ne: 'deleted' } },
        { $set: set },
      )
      if (canonicalUpdate.matchedCount === 0) {
        result.skippedRaceGroups += 1
        continue
      }
      if (group.canonical.fingerprintKey !== group.fingerprintKey) {
        result.rekeyedCanonicalDocuments += 1
      }

      if (group.duplicates.length === 0) continue
      result.repointedCreatives += await repointCreatives(group)
      const archive = await Material.updateMany(
        { _id: { $in: groupDuplicateIds }, status: { $ne: 'deleted' } },
        {
          $set: {
            status: 'deleted',
            deduplicatedInto: group.canonical._id,
          },
        },
      )
      result.archivedDocuments += archive.modifiedCount || 0
      result.mergedGroups += 1
    } catch (error: any) {
      if (error?.code === 11000) {
        result.skippedRaceGroups += 1
        continue
      }
      throw error
    }
  }

  return result
}
