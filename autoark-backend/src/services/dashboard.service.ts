import { PipelineStage } from 'mongoose'
import { MetricsDaily } from '../models'

interface DashboardFilters {
  startDate: string
  endDate: string
  channel?: string
  appPackageId?: string
  country?: string
}

const buildMatchStage = (filters: DashboardFilters) => {
  const match: any = {
    date: { $gte: filters.startDate, $lte: filters.endDate },
  }

  if (filters.channel) {
    match.channel = filters.channel
  }

  if (filters.country) {
    match.country = filters.country
  }

  return match
}

export const getDaily = async (filters: DashboardFilters) => {
  const match = buildMatchStage(filters)

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $group: {
        _id: '$date',
        spendUsd: { $sum: '$spendUsd' },
        installs: { $sum: '$installs' },
        revenueD0: { $sum: '$revenueD0' },
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
      },
    },
    { $sort: { _id: 1 as 1 } }, // Fix TS2769 sort type mismatch
    {
      $project: {
        _id: 0,
        date: '$_id',
        spendUsd: 1,
        installs: 1,
        revenueD0: 1,
        cpiUsd: {
          $cond: [
            { $gt: ['$installs', 0] },
            { $divide: ['$spendUsd', '$installs'] },
            0,
          ],
        },
        roiD0: {
          $cond: [
            { $gt: ['$spendUsd', 0] },
            { $divide: ['$revenueD0', '$spendUsd'] },
            0,
          ],
        },
        ctr: {
          $cond: [
            { $gt: ['$impressions', 0] },
            { $divide: ['$clicks', '$impressions'] },
            0,
          ],
        },
      },
    },
  ]

  return await MetricsDaily.aggregate(pipeline)
}

export const getByCountry = async (filters: DashboardFilters) => {
  const match = buildMatchStage(filters)

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $group: {
        _id: '$country',
        spendUsd: { $sum: '$spendUsd' },
        installs: { $sum: '$installs' },
        revenueD0: { $sum: '$revenueD0' },
      },
    },
    { $sort: { spendUsd: -1 as -1 } },
    {
      $project: {
        _id: 0,
        country: '$_id',
        spendUsd: 1,
        installs: 1,
        revenueD0: 1,
        roiD0: {
          $cond: [
            { $gt: ['$spendUsd', 0] },
            { $divide: ['$revenueD0', '$spendUsd'] },
            0,
          ],
        },
      },
    },
  ]

  return await MetricsDaily.aggregate(pipeline)
}

export const getByAdSet = async (filters: DashboardFilters) => {
  const match = buildMatchStage(filters)

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $group: {
        _id: '$adsetId',
        spendUsd: { $sum: '$spendUsd' },
        installs: { $sum: '$installs' },
        revenueD0: { $sum: '$revenueD0' },
      },
    },
    { $sort: { spendUsd: -1 as -1 } },
    {
      $project: {
        _id: 0,
        adsetId: '$_id',
        spendUsd: 1,
        installs: 1,
        cpiUsd: {
          $cond: [
            { $gt: ['$installs', 0] },
            { $divide: ['$spendUsd', '$installs'] },
            0,
          ],
        },
        roiD0: {
          $cond: [
            { $gt: ['$spendUsd', 0] },
            { $divide: ['$revenueD0', '$spendUsd'] },
            0,
          ],
        },
      },
    },
  ]

  return await MetricsDaily.aggregate(pipeline)
}
