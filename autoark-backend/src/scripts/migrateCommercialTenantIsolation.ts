/**
 * Commercial multi-tenant migration.
 *
 * Default mode is dry-run. Pass --apply to write backfills and rebuild indexes.
 */

import dotenv from 'dotenv'
import mongoose from 'mongoose'

dotenv.config()

type CollectionPlan = {
  name: string
  label: string
}

type IndexPlan = {
  collection: string
  dropNames: string[]
  key: Record<string, 1 | -1>
  options: Record<string, any>
}

const APPLY = process.argv.includes('--apply')
const HELP = process.argv.includes('--help') || process.argv.includes('-h')
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || ''

const missingOrgFilter = {
  $or: [
    { organizationId: { $exists: false } },
    { organizationId: null },
  ],
}

const ownerCollections: CollectionPlan[] = [
  { name: 'materials', label: 'Material library' },
  { name: 'products', label: 'Products' },
  { name: 'fbtokens', label: 'Facebook tokens' },
  { name: 'facebookusers', label: 'Facebook user asset cache' },
  { name: 'addrafts', label: 'Ad drafts' },
  { name: 'adtasks', label: 'Ad tasks' },
  { name: 'targetingpackages', label: 'Targeting packages' },
  { name: 'creativegroups', label: 'Creative groups' },
  { name: 'copywritingpackages', label: 'Copywriting packages' },
  { name: 'accountgroups', label: 'Account groups' },
]

const indexPlans: IndexPlan[] = [
  {
    collection: 'products',
    dropNames: ['identifier_1'],
    key: { organizationId: 1, identifier: 1 },
    options: {
      unique: true,
      name: 'organizationId_1_identifier_1',
      partialFilterExpression: {
        organizationId: { $exists: true },
        identifier: { $exists: true },
      },
    },
  },
  {
    collection: 'folders',
    dropNames: ['parentId_1_name_1'],
    key: { organizationId: 1, parentId: 1, name: 1 },
    options: {
      unique: true,
      name: 'organizationId_1_parentId_1_name_1',
      partialFilterExpression: { organizationId: { $exists: true } },
    },
  },
  {
    collection: 'folders',
    dropNames: [],
    key: { organizationId: 1, path: 1 },
    options: { name: 'organizationId_1_path_1' },
  },
  {
    collection: 'fbtokens',
    dropNames: [],
    key: { fbUserId: 1, organizationId: 1 },
    options: {
      unique: true,
      name: 'fbUserId_1_organizationId_1',
      partialFilterExpression: {
        fbUserId: { $exists: true },
        organizationId: { $exists: true },
      },
    },
  },
  {
    collection: 'facebookusers',
    dropNames: ['fbUserId_1'],
    key: { fbUserId: 1, organizationId: 1 },
    options: {
      unique: true,
      name: 'fbUserId_1_organizationId_1',
      partialFilterExpression: {
        fbUserId: { $exists: true },
        organizationId: { $exists: true },
      },
    },
  },
  {
    collection: 'targetingpackages',
    dropNames: ['accountId_1_name_1'],
    key: { organizationId: 1, accountId: 1, name: 1 },
    options: {
      unique: true,
      name: 'organizationId_1_accountId_1_name_1',
      partialFilterExpression: { organizationId: { $exists: true } },
    },
  },
  {
    collection: 'creativegroups',
    dropNames: ['accountId_1_name_1'],
    key: { organizationId: 1, accountId: 1, name: 1 },
    options: {
      unique: true,
      name: 'organizationId_1_accountId_1_name_1',
      partialFilterExpression: { organizationId: { $exists: true } },
    },
  },
  {
    collection: 'copywritingpackages',
    dropNames: ['accountId_1_name_1'],
    key: { organizationId: 1, accountId: 1, name: 1 },
    options: {
      unique: true,
      name: 'organizationId_1_accountId_1_name_1',
      partialFilterExpression: { organizationId: { $exists: true } },
    },
  },
]

