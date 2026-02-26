/**
 * 数据采集器 — 双源采集：Facebook API (一手) + Metabase BI (补充)
 *
 * 优先级：
 * 1. Facebook API: 实时花费、状态、预算（一手数据，最可信）
 * 2. Metabase BI: 收入、ROI、付费率、ARPU（FB API 没有的业务指标）
 *
 * 合并策略：以 Facebook API 为基础，Metabase 补充业务指标。
 * 如果 campaign 在 FB API 中存在，用 FB 的 spend/status；
 * Metabase 中有但 FB 没有的（如 TikTok），保留 Metabase 数据。
 */
import axios from 'axios'
import dayjs from 'dayjs'
import { log } from '../../platform/logger'
import { getAgentConfig } from '../agent-config.model'

const FB_GRAPH = 'https://graph.facebook.com/v21.0'
const MB_BASE = 'https://meta.iohubonline.club'
let mbSession: string | null = null
let mbExpiry = 0

async function session(): Promise<string> {
  if (mbSession && Date.now() < mbExpiry) return mbSession
  const e = process.env.METABASE_EMAIL, p = process.env.METABASE_PASSWORD
  if (!e || !p) throw new Error('METABASE credentials not set')
  const r = await axios.post(`${MB_BASE}/api/session`, { username: e, password: p })
  mbSession = r.data.id; mbExpiry = Date.now() + 12 * 3600e3
  return mbSession!
}

export interface RawCampaign {
  campaignId: string
  campaignName: string
  accountId: string
  platform: string
  optimizer: string
  pkgName: string
  date: string
  spend: number
  installs: number
  cpi: number
  cpa: number
  revenue: number
  firstDayRoi: number
  adjustedRoi: number
  day3Roi: number
  payRate: number
  arpu: number
  ctr: number
  source?: 'facebook_api' | 'metabase' | 'merged'
}

/**
 * 双源采集：Metabase (基础) + Facebook API (补充新 campaign)
 *
 * 策略：
 * 1. Metabase 是权威数据源（花费、收入、ROI 全有），覆盖所有平台
 * 2. Facebook API 只用来发现 Metabase 中还没有的新 campaign（刚发布的）
 * 3. 不用 FB API 的 spend 覆盖 Metabase 的 spend（Metabase 更完整）
 */
export async function collectData(startDate: string, endDate: string): Promise<RawCampaign[]> {
  const [fbCampaigns, mbData] = await Promise.all([
    collectNewCampaignsFromFB().catch(err => {
      log.warn(`[Collector] Facebook API failed: ${err.message}`)
      return [] as RawCampaign[]
    }),
    collectFromMetabase(startDate, endDate).catch(err => {
      log.warn(`[Collector] Metabase failed: ${err.message}`)
      return [] as RawCampaign[]
    }),
  ])

  // Metabase 为基础
  const result = new Map<string, RawCampaign>()
  for (const mb of mbData) {
    result.set(mb.campaignId, { ...mb, source: 'metabase' })
  }

  // FB API 只补充 Metabase 中没有的新 campaign
  let fbAdded = 0
  for (const fb of fbCampaigns) {
    if (!result.has(fb.campaignId)) {
      result.set(fb.campaignId, { ...fb, source: 'facebook_api' })
      fbAdded++
    }
  }

  const all = [...result.values()]
  log.info(`[Collector] Metabase: ${mbData.length}, FB new: ${fbAdded} (of ${fbCampaigns.length} checked), Total: ${all.length}`)

  return all
}

// ==================== Facebook API: 发现新 campaign ====================

/**
 * 拉 ACTIVE + PAUSED campaign 列表（不查 insights），用于发现 Metabase 中还没有的广告
 */
