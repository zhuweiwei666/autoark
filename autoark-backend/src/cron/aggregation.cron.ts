/**
 * 📊 预聚合数据滚动刷新
 *
 * - 今天：每 10 分钟刷新
 * - 昨天：每小时最终校准
 * - 前天：每天最终校准
 * - 更早日期：只读永久事实；仅 coverage-gap/管理员定向补拉
 * - 同一日期重复触发会合并，所有日期串行执行，避免放大 Meta 请求
 */

import cron from 'node-cron'
import logger from '../utils/logger'
import { isFacebookAggregationEnabled } from '../config/facebookSync'
import { refreshAggregation } from '../services/aggregation.service'
import { freezeMatureMetaInsightsCoverage } from '../services/metaInsightsPersistence.service'
import { addDateDays, formatShanghaiDate } from '../utils/shanghaiDate'

type RefreshTrigger = 'initial' | 'today' | 'yesterday' | 'day-before'

export function initAggregationCron() {
  if (!isFacebookAggregationEnabled()) {
    logger.warn(
      '[AggregationCron] Meta aggregation disabled; cron not scheduled',
    )
    return
  }

  const pendingDates = new Map<string, RefreshTrigger>()
  let drainInFlight: Promise<void> | null = null

  const drain = async () => {
    while (pendingDates.size > 0) {
      const next = pendingDates.entries().next().value as
        | [string, RefreshTrigger]
        | undefined
      if (!next) break
      const [date, trigger] = next
      pendingDates.delete(date)
      logger.info(`[AggregationCron] Starting ${trigger} refresh for ${date}...`)
      try {
        await refreshAggregation(date)
        if (trigger === 'day-before') {
          await freezeMatureMetaInsightsCoverage()
        }
        logger.info(`[AggregationCron] ${trigger} refresh for ${date} completed`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(
          `[AggregationCron] ${trigger} refresh for ${date} failed:`,
          message,
        )
      }
    }
  }

  const enqueueRefresh = (
    trigger: RefreshTrigger,
    offsetDays: number,
  ): Promise<void> => {
    const date = addDateDays(formatShanghaiDate(), offsetDays)
    pendingDates.set(date, trigger)
    if (!drainInFlight) {
      drainInFlight = drain().finally(() => {
        drainInFlight = null
      })
    }
    return drainInFlight
  }

  setTimeout(() => enqueueRefresh('initial', 0), 5000)

  cron.schedule(
    '*/10 * * * *',
    () => enqueueRefresh('today', 0),
    { timezone: 'Asia/Shanghai' },
  )
  cron.schedule(
    '3 * * * *',
    () => enqueueRefresh('yesterday', -1),
    { timezone: 'Asia/Shanghai' },
  )
  cron.schedule(
    '47 23 * * *',
    () => enqueueRefresh('day-before', -2),
    { timezone: 'Asia/Shanghai' },
  )

  logger.info(
    '[AggregationCron] Meta aggregation initialized '
      + '(today/10m, yesterday/hourly, day-before/23:47 final; older dates frozen)',
  )
}

export default initAggregationCron