function printHelp() {
  console.log(`
Usage:
  npm run migrate:commercial-isolation
  npm run migrate:commercial-isolation -- --apply

Default mode is dry-run. It reports:
  - records that can be backfilled with organizationId
  - records that need manual review
  - old global unique indexes that will be replaced
  - duplicate keys that would block new tenant-scoped indexes

Required env:
  MONGO_URI or MONGODB_URI
`)
}

function asId(value: any): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  if (value instanceof mongoose.Types.ObjectId) return value.toString()
  if (typeof value.toHexString === 'function') return value.toHexString()
  if (value._id && value._id !== value) return asId(value._id)
  if (typeof value.toString === 'function') return value.toString()
  return undefined
}

function toObjectId(value: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(value)
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter(Boolean) as string[])]
}

function collectAccountIds(doc: any): string[] {
  const ids: Array<string | undefined> = []

  if (doc.accountId) ids.push(String(doc.accountId))

  for (const account of doc.accounts || []) {
    ids.push(typeof account === 'string' ? account : account?.accountId)
  }

  for (const account of doc.configSnapshot?.accounts || []) {
    ids.push(account?.accountId)
  }

  for (const item of doc.items || []) {
    ids.push(item?.accountId)
  }

  for (const accountId of doc.usage?.accounts || []) {
    ids.push(accountId)
  }

  for (const mapping of doc.facebookMappings || []) {
    ids.push(mapping?.accountId)
  }

  return unique(ids)
}

async function collectionExists(db: mongoose.mongo.Db, name: string): Promise<boolean> {
  const found = await db.listCollections({ name }).next()
  return Boolean(found)
}

async function buildLookupMaps(db: mongoose.mongo.Db) {
  const users = await db.collection('users').find(
    { organizationId: { $exists: true, $ne: null } },
    { projection: { _id: 1, organizationId: 1 } },
  ).toArray()

  const userOrgById = new Map<string, string>()
  for (const user of users) {
    const userId = asId(user._id)
    const orgId = asId(user.organizationId)
    if (userId && orgId) userOrgById.set(userId, orgId)
  }

  const accounts = await db.collection('accounts').find(
    { organizationId: { $exists: true, $ne: null } },
    { projection: { accountId: 1, organizationId: 1 } },
  ).toArray()

  const accountOrgById = new Map<string, Set<string>>()
  for (const account of accounts) {
    const accountId = String(account.accountId || '')
    const orgId = asId(account.organizationId)
    if (!accountId || !orgId) continue
    if (!accountOrgById.has(accountId)) accountOrgById.set(accountId, new Set())
    accountOrgById.get(accountId)!.add(orgId)
  }

  const tokens = await db.collection('fbtokens').find(
    { organizationId: { $exists: true, $ne: null } },
    { projection: { _id: 1, organizationId: 1 } },
  ).toArray()

  const tokenOrgById = new Map<string, string>()
  for (const token of tokens) {
    const tokenId = asId(token._id)
    const orgId = asId(token.organizationId)
    if (tokenId && orgId) tokenOrgById.set(tokenId, orgId)
  }

  return { userOrgById, accountOrgById, tokenOrgById }
}

function inferOrganizationId(
  doc: any,
  userOrgById: Map<string, string>,
  accountOrgById: Map<string, Set<string>>,
  tokenOrgById: Map<string, string>,
): { orgId?: string; reason: string } {
  const byUser = unique([
    userOrgById.get(String(doc.createdBy || '')),
    userOrgById.get(String(doc.userId || '')),
  ])

  if (byUser.length === 1) {
    return { orgId: byUser[0], reason: 'user ownership' }
  }

  if (byUser.length > 1) {
    return { reason: `ambiguous user ownership: ${byUser.join(',')}` }
  }

  const byToken = unique([
    tokenOrgById.get(asId(doc.tokenId) || ''),
  ])

  if (byToken.length === 1) {
    return { orgId: byToken[0], reason: 'token ownership' }
  }

  if (byToken.length > 1) {
    return { reason: `ambiguous token ownership: ${byToken.join(',')}` }
  }

  const byAccount = unique(
    collectAccountIds(doc).flatMap((accountId) => [...(accountOrgById.get(accountId) || [])]),
  )

  if (byAccount.length === 1) {
    return { orgId: byAccount[0], reason: 'account ownership' }
  }

  if (byAccount.length > 1) {
    return { reason: `ambiguous account ownership: ${byAccount.join(',')}` }
  }

  return { reason: 'no user/account ownership signal' }
}

