"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = initTokenValidationCron;
const node_cron_1 = __importDefault(require("node-cron"));
const fbToken_validation_service_1 = require("../services/fbToken.validation.service");
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * 每小时检查一次所有 token 的状态
 * Cron 表达式：0 * * * * (每小时的第 0 分钟执行)
 */
function initTokenValidationCron() {
    const schedule = '0 * * * *'; // 每小时执行一次
    node_cron_1.default.schedule(schedule, async () => {
        logger_1.default.info('[Cron] Starting scheduled token validation...');
        try {
            await (0, fbToken_validation_service_1.checkAllTokensStatus)();
            logger_1.default.info('[Cron] Token validation completed');
        }
        catch (error) {
            logger_1.default.error('[Cron] Token validation failed:', error);
        }
    });
    logger_1.default.info(`[Cron] Token validation cron initialized with schedule: ${schedule}`);
}
