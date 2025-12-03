"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.preaggregateCampaignMetrics = void 0;
const MetricsDaily_1 = __importDefault(require("../models/MetricsDaily"));
const Campaign_1 = __importDefault(require("../models/Campaign"));
const logger_1 = __importDefault(require("../utils/logger"));
const dayjs_1 = __importDefault(require("dayjs"));
const db_1 = require("../config/db");
const cache_1 = require("../utils/cache");
/**
 * 预聚合常用日期范围的数据
 * 定期计算并缓存常用查询，减少实时查询压力
 */
const preaggregateCampaignMetrics = async () => {
    const startTime = Date.now();
    logger_1.default.info('[Preaggregation] Starting campaign metrics preaggregation...');
    try {
        // 获取所有活跃的 campaignIds
        const campaigns = await Campaign_1.default.find({ status: { $in: ['ACTIVE', 'PAUSED'] } })
            .select('campaignId')
            .lean();
        const campaignIds = campaigns.map(c => c.campaignId);
        if (campaignIds.length === 0) {
            logger_1.default.info('[Preaggregation] No campaigns found, skipping preaggregation');
            return;
        }
        logger_1.default.info(`[Preaggregation] Processing ${campaignIds.length} campaigns`);
        // 预聚合的日期范围配置
        const dateRanges = [
            {
                name: 'today',
                startDate: (0, dayjs_1.default)().format('YYYY-MM-DD'),
                endDate: (0, dayjs_1.default)().format('YYYY-MM-DD'),
                ttl: cache_1.CACHE_TTL.TODAY,
            },
            {
                name: 'yesterday',
                startDate: (0, dayjs_1.default)().subtract(1, 'day').format('YYYY-MM-DD'),
                endDate: (0, dayjs_1.default)().subtract(1, 'day').format('YYYY-MM-DD'),
                ttl: cache_1.CACHE_TTL.TODAY,
            },
            {
                name: 'last7days',
                startDate: (0, dayjs_1.default)().subtract(7, 'day').format('YYYY-MM-DD'),
                endDate: (0, dayjs_1.default)().format('YYYY-MM-DD'),
                ttl: cache_1.CACHE_TTL.DATE_RANGE,
            },
            {
                name: 'last30days',
                startDate: (0, dayjs_1.default)().subtract(30, 'day').format('YYYY-MM-DD'),
                endDate: (0, dayjs_1.default)().format('YYYY-MM-DD'),
                ttl: cache_1.CACHE_TTL.DATE_RANGE,
            },
        ];
        // 使用写连接进行聚合（预聚合是写操作）
        const writeConnection = (0, db_1.getWriteConnection)();
        const MetricsDailyWrite = writeConnection.model('MetricsDaily', MetricsDaily_1.default.schema);
        // 分批处理 campaignIds（每批 100 个）
        const BATCH_SIZE = 100;
        let processedCount = 0;
        for (const dateRange of dateRanges) {
            logger_1.default.info(`[Preaggregation] Processing date range: ${dateRange.name} (${dateRange.startDate} - ${dateRange.endDate})`);
            for (let i = 0; i < campaignIds.length; i += BATCH_SIZE) {
                const batchIds = campaignIds.slice(i, i + BATCH_SIZE);
                try {
                    const dateQuery = {
                        campaignId: { $in: batchIds },
                    };
                    if (dateRange.startDate === dateRange.endDate) {
                        // 单日查询
                        dateQuery.date = dateRange.startDate;
                        const metrics = await MetricsDailyWrite.find(dateQuery)
                            .hint({ campaignId: 1, date: 1 })
                            .lean();
                        // 转换为聚合格式
                        const metricsData = metrics.map((metric) => ({
                            _id: metric.campaignId,
                            spendUsd: metric.spendUsd || 0,
                            impressions: metric.impressions || 0,
                            clicks: metric.clicks || 0,
                            cpc: metric.cpc,
                            ctr: metric.ctr,
                            cpm: metric.cpm,
                            actions: metric.actions,
                            action_values: metric.action_values,
                            purchase_roas: metric.purchase_roas,
                            raw: metric.raw,
                        }));
                        // 为每个 campaignId 生成缓存键并存储
                        for (const campaignId of batchIds) {
                            const cacheKey = (0, cache_1.getCacheKey)('campaigns:metrics', {
                                campaignIds: campaignId,
                                startDate: dateRange.startDate,
                                endDate: dateRange.endDate,
                                page: 1,
                                limit: 1,
                            });
                            const campaignMetrics = metricsData.find(m => m._id === campaignId);
                            if (campaignMetrics) {
                                await (0, cache_1.setToCache)(cacheKey, [campaignMetrics], dateRange.ttl);
                            }
                        }
                    }
                    else {
                        // 日期范围查询，使用聚合
                        dateQuery.date = {
                            $gte: dateRange.startDate,
                            $lte: dateRange.endDate,
                        };
                        const metricsData = await MetricsDailyWrite.aggregate([
                            { $match: dateQuery },
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
                                    actions: { $first: '$actions' },
                                    action_values: { $first: '$action_values' },
                                    purchase_roas: { $first: '$purchase_roas' },
                                    raw: { $first: '$raw' },
                                },
                            },
                        ])
                            .hint({ campaignId: 1, date: 1 })
                            .allowDiskUse(true);
                        // 为每个 campaignId 生成缓存键并存储
                        for (const campaignId of batchIds) {
                            const cacheKey = (0, cache_1.getCacheKey)('campaigns:metrics', {
                                campaignIds: campaignId,
                                startDate: dateRange.startDate,
                                endDate: dateRange.endDate,
                                page: 1,
                                limit: 1,
                            });
                            const campaignMetrics = metricsData.find(m => m._id === campaignId);
                            if (campaignMetrics) {
                                await (0, cache_1.setToCache)(cacheKey, [campaignMetrics], dateRange.ttl);
                            }
                        }
                    }
                    processedCount += batchIds.length;
                    logger_1.default.info(`[Preaggregation] Processed ${processedCount}/${campaignIds.length} campaigns for ${dateRange.name}`);
                }
                catch (error) {
                    logger_1.default.error(`[Preaggregation] Error processing batch ${i}-${i + BATCH_SIZE}:`, error);
                }
            }
        }
        const duration = Date.now() - startTime;
        logger_1.default.info(`[Preaggregation] Completed in ${duration}ms. Processed ${processedCount} campaigns across ${dateRanges.length} date ranges`);
    }
    catch (error) {
        logger_1.default.error('[Preaggregation] Failed:', error);
        throw error;
    }
};
exports.preaggregateCampaignMetrics = preaggregateCampaignMetrics;
