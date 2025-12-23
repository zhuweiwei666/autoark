"use strict";
/**
 * 📊 预聚合数据服务
 *
 * 核心逻辑：
 * - 最近 3 天：从 Facebook API 实时获取 → 更新到数据库
 * - 超过 3 天：直接从数据库读取
 *
 * 性能优化：
 * - 并发处理：使用 Promise.all + 分批控制（并发度 10）
 * - 错误隔离：单个账户失败不影响整体
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshAggregation = refreshAggregation;
exports.refreshRecentDays = refreshRecentDays;
exports.getDailySummary = getDailySummary;
exports.getCountryData = getCountryData;
exports.getAccountData = getAccountData;
exports.getCampaignData = getCampaignData;
exports.getOptimizerData = getOptimizerData;
exports.getMaterialData = getMaterialData;
const logger_1 = __importDefault(require("../utils/logger"));
const dayjs_1 = __importDefault(require("dayjs"));
const Aggregation_1 = require("../models/Aggregation");
const Account_1 = __importDefault(require("../models/Account"));
const Campaign_1 = __importDefault(require("../models/Campaign"));
const FbToken_1 = __importDefault(require("../models/FbToken"));
const insights_api_1 = require("../integration/facebook/insights.api");
// 国家代码到名称的映射
const COUNTRY_NAMES = {
    'US': '美国', 'GB': '英国', 'CA': '加拿大', 'AU': '澳大利亚',
    'JP': '日本', 'KR': '韩国', 'TW': '台湾', 'HK': '香港',
    'TH': '泰国', 'VN': '越南', 'ID': '印尼', 'MY': '马来西亚', 'SG': '新加坡', 'PH': '菲律宾',
    'IN': '印度', 'PK': '巴基斯坦', 'BD': '孟加拉',
    'BR': '巴西', 'MX': '墨西哥', 'AR': '阿根廷',
    'DE': '德国', 'FR': '法国', 'IT': '意大利', 'ES': '西班牙', 'NL': '荷兰',
    'RU': '俄罗斯', 'TR': '土耳其', 'SA': '沙特', 'AE': '阿联酋', 'EG': '埃及',
};
/**
 * 🔄 刷新指定日期的所有聚合数据
 * @param date YYYY-MM-DD 格式
 * @param forceRefresh 是否强制刷新（即使不在最近3天内）
 */
