/**
 * 预置 Skill 数据
 * 首次启动时写入 MongoDB（已存在则跳过）
 */
import { Skill } from './skill.model'
import { log } from '../platform/logger'

const SCREENER_SEEDS = [
  {
    name: '冷启动保护',
    agentId: 'screener',
    description: '花费过低的 campaign 数据不足以做任何判断，直接跳过',
    screening: {
      conditions: [{ field: 'todaySpend', operator: '<', value: 5 }],
      conditionLogic: 'AND',
      verdict: 'skip',
      priority: 'low',
      reasonTemplate: '花费 ${todaySpend} < $5，数据不足',
    },
    order: 10,
  },
  {
    name: '数据不足跳过',
    agentId: 'screener',
    description: '数据置信度极低，跳过',
    screening: {
      conditions: [{ field: 'confidence', operator: '<', value: 0.3 }],
      conditionLogic: 'AND',
      verdict: 'skip',
      priority: 'low',
      reasonTemplate: '数据置信度 {confidence} < 0.3，跳过',
    },
    order: 20,
  },
  {
    name: '已有待处理操作',
    agentId: 'screener',
    description: '24h 内已有 pending 操作的 campaign 不重复处理',
    screening: {
      conditions: [{ field: 'hasPendingAction', operator: '==', value: 1 }],
      conditionLogic: 'AND',
      verdict: 'skip',
      priority: 'low',
      reasonTemplate: '已有待处理操作，跳过',
    },
    order: 30,
  },
  {
    name: '花费飙升检测',
    agentId: 'screener',
    description: '今日花费相比昨日飙升超过 100%，需要紧急关注',
    screening: {
      conditions: [
        { field: 'spendTrend', operator: '>', value: 100 },
        { field: 'todaySpend', operator: '>', value: 20 },
      ],
      conditionLogic: 'AND',
      verdict: 'needs_decision',
      priority: 'critical',
      reasonTemplate: '花费飙升 {spendTrend}%，今日花费 ${todaySpend}',
    },
    order: 40,
  },
  {
    name: 'ROI 暴跌检测',
    agentId: 'screener',
    description: 'ROI 相比昨天暴跌超过 50%，紧急关注',
    screening: {
      conditions: [
        { field: 'roiDropVsYesterday', operator: '>', value: 50 },
        { field: 'todaySpend', operator: '>', value: 30 },
      ],
      conditionLogic: 'AND',
      verdict: 'needs_decision',
      priority: 'critical',
      reasonTemplate: 'ROI 暴跌 {roiDropVsYesterday}%（vs 昨日），花费 ${todaySpend}',
    },
    order: 50,
  },
  {
    name: '严重亏损识别',
    agentId: 'screener',
    description: '花费较高但 ROI 极低，严重亏损需立即处理',
    screening: {
      conditions: [
        { field: 'todaySpend', operator: '>', value: 50 },
        { field: 'adjustedRoi', operator: '<', value: 0.3 },
      ],
      conditionLogic: 'AND',
      verdict: 'needs_decision',
      priority: 'critical',
      reasonTemplate: 'ROAS {adjustedRoi} < 0.3，花费 ${todaySpend}，严重亏损',
    },
    order: 60,
  },
  {
    name: '零转化告警',
    agentId: 'screener',
    description: '花费超过 $100 但没有任何安装/转化',
    screening: {
      conditions: [
        { field: 'todaySpend', operator: '>', value: 100 },
        { field: 'installs', operator: '==', value: 0 },
      ],
      conditionLogic: 'AND',
      verdict: 'needs_decision',
      priority: 'high',
      reasonTemplate: '花费 ${todaySpend} 零转化',
    },
    order: 70,
  },
  {
    name: '轻微亏损关注',
    agentId: 'screener',
    description: '花费中等但 ROI 不达标，需要关注',
    screening: {
      conditions: [
        { field: 'todaySpend', operator: '>', value: 30 },
        { field: 'adjustedRoi', operator: '<', value: 0.8 },
      ],
      conditionLogic: 'AND',
      verdict: 'needs_decision',
      priority: 'normal',
      reasonTemplate: 'ROAS {adjustedRoi} < 0.8，花费 ${todaySpend}，轻微亏损',
    },
    order: 80,
  },
  {
    name: '高潜力发现',
    agentId: 'screener',
    description: 'ROI 非常好的 campaign，可考虑扩量',
    screening: {
      conditions: [
        { field: 'adjustedRoi', operator: '>', value: 2.5 },
        { field: 'todaySpend', operator: '>', value: 30 },
      ],
      conditionLogic: 'AND',
      verdict: 'needs_decision',
      priority: 'normal',
      reasonTemplate: 'ROAS {adjustedRoi} > 2.5，花费 ${todaySpend}，高潜力',
    },
    order: 90,
  },
  {
    name: 'ROAS 上升趋势',
    agentId: 'screener',
    description: 'ROI 不错且上升趋势，值得关注扩量',
    screening: {
      conditions: [
        { field: 'adjustedRoi', operator: '>', value: 1.5 },
        { field: 'roasTrend', operator: '>', value: 10 },
      ],
      conditionLogic: 'AND',
      verdict: 'needs_decision',
      priority: 'low',
      reasonTemplate: 'ROAS {adjustedRoi} 上升趋势 +{roasTrend}%',
    },
    order: 100,
  },
  {
    name: '历史偏离检测',
    agentId: 'screener',
    description: '有一定花费但当前指标偏离自身历史均值，可能需关注',
    screening: {
      conditions: [{ field: 'todaySpend', operator: '>', value: 20 }],
      conditionLogic: 'AND',
      verdict: 'watch',
      priority: 'normal',
      reasonTemplate: '花费 ${todaySpend}，待历史比对',
      historyCheck: {
        enabled: true,
        field: 'adjustedRoi',
        windowDays: 7,
        deviationStddev: 2,
      },
    },
    order: 110,
  },
  {
    name: '持续低于大盘',
    agentId: 'screener',
    description: 'ROI 持续低于全公司 P25 水平线',
    screening: {
      conditions: [
        { field: 'belowBenchmarkP25', operator: '==', value: 1 },
        { field: 'todaySpend', operator: '>', value: 30 },
      ],
      conditionLogic: 'AND',
      verdict: 'needs_decision',
      priority: 'normal',
      reasonTemplate: 'ROAS {adjustedRoi} 低于大盘 P25，花费 ${todaySpend}',
    },
    order: 120,
  },
]

