/**
 * Step 3: 分类标记 - 纯规则逻辑，不调 LLM
 * 给每个 campaign 打标签
 */
import { CampaignMetrics } from './analyzer'
import { CampaignLabel, THRESHOLDS, LABEL_NAMES } from './standards'
import { Skill, matchCampaignToSkill } from './skill.model'

export interface ClassifiedCampaign extends CampaignMetrics {
  label: CampaignLabel
  labelName: string
  labelReason: string
  skillName?: string
}

/**
 * 对每个 campaign 进行分类标记（支持 Skill 覆盖阈值）
 */
export async function classifyCampaigns(campaigns: CampaignMetrics[]): Promise<ClassifiedCampaign[]> {
  // 加载所有活跃 Skill
  let skills: any[] = []
  try {
    skills = await Skill.find({ isActive: true }).lean()
  } catch { /* Skill 集合不存在时不报错 */ }

  return campaigns.map(c => {
    // 匹配 Skill
    const skill = matchCampaignToSkill(
      { pkgName: c.pkgName, platform: c.platform, optimizer: c.optimizer, accountId: c.accountId },
      skills
    )

    // 合并阈值：Skill 覆盖默认值
    const thresholds = skill?.thresholds
      ? { ...THRESHOLDS, ...Object.fromEntries(Object.entries(skill.thresholds).filter(([, v]) => v != null)) }
      : THRESHOLDS

    const { label, reason } = classify(c, thresholds)
    return {
      ...c,
      label,
      labelName: LABEL_NAMES[label],
      labelReason: reason,
      skillName: skill?.name,
    }
  })
}

function classify(c: CampaignMetrics, T = THRESHOLDS): { label: CampaignLabel; reason: string } {

  // 1. 观察期：花费太少，数据不够
  if (c.totalSpend3d < T.observe_max_spend) {
    return { label: 'observing', reason: `总花费 $${c.totalSpend3d} < $${T.observe_max_spend}，数据不足` }
  }

  // 2. 亏损严重：ROAS 极低 + 持续
  if (c.avgRoas3d < T.loss_severe_roas && c.totalSpend3d >= T.loss_severe_min_spend) {
    // 检查是否连续多天
    const lowDays = c.dailyData.filter(d => d.spend > 5 && (d.spend > 0 ? d.roas : 0) < T.loss_severe_roas).length
    if (lowDays >= T.loss_severe_min_days) {
      return { label: 'loss_severe', reason: `ROAS ${c.avgRoas3d} < ${T.loss_severe_roas}，连续${lowDays}天，总花费 $${c.totalSpend3d}` }
    }
  }

  // 3. 衰退中：ROAS 曾好但持续下降
  if (c.dayBeforeRoas > T.stable_good_roas_min && c.roasTrend < -T.decline_drop_pct) {
    return { label: 'declining', reason: `ROAS 从 ${c.dayBeforeRoas} 降到 ${c.todayRoas}，下降 ${Math.abs(c.roasTrend)}%` }
  }
  if (c.yesterdayRoas > T.stable_good_roas_min && c.todayRoas < T.loss_mild_roas) {
    return { label: 'declining', reason: `ROAS 从昨日 ${c.yesterdayRoas} 骤降至今日 ${c.todayRoas}` }
  }

  // 4. 亏损轻微
  if (c.avgRoas3d < T.loss_mild_roas && c.totalSpend3d >= T.loss_mild_min_spend) {
    const lowDays = c.dailyData.filter(d => d.spend > 5 && (d.spend > 0 ? d.roas : 0) < T.loss_mild_roas).length
    if (lowDays >= T.loss_mild_min_days) {
      return { label: 'loss_mild', reason: `ROAS ${c.avgRoas3d} < ${T.loss_mild_roas}，连续${lowDays}天` }
    }
  }

  // 5. 高潜力：ROAS 非常好
  if (c.avgRoas3d >= T.high_potential_roas) {
    return { label: 'high_potential', reason: `ROAS ${c.avgRoas3d} >= ${T.high_potential_roas}` }
  }
  // 或者 ROAS 不错且上升趋势
  if (c.avgRoas3d >= T.high_potential_trend_roas && c.roasTrend > T.trend_up_pct) {
    return { label: 'high_potential', reason: `ROAS ${c.avgRoas3d} + 上升趋势 ${c.roasTrend}%` }
  }

  // 6. 稳定良好
  if (c.avgRoas3d >= T.stable_good_roas_min && c.avgRoas3d < T.stable_good_roas_max) {
    return { label: 'stable_good', reason: `ROAS ${c.avgRoas3d} 在 ${T.stable_good_roas_min}-${T.stable_good_roas_max} 之间` }
  }

  // 7. 默认：稳定一般
  return { label: 'stable_normal', reason: `ROAS ${c.avgRoas3d}，无显著趋势` }
}

/**
 * 生成分类汇总统计
 */
export function classifySummary(campaigns: ClassifiedCampaign[]): Record<CampaignLabel, number> {
  const counts: Record<string, number> = {}
  for (const c of campaigns) {
    counts[c.label] = (counts[c.label] || 0) + 1
  }
  return counts as any
}
