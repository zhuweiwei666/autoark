import Campaign from '../models/Campaign'
import Account from '../models/Account'
import FbToken from '../models/FbToken'
import { CountrySummary } from '../models/Summary'
import logger from '../utils/logger'
import dayjs from 'dayjs'
import { fetchInsights } from '../integration/facebook/insights.api'

// 国家代码到名称的映射
const COUNTRY_NAMES: Record<string, string> = {
    'US': '美国', 'CN': '中国', 'JP': '日本', 'DE': '德国', 'GB': '英国',
    'FR': '法国', 'IT': '意大利', 'CA': '加拿大', 'AU': '澳大利亚', 'BR': '巴西',
    'IN': '印度', 'KR': '韩国', 'MX': '墨西哥', 'ES': '西班牙', 'ID': '印度尼西亚',
    'NL': '荷兰', 'SA': '沙特阿拉伯', 'CH': '瑞士', 'TW': '台湾', 'PL': '波兰',
    'TH': '泰国', 'TR': '土耳其', 'BE': '比利时', 'SE': '瑞典', 'PH': '菲律宾',
    'AR': '阿根廷', 'AT': '奥地利', 'NO': '挪威', 'AE': '阿联酋', 'IL': '以色列',
    'MY': '马来西亚', 'SG': '新加坡', 'HK': '香港', 'DK': '丹麦', 'FI': '芬兰',
    'CL': '智利', 'CO': '哥伦比亚', 'PT': '葡萄牙', 'ZA': '南非', 'IE': '爱尔兰',
    'CZ': '捷克', 'RO': '罗马尼亚', 'NZ': '新西兰', 'GR': '希腊', 'HU': '匈牙利',
    'VN': '越南', 'EG': '埃及', 'PE': '秘鲁', 'PK': '巴基斯坦', 'UA': '乌克兰',
    'NG': '尼日利亚', 'BD': '孟加拉', 'VE': '委内瑞拉', 'QA': '卡塔尔', 'KW': '科威特',
    'AL': '阿尔巴尼亚', 'BO': '玻利维亚'
}

/**
 * 获取国家数据 - 直接从 Facebook API 获取实时数据（与广告系列页面一致）
 * 数据会缓存到 CountrySummary，API 失败时回退到缓存
 */
export const getCountries = async (filters: any = {}, pagination: { page: number, limit: number, sortBy: string, sortOrder: 'asc' | 'desc' }) => {
    const startTime = Date.now()
    const today = dayjs().format('YYYY-MM-DD')
    const startDate = filters.startDate || today
    const endDate = filters.endDate || startDate
    
    try {
        // ========== 优先从 Facebook API 获取实时数据 ==========
        logger.info(`[getCountries] Fetching from Facebook API for ${startDate} to ${endDate}...`)
        
        const result = await getCountriesFromFacebookAPI(filters, pagination)
        
        if (result.data.length > 0) {
            logger.info(`[getCountries] Got ${result.pagination.total} countries from Facebook API in ${Date.now() - startTime}ms`)
            return result
        }
        
        // ========== API 无数据时，回退到预聚合缓存 ==========
        logger.info(`[getCountries] No data from Facebook API, falling back to cache...`)
        return await getCountriesFromCache(startDate, endDate, pagination)
        
    } catch (error: any) {
        logger.error(`[getCountries] Facebook API error: ${error.message}, falling back to cache...`)
        
        // API 出错时回退到缓存
        try {
            return await getCountriesFromCache(startDate, endDate, pagination)
        } catch (cacheError: any) {
            logger.error('Error in getCountries cache fallback:', cacheError)
            throw error // 抛出原始错误
        }
    }
}

/**
 * 从缓存（CountrySummary）获取国家数据
 */