const DECISION_SEEDS = [
  {
    name: '严重亏损止损',
    agentId: 'decision',
    description: '严重亏损的 campaign 自动暂停止损',
    decision: {
      triggerLabels: ['loss_severe'],
      conditions: [],
      conditionLogic: 'AND',
      action: 'pause',
      auto: true,
      params: { budgetChangePct: 0 },
      reasonTemplate: '严重亏损: ROAS {avgRoas3d}，3日花费 ${totalSpend3d}，立即暂停',
      llmContext: '严重亏损的 campaign 通常回收无望，果断止损是最优策略。',
      llmRules: [
        '连续 2 天 ROAS < 0.3 说明素材/受众不行',
        '不要对新 campaign（< 24h）轻易判亏损',
      ],
    },
    order: 10,
  },
  {
    name: '零转化止损',
    agentId: 'decision',
    description: '花费高但零转化，自动暂停',
    decision: {
      triggerLabels: [],
      conditions: [
        { field: 'todayConversions', operator: '==', value: 0 },
        { field: 'totalSpend3d', operator: '>', value: 100 },
      ],
      conditionLogic: 'AND',
      action: 'pause',
      auto: true,
      params: { budgetChangePct: 0 },
      reasonTemplate: '花费 ${totalSpend3d} 零转化，立即暂停',
      llmContext: '零转化通常意味着 tracking 问题或受众完全不匹配。',
      llmRules: ['排除 tracking 延迟（2-4h 内可能还没回传）'],
    },
    order: 20,
  },
  {
    name: '轻微亏损暂停',
    agentId: 'decision',
    description: '轻微亏损建议暂停，需审批',
    decision: {
      triggerLabels: ['loss_mild'],
      conditions: [],
      conditionLogic: 'AND',
      action: 'pause',
      auto: false,
      params: { budgetChangePct: 0 },
      reasonTemplate: '轻微亏损: ROAS {avgRoas3d}，建议暂停观察',
      llmContext: '轻微亏损的 campaign 可能只是暂时波动，也可能真的不行。',
      llmRules: [
        '如果连续 3 天 ROAS < 0.8 再暂停',
        '如果有上升趋势，可以再观察 1 天',
      ],
    },
    order: 30,
  },
  {
    name: '衰退暂停',
    agentId: 'decision',
    description: '曾经好但持续衰退的 campaign，建议暂停',
    decision: {
      triggerLabels: ['declining'],
      conditions: [],
      conditionLogic: 'AND',
      action: 'pause',
      auto: false,
      params: { budgetChangePct: 0 },
      reasonTemplate: '衰退中: {labelReason}，建议暂停',
      llmContext: '衰退通常因素材疲劳或受众饱和导致。',
      llmRules: [
        '如果 ROAS 仍 > 1.0 可以降预算而非暂停',
        '周末衰退可能是正常波动',
      ],
    },
    order: 40,
  },
  {
    name: '高潜力扩量',
    agentId: 'decision',
    description: 'ROAS 高且稳定的 campaign，建议加预算',
    decision: {
      triggerLabels: ['high_potential'],
      conditions: [{ field: 'estimatedDailySpend', operator: '<', value: 200 }],
      conditionLogic: 'AND',
      action: 'increase_budget',
      auto: false,
      params: { budgetChangePct: 25 },
      reasonTemplate: '高潜力: ROAS {avgRoas3d}，建议加预算 25%',
      llmContext: '高潜力的 campaign 应抓紧扩量窗口。',
      llmRules: [
        '单次加预算不超过 30%',
        '日花费超过 $200 后扩量效果递减',
      ],
    },
    order: 50,
  },
  {
    name: '稳定良好扩量',
    agentId: 'decision',
    description: 'ROAS 稳定良好的 campaign，保守加预算',
    decision: {
      triggerLabels: ['stable_good'],
      conditions: [{ field: 'estimatedDailySpend', operator: '<', value: 200 }],
      conditionLogic: 'AND',
      action: 'increase_budget',
      auto: false,
      params: { budgetChangePct: 15 },
      reasonTemplate: '稳定良好: ROAS {avgRoas3d}，建议加预算 15%',
      llmContext: '稳定良好的 campaign 小幅扩量风险较低。',
      llmRules: [
        '需连续 3 天稳定良好再加',
        '加预算后密切关注 ROAS 变化',
      ],
    },
    order: 60,
  },
]

/**
 * 初始化预置 Skills（幂等：同名跳过）
 */
export async function seedSkills(): Promise<void> {
  const all = [...SCREENER_SEEDS, ...DECISION_SEEDS]
  let created = 0

  for (const seed of all) {
    const exists = await Skill.findOne({ name: seed.name, agentId: seed.agentId })
    if (exists) continue
    await Skill.create({ ...seed, enabled: true })
    created++
  }

  if (created > 0) {
    log.info(`[SkillSeeds] Created ${created} preset skills (${SCREENER_SEEDS.length} screener + ${DECISION_SEEDS.length} decision)`)
  }
}
