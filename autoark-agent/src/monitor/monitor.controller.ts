/**
 * 监控 API - 极简数据看板
 */
import { Router, Request, Response } from 'express'
import { authenticate } from '../auth/auth.middleware'
import { Metrics } from '../data/metrics.model'
import { Action } from '../action/action.model'
import { AdAccount } from '../data/account.model'
import dayjs from 'dayjs'

const router = Router()
router.use(authenticate)

// 总览：最近 7 天的花费、收入、ROAS 趋势
router.get('/overview', async (_req: Request, res: Response) => {
  const startDate = dayjs().subtract(7, 'day').format('YYYY-MM-DD')
  const endDate = dayjs().format('YYYY-MM-DD')

  // 按天聚合
  const daily = await Metrics.aggregate([
    { $match: { date: { $gte: startDate, $lte: endDate }, campaignId: { $exists: true } } },
    {
      $group: {
        _id: '$date',
        spend: { $sum: '$spend' },
        revenue: { $sum: '$revenue' },
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
      },
    },
    { $sort: { _id: 1 } },
  ])

  const totals = daily.reduce(
    (acc, d) => ({
      spend: acc.spend + d.spend,
      revenue: acc.revenue + d.revenue,
      impressions: acc.impressions + d.impressions,
      clicks: acc.clicks + d.clicks,
    }),
    { spend: 0, revenue: 0, impressions: 0, clicks: 0 }
  )

  res.json({
    dateRange: { start: startDate, end: endDate },
    totals: {
      ...totals,
      roas: totals.spend > 0 ? +(totals.revenue / totals.spend).toFixed(2) : 0,
      ctr: totals.impressions > 0 ? +((totals.clicks / totals.impressions) * 100).toFixed(2) : 0,
    },
    daily: daily.map((d) => ({
      date: d._id,
      spend: +d.spend.toFixed(2),
      revenue: +d.revenue.toFixed(2),
      roas: d.spend > 0 ? +(d.revenue / d.spend).toFixed(2) : 0,
      impressions: d.impressions,
      clicks: d.clicks,
    })),
  })
})

// 账户列表
router.get('/accounts', async (_req: Request, res: Response) => {
  const accounts = await AdAccount.find({ status: 'active' }).lean()
  res.json(accounts)
})

// 最近的 Agent 操作
router.get('/recent-actions', async (req: Request, res: Response) => {
  const actions = await Action.find({ userId: req.user!.id })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean()
  res.json(actions)
})

// 待审批数量
router.get('/pending-count', async (req: Request, res: Response) => {
  const count = await Action.countDocuments({ userId: req.user!.id, status: 'pending' })
  res.json({ count })
})

export default router
