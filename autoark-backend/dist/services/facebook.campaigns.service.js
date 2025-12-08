"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCampaigns = exports.syncCampaignsFromAdAccounts = void 0;
const Campaign_1 = __importDefault(require("../models/Campaign"));
const Account_1 = __importDefault(require("../models/Account"));
const MetricsDaily_1 = __importDefault(require("../models/MetricsDaily"));
const FbToken_1 = __importDefault(require("../models/FbToken"));
const facebook_api_1 = require("./facebook.api");
const logger_1 = __importDefault(require("../utils/logger"));
const dayjs_1 = __importDefault(require("dayjs"));
const accountId_1 = require("../utils/accountId");
const db_1 = require("../config/db");
const cache_1 = require("../utils/cache");
const facebookPurchase_1 = require("../utils/facebookPurchase");
const mongoose_1 = __importDefault(require("mongoose"));
const syncCampaignsFromAdAccounts = async () => {
    const startTime = Date.now();
    let syncedCampaigns = 0;
    let syncedMetrics = 0;
    let errorCount = 0;
    const errors = [];
    try {
        // 1. 获取所有有效的广告账户
        const accounts = await Account_1.default.find({ status: 'active' });
        logger_1.default.info(`Starting campaign sync for ${accounts.length} active ad accounts`);
        for (const account of accounts) {
            if (!account.token) {
                logger_1.default.warn(`Account ${account.accountId} has no associated token, skipping campaign sync.`);
                continue;
            }
            try {
                // 2. 拉取该账户下的所有广告系列
                // 使用统一工具函数：Facebook API 调用需要带 act_ 前缀
                const accountIdForApi = (0, accountId_1.normalizeForApi)(account.accountId);
                const campaigns = await (0, facebook_api_1.fetchCampaigns)(accountIdForApi, account.token);
                logger_1.default.info(`Found ${campaigns.length} campaigns for account ${account.accountId}`);
                for (const camp of campaigns) {
                    const campaignData = {
                        campaignId: camp.id,
                        accountId: (0, accountId_1.normalizeForStorage)(account.accountId), // 统一格式：数据库存储时去掉前缀
                        channel: 'facebook',
                        name: camp.name,
                        status: camp.status,
                        objective: camp.objective,
                        buying_type: camp.buying_type,
                        daily_budget: camp.daily_budget,
                        budget_remaining: camp.budget_remaining,
                        created_time: camp.created_time ? new Date(camp.created_time) : undefined,
                        updated_time: camp.updated_time ? new Date(camp.updated_time) : undefined,
                        raw: camp,
                    };
                    await Campaign_1.default.findOneAndUpdate({ campaignId: campaignData.campaignId }, campaignData, { upsert: true, new: true });
                    syncedCampaigns++;
                    // 3. 拉取广告系列的日级别洞察数据 (今天的数据)
                    // 使用 breakdowns: ['country'] 来获取按国家分组的数据
                    const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
                    const insights = await (0, facebook_api_1.fetchInsights)(camp.id, 'campaign', 'today', // 或者选择一个日期范围
                    account.token, ['country'] // 按国家分组
                    );
                    if (insights && insights.length > 0) {
                        for (const insight of insights) {
                            // Facebook API 返回的 country 字段在 breakdowns 中
                            const country = insight.country || null;
                            const metricsData = {
                                date: today,
                                channel: 'facebook',
                                accountId: (0, accountId_1.normalizeForStorage)(account.accountId), // 统一格式：数据库存储时去掉前缀
                                campaignId: camp.id,
                                country: country, // 国家代码
                                level: 'campaign', // 明确设置级别
                                entityId: camp.id, // 设置 entityId 为 campaignId
                                impressions: insight.impressions || 0,
                                clicks: insight.clicks || 0,
                                spendUsd: parseFloat(insight.spend || '0'),
                                cpc: insight.cpc ? parseFloat(insight.cpc) : undefined,
                                ctr: insight.ctr ? parseFloat(insight.ctr) : undefined,
                                cpm: insight.cpm ? parseFloat(insight.cpm) : undefined,
                                actions: insight.actions, // Raw actions array
                                action_values: insight.action_values, // Raw action_values array
                                purchase_roas: insight.purchase_roas ? parseFloat(insight.purchase_roas) : undefined,
                                purchase_value: (0, facebookPurchase_1.extractPurchaseValue)(insight.action_values), // 自行计算购物转化价值
                                mobile_app_install_count: getActionCount(insight.actions, 'mobile_app_install'), // 自行计算事件转化次数
                                raw: insight,
                            };
                            // Campaign + Country 级别的指标，不设置 adId 和 adsetId，避免与 { adId: 1, date: 1 } 唯一索引冲突
                            // 使用新的唯一索引：{ date: 1, level: 1, entityId: 1, country: 1 }
                            // 注意：这里仍然使用 findOneAndUpdate，因为这是旧的同步方式
                            // 新的队列系统会使用 UpsertService
                            await MetricsDaily_1.default.findOneAndUpdate({
                                date: metricsData.date,
                                level: 'campaign',
                                entityId: camp.id,
                                country: country || null
                            }, {
                                $set: metricsData,
                                $unset: { adId: '', adsetId: '' } // 移除 adId 和 adsetId，避免唯一索引冲突
                            }, { upsert: true, new: true });
                            syncedMetrics++;
                        }
                    }
                }
            }
            catch (error) {
                errorCount++;
                const errorMsg = error.message || String(error);
                errors.push({ accountId: account.accountId, error: errorMsg });
                logger_1.default.error(`Failed to sync campaigns/insights for account ${account.accountId}: ${errorMsg}`);
            }
        }
        logger_1.default.info(`Campaign sync completed. Synced Campaigns: ${syncedCampaigns}, Synced Metrics: ${syncedMetrics}, Errors: ${errorCount}, Duration: ${Date.now() - startTime}ms`);
        return { syncedCampaigns, syncedMetrics, errorCount, errors };
    }
    catch (error) {
        logger_1.default.error('Campaign sync failed:', error);
        throw error;
    }
};
exports.syncCampaignsFromAdAccounts = syncCampaignsFromAdAccounts;
// 辅助函数：从 actions 数组中获取特定 action_type 的 value (用于购物转化价值)
const getActionValue = (actions, actionType) => {
    if (!actions || !Array.isArray(actions))
        return undefined;
    const action = actions.find(a => a.action_type === actionType);
    return action ? parseFloat(action.value) : undefined;
};
// 辅助函数：从 actions 数组中获取特定 action_type 的 count (用于事件转化次数)
const getActionCount = (actions, actionType) => {
    if (!actions || !Array.isArray(actions))
        return undefined;
    const action = actions.find(a => a.action_type === actionType);
    return action ? parseInt(action.value) : undefined;
};
const getCampaigns = async (filters = {}, pagination) => {
    const query = {};
    if (filters.name) {
        query.name = { $regex: filters.name, $options: 'i' };
    }
    if (filters.accountId) {
        query.accountId = filters.accountId;
    }
    if (filters.status) {
        query.status = filters.status;
    }
    if (filters.objective) {
        query.objective = filters.objective;
    }
    // 使用读连接进行查询（读写分离）
    const readConnection = (0, db_1.getReadConnection)();
    let CampaignModel = Campaign_1.default;
    if (readConnection !== mongoose_1.default) {
        if (!readConnection.models.Campaign) {
            CampaignModel = readConnection.model('Campaign', Campaign_1.default.schema);
        }
        else {
            CampaignModel = readConnection.models.Campaign;
        }
    }
    // 判断排序字段是否是 metrics 字段（需要从 MetricsDaily 获取）
    const metricsSortFields = ['spend', 'impressions', 'clicks', 'cpc', 'ctr', 'cpm', 'purchase_roas', 'purchase_value', 'mobile_app_install'];
    const isMetricsSort = metricsSortFields.includes(pagination.sortBy);
    let campaigns = [];
    let total = 0;
    if (isMetricsSort) {
        // 如果按 metrics 字段排序，需要先查询所有符合条件的 campaigns，然后按 metrics 排序
        const allCampaigns = await CampaignModel.find(query).lean();
        const allCampaignIds = allCampaigns.map(c => c.campaignId);
        total = allCampaignIds.length;
        if (allCampaignIds.length === 0) {
            return {
                data: [],
                pagination: {
                    page: pagination.page,
                    limit: pagination.limit,
                    total: 0,
                    pages: 0,
                },
            };
        }
        // 查询所有 campaigns 的 metrics 数据
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        // 优先查询新格式（有 level 和 entityId），如果没有则查询旧格式（只有 campaignId）
        const metricsQuery = {
            $or: [
                // 新格式：使用 level 和 entityId
                { level: 'campaign', entityId: { $in: allCampaignIds } },
                // 旧格式：兼容没有 level 字段的数据
                { level: { $exists: false }, campaignId: { $in: allCampaignIds, $exists: true, $ne: null } }
            ]
        };
        if (filters.startDate || filters.endDate) {
            metricsQuery.date = {};
            if (filters.startDate) {
                metricsQuery.date.$gte = filters.startDate;
            }
            if (filters.endDate) {
                metricsQuery.date.$lte = filters.endDate;
            }
        }
        else {
            metricsQuery.date = today;
        }
        // 直接从 Facebook Insights API 获取 metrics 数据（更准确）
        logger_1.default.info(`[getCampaigns-MetricsSort] Fetching metrics from Facebook API for ${allCampaignIds.length} campaigns`);
        // 构建日期参数
        let datePreset = 'today';
        let timeRange;
        if (filters.startDate && filters.endDate) {
            timeRange = { since: filters.startDate, until: filters.endDate };
            datePreset = '';
        }
        else if (filters.startDate) {
            timeRange = { since: filters.startDate, until: (0, dayjs_1.default)().format('YYYY-MM-DD') };
            datePreset = '';
        }
        else if (filters.endDate) {
            timeRange = { since: '2020-01-01', until: filters.endDate };
            datePreset = '';
        }
        logger_1.default.info(`[getCampaigns-MetricsSort] Date range: ${timeRange ? `${timeRange.since} - ${timeRange.until}` : datePreset}`);
        // 获取有效 token
        const tokenDoc = await FbToken_1.default.findOne({ status: 'active' });
        const token = tokenDoc?.token;
        let allMetricsData = [];
        if (token && allCampaignIds.length > 0) {
            // 按账户分组 campaigns
            const campaignsByAccount = new Map();
            for (const campaign of allCampaigns) {
                const accountId = campaign.accountId;
                if (!campaignsByAccount.has(accountId)) {
                    campaignsByAccount.set(accountId, []);
                }
                campaignsByAccount.get(accountId)?.push(campaign.campaignId);
            }
            logger_1.default.info(`[getCampaigns-MetricsSort] Found ${campaignsByAccount.size} accounts`);
            // 对每个账户调用 Insights API
            const accountPromises = Array.from(campaignsByAccount.entries()).map(async ([accountId, _campaignIds]) => {
                try {
                    const accountIdForApi = (0, accountId_1.normalizeForApi)(accountId);
                    const insights = await (0, facebook_api_1.fetchInsights)(accountIdForApi, 'campaign', datePreset || undefined, token, undefined, timeRange);
                    return insights || [];
                }
                catch (error) {
                    logger_1.default.warn(`[getCampaigns-MetricsSort] Failed to fetch insights for account ${accountId}`);
                    return [];
                }
            });
            const allInsights = (await Promise.all(accountPromises)).flat();
            logger_1.default.info(`[getCampaigns-MetricsSort] Fetched ${allInsights.length} insights from Facebook API`);
            // 转换 insights 为 metricsData 格式
            allMetricsData = allInsights.map((insight) => {
                const spend = parseFloat(insight.spend || '0');
                const impressions = parseInt(insight.impressions || '0', 10);
                const clicks = parseInt(insight.clicks || '0', 10);
                const ctr = impressions > 0 ? clicks / impressions : 0;
                // 从 action_values 中提取 purchase_value
                let purchase_value = 0;
                if (insight.action_values && Array.isArray(insight.action_values)) {
                    const purchaseAction = insight.action_values.find((a) => a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase' || a.action_type === 'omni_purchase');
                    if (purchaseAction) {
                        purchase_value = parseFloat(purchaseAction.value) || 0;
                    }
                }
                return {
                    _id: insight.campaign_id,
                    spendUsd: spend,
                    impressions: impressions,
                    clicks: clicks,
                    cpc: insight.cpc ? parseFloat(insight.cpc) : 0,
                    ctr: ctr,
                    cpm: insight.cpm ? parseFloat(insight.cpm) : 0,
                    actions: insight.actions,
                    action_values: insight.action_values,
                    purchase_roas: insight.purchase_roas ? parseFloat(insight.purchase_roas?.[0]?.value || '0') : 0,
                    purchase_value: purchase_value,
                    mobile_app_install: 0,
                    raw: insight
                };
            });
        }
        else {
            logger_1.default.warn(`[getCampaigns-MetricsSort] No active token found`);
        }
        // 创建 metrics Map
        const metricsMap = new Map();
        allMetricsData.forEach((item) => {
            metricsMap.set(item._id, item);
        });
        // 合并 campaigns 和 metrics，然后排序
        const campaignsWithMetrics = allCampaigns.map(campaign => {
            const metrics = metricsMap.get(campaign.campaignId) || {};
            const impressions = metrics.impressions || 0;
            const clicks = metrics.clicks || 0;
            // 计算正确的 CTR（clicks / impressions）
            const calculatedCtr = impressions > 0 ? clicks / impressions : 0;
            return {
                ...campaign,
                spend: metrics.spendUsd || 0,
                impressions: impressions,
                clicks: clicks,
                cpc: metrics.cpc || 0,
                ctr: calculatedCtr, // 使用计算出的 CTR
                cpm: metrics.cpm || 0,
                purchase_roas: metrics.purchase_roas || 0,
                purchase_value: metrics.purchase_value || 0,
                mobile_app_install: metrics.mobile_app_install || 0,
            };
        });
        // 按 metrics 字段排序
        campaignsWithMetrics.sort((a, b) => {
            const aValue = a[pagination.sortBy] || 0;
            const bValue = b[pagination.sortBy] || 0;
            if (pagination.sortOrder === 'desc') {
                return bValue - aValue;
            }
            else {
                return aValue - bValue;
            }
        });
        // 分页
        const startIndex = (pagination.page - 1) * pagination.limit;
        campaigns = campaignsWithMetrics.slice(startIndex, startIndex + pagination.limit);
        // 对于 metrics 排序，已经合并了 metrics 数据，直接返回
        // 需要将 campaigns 转换为正确的格式
        const campaignsWithMetricsFormatted = campaigns.map(campaign => {
            const campaignObj = campaign;
            const metrics = metricsMap.get(campaign.campaignId) || {};
            // 从 actions 和 action_values 中提取具体字段
            const actions = (metrics.actions || []);
            const actionValues = (metrics.action_values || []);
            const purchaseRoas = metrics.purchase_roas;
            // 提取各种 action 类型
            const extractedActions = {};
            actions.forEach((action) => {
                if (action.action_type && action.value !== undefined) {
                    extractedActions[action.action_type] = parseFloat(action.value) || 0;
                }
            });
            // 提取各种 action_value 类型
            const extractedActionValues = {};
            actionValues.forEach((action) => {
                if (action.action_type && action.value !== undefined) {
                    extractedActionValues[`${action.action_type}_value`] = parseFloat(action.value) || 0;
                }
            });
            // 提取 purchase_roas（兼容数值和数组两种格式）
            const extractedRoas = {};
            if (Array.isArray(purchaseRoas)) {
                purchaseRoas.forEach((roas) => {
                    if (roas.action_type && roas.value !== undefined) {
                        extractedRoas[`${roas.action_type}_roas`] = parseFloat(roas.value) || 0;
                    }
                });
            }
            else if (typeof purchaseRoas === 'number') {
                extractedRoas['purchase_roas'] = purchaseRoas;
            }
            // 从 raw 中过滤掉会覆盖正确计算值的字段
            const rawData = metrics.raw || {};
            const { ctr: _rawCtr, cpc: _rawCpc, cpm: _rawCpm, ...filteredRaw } = rawData;
            return {
                ...campaignObj,
                ...filteredRaw, // 先展开过滤后的 raw 数据
                ...extractedActions,
                ...extractedActionValues,
                ...extractedRoas,
                // 然后用正确的值覆盖
                id: campaignObj.campaignId,
                account_id: campaignObj.accountId,
                impressions: metrics.impressions || 0,
                clicks: metrics.clicks || 0,
                spend: metrics.spendUsd || 0,
                cpc: metrics.cpc,
                ctr: metrics.ctr, // 使用正确计算的 CTR
                cpm: metrics.cpm,
                metrics: metrics,
                raw_insights: metrics.raw,
            };
        });
        return {
            data: campaignsWithMetricsFormatted,
            pagination: {
                total,
                page: pagination.page,
                limit: pagination.limit,
                pages: Math.ceil(total / pagination.limit)
            }
        };
    }
    else {
        // 如果按 Campaign 表字段排序，也需要先获取所有符合条件的 campaigns，排序后再分页
        const allCampaigns = await CampaignModel.find(query).lean();
        total = allCampaigns.length;
        if (allCampaigns.length === 0) {
            return {
                data: [],
                pagination: {
                    page: pagination.page,
                    limit: pagination.limit,
                    total: 0,
                    pages: 0,
                },
            };
        }
        // 对所有 campaigns 进行排序
        const sortField = pagination.sortBy || 'createdAt';
        const sortOrder = pagination.sortOrder === 'desc' ? -1 : 1;
        allCampaigns.sort((a, b) => {
            const aValue = a[sortField];
            const bValue = b[sortField];
            // 处理 null/undefined 值
            if (aValue == null && bValue == null)
                return 0;
            if (aValue == null)
                return 1; // null 值排在后面
            if (bValue == null)
                return -1;
            // 处理字符串比较
            if (typeof aValue === 'string' && typeof bValue === 'string') {
                return sortOrder * aValue.localeCompare(bValue);
            }
            // 处理数字比较
            if (typeof aValue === 'number' && typeof bValue === 'number') {
                return sortOrder * (aValue - bValue);
            }
            // 处理日期比较
            if (aValue instanceof Date && bValue instanceof Date) {
                return sortOrder * (aValue.getTime() - bValue.getTime());
            }
            // 默认比较
            return sortOrder * (aValue > bValue ? 1 : aValue < bValue ? -1 : 0);
        });
        // 分页
        const startIndex = (pagination.page - 1) * pagination.limit;
        campaigns = allCampaigns.slice(startIndex, startIndex + pagination.limit);
    }
    // 联表查询 MetricsDaily 数据，以获取消耗、CPM 等实时指标（仅用于非 metrics 排序的情况）
    const campaignIds = campaigns.map(c => c.campaignId);
    // 如果没有 campaignIds，直接返回空数据
    if (campaignIds.length === 0) {
        return {
            data: campaigns.map((campaign) => {
                // 使用 .lean() 后，campaign 已经是普通对象，不需要 toObject()
                const campaignObj = campaign.toObject ? campaign.toObject() : campaign;
                return {
                    ...campaignObj,
                    spend: 0,
                    impressions: 0,
                    clicks: 0,
                    cpc: 0,
                    ctr: 0,
                    cpm: 0,
                    purchase_roas: 0,
                    purchase_value: 0,
                    mobile_app_install: 0,
                };
            }),
            pagination: {
                page: pagination.page,
                limit: pagination.limit,
                total,
                pages: Math.ceil(total / pagination.limit),
            },
        };
    }
    // 性能优化：只查询当前页的 campaigns 的 metrics
    // 构建日期查询条件：如果有日期范围，使用日期范围；否则使用今天
    const startTime = Date.now();
    let metricsData = [];
    // 尝试从缓存获取数据
    const cacheKey = (0, cache_1.getCacheKey)('campaigns:metrics', {
        campaignIds: campaignIds.sort().join(','),
        startDate: filters.startDate || '',
        endDate: filters.endDate || '',
        page: pagination.page,
        limit: pagination.limit,
    });
    const isToday = !filters.startDate && !filters.endDate;
    const cacheTtl = isToday ? cache_1.CACHE_TTL.TODAY : cache_1.CACHE_TTL.DATE_RANGE;
    // 暂时禁用缓存以确保从 Facebook API 获取最新数据
    const cachedData = null; // await getFromCache<any[]>(cacheKey)
    if (cachedData) {
        logger_1.default.info(`[getCampaigns] Cache hit for key: ${cacheKey}`);
        metricsData = cachedData;
    }
    else {
        logger_1.default.info(`[getCampaigns] Cache miss, fetching from Facebook API`);
        // 缓存未命中，从数据库查询
        try {
            // 使用读连接进行查询（读写分离）
            const readConnection = (0, db_1.getReadConnection)();
            let MetricsDailyRead = MetricsDaily_1.default;
            // 如果读连接是独立的连接，需要使用该连接的模型
            if (readConnection !== mongoose_1.default) {
                if (!readConnection.models.MetricsDaily) {
                    MetricsDailyRead = readConnection.model('MetricsDaily', MetricsDaily_1.default.schema);
                }
                else {
                    MetricsDailyRead = readConnection.models.MetricsDaily;
                }
            }
            // 直接从 Facebook Insights API 获取数据（更准确）
            {
                // 构建日期参数
                let datePreset = 'today';
                let timeRange;
                if (filters.startDate && filters.endDate) {
                    timeRange = { since: filters.startDate, until: filters.endDate };
                    datePreset = '';
                }
                else if (filters.startDate) {
                    timeRange = { since: filters.startDate, until: (0, dayjs_1.default)().format('YYYY-MM-DD') };
                    datePreset = '';
                }
                else if (filters.endDate) {
                    timeRange = { since: '2020-01-01', until: filters.endDate };
                    datePreset = '';
                }
                logger_1.default.info(`[getCampaigns] Fetching metrics from Facebook Insights API for ${campaignIds.length} campaigns, dateRange: ${timeRange ? `${timeRange.since} - ${timeRange.until}` : datePreset}`);
                // 获取有效 token
                const tokenDoc = await FbToken_1.default.findOne({ status: 'active' });
                const token = tokenDoc?.token;
                if (token && campaignIds.length > 0) {
                    // 按账户分组 campaigns，以便批量获取
                    const campaignsByAccount = new Map();
                    for (const campaign of campaigns) {
                        const accountId = campaign.accountId;
                        if (!campaignsByAccount.has(accountId)) {
                            campaignsByAccount.set(accountId, []);
                        }
                        campaignsByAccount.get(accountId)?.push(campaign.campaignId);
                    }
                    // 对每个账户调用 Insights API 获取 campaign 级别的数据
                    const accountPromises = Array.from(campaignsByAccount.entries()).map(async ([accountId, _campaignIds]) => {
                        try {
                            const accountIdForApi = (0, accountId_1.normalizeForApi)(accountId);
                            const insights = await (0, facebook_api_1.fetchInsights)(accountIdForApi, 'campaign', // 使用 campaign 级别
                            datePreset || undefined, token, undefined, timeRange);
                            return insights || [];
                        }
                        catch (error) {
                            logger_1.default.warn(`[getCampaigns] Failed to fetch insights for account ${accountId}`);
                            return [];
                        }
                    });
                    const allInsights = (await Promise.all(accountPromises)).flat();
                    logger_1.default.info(`[getCampaigns] Raw insights from Facebook API: ${JSON.stringify(allInsights.slice(0, 3))}`);
                    // 转换 insights 为 metricsData 格式
                    metricsData = allInsights.map((insight) => {
                        const spend = parseFloat(insight.spend || '0');
                        const impressions = parseInt(insight.impressions || '0', 10);
                        const clicks = parseInt(insight.clicks || '0', 10);
                        const ctr = impressions > 0 ? clicks / impressions : 0;
                        // 从 action_values 中提取 purchase_value
                        let purchase_value = 0;
                        if (insight.action_values && Array.isArray(insight.action_values)) {
                            const purchaseAction = insight.action_values.find((a) => a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase' || a.action_type === 'omni_purchase');
                            if (purchaseAction) {
                                purchase_value = parseFloat(purchaseAction.value) || 0;
                            }
                        }
                        return {
                            _id: insight.campaign_id,
                            spendUsd: spend,
                            impressions: impressions,
                            clicks: clicks,
                            cpc: insight.cpc ? parseFloat(insight.cpc) : undefined,
                            ctr: ctr,
                            cpm: insight.cpm ? parseFloat(insight.cpm) : undefined,
                            actions: insight.actions,
                            action_values: insight.action_values,
                            purchase_roas: insight.purchase_roas ? parseFloat(insight.purchase_roas?.[0]?.value || '0') : 0,
                            purchase_value: purchase_value,
                            raw: insight
                        };
                    });
                    logger_1.default.info(`[getCampaigns] Fetched ${metricsData.length} campaign insights from Facebook API`);
                }
                else {
                    logger_1.default.warn(`[getCampaigns] No active token found, using empty metrics`);
                    metricsData = [];
                }
            }
            const queryTime = Date.now() - startTime;
            if (queryTime > 1000) {
                logger_1.default.warn(`[getCampaigns] Query time: ${queryTime}ms for ${campaignIds.length} campaigns, dateRange: ${filters.startDate || 'today'} - ${filters.endDate || 'today'}`);
            }
            // 将查询结果存入缓存
            await (0, cache_1.setToCache)(cacheKey, metricsData, cacheTtl);
        }
        catch (error) {
            logger_1.default.error(`[getCampaigns] Metrics query failed: ${error.message}`, error);
            // 如果查询失败，返回空指标数据，但继续返回 campaigns
            metricsData = [];
        }
    }
    // 转换为 Map 以便快速查找
    const metricsMap = new Map();
    metricsData.forEach((item) => {
        metricsMap.set(item._id, item);
    });
    // 将指标合并到 Campaign 对象中，直接使用 Facebook 原始字段名
    const campaignsWithMetrics = campaigns.map(campaign => {
        const metrics = metricsMap.get(campaign.campaignId);
        // 使用 .lean() 后，campaign 已经是普通对象，不需要 toObject()
        const campaignObj = campaign.toObject ? campaign.toObject() : campaign;
        // 合并所有 metrics 字段（使用 Facebook 原始字段名）
        const metricsObj = metrics || {};
        // 从 actions 和 action_values 中提取具体字段
        const actions = (metricsObj.actions || []);
        const actionValues = (metricsObj.action_values || []);
        const purchaseRoas = (metricsObj.purchase_roas || []);
        // 提取各种 action 类型
        const extractedActions = {};
        actions.forEach((action) => {
            if (action.action_type && action.value !== undefined) {
                extractedActions[action.action_type] = parseFloat(action.value) || 0;
            }
        });
        // 提取各种 action_value 类型
        const extractedActionValues = {};
        actionValues.forEach((action) => {
            if (action.action_type && action.value !== undefined) {
                extractedActionValues[`${action.action_type}_value`] = parseFloat(action.value) || 0;
            }
        });
        // 提取 purchase_roas
        const extractedRoas = {};
        purchaseRoas.forEach((roas) => {
            if (roas.action_type && roas.value !== undefined) {
                extractedRoas[`${roas.action_type}_roas`] = parseFloat(roas.value) || 0;
            }
        });
        // 计算正确的 CTR（clicks / impressions），而不是直接使用存储的 CTR
        const impressions = metricsObj.impressions || 0;
        const clicks = metricsObj.clicks || 0;
        const calculatedCtr = impressions > 0 ? clicks / impressions : 0;
        // 按照优先级提取 purchase_value
        // 1) 优先使用 purchase_value_corrected（如果有）
        // 2) 否则使用 purchase_value
        // 3) 如果 purchase_value 为 0，则尝试从 action_values 重新提取
        // 4) 最终仍无则返回 0
        let purchase_value = metricsObj.purchase_value_corrected;
        // 如果没有 corrected 值，使用原始 purchase_value
        if (purchase_value === undefined || purchase_value === null) {
            purchase_value = metricsObj.purchase_value;
        }
        // 如果 purchase_value 为 0 或不存在，尝试从 action_values 重新提取
        if ((!purchase_value || purchase_value === 0) && actionValues && Array.isArray(actionValues) && actionValues.length > 0) {
            purchase_value = (0, facebookPurchase_1.extractPurchaseValue)(actionValues);
        }
        // 如果还是没有，尝试从 extractedActionValues 中获取（兼容旧逻辑）
        if ((!purchase_value || purchase_value === 0) && extractedActionValues.purchase_value !== undefined) {
            purchase_value = extractedActionValues.purchase_value;
        }
        if ((!purchase_value || purchase_value === 0) && extractedActionValues.mobile_app_purchase_value !== undefined) {
            purchase_value = extractedActionValues.mobile_app_purchase_value;
        }
        // 确保最终值不为 undefined 或 null
        purchase_value = purchase_value || 0;
        // 调试日志：如果 purchase_value 仍然为 0，记录相关信息
        if (campaignObj.campaignId && (!purchase_value || purchase_value === 0)) {
            logger_1.default.debug(`[getCampaigns] Campaign ${campaignObj.campaignId}: purchase_value=${purchase_value}, metricsObj.purchase_value=${metricsObj.purchase_value}, actionValues.length=${actionValues?.length || 0}, extractedActionValues=${JSON.stringify(extractedActionValues)}`);
        }
        // 从 raw 中过滤掉会覆盖正确计算值的字段
        const rawData = metricsObj.raw || {};
        const { ctr: _rawCtr, cpc: _rawCpc, cpm: _rawCpm, ...filteredRaw } = rawData;
        return {
            ...campaignObj,
            // 先展开过滤后的 raw 数据
            ...filteredRaw,
            // 提取的 actions
            ...extractedActions,
            // 提取的 action_values
            ...extractedActionValues,
            // 提取的 purchase_roas
            ...extractedRoas,
            // 然后用正确的值覆盖
            // Campaign 基础字段（使用 Facebook 原始字段名）
            id: campaignObj.campaignId,
            account_id: campaignObj.accountId,
            // Insights 基础字段
            impressions: impressions,
            clicks: clicks,
            spend: metricsObj.spendUsd || 0,
            cpc: metricsObj.cpc,
            ctr: calculatedCtr, // 使用计算出的 CTR
            cpm: metricsObj.cpm,
            purchase_value: purchase_value || 0, // 确保 purchase_value 被包含
            // 保留原始数据
            metrics: metricsObj,
            raw_insights: metricsObj.raw,
        };
    });
    return {
        data: campaignsWithMetrics,
        pagination: {
            total,
            page: pagination.page,
            limit: pagination.limit,
            pages: Math.ceil(total / pagination.limit)
        }
    };
};
exports.getCampaigns = getCampaigns;
// 计算 CPI (Cost Per Install)
const calculateCpi = (metrics) => {
    if (!metrics || !metrics.mobile_app_install_count || metrics.mobile_app_install_count === 0)
        return undefined;
    return metrics.spendUsd / metrics.mobile_app_install_count;
};
