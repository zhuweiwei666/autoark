"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_cron_1 = __importDefault(require("node-cron"));
const schedule_1 = require("./schedule");
const fetchFacebookMetrics_1 = __importDefault(require("./fetchFacebookMetrics"));
const rules_1 = require("../rules");
const ai_1 = require("../ai");
const logger_1 = __importDefault(require("../utils/logger"));
const initCronJobs = () => {
    // Facebook Data Sync (Hourly)
    node_cron_1.default.schedule(schedule_1.SCHEDULES.FETCH_FB_HOURLY, () => {
        (0, fetchFacebookMetrics_1.default)().catch((err) => logger_1.default.error('Unhandled error in Facebook fetch cron', err));
    });
    // Rule Engine (Daily at 1 AM)
    node_cron_1.default.schedule('0 1 * * *', () => {
        (0, rules_1.runRulesDaily)().catch((err) => logger_1.default.error('Unhandled error in Rule Engine cron', err));
    });
    // AI Optimizer (Daily at 3 AM)
    node_cron_1.default.schedule('0 3 * * *', () => {
        (0, ai_1.runAiOptimizerDaily)().catch((err) => logger_1.default.error('Unhandled error in AI Optimizer cron', err));
    });
    logger_1.default.info('Cron jobs initialized');
};
exports.default = initCronJobs;
