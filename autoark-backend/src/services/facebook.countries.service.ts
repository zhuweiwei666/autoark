import Campaign from '../models/Campaign'
import MetricsDaily from '../models/MetricsDaily'
import logger from '../utils/logger'
import dayjs from 'dayjs'
import { getReadConnection } from '../config/db'
import { getFromCache, setToCache, getCacheKey, CACHE_TTL } from '../utils/cache'
import mongoose from 'mongoose'

// 从广告系列名称中提取国家代码（简单实现，可以根据实际命名规则优化）
const extractCountryFromCampaignName = (campaignName: string): string => {
  if (!campaignName) return 'UNKNOWN'
  
  // 常见的国家代码模式（2-3个字母，通常在名称末尾或特定位置）
  // 这里使用简单的启发式方法：查找常见的国家代码
  const countryCodes = [
    'US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'SG', 'MY', 'PH', 'TH', 'VN', 'ID', 'IN', 'PK', 'BD',
    'CN', 'JP', 'KR', 'TW', 'HK', 'MO',
    'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'HU', 'RO', 'GR',
    'BR', 'MX', 'AR', 'CL', 'CO', 'PE', 'VE',
    'ZA', 'EG', 'KE', 'NG', 'GH',
    'AE', 'SA', 'IL', 'TR'
  ]
  
  // 尝试从名称中提取国家代码（通常在最后几个字符中）
  const upperName = campaignName.toUpperCase()
  for (const code of countryCodes) {
    if (upperName.includes(`_${code}_`) || upperName.endsWith(`_${code}`) || upperName.includes(`-${code}-`) || upperName.endsWith(`-${code}`)) {
      return code
    }
  }
  
  // 如果没有找到，返回 UNKNOWN
  return 'UNKNOWN'
}