async function backfillOwnerCollection(
  db: mongoose.mongo.Db,
  plan: CollectionPlan,
  userOrgById: Map<string, string>,
  accountOrgById: Map<string, Set<string>>,
  tokenOrgById: Map<string, string>,
) {
  if (!(await collectionExists(db, plan.name))) {
    console.log(`- ${plan.label}: collection not found, skip`)
    return { scanned: 0, backfilled: 0, skipped: 0 }
  }

  const collection = db.collection(plan.name)
  const cursor = collection.find(missingOrgFilter)
  let scanned = 0
  let backfilled = 0
  let skipped = 0
  const examples: string[] = []

  for await (const doc of cursor) {
    scanned += 1
    const inferred = inferOrganizationId(doc, userOrgById, accountOrgById, tokenOrgById)
    if (!inferred.orgId) {
      skipped += 1
      if (examples.length < 5) examples.push(`${asId(doc._id)} (${inferred.reason})`)
      continue
    }

    backfilled += 1
    if (APPLY) {
      await collection.updateOne(
        { _id: doc._id },
        { $set: { organizationId: toObjectId(inferred.orgId) } },
      )
    }
  }

  console.log(
    `- ${plan.label}: scanned=${scanned}, ${APPLY ? 'updated' : 'wouldUpdate'}=${backfilled}, manualReview=${skipped}`,
  )
  if (examples.length > 0) {
    console.log(`  examples: ${examples.join('; ')}`)
  }

  return { scanned, backfilled, skipped }
}

