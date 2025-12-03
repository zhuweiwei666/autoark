# Facebook 数据抓取、存储和前端展示逻辑梳理

## 一、数据抓取逻辑

### 1.1 触发方式

#### 定时任务（Cron Jobs）
- **广告系列同步**：`sync.cron.ts`
  - 频率：每 10 分钟（可通过 `CRON_SYNC_INTERVAL` 环境变量配置）
  - 调用：`facebook.sync.service.runFullSync()` → `facebook.campaigns.service.syncCampaignsFromAdAccounts()`
  
- **历史数据抓取**：`fetchFacebookMetrics.ts`
  - 频率：每小时执行
  - 调用：`facebook.service.getInsightsDaily()`（抓取昨天的数据）

- **数据预聚合**：`preaggregation.cron.ts`
  - 频率：每小时第 5 分钟（更新今天的数据）
  - 频率：每天凌晨 2 点（完整预聚合）

- **Token 验证**：`tokenValidation.cron.ts`
  - 频率：每小时执行一次

#### 手动同步
- 前端页面提供"同步广告系列"按钮
- 调用 API：`POST /api/facebook/campaigns/sync`
- 后端处理：`facebook.controller.syncCampaigns()` → `facebook.campaigns.service.syncCampaignsFromAdAccounts()`

### 1.2 数据抓取流程

```
1. 获取所有活跃账户
   └─> Account.find({ status: 'active' })

2. 遍历每个账户
   ├─> 调用 Facebook API 获取广告系列列表
   │   └─> fetchCampaigns(accountId, token)
   │       └─> GET /{accountId}/campaigns
   │           └─> 字段：id, name, objective, status, daily_budget, etc.
   │
   ├─> 保存/更新 Campaign 数据到 MongoDB
   │   └─> Campaign.findOneAndUpdate({ campaignId }, data, { upsert: true })
   │
   └─> 对每个广告系列获取 Insights 数据
       └─> fetchInsights(campaignId, 'campaign', 'today', token, ['country'])
           └─> GET /{campaignId}/insights
               └─> 参数：
                   - level: 'campaign'
                   - date_preset: 'today'
                   - breakdowns: ['country'] （按国家分组）
                   - fields: impressions, clicks, spend, cpc, ctr, cpm, 
                            actions, action_values, purchase_roas, etc.
```

### 1.3 Facebook API 调用详情

**文件**：`autoark-backend/src/services/facebook.api.ts`

#### 核心函数
- `fbClient.get()`: 统一的 Facebook Graph API 客户端
  - Base URL: `https://graph.facebook.com/v19.0`
  - 自动获取 Access Token
  - 错误处理和日志记录

- `fetchCampaigns()`: 获取广告系列列表
  - 字段：id, name, objective, status, created_time, updated_time, daily_budget, etc.
  - 限制：最多 1000 条

- `fetchInsights()`: 获取洞察数据
  - 支持不同级别：account, campaign, adset, ad
  - 支持 breakdowns（如按国家分组）
  - 字段包括：
    - 基础指标：impressions, clicks, spend, reach, frequency
    - 成本指标：cpc, ctr, cpm, cpp, cost_per_conversion
    - 转化数据：actions, action_values, purchase_roas
    - 视频指标：video_play_actions, video_30_sec_watched_actions, etc.

### 1.4 数据提取逻辑

**文件**：`autoark-backend/src/services/facebook.campaigns.service.ts`

