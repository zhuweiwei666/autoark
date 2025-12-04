import Campaign from '../models/Campaign'
import Account from '../models/Account'
import FbToken from '../models/FbToken'
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

export const getCountries = async (filters: any = {}, pagination: { page: number, limit: number, sortBy: string, sortOrder: 'asc' | 'desc' }) => {
    try {
        // 获取所有账户
        let accountQuery: any = {}
    if (filters.accountId) {
            accountQuery.accountId = filters.accountId
        }
        const accounts = await Account.find(accountQuery).lean()
        
        if (accounts.length === 0) {
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

        // 获取所有活跃的 token
        const tokens = await FbToken.find({ status: 'active' }).lean()
        if (tokens.length === 0) {
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
            cpc: number,
            ctr: number,
            cpm: number,
            purchase_value: number,
            purchase_roas: number,
            mobile_app_install: number,
            campaignIds: Set<string>
        }> = {}

        // 从每个账户获取按国家细分的数据
        for (const account of accounts) {
            // 使用第一个可用的 token
            const token = tokens[0]
            if (!token) continue

            try {
                // 使用 breakdown=country 获取按国家细分的数据
                const insights = await fetchInsights(
                    `act_${account.accountId}`,
                    'campaign', // 使用 campaign 级别以获取 campaignId
                    undefined,
                    token.token,
                    ['country'],
                    { since: startDate, until: endDate }
                )

                // 聚合数据
                for (const insight of insights) {
                    const country = insight.country
                    if (!country) continue

                    // 如果指定了广告系列名称筛选
                    if (filters.name) {
                        // 获取广告系列名称
                        const campaign = await Campaign.findOne({ campaignId: insight.campaign_id }).lean()
                        if (!campaign || !campaign.name.toLowerCase().includes(filters.name.toLowerCase())) {
                            continue
                        }
                    }

                    if (!countryDataMap[country]) {
                        countryDataMap[country] = {
                            country,
                            countryName: COUNTRY_NAMES[country] || country,
                            spend: 0,
                            impressions: 0,
                            clicks: 0,
                            cpc: 0,
                            ctr: 0,
                            cpm: 0,
                            purchase_value: 0,
                            purchase_roas: 0,
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

                    // 提取 actions 中的 mobile_app_install
                    if (insight.actions) {
                        for (const action of insight.actions) {
                            if (action.action_type === 'mobile_app_install' || action.action_type === 'omni_app_install') {
                                data.mobile_app_install += parseInt(action.value || '0', 10)
                            }
                        }
                    }

                    // 提取 action_values 中的 purchase
                    if (insight.action_values) {
                        for (const actionValue of insight.action_values) {
                            if (actionValue.action_type === 'purchase' || actionValue.action_type === 'omni_purchase') {
                                data.purchase_value += parseFloat(actionValue.value || '0')
                            }
                        }
                    }

                    // 提取 purchase_roas
                    if (insight.purchase_roas) {
                        for (const roas of insight.purchase_roas) {
                            if (roas.action_type === 'omni_purchase') {
                                data.purchase_roas = parseFloat(roas.value || '0')
                            }
                        }
                    }
                }
            } catch (error: any) {
                logger.error(`Error fetching insights for account ${account.accountId}: ${error.message}`)
                // 继续处理其他账户
            }
        }

        // 计算派生指标
        const countriesWithMetrics = Object.values(countryDataMap).map(data => {
            const cpc = data.clicks > 0 ? data.spend / data.clicks : 0
            const ctr = data.impressions > 0 ? (data.clicks / data.impressions) : 0 // 返回原始小数
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
                purchase_roas: data.purchase_roas || purchase_roas,
                mobile_app_install: data.mobile_app_install,
            }
        })

        const total = countriesWithMetrics.length
    
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

        // 排序
        const sortField = pagination.sortBy || 'spend'
        countriesWithMetrics.sort((a: any, b: any) => {
            const aValue = a[sortField] ?? 0
            const bValue = b[sortField] ?? 0
            if (typeof aValue === 'string' && typeof bValue === 'string') {
                return pagination.sortOrder === 'desc' 
                    ? bValue.localeCompare(aValue) 
                    : aValue.localeCompare(bValue)
            }
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
    } catch (error: any) {
        logger.error('Error in getCountries:', error)
        throw error
    }
}
