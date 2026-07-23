import { NextFunction, Request, Response } from 'express'
import ExternalMaterialSyncRun from '../models/ExternalMaterialSyncRun'
import ExternalMaterialSyncState from '../models/ExternalMaterialSyncState'
import {
  enqueueExternalMaterialSync,
  parseExternalMaterialSyncRequest,
  reconcileExternalMaterialContinuations,
} from '../queue/externalMaterial.queue'
import { writeAuditLog } from '../services/auditLog.service'
import {
  canManageExternalMaterials,
  canReadExternalMaterials,
} from '../utils/materialPermission'
import logger from '../utils/logger'

const PROVIDER = 'guangdada' as const
const FORBIDDEN_BODY = { success: false, message: '权限不足' }
const FAILURE_BODY = {
  success: false,
  message: '外部素材同步操作失败',
}

const COUNTER_KEYS = [
  'discovered',
  'considered',
  'alreadySeen',
  'downloaded',
  'contentReused',
  'newlyCreated',
  'invalid',
  'failed',
  'deferred',
] as const

const safeCounters = (value: unknown) => {
  const source =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return Object.fromEntries(
    COUNTER_KEYS.map((key) => {
      const count = source[key]
      return [
        key,
        typeof count === 'number' && Number.isFinite(count) && count >= 0
          ? Math.min(10_000_000, Math.trunc(count))
          : 0,
      ]
    }),
  )
}

const safeDate = (value: unknown): Date | undefined => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    return undefined
  return value
}

const recordValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const safeRun = (value: unknown) => {
  if (!value) return null
  const run = recordValue(value)
  const request = recordValue(run.request)
  return {
    mode: run.mode,
    dryRun: run.dryRun === true,
    request: {
      recentDays: request.recentDays,
      limit: request.limit,
    },
    status: run.status,
    counters: safeCounters(run.counters),
    startedAt: safeDate(run.startedAt),
    completedAt: safeDate(run.completedAt),
  }
}

const safeState = (value: unknown) => {
  const state = recordValue(value)
  return {
    provider: PROVIDER,
    paused: state.paused === true,
    pauseReason:
      typeof state.pauseReason === 'string'
        ? state.pauseReason.slice(0, 120)
        : null,
    recurringEnabled: state.recurringEnabled !== false,
  }
}

export const requireExternalMaterialRead = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.user || !canReadExternalMaterials(req.user)) {
    res.status(403).json(FORBIDDEN_BODY)
    return
  }
  next()
}

export const requireExternalMaterialManage = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.user || !canManageExternalMaterials(req.user)) {
    res.status(403).json(FORBIDDEN_BODY)
    return
  }
  next()
}

export const getGuangdadaExternalStatus = async (
  _req: Request,
  res: Response,
) => {
  try {
    const [state, lastRun] = await Promise.all([
      ExternalMaterialSyncState.findOne({ provider: PROVIDER }).lean(),
      ExternalMaterialSyncRun.findOne({ provider: PROVIDER })
        .sort({ createdAt: -1 })
        .lean(),
    ])
    return res.json({
      success: true,
      data: {
        ...safeState(state),
        lastRun: safeRun(lastRun),
      },
    })
  } catch {
    logger.error('[ExternalMaterialController] Status failed')
    return res.status(500).json(FAILURE_BODY)
  }
}

export const syncGuangdadaExternal = async (req: Request, res: Response) => {
  let bounded
  try {
    bounded = parseExternalMaterialSyncRequest(req.body ?? {})
  } catch {
    return res.status(400).json({
      success: false,
      message: '同步参数无效',
    })
  }

  try {
    const result = await enqueueExternalMaterialSync(bounded)
    const data = {
      provider: PROVIDER,
      mode: result.request.mode,
      dryRun: result.request.dryRun,
      request: {
        recentDays: result.request.recentDays,
        limit: result.request.limit,
      },
      status: result.status,
      enqueued: result.enqueued,
    }
    await writeAuditLog(req, {
      category: 'external_material',
      action: 'external_material.sync',
      targetType: 'external_material_provider',
      targetId: PROVIDER,
      summary: 'External material sync requested',
      metadata: {
        provider: PROVIDER,
        mode: result.request.mode,
        dryRun: result.request.dryRun,
        recentDays: result.request.recentDays,
        limit: result.request.limit,
        enqueued: result.enqueued,
        status: result.status,
      },
    })

    const responseStatus = result.enqueued
      ? 202
      : result.status === 'duplicate'
        ? 409
        : result.status === 'unavailable'
          ? 503
          : 200
    return res.status(responseStatus).json({ success: true, data })
  } catch {
    logger.error('[ExternalMaterialController] Sync failed')
    return res.status(500).json(FAILURE_BODY)
  }
}

export const pauseGuangdadaExternal = async (req: Request, res: Response) => {
  try {
    const state = await ExternalMaterialSyncState.findOneAndUpdate(
      { provider: PROVIDER },
      {
        $set: { paused: true, pauseReason: 'manual' },
        $setOnInsert: { provider: PROVIDER },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    await writeAuditLog(req, {
      category: 'external_material',
      action: 'external_material.pause',
      targetType: 'external_material_provider',
      targetId: PROVIDER,
      summary: 'External material sync paused',
      metadata: { provider: PROVIDER, paused: true },
    })
    return res.json({ success: true, data: safeState(state) })
  } catch {
    logger.error('[ExternalMaterialController] Pause failed')
    return res.status(500).json(FAILURE_BODY)
  }
}

export const resumeGuangdadaExternal = async (req: Request, res: Response) => {
  try {
    const state = await ExternalMaterialSyncState.findOneAndUpdate(
      { provider: PROVIDER },
      {
        $set: {
          paused: false,
          pauseReason: null,
          recurringEnabled: true,
        },
        $setOnInsert: { provider: PROVIDER },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    if (
      process.env.EXTERNAL_MATERIAL_SYNC_ENABLED === 'true' &&
      Boolean(process.env.GUANGDADA_API_KEY?.trim())
    ) {
      await reconcileExternalMaterialContinuations({
        provider: PROVIDER,
        resumeOnly: true,
      })
    }
    await writeAuditLog(req, {
      category: 'external_material',
      action: 'external_material.resume',
      targetType: 'external_material_provider',
      targetId: PROVIDER,
      summary: 'External material sync resumed',
      metadata: { provider: PROVIDER, paused: false },
    })
    return res.json({ success: true, data: safeState(state) })
  } catch {
    logger.error('[ExternalMaterialController] Resume failed')
    return res.status(500).json(FAILURE_BODY)
  }
}
