import cron, { ScheduledTask } from 'node-cron'
import ExternalMaterialSyncState from '../models/ExternalMaterialSyncState'
import {
  ExternalMaterialEnqueueResult,
  ExternalMaterialSyncRequest,
  enqueueExternalMaterialSync,
  reconcileExternalMaterialContinuations,
} from '../queue/externalMaterial.queue'
import logger from '../utils/logger'

export const EXTERNAL_MATERIAL_CRON_EXPRESSION = '0 */6 * * *'

interface CronStateStore {
  get(provider: 'guangdada'): Promise<{
    paused?: boolean
    recurringEnabled?: boolean
  } | null>
}

interface ExternalMaterialCronDependencies {
  env: NodeJS.ProcessEnv
  states: CronStateStore
  enqueue(
    request: ExternalMaterialSyncRequest,
  ): Promise<ExternalMaterialEnqueueResult>
  reconcile(): Promise<number>
}

const defaultStateStore: CronStateStore = {
  get: (provider) => ExternalMaterialSyncState.findOne({ provider }).lean(),
}

const defaultDependencies = (): ExternalMaterialCronDependencies => ({
  env: process.env,
  states: defaultStateStore,
  enqueue: enqueueExternalMaterialSync,
  reconcile: () =>
    reconcileExternalMaterialContinuations({ provider: 'guangdada' }),
})

export const runExternalMaterialCronTick = async (
  dependencies: ExternalMaterialCronDependencies = defaultDependencies(),
): Promise<void> => {
  if (
    dependencies.env.EXTERNAL_MATERIAL_SYNC_ENABLED !== 'true' ||
    !dependencies.env.GUANGDADA_API_KEY?.trim()
  ) {
    return
  }

  const state = await dependencies.states.get('guangdada')
  if (state?.paused || state?.recurringEnabled === false) return

  await dependencies.reconcile()
  await dependencies.enqueue({
    provider: 'guangdada',
    mode: 'scheduled',
    dryRun: false,
    recentDays: 3,
    limit: 500,
  })
}

let externalMaterialCronTask: ScheduledTask | null = null

export const initExternalMaterialCron = (): ScheduledTask => {
  if (externalMaterialCronTask) return externalMaterialCronTask
  externalMaterialCronTask = cron.schedule(
    EXTERNAL_MATERIAL_CRON_EXPRESSION,
    () => {
      void runExternalMaterialCronTick().catch(() => {
        logger.error('[ExternalMaterialCron] Tick failed')
      })
    },
  )
  logger.info('[ExternalMaterialCron] Scheduled')
  return externalMaterialCronTask
}

export const closeExternalMaterialCron = (): void => {
  externalMaterialCronTask?.stop()
  externalMaterialCronTask = null
}
