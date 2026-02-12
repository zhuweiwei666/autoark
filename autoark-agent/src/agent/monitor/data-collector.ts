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

  // #region agent log
  log.info(`[DEBUG_ROAS][HA] dataSources config: ${JSON.stringify({sourceCount:sources.length,sources:sources.map((s:any)=>({name:s.name,role:s.role,cardId:s.cardId,enabled:s.enabled})),rawMonitorKeys:cfg?.monitor ? Object.keys(cfg.monitor) : 'no monitor key'})}`)
  // #endregion

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

    // #region agent log
    if (src.role === 'conversion') {
      log.info(`[DEBUG_ROAS][HB] conversion data: ${JSON.stringify({convCols:data.cols,convRowCount:data.rows.length,sampleRow:data.rows.length>0?data.rows[0]:null,hasCamIdCol:data.cols.includes('cam_id'),has渠道收入Col:data.cols.includes('渠道收入'),has首日ROICol:data.cols.includes('首日ROI'),has调整ROICol:data.cols.includes('调整的首日ROI')})}`)
    }
    // #endregion
  }

  // 没有数据直接返回
  if (spendRows.length === 0) {
    log.warn('[Collector] No spend data')
    return []
  }

  // 转化数据建索引
  const convMap = buildConvMap(convRows, convCols)

  // #region agent log
  const sampleConvEntries = [...convMap.entries()].slice(0, 3).map(([k,v]) => ({key:k, revenue:v.revenue, firstDayRoi:v.firstDayRoi, adjustedRoi:v.adjustedRoi}))
  log.info(`[DEBUG_ROAS][HC] convMap: ${JSON.stringify({convMapSize:convMap.size,sampleEntries:sampleConvEntries,convRowCount:convRows.length,convColCount:convCols.length})}`)
  // #endregion

  // 合并
  const idx = (cols: string[], name: string) => cols.findIndex(c => c.toLowerCase() === name.toLowerCase())
  const result: RawCampaign[] = []

  // #region agent log
  let matchCount = 0, missCount = 0
  // #endregion

  for (const row of spendRows) {
    const cid = row[idx(spendCols, 'campaign_id')]
    if (!cid) continue
    const conv = convMap.get(String(cid)) || {} as any

    // #region agent log
    if (conv.revenue !== undefined) matchCount++; else missCount++;
    // #endregion

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

  // #region agent log
  const sampleMerged = result.slice(0, 5).map(r => ({id:r.campaignId, spend:r.spend, revenue:r.revenue, firstDayRoi:r.firstDayRoi, adjustedRoi:r.adjustedRoi}))
  const totalRev = result.reduce((s,r) => s + r.revenue, 0)
  const totalAdj = result.reduce((s,r) => s + r.adjustedRoi, 0)
  const totalFdr = result.reduce((s,r) => s + r.firstDayRoi, 0)
  log.info(`[DEBUG_ROAS][HC/D] merge: ${JSON.stringify({totalCampaigns:result.length,matchCount,missCount,totalRevenue:totalRev,totalAdjustedRoi:totalAdj,totalFirstDayRoi:totalFdr})}`)
  log.info(`[DEBUG_ROAS][HC/D] sample: ${JSON.stringify(sampleMerged)}`)
  // #endregion

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