export const getCountries = async (filters: any = {}, pagination: { page: number, limit: number, sortBy: string, sortOrder: 'asc' | 'desc' }) => {
    // 使用读连接进行查询（读写分离）
    const readConnection = getReadConnection()
    
    let CampaignModel = Campaign
    if (readConnection !== mongoose) {
      if (!readConnection.models.Campaign) {
        CampaignModel = readConnection.model('Campaign', Campaign.schema)
      } else {
        CampaignModel = readConnection.models.Campaign
      }
    }
    
    // 构建查询条件
    const campaignQuery: any = {}
    if (filters.name) {
        campaignQuery.name = { $regex: filters.name, $options: 'i' }
    }
    if (filters.accountId) {
        campaignQuery.accountId = filters.accountId
    }
    if (filters.status) {
        campaignQuery.status = filters.status
    }
    if (filters.objective) {
        campaignQuery.objective = filters.objective
    }
    
    // 获取所有符合条件的广告系列
    const allCampaigns = await CampaignModel.find(campaignQuery).lean()
    
    // 从广告系列名称中提取国家，并创建国家到广告系列的映射
    const countryToCampaigns = new Map<string, string[]>()
    allCampaigns.forEach((campaign: any) => {
        const country = extractCountryFromCampaignName(campaign.name || '')
        if (!countryToCampaigns.has(country)) {
            countryToCampaigns.set(country, [])
        }
        countryToCampaigns.get(country)!.push(campaign.campaignId)
    })
    
    const allCountryCodes = Array.from(countryToCampaigns.keys())
    const total = allCountryCodes.length
    
    if (total === 0) {
        return {
            data: [],
            pagination: {
                page: pagination.page,
                limit: pagination.limit,
                total: 0,
                pages: 0,
            },
        }
    }
    
    // 查询所有国家的 metrics 数据
    const today = dayjs().format('YYYY-MM-DD')
    const allCampaignIds = allCampaigns.map(c => c.campaignId)
    
    const metricsQuery: any = {
        campaignId: { $in: allCampaignIds, $exists: true, $ne: null }
    }
    
    if (filters.startDate || filters.endDate) {
        metricsQuery.date = {}
        if (filters.startDate) {
            metricsQuery.date.$gte = filters.startDate
        }
        if (filters.endDate) {
            metricsQuery.date.$lte = filters.endDate
        }
    } else {
        metricsQuery.date = today
    }
    
    // 获取所有 campaigns 的 metrics
    let MetricsDailyRead = MetricsDaily
    if (readConnection !== mongoose) {
      if (!readConnection.models.MetricsDaily) {
        MetricsDailyRead = readConnection.model('MetricsDaily', MetricsDaily.schema)
      } else {
        MetricsDailyRead = readConnection.models.MetricsDaily
      }
    }
    
    let allMetricsData: any[] = []
    if (filters.startDate || filters.endDate) {
        allMetricsData = await MetricsDailyRead.aggregate([
            { $match: metricsQuery },
            { $sort: { date: -1 } },
            {
                $group: {
                    _id: '$campaignId',
                    spendUsd: { $sum: '$spendUsd' },
                    impressions: { $sum: '$impressions' },
                    clicks: { $sum: '$clicks' },
                    cpc: { $avg: '$cpc' },
                    ctr: { $avg: '$ctr' },
                    cpm: { $avg: '$cpm' },
                    purchase_roas: { $first: '$purchase_roas' },
                    purchase_value: { $sum: { $ifNull: ['$purchase_value', 0] } },
                    mobile_app_install: { $sum: { $ifNull: ['$mobile_app_install_count', 0] } },
                }
            }
        ]).allowDiskUse(true)
    } else {
        const todayMetrics = await MetricsDailyRead.find(metricsQuery)
            .hint({ campaignId: 1, date: 1 })
            .lean()
        
        allMetricsData = todayMetrics.map((metric: any) => ({
            _id: metric.campaignId,
            spendUsd: metric.spendUsd || 0,
            impressions: metric.impressions || 0,
            clicks: metric.clicks || 0,
            cpc: metric.cpc,
            ctr: metric.ctr,
            cpm: metric.cpm,
            purchase_roas: metric.purchase_roas,
            purchase_value: metric.purchase_value || 0,
            mobile_app_install: metric.mobile_app_install_count || 0,
        }))
    }
    
    // 创建 campaignId 到 metrics 的映射
    const metricsMap = new Map<string, any>()
    allMetricsData.forEach((item: any) => {
        metricsMap.set(item._id, item)
    })
    
    // 按国家聚合数据
    const countriesWithMetrics = allCountryCodes.map(country => {
        const campaignIds = countryToCampaigns.get(country) || []
        const countryMetrics = campaignIds.reduce((acc, campaignId) => {
            const metrics = metricsMap.get(campaignId) || {}
            return {
                spendUsd: acc.spendUsd + (metrics.spendUsd || 0),
                impressions: acc.impressions + (metrics.impressions || 0),
                clicks: acc.clicks + (metrics.clicks || 0),
                purchase_value: acc.purchase_value + (metrics.purchase_value || 0),
                mobile_app_install: acc.mobile_app_install + (metrics.mobile_app_install || 0),
            }
        }, { spendUsd: 0, impressions: 0, clicks: 0, purchase_value: 0, mobile_app_install: 0 })
        
        // 计算平均值指标
        const campaignCount = campaignIds.length
        const avgCpc = campaignIds.length > 0 
            ? campaignIds.reduce((sum, id) => sum + ((metricsMap.get(id)?.cpc || 0) * (metricsMap.get(id)?.clicks || 0)), 0) / Math.max(campaignIds.reduce((sum, id) => sum + (metricsMap.get(id)?.clicks || 0), 0), 1)
            : 0
        const avgCtr = campaignIds.length > 0
            ? campaignIds.reduce((sum, id) => sum + ((metricsMap.get(id)?.ctr || 0) * (metricsMap.get(id)?.impressions || 0)), 0) / Math.max(campaignIds.reduce((sum, id) => sum + (metricsMap.get(id)?.impressions || 0), 0), 1)
            : 0
        const avgCpm = campaignIds.length > 0
            ? campaignIds.reduce((sum, id) => sum + ((metricsMap.get(id)?.cpm || 0) * (metricsMap.get(id)?.impressions || 0)), 0) / Math.max(campaignIds.reduce((sum, id) => sum + (metricsMap.get(id)?.impressions || 0), 0), 1)
            : 0
        
        return {
            country: country,
            campaignCount: campaignCount,
            spend: countryMetrics.spendUsd || 0,
            impressions: countryMetrics.impressions || 0,
            clicks: countryMetrics.clicks || 0,
            cpc: avgCpc || 0,
            ctr: avgCtr || 0,
            cpm: avgCpm || 0,
            purchase_roas: countryMetrics.purchase_value > 0 && countryMetrics.spendUsd > 0 
                ? countryMetrics.purchase_value / countryMetrics.spendUsd 
                : 0,
            purchase_value: countryMetrics.purchase_value || 0,
            mobile_app_install: countryMetrics.mobile_app_install || 0,
        }
    })
    
    // 判断排序字段是否是 metrics 字段
    const metricsSortFields = ['spend', 'impressions', 'clicks', 'cpc', 'ctr', 'cpm', 'purchase_roas', 'purchase_value', 'mobile_app_install', 'campaignCount']
    const isMetricsSort = metricsSortFields.includes(pagination.sortBy)
    
    // 排序
    if (isMetricsSort) {
        countriesWithMetrics.sort((a, b) => {
            const aValue = a[pagination.sortBy] || 0
            const bValue = b[pagination.sortBy] || 0
            if (pagination.sortOrder === 'desc') {
                return bValue - aValue
            } else {
                return aValue - bValue
            }
        })
    } else {
        // 按国家代码排序
        countriesWithMetrics.sort((a, b) => {
            const aValue = a.country || ''
            const bValue = b.country || ''
            if (pagination.sortOrder === 'desc') {
                return bValue.localeCompare(aValue)
            } else {
                return aValue.localeCompare(bValue)
            }
        })
    }
    
    // 分页
    const startIndex = (pagination.page - 1) * pagination.limit
    const paginatedCountries = countriesWithMetrics.slice(startIndex, startIndex + pagination.limit)
    
    return {
        data: paginatedCountries.map(item => ({
            id: item.country,
            country: item.country,
            campaignCount: item.campaignCount,
            spend: item.spend,
            impressions: item.impressions,
            clicks: item.clicks,
            cpc: item.cpc,
            ctr: item.ctr,
            cpm: item.cpm,
            purchase_roas: item.purchase_roas,
            purchase_value: item.purchase_value,
            mobile_app_install: item.mobile_app_install,
        })),
        pagination: {
            total,
            page: pagination.page,
            limit: pagination.limit,
            pages: Math.ceil(total / pagination.limit)
        }
    }
}