#### 从 Insights 中提取数据
```javascript
// 1. 基础指标（直接使用）
impressions: insight.impressions || 0
clicks: insight.clicks || 0
spendUsd: parseFloat(insight.spend || '0')
cpc: insight.cpc ? parseFloat(insight.cpc) : undefined
ctr: insight.ctr ? parseFloat(insight.ctr) : undefined
cpm: insight.cpm ? parseFloat(insight.cpm) : undefined

// 2. 转化数据（从 actions 和 action_values 数组中提取）
actions: insight.actions  // 原始数组，如 [{action_type: 'mobile_app_install', value: '10'}]
action_values: insight.action_values  // 原始数组，如 [{action_type: 'purchase', value: '100.50'}]

// 3. 提取特定指标
purchase_value: getActionValue(insight.action_values, 'purchase')
  └─> 从 action_values 数组中查找 action_type === 'purchase' 的项，返回其 value

mobile_app_install_count: getActionCount(insight.actions, 'mobile_app_install')
  └─> 从 actions 数组中查找 action_type === 'mobile_app_install' 的项，返回其 value

// 4. ROAS
purchase_roas: insight.purchase_roas ? parseFloat(insight.purchase_roas) : undefined
  └─> purchase_roas 可能是数组或单个值，需要根据实际情况处理

// 5. 国家维度（从 breakdowns 获取）
country: insight.country || null
  └─> 当使用 breakdowns: ['country'] 时，每个 insight 会包含 country 字段
```

## 二、数据存储逻辑

### 2.1 数据模型

#### Campaign 模型
**文件**：`autoark-backend/src/models/Campaign.ts`

```javascript
{
  campaignId: String (唯一索引),
  accountId: String,
  channel: String (默认 'facebook'),
  name: String,
  status: String,
  objective: String,
  buying_type: String,
  daily_budget: String,
  budget_remaining: String,
  created_time: Date,
  updated_time: Date,
  raw: Object (原始 Facebook API 响应)
}
```

#### MetricsDaily 模型
**文件**：`autoark-backend/src/models/MetricsDaily.ts`

```javascript
{
  // 标识字段
  date: String (YYYY-MM-DD, 必需),
  channel: String (默认 'facebook'),
  accountId: String,
  campaignId: String,
  adsetId: String,
  adId: String,
  country: String, // 国家代码（从 breakdowns 获取）

  // 基础指标
  impressions: Number (默认 0),
  clicks: Number (默认 0),
  spendUsd: Number (默认 0),
  cpc: Number,
  ctr: Number,
  cpm: Number,

  // 转化数据
  actions: Mixed, // Array of {action_type, value}
  action_values: Mixed, // Array of {action_type, value}
  purchase_roas: Number,
  purchase_value: Number,
  mobile_app_install_count: Number,

  // 原始数据
  raw: Object, // 完整的 Facebook API 响应

  // 时间戳
  createdAt: Date,
  updatedAt: Date
}
```

### 2.2 唯一索引设计

#### Campaign 级别指标
```javascript
{ campaignId: 1, date: 1, country: 1 }
- 唯一约束：同一 campaign + 日期 + 国家 只能有一条记录
- 部分索引：只在 campaignId 存在时应用唯一约束
- 用途：存储按国家分组的 campaign 级别指标
```

#### Ad 级别指标
```javascript
{ adId: 1, date: 1 }
- 唯一约束：同一 ad + 日期 只能有一条记录
- 部分索引：只在 adId 存在时应用唯一约束
- 用途：存储 ad 级别指标（如果将来需要）
```

### 2.3 性能优化索引

```javascript
// 日期范围查询
{ date: 1 }
{ date: 1, campaignId: 1 }
{ date: 1, accountId: 1 }

// 国家维度查询
{ country: 1, date: 1 }
{ country: 1, campaignId: 1, date: 1 }
```

### 2.4 数据存储流程

```javascript
// 1. 保存 Campaign 信息
await Campaign.findOneAndUpdate(
  { campaignId: campaignData.campaignId },
  campaignData,
  { upsert: true, new: true }
)

// 2. 保存 MetricsDaily 数据（按国家分组）
for (const insight of insights) {
  const country = insight.country || null
  
  await MetricsDaily.findOneAndUpdate(
    { 
      campaignId: metricsData.campaignId, 
      date: metricsData.date, 
      country: country || null 
    },
    {
      $set: metricsData,
      $unset: { adId: '', adsetId: '' } // 移除 adId 和 adsetId，避免唯一索引冲突
    },
    { upsert: true, new: true }
  )
}
```

### 2.5 Account ID 格式统一

**文件**：`autoark-backend/src/utils/accountId.ts`

