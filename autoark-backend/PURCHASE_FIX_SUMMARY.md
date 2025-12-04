# Purchase 数据修复总结

## ✅ 已完成的修复

### 【任务 A】新增 extractPurchaseValue() 工具函数 ✅

**文件**: `src/utils/facebookPurchase.ts`

**功能**: 支持多种 Facebook 购买事件类型：
- `purchase` (标准购买)
- `mobile_app_purchase` (移动应用内购买)
- `offsite_conversion.fb_pixel_purchase` (Pixel 购买)
- `onsite_conversion.purchase` (站内转化购买)
- `onsite_conversion.purchase.mobile_app` (站内转化移动应用购买)

### 【任务 B】全局替换旧逻辑 ✅

**已替换的文件**:
1. ✅ `src/queue/facebook.worker.ts` - Ad Worker 数据提取
2. ✅ `src/services/facebook.campaigns.service.ts` - Campaign 同步和查询

**替换内容**:
```typescript
// 旧代码
const purchaseValue = getActionValue(insight.action_values, 'purchase')

// 新代码
import { extractPurchaseValue } from '../utils/facebookPurchase'
const purchaseValue = extractPurchaseValue(insight.action_values)
```

### 【任务 C】RawInsights 存储 ✅

**文件**: `src/services/facebook.upsert.service.ts`

**状态**: ✅ 已确认 RawInsights 正确写入 `purchase_value` 字段

### 【任务 D】MetricsDaily 写入 ✅

**文件**: `src/services/facebook.upsert.service.ts`

**状态**: ✅ 已确认 MetricsDaily 正确写入：
- `purchase_value`: 提取的数值
- `action_values`: 完整原始数组（用于后续提取）

### 【任务 E】修复 Campaign 查询 ✅

**文件**: `src/services/facebook.campaigns.service.ts` (约 795-822 行)

**修复逻辑**:
1. ✅ 优先使用 `purchase_value_corrected`（如果有）
2. ✅ 否则使用 `purchase_value`
3. ✅ 如果 `purchase_value` 为 0，则尝试从 `action_values` 重新提取 `extractPurchaseValue`
4. ✅ 最终仍无则返回 0

### 【任务 F】修复 Campaign 聚合逻辑 ✅

**文件**: `src/services/facebook.aggregation.service.ts`

**状态**: ✅ 已确认聚合逻辑正确：
- `purchase_value: { $sum: { $ifNull: ['$purchase_value', 0] } }`
- `action_values: { $first: '$action_values' }`

### 【任务 G】生成调试工具 ✅

**文件**: `scripts/debug_facebook_purchase.js`

**使用方法**:
```bash
npm run debug:purchase
```

**功能**:
- 自动从数据库获取 Ad ID
- 测试不同 `date_preset` (today, yesterday, last_3d, last_7d)
- 显示 `action_values` 数组内容
- 显示提取的 Purchase Value

### 【任务 H】重跑聚合脚本 ✅

**文件**: `scripts/rerun_purchase_aggregation.ts`

**使用方法**:
```bash
# 处理最近 7 天
ts-node scripts/rerun_purchase_aggregation.ts

# 处理指定日期
ts-node scripts/rerun_purchase_aggregation.ts 2025-12-03
```

**功能**:
1. 读取 RawInsights 中的所有数据
2. 使用新的 `extractPurchaseValue` 函数重新计算 `purchase_value`
3. 回填到 MetricsDaily

---

## 📋 最终检查项（任务 I）

### 1. 后端任意 adId 的 RawInsights 中 purchase_value 不为 0（如果有购买）

**检查方法**:
```bash
# 运行诊断脚本
node diagnose_purchase_value.js

# 或运行调试工具
npm run debug:purchase
```

### 2. MetricsDaily 对应日期的 purchase_value 不为 0

**检查方法**:
```bash
# 运行诊断脚本
node diagnose_purchase_value.js
```

### 3. Campaign 列表能够正确显示 purchase_value

**检查方法**:
- 访问前端 Campaign 页面
- 检查 `purchase_value` 列是否显示正确的值

### 4. 聚合统计（spend / purchase_value / ROAS）能正常计算

**检查方法**:
- 检查 Dashboard 页面
- 检查 Account Management 页面
- 确认 ROAS = purchase_value / spend 计算正确

### 5. 前端 Campaign 页面显示正确的 purchase_value

**检查方法**:
- 访问 `/fb-campaigns` 页面
- 检查 `purchase_value` 列是否显示正确的值（不为 0）

---

## 🚀 部署步骤

### 1. 构建代码

```bash
cd autoark-backend
npm run build
```

### 2. 部署到服务器

```bash
# 使用部署脚本
./deploy_with_frontend.sh

# 或手动部署
scp -r dist/ src/ scripts/ package.json root@139.162.24.176:/root/autoark/autoark-backend/
```

### 3. 重启服务

```bash
ssh root@139.162.24.176 'cd /root/autoark/autoark-backend && npm install && pm2 restart autoark --update-env'
```

### 4. 重跑历史数据（可选但推荐）

```bash
ssh root@139.162.24.176 'cd /root/autoark/autoark-backend && ts-node scripts/rerun_purchase_aggregation.ts'
```

### 5. 验证修复

```bash
# 在服务器上运行
ssh root@139.162.24.176 'cd /root/autoark/autoark-backend && npm run debug:purchase'
```

---

## 📝 关键变更文件

1. ✅ `src/utils/facebookPurchase.ts` (新建)
2. ✅ `src/queue/facebook.worker.ts` (修改)
3. ✅ `src/services/facebook.campaigns.service.ts` (修改)
4. ✅ `src/services/facebook.upsert.service.ts` (已确认正确)
5. ✅ `src/services/facebook.aggregation.service.ts` (已确认正确)
6. ✅ `scripts/debug_facebook_purchase.js` (新建)
7. ✅ `scripts/rerun_purchase_aggregation.ts` (新建)
8. ✅ `package.json` (添加 debug:purchase 脚本)

---

## 🔍 问题排查

如果 purchase_value 仍然为 0，请检查：

1. **Facebook API 是否返回了 purchase 数据**
   ```bash
   npm run debug:purchase
   ```

2. **数据库中是否有数据**
   ```bash
   node diagnose_purchase_value.js
   ```

3. **action_type 是否匹配**
   - 检查 `action_values` 数组中的实际 `action_type`
   - 确认是否在支持的 5 种类型中

4. **数据同步是否正常**
   - 检查队列系统是否正常运行
   - 检查 RawInsights 是否有数据

---

## 📚 相关文档

- `PURCHASE_EVENT_CAPTURE_REPORT.md` - Purchase 事件抓取路径详细报告
- `PURCHASE_VALUE_ANALYSIS.md` - Purchase Value 问题分析

---

**修复完成时间**: 2025-12-03
**代码版本**: Phase 6 (AI Integration) + Purchase Fix

