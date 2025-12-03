import MetricsDaily from '../models/MetricsDaily'
import Campaign from '../models/Campaign'
import Account from '../models/Account'
import logger from '../utils/logger'
import dayjs from 'dayjs'
import mongoose from 'mongoose'

/**
 * 数据聚合服务
 * 将 Ad 级别的数据向上聚合为 AdSet → Campaign → Account 级别
 */
export const aggregateMetricsByLevel = async (date?: string) => {
  const targetDate = date || dayjs().format('YYYY-MM-DD')
  logger.info(`[Aggregation] Starting metrics aggregation for date: ${targetDate}`)

  try {
    // 1. 聚合 Ad 级别数据到 AdSet 级别
    await aggregateAdToAdSet(targetDate)

    // 2. 聚合 AdSet 级别数据到 Campaign 级别
    await aggregateAdSetToCampaign(targetDate)

    // 3. 聚合 Campaign 级别数据到 Account 级别
    await aggregateCampaignToAccount(targetDate)

    logger.info(`[Aggregation] Metrics aggregation completed for date: ${targetDate}`)
  } catch (error: any) {
    logger.error(`[Aggregation] Failed to aggregate metrics:`, error)
    throw error
  }
}

/**
 * 聚合 Ad 级别数据到 AdSet 级别
 */
const aggregateAdToAdSet = async (date: string) => {
  const pipeline: mongoose.PipelineStage[] = [
    {
      $match: {
        date,
        adId: { $exists: true, $ne: null },
        adsetId: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: {
          adsetId: '$adsetId',
          campaignId: '$campaignId',
          accountId: '$accountId',
          country: '$country',
        },
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
        spendUsd: { $sum: '$spendUsd' },
        purchase_value: { $sum: { $ifNull: ['$purchase_value', 0] } },
        mobile_app_install: { $sum: { $ifNull: ['$mobile_app_install_count', 0] } },
        // 加权平均
        totalCpc: { $sum: { $multiply: [{ $ifNull: ['$cpc', 0] }, { $ifNull: ['$clicks', 0] }] } },
        totalCpm: { $sum: { $multiply: [{ $ifNull: ['$cpm', 0] }, { $ifNull: ['$impressions', 0] }] } },
        // 保留最新的 actions 和 action_values
        actions: { $first: '$actions' },
        action_values: { $first: '$action_values' },
        purchase_roas: { $first: '$purchase_roas' },
        raw: { $first: '$raw' },
      },
    },
    {
      $project: {
        _id: 0,
        date: date,
        channel: 'facebook',
        accountId: '$_id.accountId',
        campaignId: '$_id.campaignId',
        adsetId: '$_id.adsetId',
        country: '$_id.country',
        impressions: 1,
        clicks: 1,
        spendUsd: 1,
        purchase_value: 1,
        mobile_app_install: 1,
        actions: 1,
        action_values: 1,
        purchase_roas: 1,
        raw: 1,
        // 计算正确的 CTR
        ctr: {
          $cond: [
            { $gt: ['$impressions', 0] },
            { $divide: ['$clicks', '$impressions'] },
            0,
          ],
        },
        // 计算加权平均 CPC
        cpc: {
          $cond: [
            { $gt: ['$clicks', 0] },
            { $divide: ['$totalCpc', '$clicks'] },
            0,
          ],
        },
        // 计算加权平均 CPM
        cpm: {
          $cond: [
            { $gt: ['$impressions', 0] },
            { $divide: ['$totalCpm', '$impressions'] },
            0,
          ],
        },
      },
    },
  ]

  const aggregatedData = await MetricsDaily.aggregate(pipeline).allowDiskUse(true)

  // 保存聚合后的 AdSet 级别数据
  for (const item of aggregatedData) {
    await MetricsDaily.findOneAndUpdate(
      {
        date: item.date,
        adsetId: item.adsetId,
        country: item.country || null,
        adId: { $exists: false }, // 确保是 AdSet 级别，不是 Ad 级别
      },
      { $set: item },
      { upsert: true, new: true }
    )
  }

  logger.info(`[Aggregation] Aggregated ${aggregatedData.length} adset-level metrics`)
}

/**
 * 聚合 AdSet 级别数据到 Campaign 级别
 */
