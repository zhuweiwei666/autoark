/**
 * 决策标准 - 抽象优秀优化师的决策逻辑为可配置的规则
 * 这是整个 Agent 的"大脑规则"，可以随时调整
 */

// ==================== Campaign 分类标签 ====================

export type CampaignLabel =
  | 'loss_severe'      // 亏损_严重
  | 'loss_mild'        // 亏损_轻微
  | 'observing'        // 观察期
  | 'stable_normal'    // 稳定_一般
  | 'stable_good'      // 稳定_良好
  | 'high_potential'   // 高潜力
  | 'declining'        // 衰退中

export const LABEL_NAMES: Record<CampaignLabel, string> = {
  loss_severe: '亏损严重',
  loss_mild: '亏损轻微',
  observing: '观察期',
  stable_normal: '稳定一般',
  stable_good: '稳定良好',
  high_potential: '高潜力',
  declining: '衰退中',
}

// ==================== 分类阈值（可配置）====================

export const THRESHOLDS = {
  // 亏损判断
  loss_severe_roas: 0.3,       // ROAS < 0.3 = 严重亏损
  loss_severe_min_spend: 50,   // 至少花了 $50 才判定
  loss_severe_min_days: 2,     // 连续 2 天

  loss_mild_roas: 0.8,         // ROAS < 0.8 = 轻微亏损
  loss_mild_min_spend: 30,
  loss_mild_min_days: 2,

  // 观察期
  observe_max_spend: 30,       // 花费 < $30 = 还在观察期

  // 稳定判断
  stable_good_roas_min: 1.5,   // 1.5 <= ROAS < 2.5 = 稳定良好
  stable_good_roas_max: 2.5,

  // 高潜力
  high_potential_roas: 2.5,    // ROAS >= 2.5 = 高潜力
  high_potential_trend_roas: 1.5, // ROAS > 1.5 + 上升趋势 = 高潜力

  // 衰退
  decline_drop_pct: 30,        // ROAS 下降 > 30% = 衰退
  decline_min_days: 2,

  // 趋势判断
  trend_up_pct: 10,            // 上升 > 10% 认为是上升趋势
  trend_down_pct: -10,         // 下降 > 10% 认为是下降趋势
}

// ==================== 执行规则 ====================

export const EXECUTION_RULES = {
  // 自动执行（不需要人审批）
  auto_pause: {
    labels: ['loss_severe'] as CampaignLabel[],
    also: [
      { condition: 'spend > 100 且 conversions === 0', description: '花费超 $100 零转化' },
    ],
  },

  // 需要审批的关停
  approve_pause: {
    labels: ['loss_mild'] as CampaignLabel[],
    min_days: 3, // 连续 3 天轻微亏损才建议关
    also_labels: ['declining'] as CampaignLabel[],
  },

  // 需要审批的加预算
  approve_increase: {
    labels: ['high_potential'] as CampaignLabel[],
    max_current_budget: 200,   // 当前日花费 < $200 才加
    increase_pct: { min: 20, max: 30 }, // 加 20-30%
    also: {
      labels: ['stable_good'] as CampaignLabel[],
      min_days: 3,
      increase_pct: { min: 10, max: 20 },
    },
  },

  // 不操作
  no_action: {
    labels: ['observing', 'stable_normal'] as CampaignLabel[],
    cooldown_hours: 24, // 最近 24h 操作过的不动
  },

  // 预算限制
  budget_limits: {
    max_single_change_pct: 30,   // 单次最多改 30%
    max_daily_budget: 500,       // 日预算上限 $500
    min_interval_hours: 24,      // 同一 campaign 24h 内最多操作一次
  },
}

// ==================== LLM 决策 Prompt ====================

export const DECISION_PROMPT = `你是一个广告投放决策引擎。你的输入是经过预处理和分类标记的 campaign 数据，你的输出是结构化的操作清单。

## 你收到的数据格式

每个 campaign 包含两部分数据：
1. **投放数据**（来自 TopTou API）：花费 spend、展示、点击、ROAS 趋势
2. **转化数据**（来自前端 BI）：安装量 installs、CPI、CPA、首日ROI、调整ROI、三日ROI、七日ROI、付费率、ARPU

**重要**：首日ROI 比当日 ROAS 更准确（因为包含了归因窗口内的转化）。决策时优先看 adjustedRoi（调整后首日ROI）。

每个 campaign 已经被标记为以下类别之一：
- loss_severe（亏损严重）: ROAS < ${THRESHOLDS.loss_severe_roas}，花费 > $${THRESHOLDS.loss_severe_min_spend}，连续${THRESHOLDS.loss_severe_min_days}天
- loss_mild（亏损轻微）: ROAS < ${THRESHOLDS.loss_mild_roas}，花费 > $${THRESHOLDS.loss_mild_min_spend}
- observing（观察期）: 花费 < $${THRESHOLDS.observe_max_spend}
- stable_normal（稳定一般）: ROAS 在 ${THRESHOLDS.loss_mild_roas}-${THRESHOLDS.stable_good_roas_min} 之间
- stable_good（稳定良好）: ROAS 在 ${THRESHOLDS.stable_good_roas_min}-${THRESHOLDS.stable_good_roas_max} 之间
- high_potential（高潜力）: ROAS >= ${THRESHOLDS.high_potential_roas} 或上升趋势
- declining（衰退中）: ROAS 持续下降 > ${THRESHOLDS.decline_drop_pct}%

## 决策规则

### 必须关停（auto: true）
- 标记为 loss_severe -> 立即暂停
- 花费 > $100 且 0 转化 -> 立即暂停

### 建议关停（auto: false，需审批）
- loss_mild 连续 3 天 -> 暂停
- declining 且无恢复迹象 -> 暂停

### 建议加预算（auto: false，需审批）
- high_potential 且日花费 < $200 -> 加 20-30%
- stable_good 连续 3 天 -> 加 10-20%

### 不操作
- observing -> 不动
- 24h 内操作过 -> 不动
- stable_normal -> 继续观察

### 预算规则
- 单次不超过 ${EXECUTION_RULES.budget_limits.max_single_change_pct}%
- 日预算上限 $${EXECUTION_RULES.budget_limits.max_daily_budget}
- 同一 campaign ${EXECUTION_RULES.budget_limits.min_interval_hours}h 内最多操作一次

## 输出格式（严格 JSON）

\`\`\`json
{
  "actions": [
    {
      "type": "pause",
      "campaignId": "campaign_id",
      "campaignName": "campaign_name",
      "accountId": "account_id",
      "reason": "具体原因",
      "auto": true
    },
    {
      "type": "increase_budget",
      "campaignId": "campaign_id",
      "campaignName": "campaign_name",
      "accountId": "account_id",
      "currentBudget": 100,
      "newBudget": 130,
      "reason": "具体原因",
      "auto": false
    }
  ],
  "summary": "简要总结",
  "alerts": ["异常告警"]
}
\`\`\`

## 重要
- 只输出 JSON，不要其他内容
- reason 要具体：包含 ROAS 数值、天数、趋势等
- 对 observing 的 campaign 不要做任何操作
- 如果没有需要操作的，actions 为空数组
`
