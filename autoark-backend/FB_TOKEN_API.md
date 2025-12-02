# Facebook Token 管理 API 文档

## 功能概述

- ✅ 绑定 Facebook token
- ✅ 每小时自动检查 token 状态
- ✅ Token 存储到数据库
- ✅ Token 绑定优化师
- ✅ 支持通过优化师或日期筛选 token

## API 端点

### 1. 绑定 Token

**POST** `/api/fb-token`

绑定一个新的 Facebook token，如果已存在则更新。

**请求体：**
```json
{
  "token": "your-facebook-access-token",
  "optimizer": "优化师名称（可选）",
  "userId": "用户ID（可选，默认为 'default-user'）"
}
```

**响应：**
```json
{
  "success": true,
  "message": "Facebook token saved successfully",
  "data": {
    "id": "token-id",
    "userId": "default-user",
    "optimizer": "优化师名称",
    "status": "active",
    "fbUserId": "facebook-user-id",
    "fbUserName": "Facebook User Name",
    "expiresAt": "2025-12-31T23:59:59.000Z",
    "lastCheckedAt": "2025-12-02T05:00:00.000Z"
  }
}
```

### 2. 获取 Token 列表（支持筛选）

**GET** `/api/fb-token`

获取 token 列表，支持多种筛选条件。

**查询参数：**
- `optimizer` (可选): 按优化师筛选
- `startDate` (可选): 开始日期（ISO 格式，如 `2025-12-01`）
- `endDate` (可选): 结束日期（ISO 格式，如 `2025-12-31`）
- `status` (可选): 状态筛选 (`active` | `expired` | `invalid`)

**示例：**
```
GET /api/fb-token?optimizer=张三&status=active
GET /api/fb-token?startDate=2025-12-01&endDate=2025-12-31
GET /api/fb-token?optimizer=李四&startDate=2025-12-01
```

**响应：**
```json
{
  "success": true,
  "data": [
    {
      "id": "token-id",
      "userId": "default-user",
      "optimizer": "优化师名称",
      "status": "active",
      "fbUserId": "facebook-user-id",
      "fbUserName": "Facebook User Name",
      "expiresAt": "2025-12-31T23:59:59.000Z",
      "lastCheckedAt": "2025-12-02T05:00:00.000Z",
      "createdAt": "2025-12-01T10:00:00.000Z",
      "updatedAt": "2025-12-02T05:00:00.000Z"
    }
  ],
  "count": 1
}
```

### 3. 获取单个 Token 详情

**GET** `/api/fb-token/:id`

获取指定 token 的详细信息。

**响应：**
```json
{
  "success": true,
  "data": {
    "id": "token-id",
    "userId": "default-user",
    "optimizer": "优化师名称",
    "status": "active",
    "fbUserId": "facebook-user-id",
    "fbUserName": "Facebook User Name",
    "expiresAt": "2025-12-31T23:59:59.000Z",
    "lastCheckedAt": "2025-12-02T05:00:00.000Z",
    "createdAt": "2025-12-01T10:00:00.000Z",
    "updatedAt": "2025-12-02T05:00:00.000Z"
  }
}
```

### 4. 手动检查 Token 状态

**POST** `/api/fb-token/:id/check`

手动触发 token 状态检查（不等待定时任务）。

**响应：**
```json
{
  "success": true,
  "message": "Token status checked",
  "data": {
    "id": "token-id",
    "status": "active",
    "lastCheckedAt": "2025-12-02T05:00:00.000Z",
    "expiresAt": "2025-12-31T23:59:59.000Z"
  }
}
```

### 5. 更新 Token

**PUT** `/api/fb-token/:id`

更新 token 信息（如更新优化师）。

**请求体：**
```json
{
  "optimizer": "新的优化师名称"
}
```

**响应：**
```json
{
  "success": true,
  "message": "Token updated successfully",
  "data": {
    "id": "token-id",
    "userId": "default-user",
    "optimizer": "新的优化师名称",
    "status": "active",
    "fbUserId": "facebook-user-id",
    "fbUserName": "Facebook User Name",
    "expiresAt": "2025-12-31T23:59:59.000Z",
    "lastCheckedAt": "2025-12-02T05:00:00.000Z",
    "createdAt": "2025-12-01T10:00:00.000Z",
    "updatedAt": "2025-12-02T05:30:00.000Z"
  }
}
```

### 6. 删除 Token

**DELETE** `/api/fb-token/:id`

删除指定的 token。

**响应：**
```json
{
  "success": true,
  "message": "Token deleted successfully"
}
```

## Token 状态说明

- `active`: Token 有效且可用
- `expired`: Token 已过期
- `invalid`: Token 无效（可能已被撤销或格式错误）

## 定时任务

系统每小时自动检查所有 token 的状态（Cron: `0 * * * *`），更新以下字段：
- `status`: 根据验证结果更新状态
- `lastCheckedAt`: 最后检查时间
- `expiresAt`: Token 过期时间（如果 Facebook API 返回）
- `fbUserId` / `fbUserName`: Facebook 用户信息

## 使用示例

### 使用 curl 绑定 token

```bash
curl -X POST http://localhost:3001/api/fb-token \
  -H "Content-Type: application/json" \
  -d '{
    "token": "your-facebook-access-token",
    "optimizer": "张三"
  }'
```

### 使用 curl 查询 token（按优化师筛选）

```bash
curl "http://localhost:3001/api/fb-token?optimizer=张三&status=active"
```

### 使用 curl 查询 token（按日期筛选）

```bash
curl "http://localhost:3001/api/fb-token?startDate=2025-12-01&endDate=2025-12-31"
```

## 注意事项

1. **Token 安全**: API 响应中不会返回 token 本身，只返回 token 的元数据
2. **自动验证**: 绑定 token 时会自动验证 token 的有效性
3. **定时检查**: 系统每小时自动检查所有 token，无需手动触发
4. **向后兼容**: 现有的 `getFacebookAccessToken()` 函数仍然可用，会获取默认用户的 active token

