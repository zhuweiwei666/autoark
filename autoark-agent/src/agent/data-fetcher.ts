/**
 * 数据采集器 - 从 Metabase 拉取多个数据源并合并
 * 
 * 7786: 花费数据（spend, impressions, clicks）
 * 4002: 转化数据（installs, CPI, CPA, ROI, ARPU, 付费率）
 * 
 * 按 campaign_id + date 合并成一条完整记录
 */
import axios from 'axios'
import dayjs from 'dayjs'
import { log } from '../platform/logger'
import { getAgentConfig } from './agent-config.model'

const MB_BASE = 'https://meta.iohubonline.club'
let mbSession: string | null = null
let mbSessionExpiry = 0

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

export interface MergedCampaignData {
  date: string
  campaignId: string | null
  campaignName: string | null
  accountId: string | null
  accountName: string | null
  platform: string | null
  optimizer: string | null
  pkgName: string | null
  // 花费数据 (7786)
  spend: number
  impressions: number
  clicks: number
  // 转化数据 (4002)
  installs: number
  cpi: number
  cpa: number
  revenue: number     // 渠道收入
  firstDayRoi: number
  adjustedRoi: number
  day3Roi: number
  day7Roi: number
  firstDayUv: number
  payUv: number
  payRate: number
  arpu: number
  ctr: number
}

/**
 * 拉取并合并多个数据源
 */
export async function fetchMergedData(startDate: string, endDate: string): Promise<MergedCampaignData[]> {
  const session = await getMbSession()
  const monitorConfig = await getAgentConfig('monitor')
  const dataSources = monitorConfig?.monitor?.dataSources || []

  const spendSource = dataSources.find((d: any) => d.role === 'spend' && d.enabled)
  const convSource = dataSources.find((d: any) => d.role === 'conversion' && d.enabled)

  // 拉花费数据 (7786)
  let spendRows: any[][] = []
  let spendCols: string[] = []
  if (spendSource) {
    const res = await queryMetabase(session, spendSource.cardId, spendSource.accessCode, startDate, endDate, {})
    spendCols = res.columns
    spendRows = res.rows
    log.info(`[DataFetcher] Spend data: ${spendRows.length} rows from card ${spendSource.cardId}`)
  }

  // 拉转化数据 (4002)
  let convRows: any[][] = []
  let convCols: string[] = []
  if (convSource) {
    const res = await queryMetabase(session, convSource.cardId, convSource.accessCode, startDate, endDate, {
      platform: 'ALL', channel_name: 'ALL',
    })
    convCols = res.columns
    convRows = res.rows
    log.info(`[DataFetcher] Conversion data: ${convRows.length} rows from card ${convSource.cardId}`)
  }

  // 合并：以花费数据为主，用 campaign_id 关联转化数据
  const convMap = buildConversionMap(convRows, convCols)
  const merged = mergeData(spendRows, spendCols, convMap)

  log.info(`[DataFetcher] Merged: ${merged.length} campaigns`)
  return merged
}

async function queryMetabase(
  session: string, cardId: string, accessCode: string,
  startDate: string, endDate: string, extraParams: Record<string, string>,
): Promise<{ columns: string[]; rows: any[][] }> {
  const parameters: any[] = [
    { type: 'category', value: accessCode, target: ['variable', ['template-tag', 'access_code']] },
    { type: 'date/single', value: startDate, target: ['variable', ['template-tag', 'start_day']] },
    { type: 'date/single', value: endDate, target: ['variable', ['template-tag', 'end_day']] },
  ]
  for (const [key, value] of Object.entries(extraParams)) {
    parameters.push({ type: 'category', value, target: ['variable', ['template-tag', key]] })
  }

  const res = await axios.post(`${MB_BASE}/api/card/${cardId}/query`, { parameters }, {
    headers: { 'X-Metabase-Session': session, 'Content-Type': 'application/json' },
    timeout: 60000,
  })

  const data = res.data?.data
  if (!data?.cols) return { columns: [], rows: [] }

  return {
    columns: data.cols.map((c: any) => c.name),
    rows: data.rows || [],
  }
}

/**
 * 把 4002 转化数据按 cam_id 建索引
 */
function buildConversionMap(rows: any[][], cols: string[]): Map<string, any> {
  const idx = (name: string) => cols.indexOf(name)
  const map = new Map<string, any>()

  const iCamId = idx('cam_id')
  if (iCamId === -1) return map

  for (const row of rows) {
    const camId = row[iCamId]
    if (!camId) continue
    // 可能有多行（汇总行等），取有 cam_id 的
    map.set(String(camId), {
      installs: Number(row[idx('安装量')] || 0),
      cpi: Number(row[idx('CPI')] || 0),
      cpa: Number(row[idx('CPA')] || 0),
      revenue: Number(row[idx('渠道收入')] || 0),
      firstDayRoi: Number(row[idx('首日ROI')] || 0),
      adjustedRoi: Number(row[idx('调整的首日ROI')] || 0),
      day3Roi: Number(row[idx('三日回收ROI')] || 0),
      day7Roi: Number(row[idx('七日回收ROI')] || 0),
      firstDayUv: Number(row[idx('首日UV')] || 0),
      payUv: Number(row[idx('首日付费UV')] || 0),
      payRate: Number(row[idx('首日付费率')] || 0),
      arpu: Number(row[idx('首日ARPU')] || 0),
      ctr: Number(row[idx('CTR')] || 0),
    })
  }

  return map
}

/**
 * 合并花费数据和转化数据
 */
function mergeData(spendRows: any[][], spendCols: string[], convMap: Map<string, any>): MergedCampaignData[] {
  const idx = (name: string) => {
    const i = spendCols.findIndex(c => c.toLowerCase() === name.toLowerCase())
    return i
  }

  const results: MergedCampaignData[] = []

  for (const row of spendRows) {
    const campaignId = row[idx('campaign_id')]
    if (!campaignId) continue

    const conv = convMap.get(String(campaignId)) || {}

    results.push({
      date: row[idx('to_date')] || '',
      campaignId: String(campaignId),
      campaignName: row[idx('campaign_name')] || null,
      accountId: row[idx('ad_account_id')] || null,
      accountName: row[idx('ad_account_name')] || null,
      platform: row[idx('platform')] || null,
      optimizer: row[idx('optimizer')] || null,
      pkgName: row[idx('pkg_name')] || null,
      // 花费
      spend: Number(row[idx('original_ad_spend')] || row[idx('spend')] || 0),
      impressions: Number(row[idx('impressions')] || 0),
      clicks: Number(row[idx('clicks')] || 0),
      // 转化（从 4002 合并）
      installs: conv.installs || 0,
      cpi: conv.cpi || 0,
      cpa: conv.cpa || 0,
      revenue: conv.revenue || 0,
      firstDayRoi: conv.firstDayRoi || 0,
      adjustedRoi: conv.adjustedRoi || 0,
      day3Roi: conv.day3Roi || 0,
      day7Roi: conv.day7Roi || 0,
      firstDayUv: conv.firstDayUv || 0,
      payUv: conv.payUv || 0,
      payRate: conv.payRate || 0,
      arpu: conv.arpu || 0,
      ctr: conv.ctr || 0,
    })
  }

  return results
}