async function collectNewCampaignsFromFB(): Promise<RawCampaign[]> {
  const fbToken = process.env.FB_ACCESS_TOKEN
  if (!fbToken) return []

  const accountsRes = await axios.get(`${FB_GRAPH}/me/adaccounts`, {
    params: { fields: 'id,account_id,name', limit: 200, access_token: fbToken },
    timeout: 15000,
  })
  const accounts = accountsRes.data?.data || []
  const today = dayjs().format('YYYY-MM-DD')
  const result: RawCampaign[] = []

  for (const acc of accounts) {
    try {
      const res = await axios.get(`${FB_GRAPH}/${acc.id}/campaigns`, {
        params: { fields: 'id,name,status,daily_budget', limit: 500, access_token: fbToken },
        timeout: 15000,
      })

      for (const camp of res.data?.data || []) {
        if (camp.status !== 'ACTIVE' && camp.status !== 'PAUSED') continue

        const parts = camp.name.split('_')
        const optimizer = parts[0] || ''
        const pkgName = parts.length >= 3 ? parts[2] : ''

        result.push({
          campaignId: camp.id,
          campaignName: camp.name,
          accountId: acc.account_id,
          platform: 'FB',
          optimizer,
          pkgName,
          date: today,
          spend: 0,
          installs: 0,
          cpi: 0,
          cpa: 0,
          revenue: 0,
          firstDayRoi: 0,
          adjustedRoi: 0,
          day3Roi: 0,
          payRate: 0,
          arpu: 0,
          ctr: 0,
        })
      }
    } catch (e: any) {
      log.warn(`[Collector] FB account ${acc.account_id} failed: ${e.message}`)
    }
  }

  return result
}

// ==================== Metabase 采集 ====================

async function collectFromMetabase(startDate: string, endDate: string): Promise<RawCampaign[]> {
  const tok = await session()
  const cfg = await getAgentConfig('monitor')
  const src = (cfg?.monitor?.dataSources || []).find((d: any) => d.enabled)

  if (!src) {
    log.warn('[Collector] No enabled Metabase data source')
    return []
  }

  const data = await queryCard(tok, src.cardId, src.accessCode, startDate, endDate)
  log.info(`[Collector] Metabase ${src.name}: ${data.rows.length} rows, ${data.cols.length} cols`)

  const col = (name: string) => data.cols.indexOf(name)
  const result: RawCampaign[] = []
  let skipped = 0

  for (const r of data.rows) {
    const camId = r[col('cam_id')]
    if (!camId || camId === '_' || camId === 'None' || camId === null) { skipped++; continue }

    const spendAPI = Number(r[col('广告花费_API')] || 0)
    const spendBI = Number(r[col('广告花费')] || 0)
    const spend = spendAPI > 0 ? spendAPI : spendBI

    const adjustedRevenue = Number(r[col('调整的首日收入')] || 0)
    const channelRevenue = Number(r[col('渠道收入')] || 0)
    const firstDayRevenue = Number(r[col('首日新增收入')] || 0)

    const roi = (rev: number) => spend > 0 ? rev / spend : 0
    const firstDayUV = Number(r[col('首日UV')] || 0)

    result.push({
      campaignId: String(camId),
      campaignName: r[col('campaign_name')] || '',
      accountId: String(r[col('ad_account_id')] || ''),
      platform: r[col('渠道')] || '',
      optimizer: r[col('优化师')] || '',
      pkgName: r[col('包名')] || '',
      date: r[col('日期')] || endDate,
      spend,
      installs: firstDayUV,
      cpi: firstDayUV > 0 ? spend / firstDayUV : 0,
      cpa: Number(r[col('CPA')] || 0),
      revenue: adjustedRevenue > 0 ? adjustedRevenue : channelRevenue,
      firstDayRoi: roi(firstDayRevenue),
      adjustedRoi: roi(adjustedRevenue),
      day3Roi: Number(r[col('三日回收ROI')] || 0),
      payRate: Number(r[col('首日付费率')] || 0),
      arpu: Number(r[col('首日ARPU')] || 0),
      ctr: Number(r[col('CTR')] || 0),
    })
  }

  if (skipped > 0) log.info(`[Collector] Metabase skipped ${skipped} summary/empty rows`)
  return result
}

async function queryCard(tok: string, cardId: string, accessCode: string, start: string, end: string) {
  const params = [
    { type: 'category', value: accessCode, target: ['variable', ['template-tag', 'access_code']] },
    { type: 'date/single', value: start, target: ['variable', ['template-tag', 'start_day']] },
    { type: 'date/single', value: end, target: ['variable', ['template-tag', 'end_day']] },
    { type: 'category', value: 'ALL', target: ['variable', ['template-tag', 'platform']] },
    { type: 'category', value: 'ALL', target: ['variable', ['template-tag', 'channel_name']] },
  ]
  const res = await axios.post(`${MB_BASE}/api/card/${cardId}/query`, { parameters: params }, {
    headers: { 'X-Metabase-Session': tok, 'Content-Type': 'application/json' }, timeout: 60000,
  })
  const d = res.data?.data
  return { cols: (d?.cols || []).map((c: any) => c.name), rows: d?.rows || [] }
}
