/**
 * 感知层 - Agent 的眼睛
 * 每 10 分钟拉数据，和上次对比，检测异常事件
 */
import dayjs from 'dayjs'
import axios from 'axios'
import { log } from '../platform/logger'
import { getRedis } from '../config/redis'
import { AgentEvent, emitEvent } from './events'
import { CampaignMetrics } from './analyzer'
import { analyzeData } from './analyzer'
import { Snapshot } from '../data/snapshot.model'
import { Action } from '../action/action.model'

const MB_BASE = 'https://meta.iohubonline.club'
const MB_CARD_ID = '7786'
const MB_ACCESS_CODE = 'VfuSBdaO33sklvtr'

let mbSession: string | null = null
let mbSessionExpiry = 0
let lastSnapshot: Map<string, CampaignMetrics> = new Map()

async function getMbSession(): Promise<string> {
  if (mbSession && Date.now() < mbSessionExpiry) return mbSession
  const email = process.env.METABASE_EMAIL || ''
  const pw = process.env.METABASE_PASSWORD || ''
  if (!email || !pw) throw new Error('METABASE credentials not set')
  const res = await axios.post(`${MB_BASE}/api/session`, { username: email, password: pw })
  mbSession = res.data.id
  mbSessionExpiry = Date.now() + 12 * 3600 * 1000
  return mbSession!
}

/**
 * 主感知循环 - 拉数据、检测变化、发出事件
 */
export async function perceive(): Promise<{ events: AgentEvent[]; campaigns: CampaignMetrics[] }> {
  const today = dayjs().format('YYYY-MM-DD')
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
  const dayBefore = dayjs().subtract(2, 'day').format('YYYY-MM-DD')

  // 拉数据
  const session = await getMbSession()
  const mbRes = await axios.post(`${MB_BASE}/api/card/${MB_CARD_ID}/query`, {
    parameters: [
      { type: 'category', value: MB_ACCESS_CODE, target: ['variable', ['template-tag', 'access_code']] },
      { type: 'date/single', value: dayBefore, target: ['variable', ['template-tag', 'start_day']] },
      { type: 'date/single', value: today, target: ['variable', ['template-tag', 'end_day']] },
    ],
  }, {
    headers: { 'X-Metabase-Session': session, 'Content-Type': 'application/json' },
    timeout: 60000,
  })

  const rawData = mbRes.data?.data
  if (!rawData?.cols || !rawData?.rows?.length) {
    log.warn('[Perception] No data from Metabase')
    return { events: [], campaigns: [] }
  }

  const columns = rawData.cols.map((c: any) => c.name)
  const campaigns = analyzeData(rawData.rows, columns, today, yesterday, dayBefore)

  // 检测事件
  const events: AgentEvent[] = []
  const hourNow = dayjs().hour() + dayjs().minute() / 60
  const currentSnapshot = new Map<string, CampaignMetrics>()

  for (const c of campaigns) {
    currentSnapshot.set(c.campaignId, c)
    const prev = lastSnapshot.get(c.campaignId)

    // 1. 花费飙升（今日花费速率 > 昨日平均速率的 2 倍）
    if (c.yesterdaySpend > 10 && hourNow > 2) {
      const yesterdayRate = c.yesterdaySpend / 24
      const todayRate = c.todaySpend / hourNow
      if (todayRate > yesterdayRate * 2 && c.todaySpend > 20) {
        events.push({
          type: 'spend_spike', campaignId: c.campaignId, campaignName: c.campaignName,
          accountId: c.accountId, currentRate: Math.round(todayRate * 100) / 100,
          normalRate: Math.round(yesterdayRate * 100) / 100, ratio: Math.round(todayRate / yesterdayRate * 10) / 10,
        })
      }
    }

    // 2. ROAS 暴跌（今日 ROAS 比昨日下降 > 50%）
    if (c.yesterdayRoas > 0.5 && c.todaySpend > 20 && hourNow > 3) {
      const dropPct = Math.round((1 - c.todayRoas / c.yesterdayRoas) * 100)
      if (dropPct > 50) {
        events.push({
          type: 'roas_crash', campaignId: c.campaignId, campaignName: c.campaignName,
          accountId: c.accountId, before: c.yesterdayRoas, after: c.todayRoas, dropPct,
        })
      }
    }

    // 3. 高花费零转化
    if (c.todaySpend > 50 && c.todayConversions === 0 && hourNow > 4) {
      events.push({
        type: 'zero_conversion', campaignId: c.campaignId, campaignName: c.campaignName,
        accountId: c.accountId, spend: c.todaySpend, hours: Math.round(hourNow),
      })
    }

    // 4. 效果恢复（之前差，现在好了）
    if (prev && prev.todayRoas < 0.5 && c.todayRoas > 1.5) {
      events.push({
        type: 'performance_recovered', campaignId: c.campaignId, campaignName: c.campaignName,
        roasBefore: prev.todayRoas, roasNow: c.todayRoas,
      })
    }
  }

  // 5. 待复盘的历史决策
  const reflectionDue = await Action.find({
    status: 'executed',
    executedAt: {
      $gte: dayjs().subtract(4, 'hour').toDate(),
      $lte: dayjs().subtract(2, 'hour').toDate(),
    },
    'params.reflected': { $ne: true },
  }).lean()

  for (const a of reflectionDue) {
    events.push({
      type: 'reflection_due', decisionId: (a as any)._id.toString(),
      campaignId: (a as any).entityId || '', hoursAgo: Math.round(dayjs().diff(dayjs((a as any).executedAt), 'hour', true)),
    })
  }

  // 更新快照缓存
  lastSnapshot = currentSnapshot

  // 保存到 Redis 工作记忆
  try {
    const redis = getRedis()
    if (redis) {
      await redis.set('agent:working:campaigns', JSON.stringify(
        campaigns.slice(0, 100).map(c => ({
          id: c.campaignId, name: c.campaignName, account: c.accountId,
          spend: c.todaySpend, roas: c.todayRoas, trend: c.roasTrend,
        }))
      ), 'EX', 900) // 15 分钟过期
      await redis.set('agent:working:lastPerception', dayjs().toISOString(), 'EX', 900)
      await redis.set('agent:working:eventCount', String(events.length), 'EX', 900)
    }
  } catch { /* Redis optional */ }

  log.info(`[Perception] ${campaigns.length} campaigns, ${events.length} events detected`)

  // 发出事件
  for (const event of events) {
    await emitEvent(event)
  }

  return { events, campaigns }
}