async function getCountriesFromCache(startDate: string, endDate: string, pagination: { page: number, limit: number, sortBy: string, sortOrder: 'asc' | 'desc' }) {
    const isSingleDay = startDate === endDate
    let countriesWithMetrics: any[] = []
    
    if (isSingleDay) {
        const preAggregatedData = await CountrySummary.find({ date: startDate }).lean()
        
        countriesWithMetrics = preAggregatedData.map((data: any) => ({
            id: data.country,
            country: data.country,
            countryName: data.countryName || COUNTRY_NAMES[data.country] || data.country,
            campaignCount: data.campaignCount || 0,
            spend: data.spend || 0,
            impressions: data.impressions || 0,
            clicks: data.clicks || 0,
            cpc: data.cpc || 0,
            ctr: (data.ctr || 0) / 100,
            cpm: data.cpm || 0,
            purchase_value: data.revenue || data.purchase_value || 0,
            purchase_roas: data.roas || data.purchase_roas || 0,
            mobile_app_install: data.installs || data.mobileAppInstall || data.mobile_app_install || 0,
        }))
    } else {
        const aggregatedData = await CountrySummary.aggregate([
            { $match: { date: { $gte: startDate, $lte: endDate } } },
            {
                $group: {
                    _id: '$country',
                    countryName: { $first: '$countryName' },
                    spend: { $sum: '$spend' },
                    revenue: { $sum: '$revenue' },
                    impressions: { $sum: '$impressions' },
                    clicks: { $sum: '$clicks' },
                    installs: { $sum: '$installs' },
                    campaignCount: { $max: '$campaignCount' },
                }
            }
        ])
        
        countriesWithMetrics = aggregatedData.map((data: any) => {
            const spend = data.spend || 0
            const clicks = data.clicks || 0
            const impressions = data.impressions || 0
            const revenue = data.revenue || 0
            
            return {
                id: data._id,
                country: data._id,
                countryName: data.countryName || COUNTRY_NAMES[data._id] || data._id,
                campaignCount: data.campaignCount || 0,
                spend,
                impressions,
                clicks,
                cpc: clicks > 0 ? spend / clicks : 0,
                ctr: impressions > 0 ? clicks / impressions : 0,
                cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
                purchase_value: revenue,
                purchase_roas: spend > 0 ? revenue / spend : 0,
                mobile_app_install: data.installs || 0,
            }
        })
    }
    
    // 排序
    const sortField = pagination.sortBy || 'spend'
    countriesWithMetrics.sort((a: any, b: any) => {
        const aValue = a[sortField] ?? 0
        const bValue = b[sortField] ?? 0
        return pagination.sortOrder === 'desc' ? bValue - aValue : aValue - bValue
    })
    
    // 分页
    const total = countriesWithMetrics.length
    const startIndex = (pagination.page - 1) * pagination.limit
    const paginatedCountries = countriesWithMetrics.slice(startIndex, startIndex + pagination.limit)
    
    return {
        data: paginatedCountries,
        pagination: {
            total,
            page: pagination.page,
            limit: pagination.limit,
            pages: Math.ceil(total / pagination.limit)
        }
    }
}

/**
 * 从 Facebook API 获取国家数据（慢速后备方案）
 */
