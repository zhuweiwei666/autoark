/**
 * Backfill immutable Facebook object ownership from the current Account record.
 *
 * Default mode is dry-run. Pass --apply to write. The migration is idempotent
 * and fails closed if one accountId resolves to conflicting ownership.
 */

import dotenv from 'dotenv'
import mongoose from 'mongoose'

dotenv.config({ quiet: true })

const APPLY = process.argv.includes('--apply')
const HELP = process.argv.includes('--help') || process.argv.includes('-h')
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || ''
const BATCH_SIZE = 250
const TARGET_COLLECTIONS = ['campaigns', 'adsets', 'ads', 'creatives'] as const

type AccountLineage = {
  accountId: string
  organizationId?: mongoose.Types.ObjectId
  tokenId?: mongoose.Types.ObjectId
  optimizer: string
}

function printHelp() {
  console.log(`
Usage:
  npm run backfill:optimizer-lineage
  npm run backfill:optimizer-lineage -- --apply

Default mode is dry-run. The migration copies organizationId, tokenId and
optimizer from each Facebook Account into Campaign, AdSet, Ad and Creative.
Missing sourceSyncedAt is restored from the object's own updatedAt/createdAt.
`)
}

function asObjectId(value: any): mongoose.Types.ObjectId | undefined {
  if (!value) return undefined
  if (value instanceof mongoose.Types.ObjectId) return value
  const text =
    typeof value?.toHexString === 'function'
      ? value.toHexString()
      : String(value)
  return mongoose.Types.ObjectId.isValid(text)
    ? new mongoose.Types.ObjectId(text)
    : undefined
}

export function buildAccountLineage(rows: any[]): AccountLineage[] {
  const byAccount = new Map<string, AccountLineage>()

  for (const row of rows) {
    const accountId = String(row.accountId || '').trim()
    const optimizer = String(row.operator || '').trim()
    if (!accountId || !optimizer) continue

    const candidate: AccountLineage = {
      accountId,
      optimizer,
      organizationId: asObjectId(row.organizationId),
      tokenId: asObjectId(row.tokenId),
    }
    const existing = byAccount.get(accountId)
    if (!existing) {
      byAccount.set(accountId, candidate)
      continue
    }

    const existingKey = [
      existing.optimizer,
      existing.organizationId?.toHexString() || '',
      existing.tokenId?.toHexString() || '',
    ].join('|')
    const candidateKey = [
      candidate.optimizer,
      candidate.organizationId?.toHexString() || '',
      candidate.tokenId?.toHexString() || '',
    ].join('|')
    if (existingKey !== candidateKey) {
      throw new Error(
        '同一 Facebook accountId 存在冲突的投手、组织或授权归属，已停止回填',
      )
    }
  }

  return Array.from(byAccount.values())
}

export function buildLineageOperation(lineage: AccountLineage) {
  const fields: Record<string, any> = {
    optimizer: { $literal: lineage.optimizer },
    channel: { $literal: 'facebook' },
    sourceSyncedAt: {
      $ifNull: ['$sourceSyncedAt', { $ifNull: ['$updatedAt', '$createdAt'] }],
    },
  }
  if (lineage.organizationId) {
    fields.organizationId = { $literal: lineage.organizationId }
  }
  if (lineage.tokenId) {
    fields.tokenId = { $literal: lineage.tokenId }
  }

  return {
    updateMany: {
      filter: { accountId: lineage.accountId },
      update: [{ $set: fields }],
    },
  }
}

async function collectionExists(
  db: mongoose.mongo.Db,
  name: string,
): Promise<boolean> {
  return Boolean(await db.listCollections({ name }, { nameOnly: true }).next())
}

async function backfillCollection(
  db: mongoose.mongo.Db,
  name: (typeof TARGET_COLLECTIONS)[number],
  lineage: AccountLineage[],
) {
  if (!(await collectionExists(db, name))) {
    console.log(`- ${name}: collection not found, skip`)
    return { candidates: 0, matched: 0, modified: 0 }
  }

  const collection = db.collection(name)
  const accountIds = lineage.map((item) => item.accountId)
  const [candidates, withOptimizer] = await Promise.all([
    collection.countDocuments({ accountId: { $in: accountIds } }),
    collection.countDocuments({
      accountId: { $in: accountIds },
      optimizer: { $exists: true, $nin: ['', null] },
    }),
  ])

  if (!APPLY) {
    console.log(
      `- ${name}: candidates=${candidates}, currentlyLineaged=${withOptimizer}`,
    )
    return { candidates, matched: 0, modified: 0 }
  }

  let matched = 0
  let modified = 0
  for (let index = 0; index < lineage.length; index += BATCH_SIZE) {
    const operations = lineage
      .slice(index, index + BATCH_SIZE)
      .map(buildLineageOperation)
    const result = await collection.bulkWrite(operations, { ordered: false })
    matched += result.matchedCount
    modified += result.modifiedCount
  }

  console.log(
    `- ${name}: candidates=${candidates}, matched=${matched}, modified=${modified}`,
  )
  return { candidates, matched, modified }
}

async function main() {
  if (HELP) {
    printHelp()
    return
  }
  if (!MONGO_URI) throw new Error('MONGO_URI or MONGODB_URI is required')

  await mongoose.connect(MONGO_URI, { readPreference: 'primary' })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is unavailable')

  const accountRows = await db
    .collection('accounts')
    .find(
      {
        channel: 'facebook',
        operator: { $exists: true, $nin: ['', null] },
      },
      {
        projection: {
          accountId: 1,
          organizationId: 1,
          tokenId: 1,
          operator: 1,
        },
      },
    )
    .toArray()
  const lineage = buildAccountLineage(accountRows)
  if (lineage.length === 0) {
    throw new Error('没有可回填的 Facebook 投手账户')
  }

  console.log(
    `[optimizer-lineage] mode=${APPLY ? 'apply' : 'dry-run'}, accounts=${lineage.length}`,
  )
  for (const name of TARGET_COLLECTIONS) {
    await backfillCollection(db, name, lineage)
  }
  console.log(
    `[optimizer-lineage] ${APPLY ? 'apply complete' : 'dry-run complete'}`,
  )
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`[optimizer-lineage] failed: ${error.message}`)
      process.exitCode = 1
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => undefined)
    })
}