const aggregateAdSetToCampaign = async (date: string) => {
  const pipeline: mongoose.PipelineStage[] = [
    {
      $match: {
        date,
        campaignId: { $exists: true, $ne: null },
        adId: { $exists: false }, // 只聚合 AdSet 级别，不包括 Ad 级别
      },
    },
    {
      $group: {
        _id: {
          campaignId: '$campaignId',
          accountId: '$accountId',
          country: '$country',
        },
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
        spendUsd: { $sum: '$spendUsd' },
        purchase_value: { $sum: { $ifNull: ['$purchase_value', 0] } },
        mobile_app_install: { $sum: { $ifNull: ['$mobile_app_install', 0] } },
        // 加权平均
        totalCpc: { $sum: { $multiply: [{ $ifNull: ['$cpc', 0] }, { $ifNull: ['$clicks', 0] }] } },
        totalCpm: { $sum: { $multiply: [{ $ifNull: ['$cpm', 0] }, { $ifNull: ['$impressions', 0] }] } },
        // 保留最新的 actions 和 action_values
        actions: { $first: '$actions' },
        action_values: { $first: '$action_values' },
        purchase_roas: { $first: '$purchase_roas' },
        raw: { $first: '$raw' },
      },
    },
    {
      $project: {
        _id: 0,
        date: date,
        channel: 'facebook',
        accountId: '$_id.accountId',
        campaignId: '$_id.campaignId',
        country: '$_id.country',
        impressions: 1,
        clicks: 1,
        spendUsd: 1,
        purchase_value: 1,
        mobile_app_install: 1,
        actions: 1,
        action_values: 1,
        purchase_roas: 1,
        raw: 1,
        // 计算正确的 CTR
        ctr: {
          $cond: [
            { $gt: ['$impressions', 0] },
            { $divide: ['$clicks', '$impressions'] },
            0,
          ],
        },
        // 计算加权平均 CPC
        cpc: {
          $cond: [
            { $gt: ['$clicks', 0] },
            { $divide: ['$totalCpc', '$clicks'] },
            0,
          ],
        },
        // 计算加权平均 CPM
        cpm: {
          $cond: [
            { $gt: ['$impressions', 0] },
            { $divide: ['$totalCpm', '$impressions'] },
            0,
          ],
        },
      },
    },
  ]

  const aggregatedData = await MetricsDaily.aggregate(pipeline).allowDiskUse(true)

  // 保存聚合后的 Campaign 级别数据
  for (const item of aggregatedData) {
    await MetricsDaily.findOneAndUpdate(
      {
        date: item.date,
        campaignId: item.campaignId,
        country: item.country || null,
        adId: { $exists: false },
        adsetId: { $exists: false }, // 确保是 Campaign 级别
      },
      { $set: item },
      { upsert: true, new: true }
    )
  }

  logger.info(`[Aggregation] Aggregated ${aggregatedData.length} campaign-level metrics`)
}

/**
 * 聚合 Campaign 级别数据到 Account 级别
 */
const aggregateCampaignToAccount = async (date: string) => {
  const pipeline: mongoose.PipelineStage[] = [
    {
      $match: {
        date,
        accountId: { $exists: true, $ne: null },
        campaignId: { $exists: true, $ne: null },
        adId: { $exists: false },
        adsetId: { $exists: false }, // 只聚合 Campaign 级别
      },
    },
    {
      $group: {
        _id: {
          accountId: '$accountId',
          country: '$country',
        },
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
        spendUsd: { $sum: '$spendUsd' },
        purchase_value: { $sum: { $ifNull: ['$purchase_value', 0] } },
        mobile_app_install: { $sum: { $ifNull: ['$mobile_app_install', 0] } },
        // 加权平均
        totalCpc: { $sum: { $multiply: [{ $ifNull: ['$cpc', 0] }, { $ifNull: ['$clicks', 0] }] } },
        totalCpm: { $sum: { $multiply: [{ $ifNull: ['$cpm', 0] }, { $ifNull: ['$impressions', 0] }] } },
      },
    },
    {
      $project: {
        _id: 0,
        date: date,
        channel: 'facebook',
        accountId: '$_id.accountId',
        country: '$_id.country',
        impressions: 1,
        clicks: 1,
        spendUsd: 1,
        purchase_value: 1,
        mobile_app_install: 1,
        // 计算正确的 CTR
        ctr: {
          $cond: [
            { $gt: ['$impressions', 0] },
            { $divide: ['$clicks', '$impressions'] },
            0,
          ],
        },
        // 计算加权平均 CPC
        cpc: {
          $cond: [
            { $gt: ['$clicks', 0] },
            { $divide: ['$totalCpc', '$clicks'] },
            0,
          ],
        },
        // 计算加权平均 CPM
        cpm: {
          $cond: [
            { $gt: ['$impressions', 0] },
            { $divide: ['$totalCpm', '$impressions'] },
            0,
          ],
        },
      },
    },
  ]

  const aggregatedData = await MetricsDaily.aggregate(pipeline).allowDiskUse(true)

  // 保存聚合后的 Account 级别数据
  for (const item of aggregatedData) {
    await MetricsDaily.findOneAndUpdate(
      {
        date: item.date,
        accountId: item.accountId,
        country: item.country || null,
        campaignId: { $exists: false },
        adsetId: { $exists: false },
        adId: { $exists: false }, // 确保是 Account 级别
      },
      { $set: item },
      { upsert: true, new: true }
    )
  }

  logger.info(`[Aggregation] Aggregated ${aggregatedData.length} account-level metrics`)
}

