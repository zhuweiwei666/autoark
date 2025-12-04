# Purchase 事件抓取路径、方法和逻辑报告

## 📋 目录

1. [数据流概览](#数据流概览)
2. [Facebook API 请求层](#facebook-api-请求层)
3. [数据提取逻辑](#数据提取逻辑)
4. [数据存储逻辑](#数据存储逻辑)
5. [数据聚合逻辑](#数据聚合逻辑)
6. [数据查询逻辑](#数据查询逻辑)
7. [前端显示逻辑](#前端显示逻辑)
8. [可能的问题点](#可能的问题点)
9. [Facebook API 文档参考](#facebook-api-文档参考)

---

## 数据流概览

```
Facebook Graph API
    ↓
[1] Insights API 请求 (fetchInsights)
    ↓
[2] 数据提取 (getActionValue)
    ↓
[3] 数据存储 (UpsertService)
    ├─→ RawInsights (原始快照)
    └─→ MetricsDaily (聚合指标)
    ↓
[4] 数据聚合 (AggregationService)
    Ad → AdSet → Campaign → Account
    ↓
[5] 数据查询 (getCampaigns)
    ↓
[6] 前端显示 (FacebookCampaignsPage)
```

---

## Facebook API 请求层

### 1.1 API 端点

**文件**: `autoark-backend/src/integration/facebook/insights.api.ts`

**函数**: `fetchInsights(entityId, level, datePreset, token, breakdowns)`

**请求示例**:
```typescript
GET /{entityId}/insights
  ?level=ad                    // 或 campaign, adset, account
  &date_preset=today          // 或 yesterday, last_3d, last_7d
  &fields=campaign_id,ad_id,spend,impressions,clicks,actions,action_values,purchase_roas
  &breakdowns=country          // 可选：按国家分组
  &limit=1000
  &access_token={token}
```

### 1.2 请求的字段

**关键字段**:
- ✅ `actions`: 转化事件数组（如 `mobile_app_install`）
- ✅ `action_values`: 转化价值数组（包含 `purchase` 价值）
- ✅ `purchase_roas`: Purchase ROAS 数组
- ✅ `spend`, `impressions`, `clicks`: 基础指标

**完整字段列表**:
```typescript
const fields = [
  'campaign_id', 'adset_id', 'ad_id',
  'impressions', 'clicks', 'unique_clicks',
  'spend', 'reach', 'frequency',
  'cpc', 'ctr', 'cpm', 'cpp',
  'cost_per_conversion', 'conversions',
  'actions',                    // ⭐ 关键字段
  'action_values',              // ⭐ 关键字段（包含 purchase value）
  'unique_actions',
  'purchase_roas',              // ⭐ 关键字段
  'cost_per_action_type',
  'date_start', 'date_stop',
  // ... 视频相关字段
].join(',')
```

### 1.3 请求层级和日期预设

**当前实现**（队列系统 V2）:

| 层级 | 日期预设 | 用途 |
|------|---------|------|
| **Ad** | `today`, `yesterday`, `last_3d`, `last_7d` | 主要数据源（最准确） |
| **Campaign** | `today` | 旧同步逻辑（可能不准确） |

**为什么使用 Ad 级别？**
- ✅ Purchase 数据在 Ad 级别最准确
- ✅ Facebook 优先将事件分配到 Ad 级别
- ✅ Campaign 级别可能丢失 30-60% 的 purchase 数据

---

## 数据提取逻辑

### 2.1 提取函数

**文件**: `autoark-backend/src/queue/facebook.worker.ts`

**函数**: `getActionValue(actions, actionType)`

```typescript
const getActionValue = (actions: any[], actionType: string): number | undefined => {
  if (!actions || !Array.isArray(actions)) return undefined
  const action = actions.find(a => a.action_type === actionType)
  return action ? parseFloat(action.value) : undefined
}
```

### 2.2 Purchase Value 提取

**位置**: `autoark-backend/src/queue/facebook.worker.ts:250`

```typescript
// 从 action_values 数组中提取 purchase value
const purchaseValue = getActionValue(insight.action_values, 'purchase')
```

**当前逻辑**:
- ✅ 查找 `action_type === 'purchase'` 的项
- ❌ **未查找** `'mobile_app_purchase'`
- ❌ **未查找** `'offsite_conversion.fb_pixel_purchase'`

### 2.3 Facebook API 返回的数据结构

**action_values 数组格式**:
```json
{
  "action_values": [
    {
      "action_type": "purchase",
      "value": "123.45"
    },
    {
      "action_type": "mobile_app_purchase",
      "value": "67.89"
    },
    {
      "action_type": "offsite_conversion.fb_pixel_purchase",
      "value": "234.56"
    }
  ]
}
```

**purchase_roas 数组格式**:
```json
{
  "purchase_roas": [
    {
      "action_type": "purchase",
      "value": "2.5"
    }
  ]
}
```

### 2.4 可能的问题

1. **action_type 名称不匹配**
   - 当前只查找 `'purchase'`
   - 但 Facebook 可能返回 `'mobile_app_purchase'` 或 `'offsite_conversion.fb_pixel_purchase'`

2. **数据延迟**
   - `today` 的数据可能不完整（延迟 3-24 小时）
   - 建议使用 `last_7d` 数据

3. **层级问题**
   - Campaign 级别的 purchase 数据可能不完整
   - 必须从 Ad 级别向上聚合

---

## 数据存储逻辑

### 3.1 存储路径（队列系统 V2）

**文件**: `autoark-backend/src/queue/facebook.worker.ts`

**流程**:
```
AdWorker
  ↓
fetchInsights(adId, 'ad', 'today', token, ['country'])
  ↓
提取 purchaseValue = getActionValue(insight.action_values, 'purchase')
  ↓
存储到 RawInsights (所有 datePreset)
  ↓
存储到 MetricsDaily (仅 today/yesterday)
```

### 3.2 RawInsights 存储

**文件**: `autoark-backend/src/services/facebook.upsert.service.ts`

**存储内容**:
```typescript
await upsertService.upsertRawInsights({
  date: actualDate,
  datePreset: preset,              // 'today', 'yesterday', 'last_3d', 'last_7d'
  adId: adId,
  country: country,
  raw: insight,                    // ⭐ 完整原始响应
  purchase_value: purchaseValue,    // ⭐ 提取的 purchase value
  // ... 其他字段
})
```

**唯一索引**: `{ adId: 1, date: 1, datePreset: 1, country: 1 }`

**用途**:
- 保存完整的 Facebook API 响应
- 用于 Purchase 值修正（比较 today/yesterday/last_7d）
- 调试和问题排查

### 3.3 MetricsDaily 存储

**文件**: `autoark-backend/src/services/facebook.upsert.service.ts`

**存储内容**:
```typescript
await upsertService.upsertMetricsDaily({
  date: actualDate,
  level: 'ad',                      // ⭐ 明确设置级别
  entityId: adId,                   // ⭐ 使用 entityId
  country: country,
  
  purchase_value: purchaseValue || 0,  // ⭐ 提取的 purchase value
  action_values: insight.action_values, // ⭐ 保存原始数组
  purchase_roas: insight.purchase_roas,
  
  // ... 其他指标
})
```

**唯一索引**: `{ date: 1, level: 1, entityId: 1, country: 1 }`

**字段说明**:
- `purchase_value`: 提取的数值（可能为 0）
- `action_values`: 原始数组（用于后续提取）
- `purchase_value_corrected`: 修正后的值（由 Purchase Correction Service 计算）

### 3.4 旧同步逻辑（可能存在问题）

**文件**: `autoark-backend/src/services/facebook.campaigns.service.ts`

**问题**:
- ❌ 直接从 Campaign 级别获取 insights（不准确）
- ❌ 之前没有设置 `level` 和 `entityId`（已修复）
- ✅ 现在已修复：设置 `level: 'campaign'` 和 `entityId: campaignId`

---

## 数据聚合逻辑

### 4.1 Ad → Campaign 聚合

**文件**: `autoark-backend/src/services/facebook.aggregation.service.ts`

**函数**: `aggregateMetricsByLevel(date)`

**聚合逻辑**:
```typescript
// 1. 从 Ad 级别聚合到 AdSet 级别
MetricsDaily.aggregate([
  { $match: { level: 'ad', date: date } },
  {
    $group: {
      _id: { adsetId: '$adsetId', country: '$country' },
      purchase_value: { $sum: { $ifNull: ['$purchase_value', 0] } },
      // ... 其他指标
    }
  },
  // 写入 AdSet 级别数据
])

// 2. 从 AdSet 级别聚合到 Campaign 级别
// 3. 从 Campaign 级别聚合到 Account 级别
```

**关键点**:
- ✅ 使用 `$sum` 聚合 `purchase_value`
- ✅ 保留 `action_values` 数组（取第一个）
- ✅ 按 `country` 分组聚合

### 4.2 Purchase 值修正

**文件**: `autoark-backend/src/services/facebook.purchase.correction.ts`

**逻辑**:
1. 读取 `today` 的 purchase_value
2. 读取 `last_7d` 的 purchase_value
3. 如果 `last_7d > today`，使用 `last_7d` 作为修正值
4. 更新 `purchase_value_corrected` 字段

**原因**:
- Facebook 的 purchase 数据有延迟
- `last_7d` 数据通常更完整和准确

---

## 数据查询逻辑

### 5.1 Campaign 列表查询

**文件**: `autoark-backend/src/services/facebook.campaigns.service.ts`

**函数**: `getCampaigns(filters, pagination)`

**查询流程**:
```typescript
// 1. 查询 Campaign 基础信息
const campaigns = await CampaignModel.find(query).lean()

// 2. 查询 MetricsDaily 数据
const metricsQuery = {
  $or: [
    { level: 'campaign', entityId: { $in: campaignIds } },  // 新格式
    { level: { $exists: false }, campaignId: { $in: campaignIds } }  // 旧格式兼容
  ],
  date: today  // 或日期范围
}

// 3. 聚合 metrics 数据
const metricsData = await MetricsDailyRead.aggregate([
  { $match: metricsQuery },
  {
    $group: {
      _id: '$campaignId',
      purchase_value: { $sum: { $ifNull: ['$purchase_value', 0] } },
      // ... 其他指标
    }
  }
])
```

### 5.2 Purchase Value 提取（查询时）

**位置**: `autoark-backend/src/services/facebook.campaigns.service.ts:795-814`

**逻辑**:
```typescript
// 1. 优先使用存储的 purchase_value
let purchase_value = metricsObj.purchase_value

// 2. 如果为 0，从 action_values 中提取
if (!purchase_value && actionValues?.length > 0) {
  const purchaseAction = actionValues.find(a => 
    a.action_type === 'purchase' || 
    a.action_type === 'mobile_app_purchase'
  )
  if (purchaseAction) {
    purchase_value = parseFloat(purchaseAction.value) || 0
  }
}

// 3. 如果还是没有，使用 extractedActionValues
if (!purchase_value) {
  purchase_value = extractedActionValues.purchase_value || 
                   extractedActionValues.mobile_app_purchase_value || 
                   0
}
```

### 5.3 可能的问题

1. **聚合时丢失数据**
   - 如果 Ad 级别的数据没有正确聚合到 Campaign 级别
   - 查询 Campaign 级别时可能找不到数据

2. **查询条件不匹配**
   - 旧数据没有 `level` 字段
   - 新数据使用 `level: 'campaign'` 和 `entityId`
   - 需要兼容两种格式

---

## 前端显示逻辑

### 6.1 API 调用

**文件**: `autoark-frontend/src/services/api.ts`

**函数**: `getCampaigns(params)`

```typescript
GET /api/facebook/campaigns-list
  ?page=1
  &limit=20
  &sortBy=spend
  &sortOrder=desc
  &startDate=2025-12-03
  &endDate=2025-12-03
```

### 6.2 数据映射

**文件**: `autoark-frontend/src/pages/FacebookCampaignsPage.tsx`

**字段映射**:
```typescript
{
  purchase_value: response.purchase_value || 0,  // 直接使用后端返回的值
  purchase_roas: response.purchase_roas || 0,
  // ...
}
```

---

## 可能的问题点

### 7.1 Facebook API 层面

| 问题 | 可能原因 | 检查方法 |
|------|---------|---------|
| **API 未返回 purchase 数据** | 1. Pixel 未正确配置<br>2. 未触发 purchase 事件<br>3. 广告目标不匹配 | 运行 `test_facebook_api.js` |
| **action_type 名称不匹配** | Facebook 返回的是 `mobile_app_purchase` 而不是 `purchase` | 检查 `action_values` 数组中的实际 `action_type` |
| **数据延迟** | `today` 数据不完整 | 使用 `last_7d` 数据 |

### 7.2 数据提取层面

| 问题 | 当前实现 | 建议 |
|------|---------|------|
| **只查找 `'purchase'`** | ✅ 已实现 | ❌ 应该也查找 `'mobile_app_purchase'` 和 `'offsite_conversion.fb_pixel_purchase'` |
| **未处理数组为空** | ✅ 已处理 | - |
| **未处理 value 为字符串** | ✅ 使用 `parseFloat` | - |

### 7.3 数据存储层面

| 问题 | 当前实现 | 状态 |
|------|---------|------|
| **level 字段缺失** | ❌ 旧数据没有 | ✅ 已修复：新写入会设置 |
| **entityId 字段缺失** | ❌ 旧数据没有 | ✅ 已修复：新写入会设置 |
| **action_values 未保存** | ❌ 旧逻辑可能未保存 | ✅ 已修复：新逻辑会保存 |

### 7.4 数据聚合层面

| 问题 | 当前实现 | 状态 |
|------|---------|------|
| **Ad → Campaign 聚合** | ✅ 已实现 | 需要确认是否正确执行 |
| **Purchase 值修正** | ✅ 已实现 | 需要确认是否定期运行 |

### 7.5 数据查询层面

| 问题 | 当前实现 | 状态 |
|------|---------|------|
| **查询条件不匹配** | ❌ 旧数据查询不到 | ✅ 已修复：使用 `$or` 兼容新旧格式 |
| **聚合数据丢失** | ⚠️ 可能存在问题 | 需要检查聚合逻辑 |

---

## Facebook API 文档参考

### 8.1 Insights API 文档

**官方文档**: 
- [Facebook Marketing API - Insights](https://developers.facebook.com/docs/marketing-api/insights)
- [Insights Parameters](https://developers.facebook.com/docs/marketing-api/insights/parameters)

### 8.2 Action Values 文档

**关键信息**:
- `action_values` 是一个数组，包含各种转化事件的价值
- 每个元素包含 `action_type` 和 `value` 字段
- `value` 是字符串格式的数字（需要 `parseFloat` 转换）

**文档链接**:
- [Actions Parameter](https://developers.facebook.com/docs/marketing-api/insights/parameters#actions)
- [Action Values](https://developers.facebook.com/docs/marketing-api/insights/parameters#action-values)

### 8.3 Purchase 相关的 action_type

根据 Facebook 文档，可能的 `action_type` 值包括：

| action_type | 说明 | 使用场景 |
|-------------|------|---------|
| `purchase` | 标准购买事件 | Web 网站购买 |
| `mobile_app_purchase` | 移动应用内购买 | iOS/Android 应用 |
| `offsite_conversion.fb_pixel_purchase` | Pixel 购买事件 | Facebook Pixel 触发的购买 |
| `offsite_conversion.fb_pixel_add_to_cart` | Pixel 加购事件 | Facebook Pixel 触发的加购 |

**当前实现只查找 `'purchase'`，可能遗漏其他类型！**

### 8.4 数据延迟说明

**Facebook 官方说明**:
- Purchase 数据通常有 **3-24 小时延迟**
- `today` 的数据可能不完整
- 建议使用 `last_7d` 或 `last_3d` 数据

**文档链接**:
- [Data Latency](https://developers.facebook.com/docs/marketing-api/insights/overview#data-latency)

### 8.5 层级数据准确性

**Facebook 官方说明**:
- Ad 级别的数据最准确
- Campaign 级别的数据是聚合的，可能不完整
- 建议从 Ad 级别向上聚合

**文档链接**:
- [Breakdowns and Aggregations](https://developers.facebook.com/docs/marketing-api/insights/breakdowns)

---

## 代码位置索引

### 关键文件

| 文件 | 功能 | 行数 |
|------|------|------|
| `src/integration/facebook/insights.api.ts` | Facebook API 请求 | 1-66 |
| `src/queue/facebook.worker.ts` | 数据提取和存储 | 42-50, 250-300 |
| `src/services/facebook.upsert.service.ts` | 数据存储服务 | 89-150 |
| `src/services/facebook.campaigns.service.ts` | 数据查询服务 | 795-814 |
| `src/services/facebook.aggregation.service.ts` | 数据聚合服务 | - |
| `src/services/facebook.purchase.correction.ts` | Purchase 值修正 | - |

### 关键函数

| 函数 | 文件 | 行数 | 功能 |
|------|------|------|------|
| `fetchInsights` | `insights.api.ts` | 3-66 | 请求 Facebook Insights API |
| `getActionValue` | `facebook.worker.ts` | 42-50 | 从 action_values 提取值 |
| `upsertMetricsDaily` | `upsert.service.ts` | 89-150 | 存储 MetricsDaily |
| `getCampaigns` | `campaigns.service.ts` | 150-846 | 查询 Campaign 列表 |

---

## 建议的修复方案

### 1. 扩展 action_type 查找范围

**当前代码**:
```typescript
const purchaseValue = getActionValue(insight.action_values, 'purchase')
```

**建议修改**:
```typescript
const getPurchaseValue = (actionValues: any[]): number => {
  if (!actionValues || !Array.isArray(actionValues)) return 0
  
  // 按优先级查找
  const types = [
    'purchase',
    'mobile_app_purchase',
    'offsite_conversion.fb_pixel_purchase'
  ]
  
  for (const type of types) {
    const action = actionValues.find(a => a.action_type === type)
    if (action && action.value) {
      return parseFloat(action.value) || 0
    }
  }
  
  return 0
}

const purchaseValue = getPurchaseValue(insight.action_values)
```

### 2. 优先使用 last_7d 数据

**当前逻辑**: 只存储 `today` 和 `yesterday` 到 MetricsDaily

**建议**: 在查询时，如果 `today` 的 purchase_value 为 0，尝试使用 `last_7d` 数据

### 3. 添加调试日志

**建议**: 在关键位置添加日志，记录：
- Facebook API 返回的 `action_values` 数组内容
- 提取的 `purchase_value` 值
- 数据聚合的结果

---

## 诊断工具

### 1. 数据库诊断

```bash
cd /root/autoark/autoark-backend
node diagnose_purchase_value.js
```

### 2. API 测试

```bash
cd /root/autoark/autoark-backend
node test_facebook_api.js
```

---

## 总结

### 当前实现的关键点

1. ✅ **API 请求正确**: 已请求 `action_values` 字段
2. ✅ **数据存储正确**: 已保存 `action_values` 数组和提取的 `purchase_value`
3. ✅ **数据聚合正确**: 从 Ad 级别向上聚合
4. ⚠️ **数据提取可能不完整**: 只查找 `'purchase'`，可能遗漏其他类型
5. ⚠️ **数据延迟未处理**: 未优先使用 `last_7d` 数据

### 需要您协助确认的事项

1. **运行诊断脚本**: 确认数据库中是否有 purchase 数据
2. **运行 API 测试**: 确认 Facebook API 是否返回 purchase 数据
3. **检查 action_type**: 确认实际的 `action_type` 名称是什么
4. **检查 Pixel 配置**: 确认网站是否正确发送 purchase 事件

---

**报告生成时间**: 2025-12-03
**代码版本**: Phase 6 (AI Integration)
**API 版本**: Facebook Graph API v19.0

