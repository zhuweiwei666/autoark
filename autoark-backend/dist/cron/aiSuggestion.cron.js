"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAiSuggestionCron = initAiSuggestionCron;
const node_cron_1 = __importDefault(require("node-cron"));
const logger_1 = __importDefault(require("../utils/logger"));
const aiSuggestion_service_1 = require("../services/aiSuggestion.service");
/**
 * 🤖 AI 建议定时任务
 *
 * - 每小时生成新的优化建议
 * - 每天清理过期建议
 */
function initAiSuggestionCron() {
    // 每小时整点生成建议
    node_cron_1.default.schedule('0 * * * *', async () => {
        logger_1.default.info('[AiSuggestionCron] Generating suggestions...');
        try {
            const suggestions = await aiSuggestion_service_1.aiSuggestionService.generateSuggestions();
            logger_1.default.info(`[AiSuggestionCron] Generated ${suggestions.length} suggestions`);
        }
        catch (error) {
            logger_1.default.error('[AiSuggestionCron] Generate failed:', error.message);
        }
    });
    // 每天凌晨 2 点清理过期建议
    node_cron_1.default.schedule('0 2 * * *', async () => {
        logger_1.default.info('[AiSuggestionCron] Cleaning up expired suggestions...');
        try {
            const count = await aiSuggestion_service_1.aiSuggestionService.cleanupExpired();
            logger_1.default.info(`[AiSuggestionCron] Cleaned up ${count} expired suggestions`);
        }
        catch (error) {
            logger_1.default.error('[AiSuggestionCron] Cleanup failed:', error.message);
        }
    }, {
        timezone: 'Asia/Shanghai'
    });
    logger_1.default.info('[AiSuggestionCron] AI suggestion cron initialized (hourly generation, daily cleanup)');
}
exports.default = { initAiSuggestionCron };