- **API 调用时**：需要 `act_` 前缀
  - `normalizeForApi(accountId)`: 确保有 `act_` 前缀

- **数据库存储时**：去掉 `act_` 前缀
  - `normalizeForStorage(accountId)`: 去掉 `act_` 前缀

- **原因**：Facebook API 要求 accountId 必须有 `act_` 前缀，但数据库存储时统一去掉前缀以便查询

## 三、数据查询逻辑

### 3.1 广告系列列表查询

**文件**：`autoark-backend/src/services/facebook.campaigns.service.ts`

#### 查询流程
```
1. 构建 Campaign 查询条件
   └─> 根据 filters (name, accountId, status, objective) 构建 MongoDB query

2. 获取所有匹配的 Campaigns
   └─> Campaign.find(query).lean()

3. 根据排序字段决定查询策略
   ├─> 如果是 metrics 字段排序（spend, impressions, clicks, etc.）
   │   └─> 需要先查询 MetricsDaily，然后排序，最后分页
   │
   └─> 如果是 Campaign 字段排序（name, status, etc.）
       └─> 直接对 Campaigns 排序，然后分页

4. 查询 MetricsDaily 数据
   ├─> 如果有日期范围（startDate, endDate）
   │   └─> 使用 MongoDB aggregation 聚合多天数据
   │       └─> $match: 日期范围 + campaignId 列表
   │       └─> $group: 按 campaignId 分组，求和/平均指标
   │       └─> $project: 计算正确的 CTR (clicks / impressions)
   │
   └─> 如果没有日期范围（默认今天）
       └─> 直接查询今天的 MetricsDaily 数据
           └─> MetricsDaily.find({ campaignId: { $in: campaignIds }, date: today })

5. 合并 Campaign 和 Metrics 数据
   └─> 将 MetricsDaily 数据映射到对应的 Campaign

6. 从 action_values 中提取 purchase_value
   └─> 如果 metricsObj.purchase_value 不存在，从 action_values 数组中提取
```

#### 关键计算逻辑

**CTR 计算**：
```javascript
// 不再使用存储的 CTR 值，而是重新计算
const impressions = metricsObj.impressions || 0
const clicks = metricsObj.clicks || 0
const ctr = impressions > 0 ? clicks / impressions : 0
```

**purchase_value 提取**：
```javascript
// 优先级：
1. metricsObj.purchase_value (数据库存储的值)
2. 从 action_values 数组中提取
   └─> actionValues.find(a => a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase')
3. 从 extractedActionValues 中获取
```

### 3.2 缓存策略

**文件**：`autoark-backend/src/utils/cache.ts`

- **今天的数据**：缓存 5-10 分钟（`CACHE_TTL.TODAY`）
- **日期范围数据**：缓存 30 分钟（`CACHE_TTL.DATE_RANGE`）
- **缓存键**：基于查询参数生成（filters, sortBy, sortOrder）

### 3.3 读写分离

**文件**：`autoark-backend/src/config/db.ts`

- **写连接**：主节点（默认连接）
- **读连接**：从节点（`readPreference: 'secondaryPreferred'`）
- **用途**：查询操作使用读连接，减轻主节点压力

## 四、前端展示逻辑

### 4.1 页面组件

**文件**：`autoark-frontend/src/pages/FacebookCampaignsPage.tsx`

#### 主要功能
- 广告系列列表展示
- 筛选功能（名称、账户ID、状态、目标、日期范围）
- 排序功能（所有字段可排序）
- 分页功能
- 列显示/隐藏配置
- 手动同步按钮

### 4.2 API 调用

**文件**：`autoark-frontend/src/services/api.ts`

#### getCampaigns()
```typescript
export async function getCampaigns(params?: {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  name?: string
  accountId?: string
  status?: string
  objective?: string
  startDate?: string
  endDate?: string
}): Promise<CampaignListResponse>
```

**请求示例**：
```
GET /api/facebook/campaigns-list?page=1&limit=20&sortBy=spend&sortOrder=desc&startDate=2025-12-01&endDate=2025-12-03
```

### 4.3 数据格式化

