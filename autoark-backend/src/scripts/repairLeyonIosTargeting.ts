import mongoose from 'mongoose'
import connectDB from '../config/db'
import Account from '../models/Account'
import AdTask from '../models/AdTask'
import TargetingPackage from '../models/TargetingPackage'
import { facebookClient } from '../integration/facebook/facebookClient'
import { updateAdSet } from '../integration/facebook/bulkCreate.api'

const PACKAGE_ID = '6a6338c049f54d72f9a3b16b'
const PACKAGE_NAME = 'autoark-leyon'
const EXPECTED_TASK_COUNT = 6
const EXPECTED_RECORDED_ADSET_COUNT = 19
const EXPECTED_ALREADY_IOS_COUNT = 1
const EXPECTED_MISSING_ADSET_COUNT = 2

type Targeting = Record<string, any>

type RecordedAdSet = {
  taskId: string
  accountId: string
  adsetId: string
}

type CurrentAdSet = RecordedAdSet & {
  found: boolean
  status?: string
  targeting?: Targeting
}

type RepairScope = {
  taskCount: number
  recordedAdsetCount: number
  foundCount: number
  activeMissingIos: CurrentAdSet[]
  alreadyIos: CurrentAdSet[]
  missing: CurrentAdSet[]
  unexpected: CurrentAdSet[]
}

const normalizeAccountId = (value: string) => value.replace(/^act_/, '')

export const hasOnlyIosTargeting = (targeting: Targeting | undefined) => (
  Array.isArray(targeting?.user_os)
  && targeting.user_os.length === 1
  && targeting.user_os[0] === 'iOS'
)

export const addIosTargeting = (targeting: Targeting): Targeting => ({
  ...targeting,
  user_os: ['iOS'],
})

const canonicalize = (value: any): any => {
  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])]),
    )
  }
  return value
}

const withoutUserOs = (targeting: Targeting | undefined): Targeting => {
  const { user_os: _userOs, ...rest } = targeting || {}
  return rest
}

export const targetingMatchesExceptUserOs = (
  before: Targeting | undefined,
  after: Targeting | undefined,
) => (
  JSON.stringify(canonicalize(withoutUserOs(before)))
  === JSON.stringify(canonicalize(withoutUserOs(after)))
)

export const classifyRepairScope = (
  taskCount: number,
  records: CurrentAdSet[],
): RepairScope => {
  const activeMissingIos: CurrentAdSet[] = []
  const alreadyIos: CurrentAdSet[] = []
  const missing: CurrentAdSet[] = []
  const unexpected: CurrentAdSet[] = []

  for (const record of records) {
    if (!record.found) {
      missing.push(record)
    } else if (hasOnlyIosTargeting(record.targeting)) {
      alreadyIos.push(record)
    } else if (record.status === 'ACTIVE' && !record.targeting?.user_os) {
      activeMissingIos.push(record)
    } else {
      unexpected.push(record)
    }
  }

  return {
    taskCount,
    recordedAdsetCount: records.length,
    foundCount: records.filter(record => record.found).length,
    activeMissingIos,
    alreadyIos,
    missing,
    unexpected,
  }
}

export const assertExpectedRepairScope = (scope: RepairScope, expectedRepairCount: number) => {
  const failures: string[] = []
  if (scope.taskCount !== EXPECTED_TASK_COUNT) {
    failures.push(`task count ${scope.taskCount} != ${EXPECTED_TASK_COUNT}`)
  }
  if (scope.recordedAdsetCount !== EXPECTED_RECORDED_ADSET_COUNT) {
    failures.push(
      `recorded AdSet count ${scope.recordedAdsetCount} != ${EXPECTED_RECORDED_ADSET_COUNT}`,
    )
  }
  if (scope.activeMissingIos.length !== expectedRepairCount) {
    failures.push(
      `ACTIVE AdSets missing iOS ${scope.activeMissingIos.length} != ${expectedRepairCount}`,
    )
  }
  if (scope.alreadyIos.length !== EXPECTED_ALREADY_IOS_COUNT) {
    failures.push(
      `already-iOS AdSet count ${scope.alreadyIos.length} != ${EXPECTED_ALREADY_IOS_COUNT}`,
    )
  }
  if (scope.missing.length !== EXPECTED_MISSING_ADSET_COUNT) {
    failures.push(`missing AdSet count ${scope.missing.length} != ${EXPECTED_MISSING_ADSET_COUNT}`)
  }
  if (scope.unexpected.length > 0) {
    failures.push(`unexpected AdSet state count ${scope.unexpected.length} != 0`)
  }

  if (failures.length > 0) {
    throw new Error(`Leyon repair scope changed; refusing mutation: ${failures.join('; ')}`)
  }
}

