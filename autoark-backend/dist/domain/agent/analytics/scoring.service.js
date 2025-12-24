"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoringService = exports.ScoringService = void 0;
const trend_service_1 = require("./trend.service");
class ScoringService {
    /**
     * 综合评分入口
     * @param metrics 当前最近指标
     * @param sequence 历史指标序列 (用于计算斜率)
     * @param agentConfig Agent 配置
     * @param platform 平台标识 ('facebook' | 'tiktok')
     */
    async evaluate(metrics, sequence, agentConfig, platform = 'facebook') {
        const config = agentConfig.scoringConfig;
        const objectives = agentConfig.objectives;
        // 1. 确定生命周期阶段
        const stage = this.identifyStage(metrics.spend, config.stages);
        // 2. 计算各维度基础得分 (归一化到 0-100)
        // 对于 TikTok，我们可以应用稍微不同的标准化基准（如果未在 config 中指定）
        const baseScores = this.calculateBaseMetricScores(metrics, objectives, config.baselines);
        // 3. 应用权重矩阵得到阶段基础分
        let baseScore = 0;
        const metricContributions = {};
        // TikTok 特有的权重微调逻辑 (可以在这里硬编码一些专家建议)
        const effectiveWeights = { ...stage.weights };
        if (platform === 'tiktok') {
            // 专家建议：TikTok 启动期 HookRate 权重提高，成熟期看重完播率（此处简化，后续可在 UI 配置）
            if (stage.name === 'Cold Start' && effectiveWeights.hookRate != null) {
                effectiveWeights.hookRate *= 1.2;
                // 归一化权重以防溢出
                const sum = Object.values(effectiveWeights).reduce((a, b) => a + b, 0);
                for (const k in effectiveWeights)
                    effectiveWeights[k] /= sum;
            }
        }
        for (const [key, weight] of Object.entries(effectiveWeights)) {
            const score = baseScores[key] || 0;
            const contribution = score * weight;
            baseScore += contribution;
            metricContributions[key] = contribution;
        }
        // 4. 计算趋势动能增益 (Derivatives)
        const slopes = {};
        let momentumBonusTotal = 0;
        // 我们主要考察 CTR (升), CPA (降), ROAS (升) 的趋势
        const trendLookups = [
            { key: 'ctr', direction: 1 },
            { key: 'cpa', direction: -1 },
            { key: 'roas', direction: 1 },
            { key: 'hookRate', direction: 1 }, // 🆕
            { key: 'atcRate', direction: 1 }, // 🆕
        ];
        // TikTok 的趋势计算可能需要更强的平滑
        const emaAlpha = platform === 'tiktok' ? 0.2 : 0.3;
        for (const { key, direction } of trendLookups) {
            const seq = sequence[key];
            if (seq && seq.length >= 2) {
                const emaSeq = trend_service_1.trendService.calculateEMA(seq, emaAlpha);
                const slope = trend_service_1.trendService.calculateSlope(emaSeq);
                slopes[key] = slope;
                // 只有当该指标在当前阶段有权重时，才计算动能奖金
                if ((stage.weights[key] || 0) > 0) {
                    const multiplier = trend_service_1.trendService.getTrendMultiplier(slope, direction, config.momentumSensitivity || 0.1);
                    momentumBonusTotal += multiplier;
                }
            }
        }
        // 5. 最终合成得分
        // FinalScore = BaseScore * (1 + MomentumBonus)
        const finalScore = Math.max(0, Math.min(100, baseScore * (1 + momentumBonusTotal)));
        return {
            finalScore,
            baseScore,
            momentumBonus: momentumBonusTotal,
            stage: stage.name,
            metricContributions,
            slopes
        };
    }
    identifyStage(spend, stages) {
        for (const stage of stages) {
            if (spend >= stage.minSpend && spend < stage.maxSpend) {
                return stage;
            }
        }
        return stages[stages.length - 1]; // 默认成熟期
    }
    /**
     * 将原始指标转化为 0-100 的基准分
     */
    calculateBaseMetricScores(metrics, objectives, baselines) {
        return {
            // CPM: 越低越好。基准 $20 算 60 分。
            cpm: this.normalizeLowerIsBetter(metrics.cpm, baselines.cpm || 20),
            // CTR: 越高越好。基准 1% 算 60 分。
            ctr: this.normalizeHigherIsBetter(metrics.ctr, baselines.ctr || 0.01),
            // CPC: 越低越好。基准 $1 算 60 分。
            cpc: this.normalizeLowerIsBetter(metrics.cpc, baselines.cpc || 1),
            // CPA: 越低越好。以 targetCpa (或 maxCpa) 为 60 分。
            cpa: this.normalizeLowerIsBetter(metrics.cpa, objectives.maxCpa || 20),
            // ROAS: 越高越好。以 targetRoas 为 60 分。
            roas: this.normalizeHigherIsBetter(metrics.roas, objectives.targetRoas || 1.5),
            // Hook Rate: 越高越好
            hookRate: this.normalizeHigherIsBetter(metrics.hookRate, baselines.hookRate || 0.25),
            // ATC Rate: 越高越好
            atcRate: this.normalizeHigherIsBetter(metrics.atcRate, baselines.atcRate || 0.05),
        };
    }
    normalizeHigherIsBetter(val, baseline) {
        if (val === 0)
            return 0;
        if (baseline === 0)
            return 100;
        // val = baseline -> 60分
        // val = 2 * baseline -> 90分
        // val = 0.5 * baseline -> 30分
        return Math.min(100, (val / baseline) * 60);
    }
    normalizeLowerIsBetter(val, baseline) {
        if (val === 0)
            return 100;
        if (baseline === 0)
            return 0;
        // val = baseline -> 60分
        // val = 0.5 * baseline -> 90分
        // val = 2 * baseline -> 30分
        return Math.max(0, Math.min(100, (baseline / val) * 60));
    }
}
exports.ScoringService = ScoringService;
exports.scoringService = new ScoringService();
