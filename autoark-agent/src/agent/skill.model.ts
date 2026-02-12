/**
 * Skill 系统 - 可插拔的策略模块
 * 不同产品/行业用不同的决策参数
 */
import mongoose from 'mongoose'

const skillSchema = new mongoose.Schema({
  name: { type: String, required: true },          // "iOS 游戏买量"
  description: String,

  // 匹配条件：什么 campaign 用这个 skill
  match: {
    packagePatterns: [String],   // ["*game*", "com.xxx.*"] 支持通配符
    platforms: [String],         // ["Facebook", "TikTok"]
    optimizers: [String],        // 空=全部
    accountIds: [String],        // 空=全部
  },

  // 阈值覆盖（覆盖 standards.ts 的 THRESHOLDS 默认值）
  thresholds: {
    observe_max_spend: Number,
    loss_severe_roas: Number,
    loss_severe_min_spend: Number,
    loss_mild_roas: Number,
    loss_mild_min_spend: Number,
    stable_good_roas_min: Number,
    high_potential_roas: Number,
    decline_drop_pct: Number,
  },

  // 额外上下文（注入到 LLM prompt）
  context: String,   // "这是游戏类App，回收周期通常7-14天..."

  // 特殊规则（自然语言，LLM 会参考）
  rules: [String],   // ["周末不关停", "CPI>$5 才算正常"]

  // 从经验中积累的知识
  learnedKnowledge: [String],

  // 统计
  stats: {
    totalDecisions: { type: Number, default: 0 },
    correctDecisions: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
  },

  isActive: { type: Boolean, default: true },
  priority: { type: Number, default: 0 }, // 匹配优先级，高的优先
}, { timestamps: true })

export const Skill = mongoose.model('AgentSkill', skillSchema)

/**
 * 匹配 campaign 到 skill
 */
export function matchCampaignToSkill(campaign: {
  pkgName?: string; platform?: string; optimizer?: string; accountId?: string
}, skills: any[]): any | null {
  for (const skill of skills.sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0))) {
    if (!skill.isActive) continue
    const m = skill.match || {}

    // 包名匹配（支持通配符）
    if (m.packagePatterns?.length > 0 && campaign.pkgName) {
      const matched = m.packagePatterns.some((p: string) => {
        const regex = new RegExp('^' + p.replace(/\*/g, '.*') + '$', 'i')
        return regex.test(campaign.pkgName!)
      })
      if (!matched) continue
    }

    // 平台匹配
    if (m.platforms?.length > 0 && campaign.platform) {
      if (!m.platforms.some((p: string) => campaign.platform!.toLowerCase().includes(p.toLowerCase()))) continue
    }

    // 优化师匹配
    if (m.optimizers?.length > 0 && campaign.optimizer) {
      if (!m.optimizers.includes(campaign.optimizer)) continue
    }

    // 账户匹配
    if (m.accountIds?.length > 0 && campaign.accountId) {
      if (!m.accountIds.includes(campaign.accountId)) continue
    }

    return skill
  }
  return null
}