const parseExpectedCount = () => {
  const argument = process.argv.find(value => value.startsWith('--expected='))
  const value = Number(argument?.split('=')[1])
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('A positive integer --expected=<count> argument is required')
  }
  return value
}

const loadRecordedAdSets = async (): Promise<{ taskCount: number; records: RecordedAdSet[] }> => {
  const packageObjectId = new mongoose.Types.ObjectId(PACKAGE_ID)
  const tasks: any[] = await AdTask.find({
    $or: [
      { 'configSnapshot.adset.targetingPackageId': PACKAGE_ID },
      { 'configSnapshot.adset.targetingPackageId': packageObjectId },
    ],
  })
    .select('_id items.accountId items.result.adsetIds')
    .lean()

  const records: RecordedAdSet[] = []
  for (const task of tasks) {
    for (const item of task.items || []) {
      for (const adsetId of item.result?.adsetIds || []) {
        records.push({
          taskId: String(task._id),
          accountId: normalizeAccountId(String(item.accountId)),
          adsetId: String(adsetId),
        })
      }
    }
  }

  const uniqueIds = new Set(records.map(record => record.adsetId))
  if (uniqueIds.size !== records.length) {
    throw new Error('Duplicate Leyon AdSet IDs found in task history; refusing mutation')
  }

  return { taskCount: tasks.length, records }
}

const loadAccountTokens = async (records: RecordedAdSet[]) => {
  const accountIds = [...new Set(records.map(record => record.accountId))]
  const accounts: any[] = await Account.find({
    channel: 'facebook',
    accountId: {
      $in: accountIds.flatMap(accountId => [accountId, `act_${accountId}`]),
    },
  })
    .select('accountId token')
    .lean()

  const tokens = new Map<string, string>()
  for (const account of accounts) {
    const accountId = normalizeAccountId(String(account.accountId))
    if (account.token) tokens.set(accountId, account.token)
  }

  const missingTokenIds = accountIds.filter(accountId => !tokens.has(accountId))
  if (missingTokenIds.length > 0) {
    throw new Error(`Missing Facebook token for account(s): ${missingTokenIds.join(', ')}`)
  }
  return tokens
}

const loadCurrentAdSets = async (
  records: RecordedAdSet[],
  tokens: Map<string, string>,
): Promise<CurrentAdSet[]> => {
  const byAccount = new Map<string, RecordedAdSet[]>()
  for (const record of records) {
    const accountRecords = byAccount.get(record.accountId) || []
    accountRecords.push(record)
    byAccount.set(record.accountId, accountRecords)
  }

  const current: CurrentAdSet[] = []
  for (const [accountId, accountRecords] of byAccount) {
    const response = await facebookClient.get(`/act_${accountId}/adsets`, {
      access_token: tokens.get(accountId),
      fields: 'id,account_id,status,targeting',
      limit: 1000,
    })
    const rows = Array.isArray(response?.data) ? response.data : []
    const byId = new Map(rows.map((row: any) => [String(row.id), row]))

    for (const record of accountRecords) {
      const row: any = byId.get(record.adsetId)
      if (row && normalizeAccountId(String(row.account_id || accountId)) !== accountId) {
        throw new Error(`Meta account mismatch for AdSet ${record.adsetId}; refusing mutation`)
      }
      current.push({
        ...record,
        found: Boolean(row),
        status: row?.status,
        targeting: row?.targeting,
      })
    }
  }
  return current
}

const loadSingleAdSet = async (record: RecordedAdSet, token: string) => {
  const row = await facebookClient.get(`/${record.adsetId}`, {
    access_token: token,
    fields: 'id,account_id,status,targeting',
  })
  if (
    String(row?.id) !== record.adsetId
    || normalizeAccountId(String(row?.account_id || '')) !== record.accountId
  ) {
    throw new Error(`Meta identity mismatch for AdSet ${record.adsetId}`)
  }
  return row
}

