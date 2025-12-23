"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAccountSyncCron = initAccountSyncCron;
const node_cron_1 = __importDefault(require("node-cron"));
const logger_1 = __importDefault(require("../utils/logger"));
const facebook_accounts_service_1 = require("../services/facebook.accounts.service");
/**
 * 📊 账户同步定时任务
 *
 * - 每小时同步一次所有 token 下的广告账户
 * - 启动时立即执行一次同步
 */
function initAccountSyncCron() {
    // 每小时整点同步账户
    node_cron_1.default.schedule('0 * * * *', async () => {
        logger_1.default.info('[AccountSyncCron] Starting scheduled account sync...');
        try {
            const result = await (0, facebook_accounts_service_1.syncAccountsFromTokens)();
            logger_1.default.info(`[AccountSyncCron] Sync completed. Synced: ${result.syncedCount}, Errors: ${result.errorCount}`);
        }
        catch (error) {
            logger_1.default.error('[AccountSyncCron] Sync failed:', error.message);
        }
    });
    // 启动时立即执行一次同步（延迟 30 秒，等待数据库连接稳定）
    setTimeout(async () => {
        logger_1.default.info('[AccountSyncCron] Running initial account sync...');
        try {
            const result = await (0, facebook_accounts_service_1.syncAccountsFromTokens)();
            logger_1.default.info(`[AccountSyncCron] Initial sync completed. Synced: ${result.syncedCount}, Errors: ${result.errorCount}`);
        }
        catch (error) {
            logger_1.default.error('[AccountSyncCron] Initial sync failed:', error.message);
        }
    }, 30000);
    logger_1.default.info('[AccountSyncCron] Account sync cron initialized (hourly + on startup)');
}
exports.default = { initAccountSyncCron };
