/**
 * 预置 Skill 种子数据（V2 经验体系）
 *
 * Skills = Agent 的进化记忆，分类型：
 * - config: A1 基础配置
 * - experience: 自然语言经验（给 LLM 做 context）
 * - goal: A4 产品目标约束
 * - meta: A5 元规则
 * - rule: 硬护栏（少量，不可绕过）
 */
import { Skill } from './skill.model'
import { log } from '../platform/logger'

const SEEDS = [
  // ==================== A1 数据融合：配置 + 数据经验 ====================
  {
    name: 'A1 优化师范围',
    agentId: 'a1_fusion',
    skillType: 'config',
    description: '控制数据融合覆盖哪些优化师',
    config: { key: 'optimizers', value: ['wwz'] },
    order: 1,
  },
  {
    name: 'A1 数据源配置',
    agentId: 'a1_fusion',
    skillType: 'config',
    description: '数据源开关与优先级',
    config: { key: 'sources', value: { facebook: true, metabase: true, toptou: false, spend_priority: 'facebook', roas_priority: 'metabase' } },
    order: 2,
  },
  {
    name: 'A1 凌晨归因延迟',
    agentId: 'a1_fusion',
    skillType: 'experience',
    description: '凌晨数据可信度经验',
    experience: {
      scenario: '凌晨 0-6 点（北京时间）查看 Metabase ROAS 数据',
      outcome: 'ROAS 显示为 0 或极低，但 6 小时后归因数据回来后 ROAS 正常',
      lesson: '此时段 Metabase 的 ROAS 数据归因延迟严重，应降低 ROAS 置信度，不要基于此时段 ROAS 做关停决策',
      confidence: 0.9,
      validatedCount: 10,
      source: 'human',
    },
    order: 10,
  },
  {
    name: 'A1 新广告花费跳变',
    agentId: 'a1_fusion',
    skillType: 'experience',
    description: '新 campaign 前端数据波动经验',
    experience: {
      scenario: 'Campaign 刚创建前 2 小时，FB 花费数据出现跳变或突然归零',
      outcome: '等稳定后花费恢复正常',
      lesson: '新 campaign 前 2 小时 FB 花费数据可能跳变，此期间应降低花费可信度，等下一轮再采信',
      confidence: 0.8,
      validatedCount: 5,
      source: 'human',
    },
    order: 11,
  },
  {
    name: 'A1 跨源花费偏差',
    agentId: 'a1_fusion',
    skillType: 'experience',
    description: 'FB 和 Metabase 花费偏差经验',
    experience: {
      scenario: 'FB API 花费和 Metabase 花费偏差超过 40%',
      outcome: '通常是 FB 有短暂延迟，下一轮数据趋同',
      lesson: '花费偏差大时大概率是 FB 延迟，不要因此判断数据异常，等一轮观察',
      confidence: 0.75,
      validatedCount: 3,
      source: 'human',
    },
    order: 12,
  },

  // ==================== A2 决策分析：场景-结果-教训 ====================
  {
    name: 'A2 低ROAS高付费率',
    agentId: 'a2_decision',
    skillType: 'experience',
    description: '首日ROAS低但付费率高的 campaign 判断经验',
    experience: {
      scenario: 'Campaign 首日 ROAS 低于 0.5，但付费率超过 15%',
      outcome: '这类 campaign 70% 概率在第 3 天回本',
      lesson: '不要急停，付费率高说明用户质量好但归因还没完全到位，建议观察到 day3 再决策',
      confidence: 0.78,
      validatedCount: 8,
      source: 'human',
    },
    order: 20,
  },
  {
    name: 'A2 连续衰退趋势',
    agentId: 'a2_decision',
    skillType: 'experience',
    description: '花费上升但 ROAS 持续下降的处理经验',
    experience: {
      scenario: '花费连续 3 轮上升但 ROAS 连续下降超过 30%',
      outcome: '衰退趋势确认，继续投放会加速亏损',
      lesson: '衰退趋势确认后应该先控预算（降 30%）而非直接关停，给广告一个缓冲期观察是否企稳',
      confidence: 0.82,
      validatedCount: 6,
      source: 'human',
    },
    order: 21,
  },
  {
    name: 'A2 新广告零转化',
    agentId: 'a2_decision',
    skillType: 'experience',
    description: '新 campaign 前几小时零转化的判断',
    experience: {
      scenario: '新 campaign 前 4 小时花费 $20+ 但零转化',
      outcome: '60% 是归因延迟（2-4 小时后转化数据到达），40% 确实是素材问题',
      lesson: '花费 < $50 且运行 < 6 小时的零转化不急停，标记观察等归因；花费 > $50 仍零转化则大概率是素材问题',
      confidence: 0.7,
      validatedCount: 5,
      source: 'human',
    },
    order: 22,
  },
  {
    name: 'A2 同包名对比',
    agentId: 'a2_decision',
    skillType: 'experience',
    description: '同产品不同 campaign 表现差异的判断',
    experience: {
      scenario: '同包名下有 campaign ROAS > 2，但当前 campaign ROAS < 0.3',
      outcome: '通常是素材/受众问题而非产品问题',
      lesson: '如果同产品有表现好的广告，当前广告差大概率是素材问题，应该关停差的而不是怀疑整个产品',
      confidence: 0.85,
      validatedCount: 10,
      source: 'human',
    },
    order: 23,
  },

  // ==================== A2 硬护栏（仅少量，不可绕过）====================
  {
    name: 'A2 硬护栏-严重亏损止损',
    agentId: 'a2_decision',
    skillType: 'rule',
    description: '不可绕过的止损底线',
    screening: {
      conditions: [
        { field: 'todaySpend', operator: '>', value: 50 },
        { field: 'adjustedRoi', operator: '<', value: 0.2 },
      ],
      conditionLogic: 'AND',
      verdict: 'needs_decision',
      priority: 'critical',
      reasonTemplate: '硬护栏触发: 花费 ${todaySpend} > $50 且 ROAS {adjustedRoi} < 0.2，必须止损',
    },
    order: 1,
  },
  {
    name: 'A2 硬护栏-冷启动保护',
    agentId: 'a2_decision',
    skillType: 'rule',
    description: '花费太低不做决策',
    screening: {
      conditions: [{ field: 'todaySpend', operator: '<', value: 5 }],
      conditionLogic: 'AND',
      verdict: 'skip',
      priority: 'low',
      reasonTemplate: '冷启动: 花费 ${todaySpend} < $5，数据不足',
    },
    order: 2,
  },

  // ==================== A3 执行路由：通道经验 ====================
  {
    name: 'A3 TikTok走TopTou',
    agentId: 'a3_executor',
    skillType: 'experience',
    description: 'TikTok 广告执行通道选择',
    experience: {
      scenario: '尝试用 Facebook API 操作 TikTok campaign ID',
      outcome: '报错 Object does not exist',
      lesson: 'TikTok 平台的广告必须走 TopTou API 执行，不能用 Facebook API',
      confidence: 1.0,
      validatedCount: 20,
      source: 'human',
    },
    order: 30,
  },
  {
    name: 'A3 FB预算延迟生效',
    agentId: 'a3_executor',
    skillType: 'experience',
    description: 'Facebook 预算修改的生效延迟',
    experience: {
      scenario: '通过 FB API 修改 campaign 预算',
      outcome: '实际生效可能延迟 10-15 分钟',
      lesson: '修改预算后不要立即验证是否生效，至少等 15 分钟再检查',
      confidence: 0.85,
      validatedCount: 8,
      source: 'human',
    },
    order: 31,
  },

  // ==================== A4 全局治理：产品目标 ====================
  {
    name: 'A4 funce投放目标',
    agentId: 'a4_governor',
    skillType: 'goal',
    description: 'funce 产品的投放目标与约束',
    goal: {
      product: 'funce',
      dailySpendTarget: 500,
      roasFloor: 1.0,
      priority: 'roas_first',
      channels: ['FB'],
      countries: [],
      notes: '最高优先级是首日ROAS，不允许大额亏损。宁可少花钱也不能亏。',
    },
    order: 40,
  },

  // ==================== A4 全局策略经验 ====================
  {
    name: 'A4 关停后补量',
    agentId: 'a4_governor',
    skillType: 'experience',
    description: '大量关停后的消耗补充经验',
    experience: {
      scenario: '一轮关停超过 30% 的活跃 campaign',
      outcome: '消耗目标无法达成，需要 1-2 天恢复',
      lesson: '大量关停后需要立即补量：复制优质广告或启用候补广告 3-5 条，否则消耗目标要延后 1-2 天',
      confidence: 0.8,
      validatedCount: 4,
      source: 'human',
    },
    order: 41,
  },
  {
    name: 'A4 学习期占比风险',
    agentId: 'a4_governor',
    skillType: 'experience',
    description: '学习期广告占比过高的风险',
    experience: {
      scenario: '学习期 campaign 占活跃广告比例超过 40%',
      outcome: '整体 ROAS 被拉低 20-30%',
      lesson: '学习期占比过高时应砍掉一些学习中但表现差的广告，保持学习期占比在 30% 以下',
      confidence: 0.75,
      validatedCount: 3,
      source: 'human',
    },
    order: 42,
  },

  // ==================== A5 知识管理：元规则 ====================
  {
    name: 'A5 经验衰减规则',
    agentId: 'a5_knowledge',
    skillType: 'meta',
    description: '长期未验证的经验自动降低置信度',
    experience: {
      scenario: '某条经验超过 30 天未被引用或验证',
      outcome: '投放环境可能已变化，经验可能过时',
      lesson: '超过 30 天未验证的经验置信度下降 0.1，低于 0.3 时自动归档',
      confidence: 0.95,
      validatedCount: 0,
      source: 'human',
    },
    order: 50,
  },
  {
    name: 'A5 经验提权规则',
    agentId: 'a5_knowledge',
    skillType: 'meta',
    description: '被多次验证正确的经验提升优先级',
    experience: {
      scenario: '某条经验被验证正确超过 5 次',
      outcome: '高置信经验',
      lesson: '验证 5 次以上的经验置信度提升到 0.9，并标记为高优经验优先展示给 LLM',
      confidence: 0.95,
      validatedCount: 0,
      source: 'human',
    },
    order: 51,
  },
  {
    name: 'A5 错误经验降权',
    agentId: 'a5_knowledge',
    skillType: 'meta',
    description: '被证明错误的经验快速降权',
    experience: {
      scenario: '基于某条经验做出的决策连续 3 次被证明是错误的',
      outcome: '经验本身可能有问题',
      lesson: '连续 3 次验证错误的经验置信度降为 0.1 并标记待审查，避免继续误导决策',
      confidence: 0.95,
      validatedCount: 0,
      source: 'human',
    },
    order: 52,
  },
]

/**
 * 初始化预置 Skills（幂等：同名跳过）
 */
export async function seedSkills(): Promise<void> {
  let created = 0

  for (const seed of SEEDS) {
    const exists = await Skill.findOne({ name: seed.name, agentId: seed.agentId })
    if (exists) continue
    await Skill.create({ ...seed, enabled: true })
    created++
  }

  if (created > 0) {
    log.info(`[SkillSeeds] Created ${created} preset skills (V2 experience system)`)
  }
}
