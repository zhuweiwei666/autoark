# AutoArk 项目完整上下文 — 供 AI 广告模型训练使用

> 本文档包含 AutoArk 广告自动化平台的完整技术细节和业务逻辑，用于训练专属 AI 广告投放决策模型。

---

## 1. 项目概述

AutoArk 是一个 **Facebook/TikTok 广告自动化投放平台**，核心功能：
- 自动监控广告 Campaign 的 ROAS、CPI、花费等指标
- 基于规则 + LLM 自动做出投放决策（暂停、加预算、降预算、恢复）
- 素材库管理，追踪素材级别的投放效果
- 多账户、多优化师、多产品的统一管理

### 技术架构
- **Backend**: Node.js/TypeScript + Express + MongoDB (Mongoose)
- **Agent**: Node.js/TypeScript，独立服务，含 AI 决策引擎
- **Frontend**: React + Vite + TailwindCSS
- **BI**: Metabase（连接底层 OLAP 数据库，唯一数据查询入口）
- **队列**: BullMQ + Redis
- **LLM**: 当前用 Google Generative AI / OpenAI 兼容 API

---

## 2. 数据源 — Metabase Cards

### Card 7726 — Campaign 聚合报表（V6，主力数据源）
- **访问码**: `xheqmmolkpj9f35e`
- **粒度**: Campaign x 天
- **刷新**: 10 分钟
- **字段**:

| 字段名 | 含义 | 类型 |
|--------|------|------|
| cam_id | Campaign ID | string |
| campaign_name | Campaign 名称 | string |
| 渠道 | 平台（FB/TT） | string |
| 优化师 | 优化师名称 | string |
| 包名 | 产品包名（如 com.game.xxx） | string |
| 日期 | 日期 YYYY-MM-DD | string |
| 广告花费_API | API 花费（美元，最准确） | number |
| 广告花费 | BI 花费（备选） | number |
| 安装量 | App 安装数 | number |
| CPI | 单次安装成本 | number |
| CPA | 单次行动成本 | number |
| 调整的首日收入 | 调整后的首日收入（最准确的收入指标） | number |
| 渠道收入 | 渠道收入（备选） | number |
| 首日新增收入 | 首日新增收入 | number |
| 三日回收ROI | 3 天回收 ROI | number |
| 首日付费率 | 首日付费用户比例 | number |
| 首日ARPU | 首日每用户平均收入 | number |
| CTR | 点击率 | number |

### Card 7786 — Ad 花费明细
- **访问码**: `VfuSBdaO33sklvtr`
- **粒度**: Ad x 天
- **字段**:

| 字段名 | 含义 | 类型 |
|--------|------|------|
| to_date | 日期 | string |
| pkg_name | 产品包名 | string |
| optimizer | 优化师 | string |
| platform | 平台 | string |
| ad_account_name | 广告账户名称 | string |
| ad_account_id | 广告账户 ID | string |
| campaign_name | Campaign 名称 | string |
| campaign_id | Campaign ID | string |
| ad_set_name | AdSet 名称 | string |
| ad_set_id | AdSet ID | string |
| ad_name | Ad 名称 | string |
| ad_id | Ad ID | string |
| original_ad_spend | 广告花费（美元） | number |
| impressions | 曝光量 | number |
| clicks | 点击量 | number |

### Metabase API 调用方式
```
认证: POST https://meta.iohubonline.club/api/session
查询: POST https://meta.iohubonline.club/api/card/{cardId}/query
参数:
  - access_code: 访问码
  - start_day: 开始日期 (YYYY-MM-DD)
  - end_day: 结束日期 (YYYY-MM-DD)
  - optimizer: 优化师过滤（可选）
  - platform: 平台过滤（可选）
返回: { data: { cols: [{name, display_name, base_type}], rows: any[][] } }
```

---

## 3. 核心数据结构

### CampaignMetrics — 加工后的 Campaign 指标

