import mongoose from 'mongoose'
import connectDB from '../config/db'
import AdTask from '../models/AdTask'
import FbToken from '../models/FbToken'
import TargetingPackage, { buildMetaUserOsTargeting } from '../models/TargetingPackage'
import { facebookClient } from '../integration/facebook/facebookClient'
import { updateAdSet } from '../integration/facebook/bulkCreate.api'
import { targetingMatchesExceptUserOs } from './repairLeyonIosTargeting'

const TASK_ID = '6a67572d381f1ddf3a09b424'
const PACKAGE_ID = '6a6338c049f54d72f9a3b16b'
const EXPECTED_ADSET_COUNT = 5
const EXPECTED_USER_OS = ['iOS_ver_16.0_and_above']

type Targeting = Record<string, any>

type RepairRecord = {
  accountId: string
  adsetId: string
  status: string
  targeting: Targeting
}

const normalizeAccountId = (value: unknown) => String(value || '').replace(/^act_/, '')

export const hasExactIos16Targeting = (targeting: Targeting | undefined) => (
  Array.isArray(targeting?.user_os)
  && targeting.user_os.length === 1
  && targeting.user_os[0] === EXPECTED_USER_OS[0]
)

export const addIos16Targeting = (targeting: Targeting): Targeting => ({
  ...targeting,
  user_os: [...EXPECTED_USER_OS],
})

export const assertRepairableRecords = (records: RepairRecord[]) => {
  if (records.length !== EXPECTED_ADSET_COUNT) {
    throw new Error(`Expected ${EXPECTED_ADSET_COUNT} AdSets, found ${records.length}`)
  }

  const invalid = records.filter(record => (
    record.status !== 'ACTIVE'
    || !Array.isArray(record.targeting?.user_os)
    || record.targeting.user_os.length !== 1
    || !['iOS', EXPECTED_USER_OS[0]].includes(record.targeting.user_os[0])
  ))
  if (invalid.length > 0) {
    throw new Error(`Unexpected AdSet state: ${invalid.map(record => record.adsetId).join(', ')}`)
  }
}

const loadAdSet = async (accountId: string, adsetId: string, token: string): Promise<RepairRecord> => {
  const row = await facebookClient.get(`/${adsetId}`, {
    access_token: token,
    fields: 'id,account_id,effective_status,targeting',
  })
  if (
    String(row?.id) !== adsetId
    || normalizeAccountId(row?.account_id) !== normalizeAccountId(accountId)
  ) {
    throw new Error(`Meta identity mismatch for AdSet ${adsetId}`)
  }
  return {
    accountId: normalizeAccountId(accountId),
    adsetId,
    status: String(row?.effective_status || ''),
    targeting: row?.targeting || {},
  }
}

const main = async () => {
  const apply = process.argv.includes('--apply')
  await connectDB()

  try {
    const task: any = await AdTask.findById(TASK_ID)
      .select('organizationId createdBy status configSnapshot items')
      .lean()
    if (!task || task.status !== 'success') {
      throw new Error('Exact successful Leyon task not found')
    }
    if (String(task.configSnapshot?.adset?.targetingPackageId) !== PACKAGE_ID) {
      throw new Error('Task targeting package does not match the exact Leyon package')
    }

    const targetingPackage: any = await TargetingPackage.findById(PACKAGE_ID).lean()
    const configuredUserOs = buildMetaUserOsTargeting(
      targetingPackage?.deviceSettings?.mobileOS,
      targetingPackage?.deviceSettings?.iosVersionMin,
    )
    if (JSON.stringify(configuredUserOs) !== JSON.stringify(EXPECTED_USER_OS)) {
      throw new Error('Leyon package is no longer configured for iOS 16.0 and above')
    }

    const tokenId = String(task.configSnapshot?.facebookTokenId || '')
    const tokenOwnerUserId = String(task.configSnapshot?.facebookTokenOwnerUserId || '')
    const token: any = await FbToken.findOne({
      _id: tokenId,
      status: 'active',
      organizationId: task.organizationId,
      userId: tokenOwnerUserId,
    })
      .select('token')
      .lean()
    if (!token?.token) {
      throw new Error('Task-pinned active Facebook token not found')
    }

    const taskItems = Array.isArray(task.items) ? task.items : []
    if (
      taskItems.length !== EXPECTED_ADSET_COUNT
      || taskItems.some((item: any) => item.status !== 'success' || item.result?.adsetIds?.length !== 1)
    ) {
      throw new Error('Task no longer contains exactly five successful single-AdSet items')
    }

    const records = await Promise.all(taskItems.map((item: any) => loadAdSet(
      item.accountId,
      String(item.result.adsetIds[0]),
      token.token,
    )))
    assertRepairableRecords(records)

    const pending = records.filter(record => !hasExactIos16Targeting(record.targeting))
    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      taskId: TASK_ID,
      packageId: PACKAGE_ID,
      expectedUserOs: EXPECTED_USER_OS,
      adsetCount: records.length,
      pendingCount: pending.length,
      pendingAdsetIds: pending.map(record => record.adsetId),
    }))

    if (!apply) return

    const updated: string[] = []
    for (const record of pending) {
      const fresh = await loadAdSet(record.accountId, record.adsetId, token.token)
      if (
        fresh.status !== 'ACTIVE'
        || JSON.stringify(fresh.targeting?.user_os) !== JSON.stringify(['iOS'])
        || !targetingMatchesExceptUserOs(record.targeting, fresh.targeting)
      ) {
        throw new Error(`AdSet ${record.adsetId} changed after preflight`)
      }

      const result = await updateAdSet({
        adsetId: record.adsetId,
        token: token.token,
        targeting: addIos16Targeting(fresh.targeting),
      })
      if (!result.success) {
        throw new Error(result.error?.message || `Meta update failed for ${record.adsetId}`)
      }

      const verified = await loadAdSet(record.accountId, record.adsetId, token.token)
      if (!hasExactIos16Targeting(verified.targeting)) {
        throw new Error(`Meta readback did not preserve iOS 16+ for ${record.adsetId}`)
      }
      if (!targetingMatchesExceptUserOs(fresh.targeting, verified.targeting)) {
        throw new Error(`Non-OS targeting changed for ${record.adsetId}`)
      }
      updated.push(record.adsetId)
    }

    const finalRecords = await Promise.all(taskItems.map((item: any) => loadAdSet(
      item.accountId,
      String(item.result.adsetIds[0]),
      token.token,
    )))
    const finalExactCount = finalRecords.filter(record => hasExactIos16Targeting(record.targeting)).length
    console.log(JSON.stringify({
      mode: 'apply',
      taskId: TASK_ID,
      updatedCount: updated.length,
      updatedAdsetIds: updated,
      verifiedExactCount: finalExactCount,
    }))
    if (finalExactCount !== EXPECTED_ADSET_COUNT) {
      throw new Error('Leyon iOS 16+ repair did not reach the exact expected final state')
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
