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
  description: '通过 Metabase 查询 BI 广告数据（campaign 维度：花费、ROAS、安装量、点击、展示等）。数据来自 TopTou API + Doris 数据仓库，最实时。每行是一个 campaign。字段包括：to_date, pkg_name, optimizer, platform, ad_account_name, ad_account_id, campaign_name, campaign_id, ad_set_name, ad_set_id, ad_name, ad_id, original_ad_spend 等。',
  parameters: S.obj('参数', {
    startDate: S.str('开始日期 YYYY-MM-DD'),
    endDate: S.str('结束日期 YYYY-MM-DD'),
    optimizer: S.str('优化师名称（可选，筛选某个优化师）'),
    pkgName: S.str('包名（可选，筛选某个应用）'),
    campaignId: S.str('广告系列 ID（可选，筛选某个 campaign）'),
    accountId: S.str('广告账户 ID（可选，筛选某个账户）'),
  }, ['startDate', 'endDate']),
  handler: async (args) => {
    const token = await getSession()
    const parameters: any[] = []

    const add = (tag: string, value: string | undefined, type = 'category') => {
      if (value) parameters.push({ type, value, target: ['variable', ['template-tag', tag]] })
    }

    add('access_code', 'VfuSBdaO33sklvtr')
    add('start_day', args.startDate, 'date/single')
    add('end_day', args.endDate, 'date/single')
    add('optimizer', args.optimizer)
    add('pkg_name', args.pkgName)
    add('campaign_id', args.campaignId)
    add('account_id', args.accountId)
    add('optimizer_code', undefined)

    const res = await axios.post(`${MB_BASE}/api/card/7786/query`, { parameters }, {
      headers: { 'X-Metabase-Session': token, 'Content-Type': 'application/json' },
      timeout: 60000,
    })

    const data = res.data?.data
    if (!data?.cols) return { error: 'No data returned' }

    const columns = (data.cols || []).map((c: any) => c.display_name || c.name)
    const rows = data.rows || []

    // 数据太多时截取，避免超出 LLM token 限制
    if (rows.length > 30) {
      return {
        columns,
        rows: rows.slice(0, 30),
        totalRows: rows.length,
        note: `共 ${rows.length} 行，已返回前 30 行。可通过 optimizer/pkgName/campaignId/accountId 缩小范围。`,
      }
    }

    return { columns, rows, totalRows: rows.length }
  },
}

export const metabaseTools: ToolDef[] = [mb_query]
