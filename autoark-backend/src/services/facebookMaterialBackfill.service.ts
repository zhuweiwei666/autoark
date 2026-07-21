import Account from '../models/Account'
import Creative from '../models/Creative'
import { materialQueue } from '../queue/facebook.queue'
import { normalizeForStorage } from '../utils/accountId'

const ORIGINAL_IMAGE_BACKFILL_CONFIRMATION = 'BACKFILL_FACEBOOK_ORIGINAL_IMAGES'

export const backfillFacebookOriginalImages = async (options?: {
  dryRun?: boolean
  confirmation?: string
  maxJobs?: number
}) => {
  if (!materialQueue) throw new Error('Queue system not available')

  const dryRun = options?.dryRun !== false
  if (!dryRun && options?.confirmation !== ORIGINAL_IMAGE_BACKFILL_CONFIRMATION) {
    throw new Error(`Original image backfill requires confirmation: ${ORIGINAL_IMAGE_BACKFILL_CONFIRMATION}`)
  }

  const requestedMax = Number(options?.maxJobs || 10000)
  const maxJobs = Math.min(20000, Math.max(1, Number.isFinite(requestedMax) ? Math.floor(requestedMax) : 10000))
  const candidateFilter = {
    channel: 'facebook',
    imageHash: { $exists: true, $nin: [null, ''] },
    isOriginal: { $ne: true },
  }
  const [totalCandidates, creatives] = await Promise.all([
    Creative.countDocuments(candidateFilter),
    Creative.find(candidateFilter).limit(maxJobs).lean(),
  ])

  const normalizedAccountIds = [...new Set(
    creatives.map((creative: any) => normalizeForStorage(creative.accountId)).filter(Boolean),
  )]
  const accountIdCandidates = normalizedAccountIds.flatMap((accountId) => [accountId, `act_${accountId}`])
  const accounts: any[] = await Account.find({
    channel: 'facebook',
    status: 'active',
    accountId: { $in: accountIdCandidates },
    token: { $exists: true, $nin: [null, ''] },
  }).lean()
  const accountById = new Map(
    accounts.map((account) => [normalizeForStorage(account.accountId), account]),
  )

  const prepared = creatives.flatMap((creative: any) => {
    const accountId = normalizeForStorage(creative.accountId)
    const account = accountById.get(accountId)
    if (!account?.token) return []

    return [{
      jobId: `material-original-image-v2-${creative.creativeId}`,
      data: {
        creative: {
          creativeId: creative.creativeId,
          name: creative.name,
          imageHash: creative.imageHash,
          imageUrl: creative.imageUrl,
        },
        accountId,
        organizationId: creative.organizationId?.toString() || account.organizationId?.toString(),
        token: account.token,
      },
    }]
  })

  let queued = 0
  let alreadyQueued = 0
  for (let start = 0; start < prepared.length; start += 50) {
    const batch = prepared.slice(start, start + 50)
    await Promise.all(batch.map(async ({ jobId, data }) => {
      const existing = await materialQueue.getJob(jobId)
      if (existing) {
        alreadyQueued += 1
        return
      }
      if (dryRun) return

      await materialQueue.add('sync-material-original-image', data, {
        jobId,
        priority: 1,
        removeOnComplete: {
          age: 86400 * 30,
          count: 100000,
        },
      })
      queued += 1
    }))
  }

  return {
    dryRun,
    maxJobs,
    totalCandidates,
    selected: creatives.length,
    eligible: prepared.length,
    skippedNoToken: creatives.length - prepared.length,
    alreadyQueued,
    queued,
    truncated: totalCandidates > creatives.length,
  }
}
