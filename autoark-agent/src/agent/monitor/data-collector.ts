/**
 * 数据采集器 — 从 Metabase 拉取配置好的数据源，合并返回
 */
import axios from 'axios'
import { log } from '../../platform/logger'
import { getAgentConfig } from '../agent-config.model'

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
  campaignId: string; campaignName: string; accountId: string; accountName: string
  platform: string; optimizer: string; pkgName: string; date: string
  spend: number; impressions: number; clicks: number
  installs: number; cpi: number; cpa: number; revenue: number
  firstDayRoi: number; adjustedRoi: number; day3Roi: number; day7Roi: number
  payRate: number; arpu: number; ctr: number
}

/**
 * 拉取所有配置的数据源并合并
 */
export async function collectData(startDate: string, endDate: string): Promise<RawCampaign[]> {
  const tok = await session()
  const cfg = await getAgentConfig('monitor')
  const sources = (cfg?.monitor?.dataSources || []).filter((d: any) => d.enabled)

  let spendRows: any[][] = [], spendCols: string[] = []
  let convRows: any[][] = [], convCols: string[] = []

  for (const src of sources) {
    const extra: Record<string, string> = {}
    if (src.role === 'conversion') { extra.platform = 'ALL'; extra.channel_name = 'ALL' }

    const data = await queryCard(tok, src.cardId, src.accessCode, startDate, endDate, extra)
    if (src.role === 'spend') { spendCols = data.cols; spendRows = data.rows }
    else if (src.role === 'conversion') { convCols = data.cols; convRows = data.rows }
    else { spendCols = data.cols; spendRows = data.rows } // 默认当 spend
    log.info(`[Collector] ${src.name}: ${data.rows.length} rows`)

  }

  // 没有数据直接返回
  if (spendRows.length === 0) {
    log.warn('[Collector] No spend data')
    return []
  }

  // 转化数据建索引
  const convMap = buildConvMap(convRows, convCols)

  // 合并
  const idx = (cols: string[], name: string) => cols.findIndex(c => c.toLowerCase() === name.toLowerCase())
  const result: RawCampaign[] = []

  for (const row of spendRows) {
    const cid = row[idx(spendCols, 'campaign_id')]
    if (!cid) continue
    const conv = convMap.get(String(cid)) || {} as any

    result.push({
      campaignId: String(cid),
      campaignName: row[idx(spendCols, 'campaign_name')] || '',
      accountId: row[idx(spendCols, 'ad_account_id')] || '',
      accountName: row[idx(spendCols, 'ad_account_name')] || '',
      platform: row[idx(spendCols, 'platform')] || '',
      optimizer: row[idx(spendCols, 'optimizer')] || '',
      pkgName: row[idx(spendCols, 'pkg_name')] || '',
      date: row[idx(spendCols, 'to_date')] || endDate,
      spend: Number(row[idx(spendCols, 'original_ad_spend')] || row[idx(spendCols, 'spend')] || 0),
      impressions: Number(row[idx(spendCols, 'impressions')] || 0),
      clicks: Number(row[idx(spendCols, 'clicks')] || 0),
      installs: conv.installs || 0,
      cpi: conv.cpi || 0,
      cpa: conv.cpa || 0,
      revenue: conv.revenue || 0,
      firstDayRoi: conv.firstDayRoi || 0,
      adjustedRoi: conv.adjustedRoi || 0,
      day3Roi: conv.day3Roi || 0,
      day7Roi: conv.day7Roi || 0,
      payRate: conv.payRate || 0,
      arpu: conv.arpu || 0,
      ctr: conv.ctr || 0,
    })
  }

  log.info(`[Collector] Merged: ${result.length} campaigns`)
  return result
}

async function queryCard(tok: string, cardId: string, accessCode: string, start: string, end: string, extra: Record<string, string>) {
  const params: any[] = [
    { type: 'category', value: accessCode, target: ['variable', ['template-tag', 'access_code']] },
    { type: 'date/single', value: start, target: ['variable', ['template-tag', 'start_day']] },
    { type: 'date/single', value: end, target: ['variable', ['template-tag', 'end_day']] },
  ]
  for (const [k, v] of Object.entries(extra)) {
    params.push({ type: 'category', value: v, target: ['variable', ['template-tag', k]] })
  }
  const res = await axios.post(`${MB_BASE}/api/card/${cardId}/query`, { parameters: params }, {
    headers: { 'X-Metabase-Session': tok, 'Content-Type': 'application/json' }, timeout: 60000,
  })
  const d = res.data?.data
  return { cols: (d?.cols || []).map((c: any) => c.name), rows: d?.rows || [] }
}

function buildConvMap(rows: any[][], cols: string[]) {
  const i = (n: string) => cols.indexOf(n)
  const map = new Map<string, any>()
  const ci = i('cam_id')
  if (ci === -1) return map
  let skipped = 0
  for (const r of rows) {
    const id = r[ci]
    // cam_id 为空的是杂质，直接过滤
    if (!id || id === '_' || id === 'None' || id === null) { skipped++; continue }
    map.set(String(id), {
      installs: Number(r[i('安装量')] || 0), cpi: Number(r[i('CPI')] || 0), cpa: Number(r[i('CPA')] || 0),
      revenue: Number(r[i('渠道收入')] || 0), firstDayRoi: Number(r[i('首日ROI')] || 0),
      adjustedRoi: Number(r[i('调整的首日ROI')] || 0), day3Roi: Number(r[i('三日回收ROI')] || 0),
      day7Roi: Number(r[i('七日回收ROI')] || 0), payRate: Number(r[i('首日付费率')] || 0),
      arpu: Number(r[i('首日ARPU')] || 0), ctr: Number(r[i('CTR')] || 0),
    })
  }
  if (skipped > 0) log.info(`[Collector] Conversion data: ${map.size} matched, ${skipped} skipped (no cam_id)`)
  return map
}
