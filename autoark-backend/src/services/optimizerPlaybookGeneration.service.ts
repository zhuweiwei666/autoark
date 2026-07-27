import mongoose from 'mongoose'
import PlaybookGeneration from '../models/PlaybookGeneration'
import { addOptimizerPlaybookJob } from '../queue/optimizerPlaybook.queue'
import { combineFilters, objectIdValue } from '../utils/accessControl'
import { generateOptimizerPlaybook } from './optimizerLearning.service'

const normalizeOptimizerId = (value: any): string =>
  String(value || '')
    .trim()
    .slice(0, 120)

const normalizeCurrency = (value: any): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  const currency = String(value).trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw errorWithStatus('currency 必须是 3 位 ISO 币种代码')
  }
  return currency
}

const boundedWindowDays = (value: any): number => {
  const parsed = Number(value)
  return Math.min(
    30,
    Math.max(3, Math.round(Number.isFinite(parsed) ? parsed : 14)),
  )
}

const scopeKeyFor = (organizationId?: any): string =>
  organizationId ? `organization:${String(organizationId)}` : 'global'

const safeErrorMessage = (error: any): string =>
  String(error?.message || '打法生成失败')
    .replace(
      /access_token"?\s*[:=]\s*"?[^&\s,"'}]+/gi,
      'access_token=[REDACTED]',
    )
    .slice(0, 1000)

const errorWithStatus = (message: string, statusCode = 400) => {
  const error: any = new Error(message)
  error.statusCode = statusCode
  return error
}

export const requestPlaybookGeneration = async ({
  optimizerId: optimizerIdInput,
  organizationId,
  currency: currencyInput,
  windowDays,
  refreshInsights = true,
  generatedBy,
}: {
  optimizerId: string
  organizationId?: any
  currency?: string
  windowDays?: number
  refreshInsights?: boolean
  generatedBy?: string
}) => {
  const optimizerId = normalizeOptimizerId(optimizerIdInput)
  if (!optimizerId) throw errorWithStatus('optimizerId 不能为空')
  const currency = normalizeCurrency(currencyInput)
  if (
    organizationId &&
    !mongoose.Types.ObjectId.isValid(String(organizationId))
  ) {
    throw errorWithStatus('organizationId 无效')
  }

  const scopeKey = scopeKeyFor(organizationId)
  const activeKey = JSON.stringify([scopeKey, optimizerId, currency || 'ALL'])
  const active: any = await PlaybookGeneration.findOne({
    activeKey,
    status: { $in: ['queued', 'running'] },
  }).lean()
  if (active) {
    if (active.status === 'queued') {
      const queued = await addOptimizerPlaybookJob(String(active._id))
      if (!queued) {
        await PlaybookGeneration.findByIdAndUpdate(active._id, {
          $set: {
            status: 'failed',
            completedAt: new Date(),
            error: '异步任务队列不可用，请稍后重试',
          },
          $unset: { activeKey: 1 },
        })
        throw errorWithStatus('异步任务队列不可用，请稍后重试', 503)
      }
    }
    return { generation: active, reused: true }
  }

  let generation: any
  try {
    generation = await PlaybookGeneration.create({
      scopeKey,
      ...(organizationId && {
        organizationId: objectIdValue(String(organizationId)),
      }),
      optimizerId,
      ...(currency && { currency }),
      activeKey,
      status: 'queued',
      windowDays: boundedWindowDays(windowDays),
      refreshInsights: refreshInsights !== false,
      generatedBy,
      requestedAt: new Date(),
    })
  } catch (error: any) {
    if (error?.code !== 11000) throw error
    const concurrent: any = await PlaybookGeneration.findOne({
      activeKey,
      status: { $in: ['queued', 'running'] },
    }).lean()
    if (!concurrent) throw error
    if (concurrent.status === 'queued') {
      const queued = await addOptimizerPlaybookJob(String(concurrent._id))
      if (!queued) {
        await PlaybookGeneration.findByIdAndUpdate(concurrent._id, {
          $set: {
            status: 'failed',
            completedAt: new Date(),
            error: '异步任务队列不可用，请稍后重试',
          },
          $unset: { activeKey: 1 },
        })
        throw errorWithStatus('异步任务队列不可用，请稍后重试', 503)
      }
    }
    return { generation: concurrent, reused: true }
  }

  const queued = await addOptimizerPlaybookJob(String(generation._id))
  if (!queued) {
    generation.status = 'failed'
    generation.error = '异步任务队列不可用，请稍后重试'
    generation.completedAt = new Date()
    generation.activeKey = undefined
    await generation.save()
    throw errorWithStatus(generation.error, 503)
  }

  return { generation: generation.toObject(), reused: false }
}

export const getPlaybookGeneration = async (
  id: string,
  accessFilter: any = {},
) => {
  if (!mongoose.Types.ObjectId.isValid(id))
    throw errorWithStatus('生成任务 ID 无效')
  const generation: any = await PlaybookGeneration.findOne(
    combineFilters({ _id: id }, accessFilter),
  ).lean()
  if (!generation) throw errorWithStatus('打法生成任务不存在或无权访问', 404)
  return generation
}

export const processPlaybookGeneration = async (
  generationId: string,
  generator = generateOptimizerPlaybook,
) => {
  const generation: any = await PlaybookGeneration.findOneAndUpdate(
    {
      _id: generationId,
      status: { $in: ['queued', 'running'] },
    },
    {
      $set: {
        status: 'running',
        startedAt: new Date(),
        error: undefined,
      },
    },
    { new: true },
  )
  if (!generation) {
    const existing: any = await PlaybookGeneration.findById(generationId).lean()
    if (existing?.status === 'completed') {
      return { skipped: true, playbookId: existing.playbookId }
    }
    throw errorWithStatus('打法生成任务不存在或状态不可执行', 409)
  }

  try {
    const playbook: any = await generator({
      optimizerId: generation.optimizerId,
      organizationId: generation.organizationId,
      currency: generation.currency,
      windowDays: generation.windowDays,
      refreshInsights: generation.refreshInsights,
      generatedBy: generation.generatedBy,
    })
    const completed: any = await PlaybookGeneration.findByIdAndUpdate(
      generation._id,
      {
        $set: {
          status: 'completed',
          playbookId: playbook._id,
          completedAt: new Date(),
          error: undefined,
        },
        $unset: { activeKey: 1 },
      },
      { new: true },
    ).lean()
    return { generation: completed, playbook }
  } catch (error: any) {
    await PlaybookGeneration.findByIdAndUpdate(generation._id, {
      $set: {
        status: 'failed',
        completedAt: new Date(),
        error: safeErrorMessage(error),
      },
      $unset: { activeKey: 1 },
    })
    throw error
  }
}
