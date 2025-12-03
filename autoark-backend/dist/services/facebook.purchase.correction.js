"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.correctPurchaseValuesForDateRange = exports.getPurchaseValueInfo = exports.correctPurchaseValue = void 0;
const MetricsDaily_1 = __importDefault(require("../models/MetricsDaily"));
const RawInsights_1 = __importDefault(require("../models/RawInsights"));
const logger_1 = __importDefault(require("../utils/logger"));
const dayjs_1 = __importDefault(require("dayjs"));
/**
 * 修正指定日期的 Purchase 值
 */
const correctPurchaseValue = async (date) => {
    logger_1.default.info(`[Purchase Correction] Starting correction for date: ${date}`);
    try {
        // 1. 获取该日期的所有 Ad 级别数据
        const adLevelData = await MetricsDaily_1.default.find({
            date,
            adId: { $exists: true, $ne: null },
        }).lean();
        if (adLevelData.length === 0) {
            logger_1.default.info(`[Purchase Correction] No ad-level data found for date: ${date}`);
            return;
        }
        // 2. 按 campaignId + country 分组
        const groupedData = new Map();
        for (const item of adLevelData) {
            const key = `${item.campaignId || 'unknown'}_${item.country || 'unknown'}`;
            if (!groupedData.has(key)) {
                groupedData.set(key, []);
            }
            groupedData.get(key).push(item);
        }
        // 3. 对每个分组，查找 last_7d 数据来修正
        const correctionOps = [];
        for (const [key, items] of groupedData.entries()) {
            const [campaignId, country] = key.split('_');
            const campaignIdValue = campaignId === 'unknown' ? null : campaignId;
            const countryValue = country === 'unknown' ? null : country;
            // 计算当前日期的总 purchase_value
            const currentTotal = items.reduce((sum, item) => sum + (item.purchase_value || 0), 0);
            // 查找 last_7d 数据（从 RawInsights）
            const dateObj = (0, dayjs_1.default)(date);
            const last7dStart = dateObj.subtract(6, 'day').format('YYYY-MM-DD');
            const last7dEnd = dateObj.format('YYYY-MM-DD');
            const last7dData = await RawInsights_1.default.find({
                date: { $gte: last7dStart, $lte: last7dEnd },
                datePreset: 'last_7d',
                campaignId: campaignIdValue,
                country: countryValue,
                adId: { $exists: true, $ne: null },
            }).lean();
            if (last7dData.length > 0) {
                // 计算 last_7d 的总 purchase_value
                const last7dTotal = last7dData.reduce((sum, item) => sum + (item.purchase_value || 0), 0);
                // 如果 last_7d 的值更大，说明有延迟回传的数据
                if (last7dTotal > currentTotal) {
                    const correctedValue = last7dTotal;
                    const diff = correctedValue - currentTotal;
                    logger_1.default.info(`[Purchase Correction] Campaign ${campaignId}, Country ${country}: ${currentTotal} → ${correctedValue} (+${diff})`);
                    // 更新所有相关的 MetricsDaily 记录
                    for (const item of items) {
                        correctionOps.push({
                            updateOne: {
                                filter: {
                                    _id: item._id,
                                },
                                update: {
                                    $set: {
                                        purchase_value_corrected: correctedValue,
                                        purchase_value_last7d: last7dTotal,
                                        purchase_correction_applied: true,
                                        purchase_correction_date: new Date(),
                                    },
                                },
                            },
                        });
                    }
                }
            }
        }
        // 4. 批量执行修正
        if (correctionOps.length > 0) {
            await MetricsDaily_1.default.bulkWrite(correctionOps, { ordered: false });
            logger_1.default.info(`[Purchase Correction] Applied ${correctionOps.length} corrections for date: ${date}`);
        }
        else {
            logger_1.default.info(`[Purchase Correction] No corrections needed for date: ${date}`);
        }
    }
    catch (error) {
        logger_1.default.error(`[Purchase Correction] Failed to correct purchase value for ${date}:`, error);
        throw error;
    }
};
exports.correctPurchaseValue = correctPurchaseValue;
/**
 * 获取 Purchase 值信息（用于前端 Tooltip）
 */
const getPurchaseValueInfo = async (campaignId, date, country) => {
    try {
        const query = {
            campaignId,
            date,
        };
        if (country) {
            query.country = country;
        }
        // 获取 today 数据
        const todayData = await MetricsDaily_1.default.findOne({
            ...query,
            datePreset: 'today',
        }).lean();
        // 获取 yesterday 数据
        const yesterdayDate = (0, dayjs_1.default)(date).subtract(1, 'day').format('YYYY-MM-DD');
        const yesterdayData = await MetricsDaily_1.default.findOne({
            campaignId,
            date: yesterdayDate,
            country: country || null,
        }).lean();
        // 获取 last_7d 数据（从 RawInsights）
        const dateObj = (0, dayjs_1.default)(date);
        const last7dStart = dateObj.subtract(6, 'day').format('YYYY-MM-DD');
        const last7dEnd = dateObj.format('YYYY-MM-DD');
        const last7dData = await RawInsights_1.default.aggregate([
            {
                $match: {
                    campaignId,
                    country: country || null,
                    date: { $gte: last7dStart, $lte: last7dEnd },
                    datePreset: 'last_7d',
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: { $ifNull: ['$purchase_value', 0] } },
                },
            },
        ]);
        const today = todayData?.purchase_value || 0;
        const yesterday = yesterdayData?.purchase_value || 0;
        const last7d = last7dData[0]?.total || 0;
        const corrected = todayData?.purchase_value_corrected || last7d || today;
        return {
            today,
            yesterday,
            last7d,
            corrected,
            lastUpdated: todayData?.updatedAt?.toISOString() || new Date().toISOString(),
        };
    }
    catch (error) {
        logger_1.default.error(`[Purchase Correction] Failed to get purchase value info:`, error);
        return {
            today: 0,
            yesterday: 0,
            last7d: 0,
            corrected: 0,
            lastUpdated: new Date().toISOString(),
        };
    }
};
exports.getPurchaseValueInfo = getPurchaseValueInfo;
/**
 * 批量修正多天的 Purchase 值
 */
const correctPurchaseValuesForDateRange = async (startDate, endDate) => {
    const start = (0, dayjs_1.default)(startDate);
    const end = (0, dayjs_1.default)(endDate);
    const dates = [];
    let current = start;
    while (current.isBefore(end) || current.isSame(end)) {
        dates.push(current.format('YYYY-MM-DD'));
        current = current.add(1, 'day');
    }
    logger_1.default.info(`[Purchase Correction] Correcting purchase values for ${dates.length} dates: ${startDate} to ${endDate}`);
    for (const date of dates) {
        try {
            await (0, exports.correctPurchaseValue)(date);
        }
        catch (error) {
            logger_1.default.error(`[Purchase Correction] Failed to correct date ${date}:`, error);
            // 继续处理其他日期
        }
    }
    logger_1.default.info(`[Purchase Correction] Completed correction for date range`);
};
exports.correctPurchaseValuesForDateRange = correctPurchaseValuesForDateRange;
