# Purchase Value 数据缺失问题分析

## 问题描述

前端显示所有 campaign 的 `purchase_value` 都是 `$0.00`，但实际 Facebook API 可能返回了 purchase 数据。

## 根本原因分析

### 1. **数据写入问题**

**旧同步逻辑** (`syncCampaignsFromAdAccounts`) 存在的问题：
- ❌ 没有设置 `level` 字段（导致 `level: undefined`）
- ❌ 没有设置 `entityId` 字段
- ❌ 使用旧的查询条件 `{ campaignId, date, country }`，而不是新的唯一索引 `{ date, level, entityId, country }`

**修复方案**：
- ✅ 在写入时明确设置 `level: 'campaign'` 和 `entityId: campaignId`
- ✅ 使用新的唯一索引进行查询和更新

### 2. **数据查询问题**

**查询逻辑** (`getCampaigns`) 存在的问题：
- ❌ 只查询 `campaignId`，没有查询 `level: 'campaign'`
- ❌ 没有兼容旧数据（没有 `level` 字段的数据）

**修复方案**：
- ✅ 使用 `$or` 查询，同时支持新格式和旧格式数据
- ✅ 优先查询 `level: 'campaign'` 的数据

### 3. **Facebook API 数据获取问题**

**可能的原因**：
1. **API 字段请求正确**：代码中已请求 `action_values` 字段 ✅
2. **数据提取逻辑正确**：`getActionValue(insight.action_values, 'purchase')` 应该能正确提取 ✅
3. **但可能的问题**：
   - Facebook API 可能没有返回 `purchase` 类型的 `action_values`（可能返回的是 `mobile_app_purchase` 或其他类型）
   - 数据可能只在 Ad 级别存在，Campaign 级别聚合时丢失
   - 数据延迟：Facebook 的 purchase 数据通常有 3-24 小时延迟

## 需要您协助检查的事项

### 1. **检查 Facebook API 实际返回的数据**

请运行以下命令检查 Facebook API 是否返回了 purchase 数据：

```bash
# 在服务器上运行
cd /root/autoark/autoark-backend
node test_facebook_api.js
```

这个脚本会：
- 测试 Ad 级别的 insights（`date_preset: today`）
- 测试 Campaign 级别的 insights（`date_preset: today`）
- 测试 Ad 级别的 insights（`date_preset: last_7d`）
- 显示 `action_values` 数组中的所有类型和值

### 2. **检查数据库中的原始数据**

请运行以下命令检查数据库中是否有 purchase 数据：

```bash
# 在服务器上运行
cd /root/autoark/autoark-backend
node diagnose_purchase_value.js
```

这个脚本会：
- 检查 `MetricsDaily` 中的 `purchase_value` 数据
- 检查 `RawInsights` 中的原始 API 响应
- 显示 `action_values` 字段的内容

### 3. **检查 Facebook Pixel 事件**

Purchase 数据通常来自 Facebook Pixel 的 `purchase` 事件。请检查：
1. 您的网站是否正确安装了 Facebook Pixel
2. Pixel 是否正确触发了 `purchase` 事件
3. 事件中是否包含了 `value` 参数

### 4. **检查广告目标**

某些广告目标（如 `LEAD_GEN`）可能不会产生 purchase 数据。请确认：
- 广告系列的目标（`objective`）是什么？
- 如果目标是 `LEAD_GEN`，那么不会有 purchase 数据，这是正常的

## 已实施的修复

### 1. **修复数据写入逻辑**

```typescript
// 在 syncCampaignsFromAdAccounts 中
const metricsData: any = {
  // ... 其他字段
  level: 'campaign', // ✅ 明确设置级别
  entityId: camp.id, // ✅ 设置 entityId 为 campaignId
  action_values: insight.action_values, // ✅ 保存原始 action_values
  purchase_value: getActionValue(insight.action_values, 'purchase'), // ✅ 提取 purchase value
}

// 使用新的唯一索引查询
await MetricsDaily.findOneAndUpdate(
  { 
    date: metricsData.date, 
    level: 'campaign', // ✅ 使用 level 字段
    entityId: camp.id, // ✅ 使用 entityId 字段
    country: country || null 
  },
  { $set: metricsData, $unset: { adId: '', adsetId: '' } },
  { upsert: true, new: true }
)
```

### 2. **修复数据查询逻辑**

```typescript
// 在 getCampaigns 中
const metricsQuery: any = {
  $or: [
    // 新格式：使用 level 和 entityId
    { level: 'campaign', entityId: { $in: allCampaignIds } },
    // 旧格式：兼容没有 level 字段的数据
    { level: { $exists: false }, campaignId: { $in: allCampaignIds, $exists: true, $ne: null } }
  ]
}
```

## 下一步行动

1. **运行诊断脚本**：确认数据库中是否有 purchase 数据
2. **运行 API 测试脚本**：确认 Facebook API 是否返回 purchase 数据
3. **检查 Pixel 事件**：确认网站是否正确发送 purchase 事件
4. **检查广告目标**：确认广告系列的目标是否会产生 purchase 数据

## 如果 Facebook API 确实没有返回 purchase 数据

可能的原因：
1. **Pixel 未正确配置**：网站没有发送 purchase 事件
2. **数据延迟**：Facebook 的 purchase 数据通常有延迟，建议使用 `last_7d` 而不是 `today`
3. **广告目标不匹配**：某些广告目标（如 `LEAD_GEN`）不会产生 purchase 数据
4. **权限问题**：Token 可能没有访问 purchase 数据的权限

## 建议的解决方案

如果确认 Facebook API 没有返回 purchase 数据：
1. 检查并修复 Facebook Pixel 配置
2. 使用 `last_7d` 数据而不是 `today` 数据（已在队列系统中实现）
3. 考虑使用 `purchase_roas` 字段作为替代指标

