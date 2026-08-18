/**
 * Seed permanent Meta fact/coverage collections from existing aggregation data.
 *
 * Default is dry-run. Pass --apply to create indexes and insert missing rows.
 * Existing permanent facts/coverage are never overwritten or deleted.
 */

import { createHash } from 'crypto'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { getFrozenBeforeDate } from '../utils/shanghaiDate'
import { normalizeForStorage } from '../utils/accountId'

dotenv.config()

const APPLY = process.argv.includes('--apply')
const HELP = process.argv.includes('--help') || process.argv.includes('-h')
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || ''
const BATCH_SIZE = 500

const roundMoney = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0
}

const integer = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

const legacySnapshotId = (date: string, accountId: string) =>
  `legacy-${createHash('sha256').update(`${date}:${accountId}`).digest('hex').slice(0, 24)}`

const legacyFactHash = (row: any) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        date: row.date,
        accountId: normalizeForStorage(row.accountId || ''),
        campaignId: row.campaignId,
        country: 'ALL',
        spend: roundMoney(row.spend),
        revenue: roundMoney(row.revenue),
        impressions: integer(row.impressions),
        clicks: integer(row.clicks),
        installs: integer(row.installs),
      }),
    )
    .digest('hex')

export const buildLegacyFactOperation = (row: any, now = new Date()) => {
  const fetchedAt = row.updatedAt || row.createdAt || now
  const fact = {
    provider: 'facebook',
    date: row.date,
    accountId: normalizeForStorage(row.accountId || ''),
    accountName: row.accountName || '',
    campaignId: String(row.campaignId || 'unknown'),
    campaignName: row.campaignName || '',
    optimizer: row.optimizer || 'unknown',
    country: 'ALL',
    spend: roundMoney(row.spend),
    revenue: roundMoney(row.revenue),
    impressions: integer(row.impressions),
    clicks: integer(row.clicks),
    installs: integer(row.installs),
    sourceHash: legacyFactHash(row),
    snapshotId: legacySnapshotId(
      row.date,
      normalizeForStorage(row.accountId || ''),
    ),
    sourceApiVersion: 'legacy-aggregate-v1',
    authorizationType: 'unknown',
    firstSeenAt: fetchedAt,
    fetchedAt,
    createdAt: now,
    updatedAt: now,
  }
  return {
    updateOne: {
      filter: {
        provider: 'facebook',
        date: fact.date,
        accountId: fact.accountId,
        campaignId: fact.campaignId,
        country: 'ALL',
      },
      update: { $setOnInsert: fact },
      upsert: true,
    },
  }
}

export const buildLegacyCoverageOperation = (
  row: any,
  factRows: number,
  now = new Date(),
) => {
  const status = row.dataStatus === 'stale' ? 'stale' : 'fresh'
  const lastAttemptAt = row.updatedAt || row.lastSyncedAt || now
  const coverage = {
    provider: 'facebook',
    date: row.date,
    accountId: normalizeForStorage(row.accountId || ''),
    status,
    hasSnapshot: true,
    factRows,
    lastAttemptAt,
    lastSuccessAt: row.lastSyncedAt || row.updatedAt || now,
    attemptCount: 0,
    consecutiveFailures: status === 'stale' ? 1 : 0,
    sourceApiVersion: 'legacy-aggregate-v1',
    ...(status === 'fresh' && row.date < getFrozenBeforeDate(now)
      ? { frozenAt: now }
      : {}),
    createdAt: now,
    updatedAt: now,
  }
  return {
    updateOne: {
      filter: {
        provider: 'facebook',
        date: coverage.date,
        accountId: coverage.accountId,
      },
      update: { $setOnInsert: coverage },
      upsert: true,
    },
  }
}

const printHelp = () => {
  console.log(
    'Usage: node dist/scripts/backfillMetaInsightsPersistence.js [--apply]',
  )
  console.log(
    'Default mode is dry-run. --apply only inserts missing facts/coverage and indexes.',
  )
}

