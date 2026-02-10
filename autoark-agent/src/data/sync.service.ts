/**
 * 数据同步服务 - 定时拉取 Facebook/TikTok 指标写入 Metrics
 */
import dayjs from 'dayjs'
import { log } from '../platform/logger'
import { Token } from './token.model'
import { AdAccount } from './account.model'
import { Metrics } from './metrics.model'
import { fetchCampaigns, fetchInsights } from '../platform/facebook/read'
import { tokenPool } from '../platform/facebook/token'

/**
 * 同步所有活跃账户最近几天的数据
 */
export async function syncAllMetrics(daysBack = 3) {
  log.info(`[Sync] Starting metrics sync (last ${daysBack} days)`)

  // 加载 Facebook tokens
  const fbTokens = await Token.find({ platform: 'facebook', status: 'active' }).lean()
  tokenPool.load(fbTokens.map((t: any) => ({ id: t._id.toString(), token: t.accessToken })))

  const accounts = await AdAccount.find({ platform: 'facebook', status: 'active' }).lean()
  if (accounts.length === 0) { log.info('[Sync] No active accounts'); return }

  for (const account of accounts) {
    try {
      // 找到该账户关联的 token
      const tokenDoc: any = account.tokenId
        ? await Token.findById(account.tokenId).lean()
        : fbTokens[0]
      if (!tokenDoc) continue
      const token = tokenDoc.accessToken

      const since = dayjs().subtract(daysBack, 'day').format('YYYY-MM-DD')
      const until = dayjs().format('YYYY-MM-DD')

      // 拉取 campaign 级别 insights
      const insights = await fetchInsights(
        `act_${account.accountId}`,
        'campaign',
        { timeRange: { since, until }, token }
      )

      // 同时获取 campaign 名称
      const campaigns = await fetchCampaigns(account.accountId, token)
      const nameMap = new Map(campaigns.map((c: any) => [c.id, c.name]))

      for (const row of insights) {
        const spend = parseFloat(row.spend || '0')
        const impressions = parseInt(row.impressions || '0')
        const clicks = parseInt(row.clicks || '0')
        const revenue = extractPurchaseValue(row)
        const installs = extractActionCount(row, 'app_install') || extractActionCount(row, 'mobile_app_install')
        const conversions = parseInt(row.conversions || '0')

        await Metrics.findOneAndUpdate(
          { date: row.date_start, accountId: account.accountId, campaignId: row.campaign_id },
          {
            $set: {
              platform: 'facebook',
              campaignName: nameMap.get(row.campaign_id) || '',
              spend, revenue, impressions, clicks, conversions, installs,
              roas: spend > 0 ? +(revenue / spend).toFixed(2) : 0,
              ctr: impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : 0,
              cpm: impressions > 0 ? +((spend / impressions) * 1000).toFixed(2) : 0,
              cpc: clicks > 0 ? +(spend / clicks).toFixed(2) : 0,
              cpa: conversions > 0 ? +(spend / conversions).toFixed(2) : 0,
            },
          },
          { upsert: true }
        )
      }

      log.info(`[Sync] Account ${account.accountId}: ${insights.length} rows synced`)
    } catch (err: any) {
      log.error(`[Sync] Account ${account.accountId} failed: ${err.message}`)
    }
  }

  log.info('[Sync] Metrics sync complete')
}

function extractPurchaseValue(row: any): number {
  if (!row.action_values) return 0
  const pv = row.action_values.find?.((a: any) =>
    a.action_type === 'offsite_conversion.fb_pixel_purchase' || a.action_type === 'purchase'
  )
  return pv ? parseFloat(pv.value || '0') : 0
}

function extractActionCount(row: any, actionType: string): number {
  if (!row.actions) return 0
  const action = row.actions.find?.((a: any) => a.action_type === actionType)
  return action ? parseInt(action.value || '0') : 0
}
