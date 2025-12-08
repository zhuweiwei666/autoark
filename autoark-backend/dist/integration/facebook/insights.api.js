"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchInsights = void 0;
const facebookClient_1 = require("./facebookClient");
const fetchInsights = async (entityId, // 可以是 accountId, campaignId, adsetId, adId
level, datePreset, token, breakdowns, // 支持 breakdowns，如 ['country'] 来按国家分组
timeRange) => {
    // Facebook Insights API 有效字段列表
    // 注意：cpa, conversion_rate, value, mobile_app_install 不是有效字段
    // 这些数据应该从 actions 和 action_values 中获取
    const fields = [
        'campaign_id',
        'adset_id',
        'ad_id',
        'impressions',
        'clicks',
        'unique_clicks',
        'spend',
        'reach',
        'frequency',
        'cpc',
        'ctr',
        'cpm',
        'cpp',
        'cost_per_conversion', // 有效字段
        'conversions', // 有效字段
        'actions', // 用于获取转化数据（包括 mobile_app_install）
        'action_values', // 用于获取转化价值（包括 purchase value）
        'unique_actions',
        'purchase_roas', // Return on Ad Spend
        'cost_per_action_type', // 有效字段
        'video_play_actions',
        'video_30_sec_watched_actions',
        'video_avg_time_watched_actions',
        'video_p100_watched_actions',
        'video_p25_watched_actions',
        'video_p50_watched_actions',
        'video_p75_watched_actions',
        'video_p95_watched_actions',
        'video_thruplay_watched_actions',
        'video_time_watched_actions',
        'date_start',
        'date_stop',
    ].join(',');
    const params = {
        level: level,
        fields,
        limit: 1000,
    };
    // 优先使用 timeRange，否则使用 datePreset
    if (timeRange) {
        params.time_range = JSON.stringify(timeRange);
    }
    else if (datePreset) {
        params.date_preset = datePreset;
    }
    else {
        params.date_preset = 'today';
    }
    // 如果指定了 breakdowns，添加到参数中
    if (breakdowns && breakdowns.length > 0) {
        params.breakdowns = breakdowns.join(',');
    }
    if (token) {
        params.access_token = token;
    }
    const res = await facebookClient_1.facebookClient.get(`/${entityId}/insights`, params);
    return res.data || [];
};
exports.fetchInsights = fetchInsights;
