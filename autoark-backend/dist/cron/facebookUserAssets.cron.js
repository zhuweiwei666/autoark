"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initFacebookUserAssetsCron = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const logger_1 = __importDefault(require("../utils/logger"));
const FbToken_1 = __importDefault(require("../models/FbToken"));
const facebookUser_service_1 = require("../services/facebookUser.service");
/**
 * FacebookUser 资产同步（Pixels/Pages/Catalogs/AdAccounts）
 * - 用于让“资产选择”基本不依赖实时拉取，提升速度与稳定性
 * - 频率不宜过高，避免触发 Graph API 限流
 */
const initFacebookUserAssetsCron = () => {
    // Every 6 hours
    node_cron_1.default.schedule('0 */6 * * *', async () => {
        try {
            const tokens = await FbToken_1.default.find({ status: 'active' }).lean();
            if (!tokens.length)
                return;
            logger_1.default.info(`[FacebookUserCron] Start syncing assets for ${tokens.length} tokens`);
            // 简单分批并行，避免一次性打爆 API
            const batchSize = 3;
            for (let i = 0; i < tokens.length; i += batchSize) {
                const batch = tokens.slice(i, i + batchSize);
                await Promise.all(batch.map(async (t) => {
                    if (!t.fbUserId || !t.token)
                        return;
                    try {
                        await (0, facebookUser_service_1.syncFacebookUserAssets)(t.fbUserId, t.token, String(t._id));
                    }
                    catch (e) {
                        logger_1.default.warn(`[FacebookUserCron] Sync failed for token ${t._id}: ${e?.message || e}`);
                    }
                }));
            }
            logger_1.default.info('[FacebookUserCron] Assets sync finished');
        }
        catch (e) {
            logger_1.default.error('[FacebookUserCron] Unhandled error:', e?.message || e);
        }
    });
};
exports.initFacebookUserAssetsCron = initFacebookUserAssetsCron;