const scopeOutput = (mode: 'dry-run' | 'apply', scope: RepairScope) => ({
  mode,
  packageId: PACKAGE_ID,
  packageName: PACKAGE_NAME,
  taskCount: scope.taskCount,
  recordedAdsetCount: scope.recordedAdsetCount,
  foundCount: scope.foundCount,
  activeMissingIosCount: scope.activeMissingIos.length,
  alreadyIosCount: scope.alreadyIos.length,
  missingCount: scope.missing.length,
  repairAdsetIds: scope.activeMissingIos.map(record => record.adsetId),
  missingAdsetIds: scope.missing.map(record => record.adsetId),
})

const main = async () => {
  const apply = process.argv.includes('--apply')
  const expectedRepairCount = parseExpectedCount()
  await connectDB()

  try {
    const targetingPackage: any = await TargetingPackage.findById(PACKAGE_ID)
    if (!targetingPackage || targetingPackage.name !== PACKAGE_NAME) {
      throw new Error('Exact Leyon targeting package identity was not found')
    }
    const mobileOS = Array.from(targetingPackage.deviceSettings?.mobileOS || [])
    if (mobileOS.length !== 1 || mobileOS[0] !== 'iOS') {
      throw new Error('Leyon targeting package is no longer iOS-only; refusing mutation')
    }

    const { taskCount, records } = await loadRecordedAdSets()
    const tokens = await loadAccountTokens(records)
    const initialRecords = await loadCurrentAdSets(records, tokens)
    const initialScope = classifyRepairScope(taskCount, initialRecords)
    assertExpectedRepairScope(initialScope, expectedRepairCount)
    console.log(JSON.stringify(scopeOutput(apply ? 'apply' : 'dry-run', initialScope)))

    if (!apply) return

    const failures: Array<{ adsetId: string; error: string }> = []
    const updated: string[] = []
    for (const record of initialScope.activeMissingIos) {
      try {
        const token = tokens.get(record.accountId) as string
        const fresh = await loadSingleAdSet(record, token)
        if (
          fresh.status !== 'ACTIVE'
          || fresh.targeting?.user_os
          || !targetingMatchesExceptUserOs(record.targeting, fresh.targeting)
        ) {
          throw new Error('AdSet changed after preflight; refusing stale targeting overwrite')
        }

        const result = await updateAdSet({
          adsetId: record.adsetId,
          token,
          targeting: addIosTargeting(fresh.targeting || {}),
        })
        if (!result.success) {
          throw new Error(result.error?.message || 'Meta update failed')
        }

        const verified = await loadSingleAdSet(record, token)
        if (!hasOnlyIosTargeting(verified.targeting)) {
          throw new Error('Meta readback is not iOS-only')
        }
        if (!targetingMatchesExceptUserOs(fresh.targeting, verified.targeting)) {
          throw new Error('Meta readback changed non-OS targeting fields')
        }
        updated.push(record.adsetId)
      } catch (error: any) {
        failures.push({
          adsetId: record.adsetId,
          error: error?.message || String(error),
        })
      }
    }

    const finalRecords = await loadCurrentAdSets(records, tokens)
    const remainingActiveMissingIos = finalRecords.filter(
      record => record.found && record.status === 'ACTIVE' && !hasOnlyIosTargeting(record.targeting),
    )
    const finalIosCount = finalRecords.filter(record => hasOnlyIosTargeting(record.targeting)).length
    const result = {
      mode: 'apply',
      updatedCount: updated.length,
      updatedAdsetIds: updated,
      verifiedIosCount: finalIosCount,
      remainingActiveMissingIosCount: remainingActiveMissingIos.length,
      remainingActiveMissingIosIds: remainingActiveMissingIos.map(record => record.adsetId),
      failureCount: failures.length,
      failures,
    }
    console.log(JSON.stringify(result))

    if (
      failures.length > 0
      || updated.length !== expectedRepairCount
      || finalIosCount !== expectedRepairCount + EXPECTED_ALREADY_IOS_COUNT
      || remainingActiveMissingIos.length > 0
    ) {
      throw new Error('Leyon iOS targeting repair did not reach the exact expected final state')
    }
  } finally {
    await mongoose.disconnect()
  }
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error(error?.message || String(error))
    process.exitCode = 1
  })
}
