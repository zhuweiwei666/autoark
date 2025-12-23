import { trendService } from './trend.service'
import logger from '../../../utils/logger'

export interface MetricData {
  cpm: number
  ctr: number
  cpc: number
  cpa: number
  roas: number
  spend: number
}

export interface MetricSequence {
  cpm: number[]
  ctr: number[]
  cpc: number[]
  cpa: number[]
  roas: number[]
}

export interface ScoringResult {
  finalScore: number
  baseScore: number
  momentumBonus: number
  stage: string
  metricContributions: Record<string, number>
  slopes: Record<string, number>
}

export class ScoringService {
  /**
   * 综合评分入口
   * @param metrics 当前最近指标
   * @param sequence 历史指标序列 (用于计算斜率)
   * @param agentConfig Agent 配置
   */
  async evaluate(
    metrics: MetricData,
    sequence: MetricSequence,
    agentConfig: any
  ): Promise<ScoringResult> {
    const config = agentConfig.scoringConfig
    const objectives = agentConfig.objectives
    
    // 1. 确定生命周期阶段
    const stage = this.identifyStage(metrics.spend, config.stages)
    
    // 2. 计算各维度基础得分 (归一化到 0-100)
    const baseScores = this.calculateBaseMetricScores(metrics, objectives, config.baselines)
    
    // 3. 应用权重矩阵得到阶段基础分
    let baseScore = 0
    const metricContributions: Record<string, number> = {}
    
    for (const [key, weight] of Object.entries(stage.weights)) {
      const score = baseScores[key as keyof typeof baseScores] || 0
      const contribution = score * (weight as number)
      baseScore += contribution
      metricContributions[key] = contribution
    }
    
    // 4. 计算趋势动能增益 (Derivatives)
    const slopes: Record<string, number> = {}
    let momentumBonusTotal = 0
    
    // 我们主要考察 CTR (升), CPA (降), ROAS (升) 的趋势
    const trendLookups: Array<{ key: keyof MetricSequence; direction: 1 | -1 }> = [
      { key: 'ctr', direction: 1 },
      { key: 'cpa', direction: -1 },
      { key: 'roas', direction: 1 },
    ]
    
    for (const { key, direction } of trendLookups) {
      const seq = sequence[key]
      if (seq && seq.length >= 2) {
        const emaSeq = trendService.calculateEMA(seq)
        const slope = trendService.calculateSlope(emaSeq)
        slopes[key] = slope
        
        // 只有当该指标在当前阶段有权重时，才计算动能奖金
        if ((stage.weights[key] || 0) > 0) {
          const multiplier = trendService.getTrendMultiplier(
            slope, 
            direction, 
            config.momentumSensitivity || 0.1
          )
          momentumBonusTotal += multiplier
        }
      }
    }
    
    // 5. 最终合成得分
    // FinalScore = BaseScore * (1 + MomentumBonus)
    const finalScore = Math.max(0, Math.min(100, baseScore * (1 + momentumBonusTotal)))
    
    return {
      finalScore,
      baseScore,
      momentumBonus: momentumBonusTotal,
      stage: stage.name,
      metricContributions,
      slopes
    }
  }

  private identifyStage(spend: number, stages: any[]): any {
    for (const stage of stages) {
      if (spend >= stage.minSpend && spend < stage.maxSpend) {
        return stage
      }
    }
    return stages[stages.length - 1] // 默认成熟期
  }

  /**
   * 将原始指标转化为 0-100 的基准分
   */
  private calculateBaseMetricScores(metrics: MetricData, objectives: any, baselines: any) {
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
    }
  }

  private normalizeHigherIsBetter(val: number, baseline: number): number {
    if (val === 0) return 0
    if (baseline === 0) return 100
    // val = baseline -> 60分
    // val = 2 * baseline -> 90分
    // val = 0.5 * baseline -> 30分
    return Math.min(100, (val / baseline) * 60)
  }

  private normalizeLowerIsBetter(val: number, baseline: number): number {
    if (val === 0) return 100
    if (baseline === 0) return 0
    // val = baseline -> 60分
    // val = 0.5 * baseline -> 90分
    // val = 2 * baseline -> 30分
    return Math.max(0, Math.min(100, (baseline / val) * 60))
  }
}

export const scoringService = new ScoringService()
