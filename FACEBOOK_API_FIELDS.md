# Facebook Graph API 字段完整列表

本文档列出了 Facebook Graph API v19.0 中可用于广告系列（Campaign）和成效数据（Insights）的所有字段。

## 📋 目录
1. [Campaign 字段（广告系列基础信息）](#campaign-字段)
2. [Insights 字段（成效指标）](#insights-字段)
3. [Actions 字段（用户操作）](#actions-字段)
4. [Action Values 字段（操作价值）](#action-values-字段)

---

## Campaign 字段

### 基础信息
| 字段名 | 类型 | 说明 | 当前使用 |
|--------|------|------|---------|
| `id` | string | 广告系列 ID | ✅ 已使用 (campaignId) |
| `name` | string | 广告系列名称 | ✅ 已使用 |
| `status` | string | 状态 (ACTIVE, PAUSED, ARCHIVED, DELETED) | ✅ 已使用 |
| `objective` | string | 广告目标 (OUTCOME_TRAFFIC, OUTCOME_LEADS, OUTCOME_APP_PROMOTION, etc.) | ✅ 已使用 |
| `created_time` | datetime | 创建时间 | ✅ 已使用 |
| `updated_time` | datetime | 更新时间 | ✅ 已使用 |

### 预算相关
| 字段名 | 类型 | 说明 | 当前使用 |
|--------|------|------|---------|
| `daily_budget` | string | 日预算（以分为单位） | ✅ 已使用 |
| `budget_remaining` | string | 剩余预算（以分为单位） | ✅ 已使用 |
| `lifetime_budget` | string | 生命周期预算 | ❌ 未使用 |
| `budget_rebalance_flag` | boolean | 预算重新平衡标志 | ❌ 未使用 |

### 购买和出价
| 字段名 | 类型 | 说明 | 当前使用 |
|--------|------|------|---------|
| `buying_type` | string | 购买类型 (AUCTION, RESERVATION) | ✅ 已使用 |
| `bid_strategy` | string | 出价策略 | ❌ 未使用 |
| `bid_amount` | number | 出价金额 | ❌ 未使用 |

### 其他
| 字段名 | 类型 | 说明 | 当前使用 |
|--------|------|------|---------|
| `account_id` | string | 账户 ID | ✅ 已使用 (accountId) |
| `start_time` | datetime | 开始时间 | ❌ 未使用 |
| `stop_time` | datetime | 停止时间 | ❌ 未使用 |
| `special_ad_categories` | array | 特殊广告类别 | ❌ 未使用 |
| `source_campaign` | object | 源广告系列 | ❌ 未使用 |
| `source_campaign_id` | string | 源广告系列 ID | ❌ 未使用 |
| `promoted_object` | object | 推广对象 | ❌ 未使用 |
| `recommendations` | array | 建议 | ❌ 未使用 |

---

## Insights 字段

### 基础指标
| 字段名 | 类型 | 说明 | 当前使用 | 计算方式 |
|--------|------|------|---------|---------|
| `impressions` | number | 展示次数 | ✅ 已使用 | - |
| `clicks` | number | 点击次数 | ✅ 已使用 | - |
| `unique_clicks` | number | 独立点击次数 | ❌ 未使用 | - |
| `spend` | number | 花费（美元） | ✅ 已使用 (spendUsd) | - |
| `reach` | number | 触及人数 | ❌ 未使用 | - |
| `frequency` | number | 频次 | ❌ 未使用 | - |

### 成本指标
| 字段名 | 类型 | 说明 | 当前使用 | 计算方式 |
|--------|------|------|---------|---------|
| `cpc` | number | 每次点击成本 | ✅ 已使用 | spend / clicks |
| `cpm` | number | 每千次展示成本 | ✅ 已使用 | (spend / impressions) * 1000 |
| `cpp` | number | 每次购买成本 | ❌ 未使用 | spend / purchases |
| `cpa` | number | 每次操作成本 | ❌ 未使用 | spend / actions |
| `ctr` | number | 点击率 | ✅ 已使用 | (clicks / impressions) * 100 |

### 转化指标
| 字段名 | 类型 | 说明 | 当前使用 | 计算方式 |
|--------|------|------|---------|---------|
| `conversions` | number | 转化次数（通用） | ❌ 未使用 | - |
| `cost_per_conversion` | number | 每次转化成本 | ❌ 未使用 | spend / conversions |
| `conversion_rate` | number | 转化率 | ❌ 未使用 | (conversions / clicks) * 100 |

### 价值指标
| 字段名 | 类型 | 说明 | 当前使用 | 计算方式 |
|--------|------|------|---------|---------|
| `purchase_roas` | array | 购买 ROAS | ✅ 已使用 | - |
| `value` | number | 总价值 | ❌ 未使用 | - |
| `cost_per_action_type` | array | 每种操作类型的成本 | ❌ 未使用 | - |

### 时间相关
| 字段名 | 类型 | 说明 | 当前使用 |
|--------|------|------|---------|
| `date_start` | string | 开始日期 (YYYY-MM-DD) | ✅ 已使用 |
| `date_stop` | string | 结束日期 (YYYY-MM-DD) | ✅ 已使用 |

### 其他指标
| 字段名 | 类型 | 说明 | 当前使用 |
|--------|------|------|---------|
| `actions` | array | 用户操作数组 | ✅ 已使用 |
| `action_values` | array | 操作价值数组 | ✅ 已使用 |
| `unique_actions` | array | 独立操作数组 | ❌ 未使用 |
| `video_play_actions` | number | 视频播放次数 | ❌ 未使用 |
| `video_30_sec_watched_actions` | number | 视频观看30秒次数 | ❌ 未使用 |
| `video_avg_time_watched_actions` | number | 平均观看时长 | ❌ 未使用 |
| `video_p100_watched_actions` | number | 视频观看100%次数 | ❌ 未使用 |
| `video_p25_watched_actions` | number | 视频观看25%次数 | ❌ 未使用 |
| `video_p50_watched_actions` | number | 视频观看50%次数 | ❌ 未使用 |
| `video_p75_watched_actions` | number | 视频观看75%次数 | ❌ 未使用 |
| `video_p95_watched_actions` | number | 视频观看95%次数 | ❌ 未使用 |
| `video_play_retention_0s_to_15s_actions` | number | 视频播放保留0-15秒 | ❌ 未使用 |
| `video_play_retention_20s_to_60s_actions` | number | 视频播放保留20-60秒 | ❌ 未使用 |
| `video_play_retention_graph_actions` | array | 视频播放保留图表 | ❌ 未使用 |
| `video_thruplay_watched_actions` | number | 视频完整播放次数 | ❌ 未使用 |
| `video_time_watched_actions` | number | 视频观看总时长 | ❌ 未使用 |

---

## Actions 字段

`actions` 是一个数组，包含各种用户操作。每个操作对象包含：
- `action_type`: 操作类型（字符串）
- `value`: 操作次数（数字）

### 常见的 action_type 值：

| action_type | 说明 | 当前使用 |
|-------------|------|---------|
| `mobile_app_install` | 移动应用安装 | ✅ 已使用 (installs) |
| `link_click` | 链接点击 | ❌ 未使用 |
| `page_engagement` | 页面互动 | ❌ 未使用 |
| `post_engagement` | 帖子互动 | ❌ 未使用 |
| `post` | 帖子操作 | ❌ 未使用 |
| `post_reaction` | 帖子反应 | ❌ 未使用 |
| `comment` | 评论 | ❌ 未使用 |
| `like` | 点赞 | ❌ 未使用 |
| `share` | 分享 | ❌ 未使用 |
| `video_view` | 视频观看 | ❌ 未使用 |
| `onsite_conversion.messaging_conversation_started_7d` | 7天内开始的消息对话 | ❌ 未使用 |
| `onsite_conversion.messaging_first_reply_7d` | 7天内首次回复 | ❌ 未使用 |
| `lead` | 潜在客户 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_purchase` | Facebook Pixel 购买 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_add_to_cart` | Facebook Pixel 加入购物车 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_initiate_checkout` | Facebook Pixel 开始结账 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_search` | Facebook Pixel 搜索 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_view_content` | Facebook Pixel 查看内容 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_add_payment_info` | Facebook Pixel 添加支付信息 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_complete_registration` | Facebook Pixel 完成注册 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_lead` | Facebook Pixel 潜在客户 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_purchase` | Facebook Pixel 购买 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_schedule` | Facebook Pixel 预约 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_subscribe` | Facebook Pixel 订阅 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_find_location` | Facebook Pixel 查找位置 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_contact` | Facebook Pixel 联系 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_customize_product` | Facebook Pixel 自定义产品 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_donate` | Facebook Pixel 捐赠 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_add_to_wishlist` | Facebook Pixel 加入愿望清单 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_start_trial` | Facebook Pixel 开始试用 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_submit_application` | Facebook Pixel 提交申请 | ❌ 未使用 |

---

## Action Values 字段

`action_values` 是一个数组，包含各种操作的价值。每个价值对象包含：
- `action_type`: 操作类型（字符串）
- `value`: 操作价值（数字，通常为美元）

### 常见的 action_type 值：

| action_type | 说明 | 当前使用 |
|-------------|------|---------|
| `purchase` | 购买价值 | ✅ 已使用 (purchase_value) |
| `mobile_app_purchase` | 移动应用购买价值 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_purchase` | Facebook Pixel 购买价值 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_add_to_cart` | Facebook Pixel 加入购物车价值 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_initiate_checkout` | Facebook Pixel 开始结账价值 | ❌ 未使用 |
| `offsite_conversion.fb_pixel_lead` | Facebook Pixel 潜在客户价值 | ❌ 未使用 |

---

## Purchase ROAS 字段

`purchase_roas` 是一个数组，包含各种购买相关的 ROAS。每个 ROAS 对象包含：
- `action_type`: 操作类型（字符串）
- `value`: ROAS 值（数字）

### 常见的 action_type 值：

| action_type | 说明 | 当前使用 |
|-------------|------|---------|
| `purchase` | 购买 ROAS | ✅ 已使用 (roas) |
| `mobile_app_purchase` | 移动应用购买 ROAS | ❌ 未使用 |
| `offsite_conversion.fb_pixel_purchase` | Facebook Pixel 购买 ROAS | ❌ 未使用 |

---

## 计算字段（需要从基础字段计算）

| 字段名 | 计算方式 | 说明 | 当前使用 |
|--------|---------|------|---------|
| `cpi` | `spend / installs` | 每次安装成本 | ✅ 已使用 |
| `roas` | `purchase_value / spend` | 广告支出回报率 | ✅ 已使用 (从 purchase_roas 获取) |
| `conversion_rate` | `(conversions / clicks) * 100` | 转化率 | ❌ 未使用 |
| `cost_per_conversion` | `spend / conversions` | 每次转化成本 | ❌ 未使用 |
| `reach_frequency` | `reach * frequency` | 触及频次 | ❌ 未使用 |

---

## 建议添加的字段

基于以上列表，建议添加以下字段到自定义列：

### 高优先级
1. **reach** - 触及人数
2. **frequency** - 频次
3. **unique_clicks** - 独立点击次数
4. **conversions** - 转化次数（通用）
5. **cost_per_conversion** - 每次转化成本
6. **conversion_rate** - 转化率

### 中优先级
7. **video_play_actions** - 视频播放次数
8. **video_30_sec_watched_actions** - 视频观看30秒次数
9. **link_click` - 链接点击次数
10. **lead** - 潜在客户数量

### 低优先级
11. **cpp** - 每次购买成本
12. **cpa** - 每次操作成本
13. **lifetime_budget** - 生命周期预算
14. **start_time** - 开始时间
15. **stop_time** - 停止时间

---

## 注意事项

1. **字段可用性**：某些字段可能只在特定条件下可用（例如，某些字段只在特定广告目标下可用）
2. **数据延迟**：某些指标可能有数据延迟（通常为几小时）
3. **权限要求**：某些字段可能需要特定的广告账户权限
4. **API 版本**：字段可能因 API 版本而异，当前使用的是 v19.0

---

## 参考链接

- [Facebook Marketing API - Campaign](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group)
- [Facebook Marketing API - Insights](https://developers.facebook.com/docs/marketing-api/insights)
- [Facebook Marketing API - Actions](https://developers.facebook.com/docs/marketing-api/insights/parameters#actions)