async function rebuildFoldersFromMaterials(db: mongoose.mongo.Db) {
  if (!(await collectionExists(db, 'folders')) || !(await collectionExists(db, 'materials'))) {
    console.log('- Folder tree: folders/materials collection missing, skip')
    return { created: 0, scannedMaterials: 0 }
  }

  const folders = db.collection('folders')
  const materials = db.collection('materials')
  const folderCache = new Map<string, any>()
  const existing = await folders.find(
    { organizationId: { $exists: true, $ne: null } },
    { projection: { _id: 1, organizationId: 1, path: 1 } },
  ).toArray()

  for (const folder of existing) {
    folderCache.set(`${asId(folder.organizationId)}|${folder.path}`, folder._id)
  }

  const materialCursor = materials.find(
    {
      organizationId: { $exists: true, $ne: null },
      folder: { $exists: true, $nin: ['', '默认'] },
    },
    { projection: { folder: 1, organizationId: 1, createdBy: 1 } },
  )

  let scannedMaterials = 0
  let created = 0

  for await (const material of materialCursor) {
    scannedMaterials += 1
    const orgId = asId(material.organizationId)
    if (!orgId) continue

    const segments = String(material.folder || '')
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)

    let parentId: any = null
    for (let index = 0; index < segments.length; index += 1) {
      const path = segments.slice(0, index + 1).join('/')
      const cacheKey = `${orgId}|${path}`
      const cachedId = folderCache.get(cacheKey)
      if (cachedId) {
        parentId = cachedId
        continue
      }

      created += 1
      if (APPLY) {
        const inserted = await folders.insertOne({
          name: segments[index],
          parentId,
          path,
          level: index,
          organizationId: toObjectId(orgId),
          createdBy: material.createdBy,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        parentId = inserted.insertedId
        folderCache.set(cacheKey, inserted.insertedId)
      } else {
        folderCache.set(cacheKey, `dry-run:${cacheKey}`)
        parentId = `dry-run:${cacheKey}`
      }
    }
  }

  console.log(`- Folder tree: scannedMaterials=${scannedMaterials}, ${APPLY ? 'created' : 'wouldCreate'}=${created}`)
  return { created, scannedMaterials }
}

async function dropIndexIfPresent(db: mongoose.mongo.Db, collectionName: string, indexName: string) {
  const collection = db.collection(collectionName)
  const indexes = await collection.indexes()
  if (!indexes.some((index) => index.name === indexName)) return false
  if (APPLY) await collection.dropIndex(indexName)
  return true
}

async function findDuplicateKeys(db: mongoose.mongo.Db, plan: IndexPlan) {
  const collection = db.collection(plan.collection)
  const groupId = Object.fromEntries(Object.keys(plan.key).map((field) => [field, `$${field}`]))
  const pipeline: any[] = []

  if (plan.options.partialFilterExpression) {
    pipeline.push({ $match: plan.options.partialFilterExpression })
  }

  pipeline.push(
    {
      $group: {
        _id: groupId,
        ids: { $push: '$_id' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $limit: 10 },
  )

  return collection.aggregate(pipeline).toArray()
}

async function rebuildIndexes(db: mongoose.mongo.Db) {
  let blockerCount = 0

  for (const plan of indexPlans) {
    if (!(await collectionExists(db, plan.collection))) continue
    const duplicates = await findDuplicateKeys(db, plan)
    if (duplicates.length > 0) {
      blockerCount += duplicates.length
      console.log(`! ${plan.collection}.${plan.options.name} has duplicate keys:`)
      for (const duplicate of duplicates) {
        console.log(`  key=${JSON.stringify(duplicate._id)} count=${duplicate.count}`)
      }
    }
  }

  if (blockerCount > 0) {
    throw new Error(`Found ${blockerCount} duplicate index key groups. Resolve them before applying indexes.`)
  }

  for (const plan of indexPlans) {
    if (!(await collectionExists(db, plan.collection))) continue
    for (const oldName of plan.dropNames) {
      const dropped = await dropIndexIfPresent(db, plan.collection, oldName)
      if (dropped) {
        console.log(`- ${plan.collection}: ${APPLY ? 'dropped' : 'wouldDrop'} old index ${oldName}`)
      }
    }

    const droppedNew = await dropIndexIfPresent(db, plan.collection, plan.options.name)
    if (droppedNew) {
      console.log(`- ${plan.collection}: ${APPLY ? 'recreated' : 'wouldRecreate'} index ${plan.options.name}`)
    }

    if (APPLY) {
      await db.collection(plan.collection).createIndex(plan.key, plan.options)
    }
    console.log(`- ${plan.collection}: ${APPLY ? 'ensured' : 'wouldEnsure'} index ${plan.options.name}`)
  }
}

async function main() {
  if (HELP) {
    printHelp()
    return
  }

  if (!MONGO_URI) {
    throw new Error('MONGO_URI or MONGODB_URI is required')
  }

  console.log(`Commercial isolation migration (${APPLY ? 'APPLY' : 'DRY-RUN'})`)
  await mongoose.connect(MONGO_URI)
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not ready')

  const { userOrgById, accountOrgById, tokenOrgById } = await buildLookupMaps(db)
  console.log(`Loaded ownership maps: users=${userOrgById.size}, accounts=${accountOrgById.size}, tokens=${tokenOrgById.size}`)

  for (const plan of ownerCollections) {
    await backfillOwnerCollection(db, plan, userOrgById, accountOrgById, tokenOrgById)
  }

  for (const plan of indexPlans) {
    for (const oldName of plan.dropNames) {
      if (!(await collectionExists(db, plan.collection))) continue
      const hasOldIndex = (await db.collection(plan.collection).indexes()).some((index) => index.name === oldName)
      if (hasOldIndex) {
        console.log(`- ${plan.collection}: legacy index present ${oldName}`)
      }
    }
  }

  await rebuildFoldersFromMaterials(db)
  await rebuildIndexes(db)
  console.log(`Done (${APPLY ? 'changes applied' : 'dry-run only'})`)
}

main()
  .catch((error) => {
    console.error('Migration failed:', error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect()
  })