```typescript
interface CampaignMetrics {
  campaignId: string
  campaignName: string
  accountId: string
  accountName: string
  platform: string         // "Facebook" | "TikTok"
  optimizer: string        // 优化师名称
  pkgName: string          // 产品包名

  // 今日指标
  todaySpend: number       // 今日花费 $
  todayRevenue: number     // 今日收入 $
  todayRoas: number        // 今日 ROAS (revenue/spend)
  todayImpressions: number
  todayClicks: number
  todayConversions: number // 今日转化（安装）

  // 昨日/前天
  yesterdaySpend: number
  yesterdayRoas: number
  dayBeforeSpend: number
  dayBeforeRoas: number

  // 趋势 (百分比变化)
  spendTrend: number       // 花费变化% (正=增长, 负=下降)
  roasTrend: number        // ROAS 变化%

  // 3日聚合
  totalSpend3d: number
  totalRevenue3d: number
  avgRoas3d: number

  // 效率
  estimatedDailySpend: number  // 预估今日全天花费
  spendPerHour: number

  // 转化指标（来自 BI 系统）
  installs: number         // 安装量
  cpi: number              // 单次安装成本 $
  cpa: number              // 单次行动成本 $
  firstDayRoi: number      // 首日 ROI
  adjustedRoi: number      // 调整后首日 ROI（最准确）
  day3Roi: number          // 3 日回收 ROI
  day7Roi: number          // 7 日回收 ROI
  payRate: number          // 首日付费率
  arpu: number             // 首日 ARPU

  // 每日原始数据
  dailyData: Array<{ date: string; spend: number; revenue: number; roas: number }>
}
```

### MarketBenchmark — 大盘基准值

```typescript
interface MarketBenchmark {
  totalCampaigns: number   // 全量 Campaign 数
  totalSpend: number       // 全量总花费
  weightedRoas: number     // 花费加权 ROAS
  avgCpi: number           // 平均 CPI
  avgAdjustedRoi: number   // 平均调整 ROI
  medianRoi: number        // ROI 中位数
  p25Roi: number           // ROI 25分位
  p75Roi: number           // ROI 75分位
  avgPayRate: number       // 平均付费率
  byPlatform: {            // 按平台分
    [platform: string]: {
      count: number
      avgRoi: number
      avgCpi: number
      totalSpend: number
    }
  }
}
```

---

## 4. 分类规则 — 7 个 Campaign 标签

### 阈值参数

```typescript
const THRESHOLDS = {
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

  // 趋势判断
  trend_up_pct: 10,            // 上升 > 10% = 上升趋势
  trend_down_pct: -10,         // 下降 > 10% = 下降趋势
}
```

### 分类逻辑（优先级从高到低）

1. **observing（观察期）**: 3日总花费 < $30，数据不足
2. **loss_severe（严重亏损）**: 3日均 ROAS < 0.3 且花费 >= $50 且连续 2 天
3. **declining（衰退中）**: 之前 ROAS > 1.5 但当前下降超 30%
4. **loss_mild（轻微亏损）**: 3日均 ROAS < 0.8 且花费 >= $30 且连续 2 天
5. **high_potential（高潜力）**: ROAS >= 2.5，或 ROAS >= 1.5 且上升趋势 > 10%
6. **stable_good（稳定良好）**: 1.5 <= ROAS < 2.5
7. **stable_normal（稳定一般）**: 其他所有情况

---

## 5. 决策规则 — 操作映射

### 自动执行（无需审批）

| 条件 | 操作 | 说明 |
|------|------|------|
| label = loss_severe | 暂停 Campaign | 严重亏损自动关停 |
| 花费 > $100 且 0 转化 | 暂停 Campaign | 烧钱无转化自动关停 |

### 需要审批

| 条件 | 操作 | 说明 |
|------|------|------|
| label = loss_mild，连续 3 天 | 暂停 Campaign | 轻微亏损建议关停 |
| label = declining | 暂停 Campaign | 衰退中建议关停 |
| label = high_potential，当前日花费 < $200 | 加预算 20-30% | 高潜力扩量 |
| label = stable_good，连续 3 天 | 加预算 10-20% | 稳定良好小幅扩量 |

### 不操作

| 条件 | 说明 |
|------|------|
| label = observing | 数据不足，继续观察 |
| label = stable_normal | 表现一般，不动 |
| 最近 24h 已操作过 | 冷却期内不重复操作 |

### 预算限制
- 单次调整幅度不超过 30%
- 日预算上限 $500
- 同一 Campaign 24h 内最多操作一次

---

## 6. Agent 决策流程（think 循环）