async function refreshAggregation(date, forceRefresh = false) {
    // 如果不是最近3天且不强制刷新，跳过
    if (!(0, Aggregation_1.isRecentDate)(date) && !forceRefresh) {
        logger_1.default.info(`[Aggregation] Skipping ${date} - not in recent 3 days`);
        return;
    }
    logger_1.default.info(`[Aggregation] Refreshing aggregation for ${date}...`);
    const startTime = Date.now();
    try {
        // 获取所有活跃 Token（用于后备）
        const activeTokens = await FbToken_1.default.find({ status: 'active' }).lean();
        if (activeTokens.length === 0) {
            logger_1.default.warn('[Aggregation] No active token found');
            return;
        }
        const defaultToken = activeTokens[0].token;
        // 构建 Token 映射（fbUserId -> token）
        const tokenMap = new Map();
        for (const t of activeTokens) {
            if (t.fbUserId && t.token) {
                tokenMap.set(t.fbUserId, t.token);
            }
        }
        logger_1.default.info(`[Aggregation] Loaded ${activeTokens.length} active tokens`);
        // 获取所有活跃账户（包含 token 字段）
        const accounts = await Account_1.default.find({ status: 'active' }).lean();
        logger_1.default.info(`[Aggregation] Found ${accounts.length} active accounts`);
        // 预先查询所有 Campaign 名称（Facebook API 可能不返回名称）
        const allCampaigns = await Campaign_1.default.find({}).select('campaignId name').lean();
        const campaignNameMap = new Map();
        for (const c of allCampaigns) {
            campaignNameMap.set(c.campaignId, c.name || '');
        }
        logger_1.default.info(`[Aggregation] Loaded ${campaignNameMap.size} campaign names`);
        // 收集所有数据（线程安全，无需锁，因为 JS 是单线程的）
        const dailyData = { spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0 };
        const countryMap = new Map();
        const accountMap = new Map();
        const campaignMap = new Map();
        const optimizerMap = new Map();
        // === 并发处理逻辑 ===
        const CONCURRENCY_LIMIT = 10;
        const chunks = [];
        for (let i = 0; i < accounts.length; i += CONCURRENCY_LIMIT) {
            chunks.push(accounts.slice(i, i + CONCURRENCY_LIMIT));
        }
        let processedCount = 0;
        let errorCount = 0;
        for (const chunk of chunks) {
            await Promise.all(chunk.map(async (account) => {
                try {
                    // 使用账户关联的 token，如果没有则使用默认 token
                    const accountToken = account.token || defaultToken;
                    if (!accountToken) {
                        logger_1.default.warn(`[Aggregation] No token for account ${account.accountId}, skipping`);
                        return;
                    }
                    // 获取 campaign 级别数据（含国家维度）
                    const insights = await (0, insights_api_1.fetchInsights)(`act_${account.accountId}`, 'campaign', undefined, accountToken, ['country'], { since: date, until: date });
                    let accountSpend = 0;
                    let accountRevenue = 0;
                    let accountImpressions = 0;
                    let accountClicks = 0;
                    let accountInstalls = 0;
                    const accountCampaigns = new Set();
                    for (const insight of insights) {
                        const spend = parseFloat(insight.spend || '0');
                        const impressions = parseInt(insight.impressions || '0', 10);
                        const clicks = parseInt(insight.clicks || '0', 10);
                        let revenue = 0;
                        let installs = 0;
                        // 提取 purchase value
                        if (insight.action_values && Array.isArray(insight.action_values)) {
                            const purchaseAction = insight.action_values.find((a) => a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase' || a.action_type === 'omni_purchase');
                            if (purchaseAction) {
                                revenue = parseFloat(purchaseAction.value) || 0;
                            }
                        }
                        // 提取 installs
                        if (insight.actions) {
                            for (const action of insight.actions) {
                                if (action.action_type === 'mobile_app_install') {
                                    installs += parseInt(action.value || '0', 10);
                                }
                            }
                        }
                        // 累加到日汇总
                        dailyData.spend += spend;
                        dailyData.revenue += revenue;
                        dailyData.impressions += impressions;
                        dailyData.clicks += clicks;
                        dailyData.installs += installs;
                        // 累加到账户
                        accountSpend += spend;
                        accountRevenue += revenue;
                        accountImpressions += impressions;
                        accountClicks += clicks;
                        accountInstalls += installs;
                        // 记录 Campaign
                        if (insight.campaign_id) {
                            accountCampaigns.add(insight.campaign_id);
                            const campaignKey = insight.campaign_id;
                            if (!campaignMap.has(campaignKey)) {
                                // 优先使用预加载的名称，其次用 API 返回的
                                const campaignName = campaignNameMap.get(insight.campaign_id) || insight.campaign_name || '';
                                // 从名称提取投手
                                const optimizer = campaignName.split('_')[0] || 'unknown';
                                campaignMap.set(campaignKey, {
                                    campaignId: insight.campaign_id,
                                    campaignName,
                                    accountId: account.accountId,
                                    accountName: account.name || '',
                                    optimizer,
                                    spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0,
                                    status: insight.campaign_status || 'ACTIVE',
                                    objective: insight.objective || '',
                                });
                            }
                            const c = campaignMap.get(campaignKey);
                            c.spend += spend;
                            c.revenue += revenue;
                            c.impressions += impressions;
                            c.clicks += clicks;
                            c.installs += installs;
                        }
                        // 记录国家
                        if (insight.country) {
                            const countryKey = insight.country;
                            if (!countryMap.has(countryKey)) {
                                countryMap.set(countryKey, {
                                    country: countryKey,
                                    countryName: COUNTRY_NAMES[countryKey] || countryKey,
                                    spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0,
                                    campaigns: new Set(),
                                });
                            }
                            const cn = countryMap.get(countryKey);
                            cn.spend += spend;
                            cn.revenue += revenue;
                            cn.impressions += impressions;
                            cn.clicks += clicks;
                            cn.installs += installs;
                            if (insight.campaign_id)
                                cn.campaigns.add(insight.campaign_id);
                        }
                    }
                    // 保存账户数据
                    accountMap.set(account.accountId, {
                        accountId: account.accountId,
                        accountName: account.name || '',
                        spend: accountSpend,
                        revenue: accountRevenue,
                        impressions: accountImpressions,
                        clicks: accountClicks,
                        installs: accountInstalls,
                        campaigns: accountCampaigns.size,
                        status: account.status || 'active',
                    });
                    processedCount++;
                }
                catch (error) {
                    errorCount++;
                    // 仅记录警告，不中断整体流程
                    // logger.warn(`[Aggregation] Failed to fetch account ${account.accountId}: ${error.message}`)
                }
            }));
        }
        // 聚合投手数据（从 Campaign 汇总）
        for (const [, campaign] of campaignMap) {
            const optimizer = campaign.optimizer;
            if (!optimizerMap.has(optimizer)) {
                optimizerMap.set(optimizer, {
                    optimizer,
                    spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0,
                    campaigns: new Set(),
                    accounts: new Set(),
                });
            }
            const o = optimizerMap.get(optimizer);
            o.spend += campaign.spend;
            o.revenue += campaign.revenue;
            o.impressions += campaign.impressions;
            o.clicks += campaign.clicks;
            o.installs += campaign.installs;
            o.campaigns.add(campaign.campaignId);
            o.accounts.add(campaign.accountId);
        }
        // ==================== 保存到数据库 ====================
        // 1. 保存日汇总
        const activeAccounts = [...accountMap.values()].filter(a => a.spend > 0).length;
        const activeCampaigns = [...campaignMap.values()].filter(c => c.spend > 0).length;
        await Aggregation_1.AggDaily.findOneAndUpdate({ date }, {
            date,
            spend: Math.round(dailyData.spend * 100) / 100,
            revenue: Math.round(dailyData.revenue * 100) / 100,
            roas: dailyData.spend > 0 ? Math.round((dailyData.revenue / dailyData.spend) * 100) / 100 : 0,
            impressions: dailyData.impressions,
            clicks: dailyData.clicks,
            installs: dailyData.installs,
            ctr: dailyData.impressions > 0 ? Math.round((dailyData.clicks / dailyData.impressions) * 10000) / 100 : 0,
            cpm: dailyData.impressions > 0 ? Math.round((dailyData.spend / dailyData.impressions) * 1000 * 100) / 100 : 0,
            cpc: dailyData.clicks > 0 ? Math.round((dailyData.spend / dailyData.clicks) * 100) / 100 : 0,
            cpi: dailyData.installs > 0 ? Math.round((dailyData.spend / dailyData.installs) * 100) / 100 : 0,
            activeCampaigns,
            activeAccounts,
        }, { upsert: true });
        // 2. 保存国家数据 (批量写入优化)
        const countryOps = Array.from(countryMap.values()).map(country => ({
            updateOne: {
                filter: { date, country: country.country },
                update: {
                    date,
                    country: country.country,
                    countryName: country.countryName,
                    spend: Math.round(country.spend * 100) / 100,
                    revenue: Math.round(country.revenue * 100) / 100,
                    roas: country.spend > 0 ? Math.round((country.revenue / country.spend) * 100) / 100 : 0,
                    impressions: country.impressions,
                    clicks: country.clicks,
                    installs: country.installs,
                    ctr: country.impressions > 0 ? Math.round((country.clicks / country.impressions) * 10000) / 100 : 0,
                    campaigns: country.campaigns.size,
                },
                upsert: true
            }
        }));
        if (countryOps.length > 0)
            await Aggregation_1.AggCountry.bulkWrite(countryOps);
        // 3. 保存账户数据 (批量写入优化)
        const accountOps = Array.from(accountMap.values()).map(account => ({
            updateOne: {
                filter: { date, accountId: account.accountId },
                update: {
                    date,
                    accountId: account.accountId,
                    accountName: account.accountName,
                    spend: Math.round(account.spend * 100) / 100,
                    revenue: Math.round(account.revenue * 100) / 100,
                    roas: account.spend > 0 ? Math.round((account.revenue / account.spend) * 100) / 100 : 0,
                    impressions: account.impressions,
                    clicks: account.clicks,
                    installs: account.installs,
                    ctr: account.impressions > 0 ? Math.round((account.clicks / account.impressions) * 10000) / 100 : 0,
                    campaigns: account.campaigns,
                    status: account.status,
                },
                upsert: true
            }
        }));
        if (accountOps.length > 0)
            await Aggregation_1.AggAccount.bulkWrite(accountOps);
        // 4. 保存广告系列数据 (批量写入优化)
        const campaignOps = Array.from(campaignMap.values()).map(campaign => ({
            updateOne: {
                filter: { date, campaignId: campaign.campaignId },
                update: {
                    date,
                    campaignId: campaign.campaignId,
                    campaignName: campaign.campaignName,
                    accountId: campaign.accountId,
                    accountName: campaign.accountName,
                    optimizer: campaign.optimizer,
                    spend: Math.round(campaign.spend * 100) / 100,
                    revenue: Math.round(campaign.revenue * 100) / 100,
                    roas: campaign.spend > 0 ? Math.round((campaign.revenue / campaign.spend) * 100) / 100 : 0,
                    impressions: campaign.impressions,
                    clicks: campaign.clicks,
                    installs: campaign.installs,
                    ctr: campaign.impressions > 0 ? Math.round((campaign.clicks / campaign.impressions) * 10000) / 100 : 0,
                    cpc: campaign.clicks > 0 ? Math.round((campaign.spend / campaign.clicks) * 100) / 100 : 0,
                    cpi: campaign.installs > 0 ? Math.round((campaign.spend / campaign.installs) * 100) / 100 : 0,
                    status: campaign.status,
                    objective: campaign.objective,
                },
                upsert: true
            }
        }));
        if (campaignOps.length > 0)
            await Aggregation_1.AggCampaign.bulkWrite(campaignOps);
        // 5. 保存投手数据 (批量写入优化)
        const optimizerOps = Array.from(optimizerMap.values()).map(optimizer => ({
            updateOne: {
                filter: { date, optimizer: optimizer.optimizer },
                update: {
                    date,
                    optimizer: optimizer.optimizer,
                    spend: Math.round(optimizer.spend * 100) / 100,
                    revenue: Math.round(optimizer.revenue * 100) / 100,
                    roas: optimizer.spend > 0 ? Math.round((optimizer.revenue / optimizer.spend) * 100) / 100 : 0,
                    impressions: optimizer.impressions,
                    clicks: optimizer.clicks,
                    installs: optimizer.installs,
                    ctr: optimizer.impressions > 0 ? Math.round((optimizer.clicks / optimizer.impressions) * 10000) / 100 : 0,
                    campaigns: optimizer.campaigns.size,
                    accounts: optimizer.accounts.size,
                },
                upsert: true
            }
        }));
        if (optimizerOps.length > 0)
            await Aggregation_1.AggOptimizer.bulkWrite(optimizerOps);
        const duration = Date.now() - startTime;
        logger_1.default.info(`[Aggregation] Refreshed ${date} in ${duration}ms: ${processedCount} accounts processed, ${activeCampaigns} campaigns, ${errorCount} errors`);
    }
    catch (error) {
        logger_1.default.error(`[Aggregation] Failed to refresh ${date}:`, error.message);
    }
}
/**
 * 🔄 刷新最近 3 天的数据
 */
async function refreshRecentDays() {
    const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
    const yesterday = (0, dayjs_1.default)().subtract(1, 'day').format('YYYY-MM-DD');
    const dayBefore = (0, dayjs_1.default)().subtract(2, 'day').format('YYYY-MM-DD');
    logger_1.default.info('[Aggregation] Refreshing recent 3 days...');
    // 并行刷新
    await Promise.all([
        refreshAggregation(today),
        refreshAggregation(yesterday),
        refreshAggregation(dayBefore),
    ]);
}
// ==================== 查询接口（直接读取，不刷新） ====================
// 🚀 刷新只在后台定时任务中进行，查询时直接返回数据库数据
/**
 * 📊 获取日汇总数据
 */
async function getDailySummary(startDate, endDate) {
    return Aggregation_1.AggDaily.find({
        date: { $gte: startDate, $lte: endDate }
    }).sort({ date: -1 }).lean();
}
/**
 * 🌍 获取国家数据
 */
async function getCountryData(date) {
    return Aggregation_1.AggCountry.find({ date })
        .sort({ spend: -1 })
        .lean();
}
/**
 * 💰 获取账户数据
 */
async function getAccountData(date) {
    return Aggregation_1.AggAccount.find({ date })
        .sort({ spend: -1 })
        .lean();
}
/**
 * 📈 获取广告系列数据
 */
async function getCampaignData(date, options) {
    const query = { date };
    if (options?.optimizer)
        query.optimizer = options.optimizer;
    if (options?.accountId)
        query.accountId = options.accountId;
    return Aggregation_1.AggCampaign.find(query)
        .sort({ spend: -1 })
        .lean();
}
/**
 * 👥 获取投手数据
 */
async function getOptimizerData(date) {
    return Aggregation_1.AggOptimizer.find({ date })
        .sort({ spend: -1 })
        .lean();
}
/**
 * 🎨 获取素材数据 (已废弃，请使用 summary.controller.ts 中的 MaterialMetrics 查询)
 */
async function getMaterialData(date) {
    return [];
}
exports.default = {
    refreshAggregation,
    refreshRecentDays,
    getDailySummary,
    getCountryData,
    getAccountData,
    getCampaignData,
    getOptimizerData,
    getMaterialData,
};
