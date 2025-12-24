"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initTiktokSyncCron = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const logger_1 = __importDefault(require("../utils/logger"));
const tiktok_sync_service_1 = require("../services/tiktok.sync.service");
/**
 * TikTok 资产同步定时任务 (Hourly)
 */
const initTiktokSyncCron = () => {
    // 每小时执行一次同步
    node_cron_1.default.schedule('0 * * * *', async () => {
        try {
            logger_1.default.info('[TiktokSyncCron] Starting scheduled sync');
            await (0, tiktok_sync_service_1.runTiktokFullSync)();
        }
        catch (error) {
            logger_1.default.error('[TiktokSyncCron] Scheduled sync failed:', error.message);
        }
    });
    // 启动时立即执行一次同步
    (0, tiktok_sync_service_1.runTiktokFullSync)().catch(err => {
        logger_1.default.error('[TiktokSyncCron] Initial sync failed:', err.message);
    });
};
exports.initTiktokSyncCron = initTiktokSyncCron;