```
1. Perception（感知）
   └─ 从 Metabase 拉取最近 3 天的 Campaign 数据
   └─ analyzeData() 加工成 CampaignMetrics

2. Benchmarking（大盘基准）
   └─ 计算全量 Campaign 的花费加权 ROAS、ROI 分位数、平台分组统计
   └─ 作为 LLM 判断的参照系

3. Scope Filtering（权限过滤）
   └─ 只处理当前 Agent 权限范围内的 Campaign
   └─ 范围由 accountIds / pkgNames / optimizers 配置

4. Reflection（反思）
   └─ 回顾过去的决策：执行了什么 → 效果如何
   └─ 提取经验教训存入 long-term memory

5. Classification（分类）
   └─ classifyCampaigns() 用规则给每个 Campaign 打标签
   └─ 支持 Skill 覆盖阈值（按产品/优化师定制策略）

6. Decision（决策）
   └─ 过滤掉观察期和冷却期的 Campaign
   └─ 将分类结果 + 大盘基准 + 动态上下文发给 LLM
   └─ LLM 输出结构化操作清单（JSON）
   └─ 降级方案：LLM 不可用时，用纯规则生成决策

7. Execution（执行）
   └─ auto=true 的操作直接执行（暂停严重亏损的）
   └─ auto=false 的操作创建审批请求

8. Recording（记录）
   └─ 保存 Snapshot（完整状态快照）
   └─ 更新 Memory（工作记忆 + 短期记忆）
```

---

## 7. Skill 系统（策略插件）

用于按产品/优化师定制决策策略：

```typescript
interface Skill {
  name: string           // 如 "游戏 A 投放策略"
  match: {
    pkgPatterns: string[] // 包名匹配（支持通配符 *）
    platforms: string[]   // 平台过滤
    optimizers: string[]  // 优化师过滤
    accountIds: string[]  // 账户过滤
  }
  thresholds: Partial<typeof THRESHOLDS>  // 覆盖默认阈值
  context: string        // 额外 LLM 上下文（如 "该产品 ROI 回收周期长，7日ROI更有参考价值"）
  rules: string[]        // 自然语言规则（如 "CPI > $5 时立即暂停"）
  learnedKnowledge: string // 积累的经验
  priority: number       // 匹配优先级
  isActive: boolean
}
```

---

## 8. 决策提示词（System Prompt）

当前 Agent 使用的完整 System Prompt：

```
你是一个顶级的广告投手（Media Buyer），精通 Facebook 和 TikTok 广告投放。
你有多年跨境电商广告投放经验，擅长通过数据分析做出精准的投放决策。

## 决策框架

### 何时扩量
- ROAS > 目标值 且 连续 3 天稳定或上升 → 加预算 20-30%
- CTR > 1.5% 且 CPA 在目标范围内 → 考虑复制到新国家/受众

### 何时关停
- ROAS < 0.5 且 连续 3 天 且 花费 > $50 → 立即关停
- 花费 > $100 且 0 转化 → 立即关停
- CPA > 目标值 2 倍 且 持续 3 天 → 关停

### 何时观望
- 新广告花费 < $30 → 数据不够，继续观察
- 刚调整过预算（24 小时内）→ 等待数据稳定
- 学习期内（Facebook 约 50 个转化事件）→ 不要频繁调整

### 素材判断
- CTR 持续下降 > 20%（对比前 7 天）→ 素材疲劳，建议更换
- 同一素材在不同国家 ROAS 差异 > 2 倍 → 调整国家预算分配

## 重要规则
- 单次预算调整幅度不超过 50%
- 不要猜测数据，必须基于真实数据做判断
- 如果数据不足以做决策，明确说"数据不足，建议继续观察"
```

---

## 9. LLM 决策输入输出格式

### 输入给 LLM 的 Campaign 数据格式

```json
{
  "campaignId": "120215942628850577",
  "campaignName": "US_Game_FB_zhangsan_v1",
  "label": "declining",
  "labelName": "衰退中",
  "todaySpend": 523.45,
  "todayRoas": 0.85,
  "yesterdayRoas": 1.12,
  "avgRoas3d": 0.92,
  "totalSpend3d": 1450.30,
  "estimatedDailySpend": 680,
  "todayConversions": 210,
  "installs": 210,
  "cpi": 2.49,
  "firstDayRoi": 0.72,
  "adjustedRoi": 0.85,
  "day3Roi": 1.05,
  "payRate": 3.2,
  "recentlyOperated": false
}
```

### LLM 输出的决策格式

