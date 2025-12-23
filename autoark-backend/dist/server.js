"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// 🔥 Must be first: load environment variables
require("./config/env");
const app_1 = __importDefault(require("./app"));
const db_1 = __importDefault(require("./config/db"));
const redis_1 = require("./config/redis");
const logger_1 = __importDefault(require("./utils/logger"));
const facebook_token_pool_1 = require("./services/facebook.token.pool");
// Queues & Workers
const facebook_queue_1 = require("./queue/facebook.queue");
const facebook_worker_1 = require("./queue/facebook.worker");
const bulkAd_worker_1 = require("./queue/bulkAd.worker");
const automation_worker_1 = require("./queue/automation.worker");
// Cron Jobs
const cron_1 = __importDefault(require("./cron"));
// V1 Sync 已废弃，改用 V2 Queue-based Sync
// import initSyncCron from './cron/sync.cron'
const sync_cron_v2_1 = __importDefault(require("./cron/sync.cron.v2"));
const preaggregation_cron_1 = __importDefault(require("./cron/preaggregation.cron"));
const tokenValidation_cron_1 = __importDefault(require("./cron/tokenValidation.cron"));
const PORT = process.env.PORT || 3001;
// Handle Uncaught Exceptions
process.on('uncaughtException', (err) => {
    logger_1.default.error('UNCAUGHT EXCEPTION! Shutting down...', err);
    process.exit(1);
});
// Handle Unhandled Rejections
process.on('unhandledRejection', (err) => {
    logger_1.default.error('UNHANDLED REJECTION! Shutting down...', err);
    // Ideally we should close the server gracefully, but process.exit is acceptable here
    process.exit(1);
});
async function bootstrap() {
    // 1) DB
    await (0, db_1.default)();
    // 2) Redis (optional)
    (0, redis_1.initRedis)();
    // 3) Token Pool
    facebook_token_pool_1.tokenPool.initialize().catch((error) => {
        logger_1.default.error('[Bootstrap] Failed to initialize token pool:', error);
    });
    // 4) Queues & Workers (only if Redis is configured)
    (0, facebook_queue_1.initQueues)();
    (0, facebook_worker_1.initWorkers)();
    (0, bulkAd_worker_1.initBulkAdWorker)();
    (0, automation_worker_1.initAutomationWorker)();
    // 5) Cron Jobs (start once per process)
    (0, cron_1.default)();
    // V2 Queue-based Sync（替代 V1 串行同步）
    (0, sync_cron_v2_1.default)();
    (0, preaggregation_cron_1.default)();
    (0, tokenValidation_cron_1.default)();
    // 6) HTTP Server
    app_1.default.listen(PORT, () => {
        logger_1.default.info(`AutoArk backend running on port ${PORT}`);
    });
}
bootstrap().catch((err) => {
    logger_1.default.error('[Bootstrap] Failed to start server:', err);
    process.exit(1);
});
