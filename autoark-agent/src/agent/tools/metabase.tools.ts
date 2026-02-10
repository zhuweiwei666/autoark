/**
 * Metabase 工具 - 通过 Metabase API 查询 BI 数据
 */
import { ToolDef, S } from '../tools'
import axios from 'axios'
import { log } from '../../platform/logger'

const MB_BASE = 'https://meta.iohubonline.club'
const MB_EMAIL = process.env.METABASE_EMAIL || 'zhuweiwei@adcreative.cn'
const MB_PASSWORD = process.env.METABASE_PASSWORD || ''

let sessionToken: string | null = null
let sessionExpiry = 0

async function getSession(): Promise<string> {
  if (sessionToken && Date.now() < sessionExpiry) return sessionToken
  if (!MB_PASSWORD) throw new Error('METABASE_PASSWORD not configured')
  const res = await axios.post(`${MB_BASE}/api/session`, { username: MB_EMAIL, password: MB_PASSWORD })
  sessionToken = res.data.id
  sessionExpiry = Date.now() + 12 * 3600 * 1000
  log.info('[Metabase] Session acquired')
  return sessionToken!
}

const mb_query: ToolDef = {
  name: 'metabase_query',
  description: '通过 Metabase 查询 BI 数据（广告花费、ROAS、安装量等）。可以按日期、优化师、包名、广告系列等维度筛选。',
  parameters: S.obj('参数', {
    cardId: S.str('Metabase Question ID（默认 4002）'),
    startDate: S.str('开始日期 YYYY-MM-DD'),
    endDate: S.str('结束日期 YYYY-MM-DD'),
    accessCode: S.str('访问码（默认 xheqmmolkpj9f35e）'),
    optimizer: S.str('优化师名称（可选）'),
    pkgName: S.str('包名（可选）'),
    campaignId: S.str('广告系列 ID（可选）'),
    platform: S.str('平台 ALL/Facebook/Google（默认 ALL）'),
  }, ['startDate', 'endDate']),
  handler: async (args) => {
    const token = await getSession()
    const cardId = args.cardId || '4002'
    const parameters: any[] = []

    const addParam = (tag: string, value: string) => {
      if (value) parameters.push({ type: 'category', value, target: ['variable', ['template-tag', tag]] })
    }

    addParam('access_code', args.accessCode || 'xheqmmolkpj9f35e')
    if (args.startDate) parameters.push({ type: 'date/single', value: args.startDate, target: ['variable', ['template-tag', 'start_day']] })
    if (args.endDate) parameters.push({ type: 'date/single', value: args.endDate, target: ['variable', ['template-tag', 'end_day']] })
    addParam('optimizer', args.optimizer || '')
    addParam('pkg_name', args.pkgName || '')
    addParam('cam_id', args.campaignId || '')
    addParam('platform', args.platform || 'ALL')
    addParam('channel_name', 'ALL')

    const res = await axios.post(`${MB_BASE}/api/card/${cardId}/query`, { parameters }, {
      headers: { 'X-Metabase-Session': token, 'Content-Type': 'application/json' },
      timeout: 60000,
    })

    const data = res.data?.data
    if (!data) return { error: 'No data returned' }

    const columns = (data.cols || []).map((c: any) => c.display_name || c.name)
    const rows = data.rows || []

    // 如果数据太多，只返回汇总行 + 前 20 行
    if (rows.length > 25) {
      const summary = rows.find((r: any[]) => r[0]?.toString().includes('汇总'))
      return {
        columns,
        summary: summary || null,
        rows: rows.filter((r: any[]) => !r[0]?.toString().includes('汇总')).slice(0, 20),
        totalRows: rows.length,
        note: `数据共 ${rows.length} 行，已截取前 20 行。如需更多请缩小日期范围。`,
      }
    }

    return { columns, rows, totalRows: rows.length }
  },
}

export const metabaseTools: ToolDef[] = [mb_query]
