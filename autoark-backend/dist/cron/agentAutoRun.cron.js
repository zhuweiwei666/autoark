"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAgentAutoRunCron = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const dayjs_1 = __importDefault(require("dayjs"));
const logger_1 = __importDefault(require("../utils/logger"));
const agent_model_1 = require("../domain/agent/agent.model");
const automationJob_service_1 = require("../services/automationJob.service");
/**
 * Agent 自动运行调度器
 * - 负责按 AgentConfig.schedule.checkInterval 触发 Planner/Executor（runAgentAsJobs）
 * - 通过幂等 key 避免同一时间窗重复入队
 */
const initAgentAutoRunCron = () => {
    // Every 5 minutes
    node_cron_1.default.schedule('*/5 * * * *', async () => {
        try {
            const now = (0, dayjs_1.default)();
            const agents = await agent_model_1.AgentConfig.find({
                status: 'active',
                mode: 'auto',
            }).lean();
            if (!agents.length)
                return;
            for (const agent of agents) {
                const checkIntervalMin = Math.max(5, Number(agent.schedule?.checkInterval || 30));
                const lastRunAt = agent.runtime?.lastRunAt ? (0, dayjs_1.default)(agent.runtime.lastRunAt) : null;
                if (lastRunAt && now.diff(lastRunAt, 'minute') < checkIntervalMin) {
                    continue;
                }
                // Active hours 护栏（使用服务器时区；如需严格时区可后续接入 dayjs-timezone）
                const hour = now.hour();
                const start = Number(agent.schedule?.activeHours?.start ?? 0);
                const end = Number(agent.schedule?.activeHours?.end ?? 24);
                if (!(hour >= start && hour < end)) {
                    continue;
                }
                // 以 5 分钟 bucket 做幂等，避免重复入队
                const bucket = now.startOf('minute').minute(Math.floor(now.minute() / 5) * 5);
                const idempotencyKey = `agent:${agent._id.toString()}:${bucket.format('YYYYMMDDHHmm')}`;
                await (0, automationJob_service_1.createAutomationJob)({
                    type: 'RUN_AGENT_AS_JOBS',
                    payload: { agentId: agent._id.toString() },
                    agentId: agent._id.toString(),
                    organizationId: agent.organizationId,
                    createdBy: agent.createdBy,
                    idempotencyKey,
                    priority: 10,
                });
            }
        }
        catch (e) {
            logger_1.default.error('[AgentAutoRunCron] Unhandled error:', e?.message || e);
        }
    });
    logger_1.default.info('[AgentAutoRunCron] Initialized (every 5 minutes)');
};
exports.initAgentAutoRunCron = initAgentAutoRunCron;
