/**
 * 数据采集器 — 从 Metabase 聚合表拉取 campaign 全量指标
 *
 * 单次请求获取花费、转化、收入、ROI 等全部字段，
 * 监控 Agent 负责将每次采集的快照存入时序，供趋势分析使用。
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
  campaignId: string
  campaignName: string
  platform: string      // 渠道: FB / TT
  optimizer: string     // 优化师
  pkgName: string       // 包名
  date: string          // 日期
  spend: number         // 花费（API 口径）
  installs: number      // 安装量
  cpi: number           // CPI
  cpa: number           // CPA
  revenue: number       // 收入（调整的首日收入，最准确）
  firstDayRoi: number   // 首日 ROI（基于 API 花费）
  adjustedRoi: number   // 调整 ROI（基于 API 花费）
  day3Roi: number       // 三日回收 ROI
  payRate: number       // 首日付费率
  arpu: number          // 首日 ARPU
  ctr: number           // CTR
}

/**
 * 从 Metabase 聚合表采集 campaign 数据
 */
export async function collectData(startDate: string, endDate: string): Promise<RawCampaign[]> {
  const tok = await session()
  const cfg = await getAgentConfig('monitor')
  const src = (cfg?.monitor?.dataSources || []).find((d: any) => d.enabled)

  if (!src) {
    log.warn('[Collector] No enabled data source')
    return []
  }

  const data = await queryCard(tok, src.cardId, src.accessCode, startDate, endDate)
  log.info(`[Collector] ${src.name}: ${data.rows.length} rows, ${data.cols.length} cols`)

  const col = (name: string) => data.cols.indexOf(name)
  const result: RawCampaign[] = []
  let skipped = 0

  for (const r of data.rows) {
    const camId = r[col('cam_id')]
    if (!camId || camId === '_' || camId === 'None' || camId === null) { skipped++; continue }

    const spendAPI = Number(r[col('广告花费_API')] || 0)
    const spendBI = Number(r[col('广告花费')] || 0)
    const spend = spendAPI > 0 ? spendAPI : spendBI

    // 收入
    const adjustedRevenue = Number(r[col('调整的首日收入')] || 0)
    const channelRevenue = Number(r[col('渠道收入')] || 0)
    const firstDayRevenue = Number(r[col('首日新增收入')] || 0)

    // ROI 基于 API 花费重算（BI 花费偏低会导致 ROI 虚高）
    const roi = (rev: number) => spend > 0 ? rev / spend : 0

    result.push({
      campaignId: String(camId),
      campaignName: r[col('campaign_name')] || '',
      platform: r[col('渠道')] || '',
      optimizer: r[col('优化师')] || '',
      pkgName: r[col('包名')] || '',
      date: r[col('日期')] || endDate,
      spend,
      installs: Number(r[col('安装量')] || 0),
      cpi: Number(r[col('CPI')] || 0),
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

  if (skipped > 0) log.info(`[Collector] Skipped ${skipped} summary/empty rows`)
  log.info(`[Collector] Result: ${result.length} campaigns`)
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