#### 货币格式
```javascript
formatCurrency(v) => `$${num.toFixed(2)}`
```

#### 百分比格式
```javascript
formatPercent(v) => `${(num * 100).toFixed(2)}%`
// 注意：CTR 值在数据库中存储为小数（如 0.028），前端显示时乘以 100 转换为百分比（2.80%）
```

#### 数字格式
```javascript
formatNumber(v) => num.toLocaleString()
```

### 4.4 默认排序

- **广告系列页面**：按 `spend` 降序（从高到低）
- **账户管理页面**：按 `periodSpend` 降序（从高到低）

### 4.5 日期选择逻辑

- **不选择日期范围**：显示今天的数据
- **选择日期范围**：显示该范围内的聚合数据

## 五、数据流图

```
┌─────────────────┐
│  Facebook API   │
└────────┬────────┘
         │
         │ fetchCampaigns()
         │ fetchInsights()
         │
         ▼
┌─────────────────┐
│  Backend API    │
│  facebook.api   │
└────────┬────────┘
         │
         │ syncCampaignsFromAdAccounts()
         │
         ▼
┌─────────────────┐      ┌─────────────────┐
│   Campaign      │      │  MetricsDaily   │
│   Collection    │      │   Collection    │
└─────────────────┘      └────────┬────────┘
                                  │
                                  │ getCampaigns()
                                  │
                                  ▼
                         ┌─────────────────┐
                         │  Query & Cache │
                         │  (Redis)       │
                         └────────┬────────┘
                                  │
                                  │ API Response
                                  │
                                  ▼
                         ┌─────────────────┐
                         │  Frontend API   │
                         │  api.ts         │
                         └────────┬────────┘
                                  │
                                  │ getCampaigns()
                                  │
                                  ▼
                         ┌─────────────────┐
                         │  React Page     │
                         │  CampaignsPage  │
                         └─────────────────┘
```

## 六、关键问题和解决方案

### 6.1 CTR 计算错误
**问题**：之前使用 `$avg` 对各个 CTR 值求平均，导致结果异常（如 279.54%）

**解决方案**：
- 不再使用存储的 CTR 值
- 重新计算：`CTR = 总 clicks / 总 impressions`
- 在聚合时使用 `$project` 阶段计算正确的 CTR

### 6.2 purchase_value 丢失
**问题**：purchase_value 有时显示为 $0.00

**解决方案**：
- 优先使用 `metricsObj.purchase_value`（数据库存储的值）
- 如果没有，从 `action_values` 数组中提取
- 支持 `purchase` 和 `mobile_app_purchase` 两种 action_type

### 6.3 数据一致性
**问题**：Dashboard、账户管理、广告系列三个层级的数据不一致

**解决方案**：
- 所有聚合查询都明确过滤：`campaignId: { $exists: true, $ne: null }`
- 确保只统计 campaign 级别的数据，避免重复计算 ad/adset 级别数据

### 6.4 性能优化
**问题**：查询大量数据时响应慢（504 Gateway Timeout）

**解决方案**：
- Redis 缓存（今天的数据 5-10 分钟，日期范围数据 30 分钟）
- MongoDB 读写分离（查询走从节点）
- 数据预聚合（定时任务预计算常用日期范围）
- 查询优化（使用 `.lean()`、索引提示、批量查询）

## 七、总结

### 数据抓取
- 定时任务每 10 分钟同步一次广告系列和今天的 Insights 数据
- 支持按国家分组（breakdowns: ['country']）
- 自动提取 purchase_value 和 mobile_app_install_count

### 数据存储
- Campaign 信息存储在 `Campaign` 集合
- 指标数据存储在 `MetricsDaily` 集合（按 campaign + date + country 唯一）
- 使用部分索引避免唯一索引冲突

### 数据查询
- 支持日期范围查询和单日查询
- 支持筛选、排序、分页
- 使用 Redis 缓存和 MongoDB 读写分离优化性能

### 前端展示
- React 组件展示广告系列列表
- 支持筛选、排序、分页、列配置
- 数据格式化（货币、百分比、数字）

