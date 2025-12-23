"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initRuleCron = initRuleCron;
const node_cron_1 = __importDefault(require("node-cron"));
const logger_1 = __importDefault(require("../utils/logger"));
const rule_service_1 = require("../services/rule.service");
const AutoRule_1 = require("../models/AutoRule");
/**
 * 🤖 规则引擎定时任务
 *
 * 调度策略：
 * - 每小时执行：所有 schedule.type = 'hourly' 的规则
 * - 每天执行：所有 schedule.type = 'daily' 的规则（北京时间 8:00）
 * - 自定义：根据规则的 cron 表达式执行
 */
function initRuleCron() {
    // 每小时执行一次（整点）
    node_cron_1.default.schedule('0 * * * *', async () => {
        logger_1.default.info('[RuleCron] Running hourly rules...');
        try {
            const hourlyRules = await AutoRule_1.AutoRule.find({
                status: 'active',
                'schedule.type': 'hourly'
            });
            for (const rule of hourlyRules) {
                try {
                    await rule_service_1.ruleService.executeRule(rule._id.toString());
                }
                catch (error) {
                    logger_1.default.error(`[RuleCron] Hourly rule ${rule.name} failed: ${error.message}`);
                }
            }
            logger_1.default.info(`[RuleCron] Hourly execution completed: ${hourlyRules.length} rules`);
        }
        catch (error) {
            logger_1.default.error(`[RuleCron] Hourly execution failed: ${error.message}`);
        }
    });
    // 每天早上 8 点执行（北京时间）
    node_cron_1.default.schedule('0 0 * * *', async () => {
        logger_1.default.info('[RuleCron] Running daily rules...');
        try {
            const dailyRules = await AutoRule_1.AutoRule.find({
                status: 'active',
                'schedule.type': 'daily'
            });
            for (const rule of dailyRules) {
                try {
                    await rule_service_1.ruleService.executeRule(rule._id.toString());
                }
                catch (error) {
                    logger_1.default.error(`[RuleCron] Daily rule ${rule.name} failed: ${error.message}`);
                }
            }
            logger_1.default.info(`[RuleCron] Daily execution completed: ${dailyRules.length} rules`);
        }
        catch (error) {
            logger_1.default.error(`[RuleCron] Daily execution failed: ${error.message}`);
        }
    }, {
        timezone: 'Asia/Shanghai'
    });
    logger_1.default.info('[RuleCron] Rule cron initialized (hourly + daily schedules)');
}
exports.default = { initRuleCron };
