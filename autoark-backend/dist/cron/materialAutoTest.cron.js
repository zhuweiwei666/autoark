"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initMaterialAutoTestCron = initMaterialAutoTestCron;
const node_cron_1 = __importDefault(require("node-cron"));
const logger_1 = __importDefault(require("../utils/logger"));
const materialAutoTest_service_1 = require("../services/materialAutoTest.service");
/**
 * 🧪 素材自动测试定时任务
 * 每 10 分钟检查一次新上传的素材
 */
function initMaterialAutoTestCron() {
    // 每 10 分钟执行一次
    node_cron_1.default.schedule('*/10 * * * *', async () => {
        logger_1.default.info('[MaterialAutoTestCron] Checking new materials...');
        try {
            await materialAutoTest_service_1.materialAutoTestService.checkNewMaterials();
            logger_1.default.info('[MaterialAutoTestCron] Check completed');
        }
        catch (error) {
            logger_1.default.error('[MaterialAutoTestCron] Check failed:', error.message);
        }
    });
    logger_1.default.info('[MaterialAutoTestCron] Material auto test cron initialized (runs every 10 minutes)');
}
exports.default = { initMaterialAutoTestCron };