const ensureIndexes = async (db: mongoose.mongo.Db) => {
  await db.collection('metainsightsfacts').createIndex(
    { provider: 1, date: 1, accountId: 1, campaignId: 1, country: 1 },
    {
      unique: true,
      name: 'provider_1_date_1_accountId_1_campaignId_1_country_1',
    },
  )
  await db
    .collection('metainsightsfacts')
    .createIndex(
      { date: 1, accountId: 1, optimizer: 1 },
      { name: 'date_1_accountId_1_optimizer_1' },
    )
  await db
    .collection('metainsightsfacts')
    .createIndex({ date: 1, country: 1 }, { name: 'date_1_country_1' })
  await db
    .collection('metainsightsfacts')
    .createIndex(
      { provider: 1, campaignId: 1, date: 1 },
      { name: 'provider_1_campaignId_1_date_1' },
    )
  await db
    .collection('metainsightscoverages')
    .createIndex(
      { provider: 1, date: 1, accountId: 1 },
      { unique: true, name: 'provider_1_date_1_accountId_1' },
    )
  await db
    .collection('metainsightscoverages')
    .createIndex(
      { provider: 1, status: 1, nextRetryAt: 1, date: 1 },
      { name: 'provider_1_status_1_nextRetryAt_1_date_1' },
    )
  await db
    .collection('metainsightscoverages')
    .createIndex(
      { provider: 1, accountId: 1, date: 1 },
      { name: 'provider_1_accountId_1_date_1' },
    )
  await db
    .collection('metainsightscoverages')
    .createIndex(
      { provider: 1, frozenAt: 1, date: 1 },
      { name: 'provider_1_frozenAt_1_date_1' },
    )
}

const main = async () => {
  if (HELP) return printHelp()
  if (!MONGO_URI) throw new Error('MONGO_URI or MONGODB_URI is required')

  await mongoose.connect(MONGO_URI, { readPreference: 'primary' })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is unavailable')

  const [campaigns, accounts, existingFacts, existingCoverage] =
    await Promise.all([
      db.collection('aggcampaigns').countDocuments({}),
      db.collection('aggaccounts').countDocuments({}),
      db.collection('metainsightsfacts').countDocuments({}),
      db.collection('metainsightscoverages').countDocuments({}),
    ])
  console.log(
    JSON.stringify({
      mode: APPLY ? 'apply' : 'dry-run',
      sourceCampaignRows: campaigns,
      sourceAccountRows: accounts,
      existingFactRows: existingFacts,
      existingCoverageRows: existingCoverage,
    }),
  )
  if (!APPLY) return

  await ensureIndexes(db)
  let factUpserts = 0
  const campaignCursor = db.collection('aggcampaigns').find({}).sort({ _id: 1 })
  let factBatch: any[] = []
  for await (const row of campaignCursor) {
    factBatch.push(buildLegacyFactOperation(row))
    if (factBatch.length >= BATCH_SIZE) {
      const result = await db
        .collection('metainsightsfacts')
        .bulkWrite(factBatch, { ordered: false })
      factUpserts += result.upsertedCount
      factBatch = []
    }
  }
  if (factBatch.length > 0) {
    const result = await db
      .collection('metainsightsfacts')
      .bulkWrite(factBatch, { ordered: false })
    factUpserts += result.upsertedCount
  }

  const factCounts = await db
    .collection('metainsightsfacts')
    .aggregate([
      {
        $group: {
          _id: { date: '$date', accountId: '$accountId' },
          rows: { $sum: 1 },
        },
      },
    ])
    .toArray()
  const factCountByAccountDate = new Map(
    factCounts.map((row: any) => [
      `${row._id.date}:${row._id.accountId}`,
      row.rows,
    ]),
  )

  let coverageUpserts = 0
  const accountCursor = db.collection('aggaccounts').find({}).sort({ _id: 1 })
  let coverageBatch: any[] = []
  for await (const row of accountCursor) {
    coverageBatch.push(
      buildLegacyCoverageOperation(
        row,
        factCountByAccountDate.get(
          `${row.date}:${normalizeForStorage(row.accountId || '')}`,
        ) || 0,
      ),
    )
    if (coverageBatch.length >= BATCH_SIZE) {
      const result = await db
        .collection('metainsightscoverages')
        .bulkWrite(coverageBatch, { ordered: false })
      coverageUpserts += result.upsertedCount
      coverageBatch = []
    }
  }
  if (coverageBatch.length > 0) {
    const result = await db
      .collection('metainsightscoverages')
      .bulkWrite(coverageBatch, { ordered: false })
    coverageUpserts += result.upsertedCount
  }

  console.log(
    JSON.stringify({ factUpserts, coverageUpserts, status: 'complete' }),
  )
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`[meta-insights-persistence] failed: ${error.message}`)
      process.exitCode = 1
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => undefined)
    })
}
