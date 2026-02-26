import type { ScreeningSummary } from '../screener'
import type { MarketBenchmark } from '../brain'

export interface GovernorDecision {
  riskLevel: 'low' | 'medium' | 'high'
  summary: string
  overrides: string[]
}

export function evaluateGlobalGuardrail(
  benchmarks: MarketBenchmark,
  actions: any[],
  screening: ScreeningSummary,
): GovernorDecision {
  const overrides: string[] = []
  const roas = benchmarks.weightedRoas || 0
  const autoCount = actions.filter((a: any) => a.auto).length

  let riskLevel: 'low' | 'medium' | 'high' = 'low'
  if (roas < 0.8) riskLevel = 'high'
  else if (roas < 1.0) riskLevel = 'medium'

  if (riskLevel === 'high') {
    overrides.push('ROAS低于硬阈值，暂停新增放量动作并优先止损')
    if (screening.watch > screening.needsDecision) {
      overrides.push('从观察池提取低风险素材小流量验证，避免无序扩量')
    }
  } else if (riskLevel === 'medium') {
    overrides.push('控制学习期广告占比，优先执行高确定性动作')
  }

  if (roas >= 1.0 && screening.needsDecision > 0 && autoCount === 0) {
    overrides.push('ROAS达标但自动动作偏少，可对高置信策略启用小比例自动执行')
  }

  const summary = riskLevel === 'high'
    ? `ROAS硬约束触发（${roas}），进入止损优先模式`
    : riskLevel === 'medium'
      ? `ROAS接近阈值（${roas}），进入稳健执行模式`
      : `ROAS健康（${roas}），按常规协同执行`

  return { riskLevel, summary, overrides }
}