async function getCountriesFromFacebookAPI(filters: any, pagination: { page: number, limit: number, sortBy: string, sortOrder: 'asc' | 'desc' }) {
    // 获取所有账户
    let accountQuery: any = {}
    if (filters.accountId) {
        accountQuery.accountId = filters.accountId
    }
    const accounts = await Account.find(accountQuery).lean()
    
    if (accounts.length === 0) {
        return {
            data: [],
            pagination: { page: pagination.page, limit: pagination.limit, total: 0, pages: 0 },
        }
    }

    // 获取所有活跃的 token
    const tokens = await FbToken.find({ status: 'active' }).lean()
    if (tokens.length === 0) {
        return {
            data: [],
            pagination: { page: pagination.page, limit: pagination.limit, total: 0, pages: 0 },
        }
    }

    // 构建日期参数
    const today = dayjs().format('YYYY-MM-DD')
    const startDate = filters.startDate || today
    const endDate = filters.endDate || today

    // 按国家聚合数据
    const countryDataMap: Record<string, {
        country: string,
        countryName: string,
        spend: number,
        impressions: number,
        clicks: number,
        purchase_value: number,
        mobile_app_install: number,
        campaignIds: Set<string>
    }> = {}

    // 从每个账户获取按国家细分的数据
    for (const account of accounts) {
        const token = tokens[0]
        if (!token) continue

        try {
            const insights = await fetchInsights(
                `act_${account.accountId}`,
                'campaign',
                undefined,
                token.token,
                ['country'],
                { since: startDate, until: endDate }
            )

            for (const insight of insights) {
                const country = insight.country
                if (!country) continue

                if (!countryDataMap[country]) {
                    countryDataMap[country] = {
                        country,
                        countryName: COUNTRY_NAMES[country] || country,
                        spend: 0,
                        impressions: 0,
                        clicks: 0,
                        purchase_value: 0,
                        mobile_app_install: 0,
                        campaignIds: new Set()
                    }
                }

                const data = countryDataMap[country]
                data.spend += parseFloat(insight.spend || '0')
                data.impressions += parseInt(insight.impressions || '0', 10)
                data.clicks += parseInt(insight.clicks || '0', 10)
                
                if (insight.campaign_id) {
                    data.campaignIds.add(insight.campaign_id)
                }

                if (insight.actions) {
                    for (const action of insight.actions) {
                        if (action.action_type === 'mobile_app_install' || action.action_type === 'omni_app_install') {
                            data.mobile_app_install += parseInt(action.value || '0', 10)
                        }
                    }
                }

                if (insight.action_values) {
                    for (const actionValue of insight.action_values) {
                        if (actionValue.action_type === 'purchase' || actionValue.action_type === 'omni_purchase') {
                            data.purchase_value += parseFloat(actionValue.value || '0')
                        }
                    }
                }
            }
        } catch (error: any) {
            logger.error(`Error fetching insights for account ${account.accountId}: ${error.message}`)
        }
    }

    // 计算派生指标
    const countriesWithMetrics = Object.values(countryDataMap).map(data => {
        const cpc = data.clicks > 0 ? data.spend / data.clicks : 0
        const ctr = data.impressions > 0 ? data.clicks / data.impressions : 0
        const cpm = data.impressions > 0 ? (data.spend / data.impressions) * 1000 : 0
        const purchase_roas = data.spend > 0 ? data.purchase_value / data.spend : 0

        return {
            id: data.country,
            country: data.country,
            countryName: data.countryName,
            campaignCount: data.campaignIds.size,
            spend: data.spend,
            impressions: data.impressions,
            clicks: data.clicks,
            cpc,
            ctr,
            cpm,
            purchase_value: data.purchase_value,
            purchase_roas,
            mobile_app_install: data.mobile_app_install,
        }
    })

    const total = countriesWithMetrics.length
    if (total === 0) {
        return {
            data: [],
            pagination: { page: pagination.page, limit: pagination.limit, total: 0, pages: 0 },
        }
    }
    
    // ========== 缓存到 CountrySummary（下次请求将使用缓存）==========
    try {
        const bulkOps = countriesWithMetrics.map((data: any) => ({
            updateOne: {
                filter: { date: startDate, country: data.country },
                update: {
                    $set: {
                        countryName: data.countryName,
                        spend: data.spend,
                        revenue: data.purchase_value,
                        impressions: data.impressions,
                        clicks: data.clicks,
                        installs: data.mobile_app_install,
                        roas: data.purchase_roas,
                        ctr: data.ctr * 100, // 存储为百分比格式（与 aggregation 一致）
                        cpc: data.cpc,
                        cpm: data.cpm,
                        campaignCount: data.campaignCount,
                        lastUpdated: new Date(),
                    }
                },
                upsert: true,
            }
        }))
        
        if (bulkOps.length > 0) {
            await CountrySummary.bulkWrite(bulkOps)
            logger.info(`[getCountries] Cached ${bulkOps.length} countries to CountrySummary for ${startDate}`)
        }
    } catch (cacheError: any) {
        logger.warn(`[getCountries] Failed to cache country data: ${cacheError.message}`)
    }

    // 排序
    const sortField = pagination.sortBy || 'spend'
    countriesWithMetrics.sort((a: any, b: any) => {
        const aValue = a[sortField] ?? 0
        const bValue = b[sortField] ?? 0
        return pagination.sortOrder === 'desc' ? bValue - aValue : aValue - bValue
    })
    
    // 分页
    const startIndex = (pagination.page - 1) * pagination.limit
    const paginatedCountries = countriesWithMetrics.slice(startIndex, startIndex + pagination.limit)
    
    return {
        data: paginatedCountries,
        pagination: {
            total,
            page: pagination.page,
            limit: pagination.limit,
            pages: Math.ceil(total / pagination.limit)
        }
    }
}