```json
{
  "actions": [
    {
      "type": "pause",
      "campaignId": "120215942628850577",
      "campaignName": "US_Game_FB_zhangsan_v1",
      "accountId": "act_123456",
      "reason": "ROAS 从 1.12 降至 0.85，连续下降，ML预测将继续恶化",
      "auto": false
    },
    {
      "type": "increase_budget",
      "campaignId": "120215942628850578",
      "campaignName": "JP_Game_FB_zhangsan_v2",
      "accountId": "act_789012",
      "reason": "ROAS 2.8 稳定3天，高于大盘P75，建议扩量",
      "auto": false,
      "currentBudget": 150,
      "newBudget": 195
    }
  ],
  "summary": "2个需要操作: 1个建议暂停(衰退), 1个建议加预算(高潜力)",
  "alerts": ["账户 act_123456 花费增速较快，注意预算控制"]
}
```

---

## 10. 广告投放领域知识

### 核心指标解释

| 指标 | 英文 | 计算方式 | 含义 |
|------|------|----------|------|
| ROAS | Return On Ad Spend | 收入 / 花费 | 广告回报率，>1 表示盈利 |
| ROI | Return On Investment | (收入-花费) / 花费 | 投资回报率 |
| CPI | Cost Per Install | 花费 / 安装量 | 单次安装成本 |
| CPA | Cost Per Action | 花费 / 目标行动数 | 单次行动成本 |
| CTR | Click-Through Rate | 点击 / 曝光 | 点击率 |
| CPM | Cost Per Mille | (花费 / 曝光) × 1000 | 千次曝光成本 |
| ARPU | Average Revenue Per User | 总收入 / 总用户数 | 每用户平均收入 |
| 付费率 | Pay Rate | 付费用户 / 总用户 | 用户付费转化率 |
| 首日ROI | Day-1 ROI | 首日收入 / 花费 | 用户获取首日的回报 |
| 三日ROI | Day-3 ROI | 3日累计收入 / 花费 | 3天累计回报 |

### 广告层级结构

```
Account（广告账户）
  └─ Campaign（广告系列）— 设定目标和预算
       └─ AdSet（广告组）— 设定定向和出价
            └─ Ad（广告）— 具体的创意/素材
```

### Facebook 广告特性
- 学习期: 新广告需要约 50 个转化事件才能出学习期
- 机器学习出价: 预算调整后需要 24-48h 重新学习
- 频繁调整会重置学习: 所以决策要谨慎，有冷却期
- 素材疲劳: CTR 持续下降说明受众对素材失去兴趣

### 投放决策经验

**好的信号:**
- ROAS 连续 3 天 > 1.5 且稳定 → 可以扩量
- CPI 下降且安装量稳定 → 效率提升
- 付费率 > 3% → 用户质量好

**危险信号:**
- ROAS 连续下降 → 素材疲劳或受众饱和
- CPI 上升 + 安装量下降 → 竞争加剧或素材失效
- 花费突增但转化不变 → 可能是广告系统异常
- 零转化 + 高花费 → 投放设置可能有问题

**决策原则:**
- 数据不足时宁可观望，不要盲目操作
- 亏损要快刀斩（特别是严重亏损）
- 扩量要慢加（每次 20-30%，观察 1-2 天再决定是否继续）
- 同一 Campaign 24h 内不要反复操作
- 关注大盘趋势，个体表现要放在大盘背景下判断

---

## 11. 模型训练建议

### 可用于训练的标签

1. **分类任务**: 7 个 Campaign 状态标签（可从规则引擎生成伪标签）
2. **回归任务**: 预测 adjustedRoi（调整首日ROI）、day3Roi（3日ROI）
3. **决策任务**: 预测操作类型（pause/increase_budget/decrease_budget/resume/no_action）

### 特征工程建议

从 Metabase 数据可派生的关键特征:
- **滑窗聚合**: roi_1d, roi_3d, roi_7d, spend_3d, cpi_3d 等
- **趋势特征**: roi_trend_3d, spend_trend_3d（变化率）
- **波动率**: roi_volatility_7d, spend_volatility_7d
- **相对位置**: roi_vs_market_avg, spend_percentile
- **Campaign 生命周期**: days_since_first_spend, lifetime_roi
- **优化师/产品维度**: optimizer_avg_roi, pkg_avg_roi

### 数据规模预估
- Card 7726 (Campaign x 天): 约 2000 Campaign/天 × 700+ 天 ≈ 140 万+ 行
- Card 7786 (Ad x 天): 数量级更大（每个 Campaign 可能有数十个 Ad）
