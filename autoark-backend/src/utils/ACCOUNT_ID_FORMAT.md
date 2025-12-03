# AccountId 格式统一规范

## 📋 规范说明

### 1. 存储格式（数据库）
- **格式**：去掉 `act_` 前缀
- **示例**：`1380155640310764`
- **适用范围**：所有数据库模型（Account, Campaign, MetricsDaily 等）

### 2. API 调用格式（Facebook Graph API）
- **格式**：添加 `act_` 前缀
- **示例**：`act_1380155640310764`
- **适用范围**：所有调用 Facebook API 的地方

### 3. 查询格式（兼容历史数据）
- **格式**：同时支持带前缀和不带前缀两种格式
- **原因**：历史数据可能存在格式不一致的情况
- **实现**：使用 `getAccountIdsForQuery()` 函数

## 🔧 工具函数

所有 accountId 格式转换都应该使用 `src/utils/accountId.ts` 中的工具函数：

### `normalizeForStorage(accountId: string): string`
将 accountId 转换为数据库存储格式（去掉前缀）
```typescript
normalizeForStorage('act_1380155640310764') // '1380155640310764'
normalizeForStorage('1380155640310764') // '1380155640310764'
```

### `normalizeForApi(accountId: string): string`
将 accountId 转换为 Facebook API 调用格式（添加前缀）
```typescript
normalizeForApi('1380155640310764') // 'act_1380155640310764'
normalizeForApi('act_1380155640310764') // 'act_1380155640310764'
```

### `getAccountIdsForQuery(accountIds: string[]): string[]`
获取用于查询的 accountId 数组（同时包含两种格式，用于兼容历史数据）
```typescript
getAccountIdsForQuery(['1380155640310764'])
// ['1380155640310764', 'act_1380155640310764']
```

### `normalizeFromQuery(accountId: string): string`
统一处理从数据库查询结果中获取的 accountId
```typescript
normalizeFromQuery('act_1380155640310764') // '1380155640310764'
normalizeFromQuery('1380155640310764') // '1380155640310764'
```

## 📝 使用示例

### 存储数据到数据库
```typescript
import { normalizeForStorage } from '../utils/accountId'

// Facebook API 返回的 accountId 带前缀
const fbAccountId = 'act_1380155640310764'

// 存储到数据库时去掉前缀
const accountData = {
  accountId: normalizeForStorage(fbAccountId), // '1380155640310764'
  // ... 其他字段
}
```

### 调用 Facebook API
```typescript
import { normalizeForApi } from '../utils/accountId'

// 数据库中的 accountId 不带前缀
const dbAccountId = '1380155640310764'

// 调用 API 时添加前缀
const apiAccountId = normalizeForApi(dbAccountId) // 'act_1380155640310764'
const campaigns = await fetchCampaigns(apiAccountId, token)
```

### 查询数据库（兼容历史数据）
```typescript
import { getAccountIdsForQuery, normalizeFromQuery } from '../utils/accountId'

// 数据库中的 accountId 不带前缀
const accountIds = ['1380155640310764', '1171512541196793']

// 查询时同时支持两种格式
const allAccountIds = getAccountIdsForQuery(accountIds)
// ['1380155640310764', 'act_1380155640310764', '1171512541196793', 'act_1171512541196793']

const results = await MetricsDaily.aggregate([
  { $match: { accountId: { $in: allAccountIds } } },
  // ...
])

// 处理查询结果时统一格式
results.forEach((item: any) => {
  const normalizedId = normalizeFromQuery(item._id)
  // ...
})
```

## ⚠️ 注意事项

1. **不要手动处理格式**：永远使用工具函数，不要手动 `replace('act_', '')` 或 `'act_' + id`
2. **存储时统一格式**：所有存储到数据库的数据，accountId 都应该是不带前缀的格式
3. **API 调用时统一格式**：所有调用 Facebook API 的地方，都应该使用带前缀的格式
4. **查询时兼容历史数据**：使用 `getAccountIdsForQuery()` 来兼容可能存在的格式不一致

## 🔄 迁移说明

如果发现历史数据中存在格式不一致的情况：
1. 使用 `getAccountIdsForQuery()` 来兼容查询
2. 逐步迁移数据到统一格式（可选，非必需）
3. 新数据必须遵循统一格式规范

