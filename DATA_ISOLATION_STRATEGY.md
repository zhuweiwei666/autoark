# 🔒 AutoArk 数据隔离策略

## 📋 权限体系回顾

```
超级管理员 (super_admin)
    ├─ 组织A (Organization A)
    │   ├─ 组织管理员 (org_admin)
    │   ├─ 成员1 (member)
    │   └─ 成员2 (member)
    └─ 组织B (Organization B)
        ├─ 组织管理员 (org_admin)
        └─ 成员1 (member)
```

---

## 🎯 数据模块分类

### 📌 类型 1: 必须完全隔离（按组织）

这些数据包含敏感业务信息，不同组织间必须完全不可见：

| 模块 | 模型 | 隔离原因 | 实施方案 |
|------|------|----------|----------|
| **广告账户** | `Account` | 核心业务资产，涉及资金 | ✅ 添加 `organizationId` |
| **广告系列** | `Campaign` | 营销策略机密 | ✅ 添加 `organizationId` |
| **广告组** | `AdSet` | 投放策略机密 | ✅ 添加 `organizationId` |
| **广告** | `Ad` | 具体投放内容 | ✅ 添加 `organizationId` |
| **Facebook Token** | `FbToken` | 高度敏感凭证 | ✅ 添加 `organizationId` |
| **Facebook 用户** | `FacebookUser` | 授权信息敏感 | ✅ 添加 `organizationId` |
| **广告草稿** | `AdDraft` | 未发布的创意 | ✅ 添加 `organizationId` |
| **广告任务** | `AdTask` | 批量创建任务 | ✅ 添加 `organizationId` |
| **创意** | `Creative` | 广告创意资产 | ✅ 添加 `organizationId` |
| **创意组** | `CreativeGroup` | 创意管理 | ✅ 添加 `organizationId` |
| **文件夹** | `Folder` | 资产组织结构 | ✅ 添加 `organizationId` |
| **AI 建议** | `AiSuggestion` | 个性化建议 | ✅ 添加 `organizationId` |
| **优化状态** | `OptimizationState` | 自动化策略状态 | ✅ 添加 `organizationId` |
| **规则** | `Rule` | 自动化规则配置 | ✅ 添加 `organizationId` |
| **操作日志** | `OpsLog` | 操作审计日志 | ✅ 添加 `organizationId` |
| **用户设置** | `UserSettings` | 个人设置 | ✅ 添加 `userId`（已有） |

---

### 📌 类型 2: 可选隔离（建议隔离）

这些数据可能包含业务策略，建议按组织隔离：

| 模块 | 模型 | 建议 | 实施方案 |
|------|------|------|----------|
| **素材库** | `Material` | **建议隔离** | ✅ 添加 `organizationId` |
| **素材指标** | `MaterialMetrics` | 跟随素材隔离 | ✅ 添加 `organizationId` |
| **文案包** | `CopywritingPackage` | **建议隔离**（可能包含商业机密） | ✅ 添加 `organizationId` |
| **定向包** | `TargetingPackage` | **建议隔离**（目标受众策略） | ✅ 添加 `organizationId` |
| **产品映射** | `Product` | **建议隔离**（产品目录不同） | ✅ 添加 `organizationId` |

---

### 📌 类型 3: 全局共享（系统级）

这些资源是系统级的，应该全局共享：

| 模块 | 模型 | 共享原因 | 实施方案 |
|------|------|----------|----------|
| **Facebook App** | `FacebookApp` | API 调用负载均衡，系统级资源 | ❌ 不添加 `organizationId` |
| **用户/组织** | `User`, `Organization` | 权限管理系统自身 | ❌ 不添加（自带隔离逻辑） |

---

### 📌 类型 4: 统计数据（特殊处理）

| 模块 | 模型 | 策略 | 实施方案 |
|------|------|------|----------|
| **原始指标** | `RawInsights` | 跟随广告/广告系列隔离 | ✅ 通过关联数据隔离 |
| **每日指标** | `MetricsDaily` | 跟随广告账户隔离 | ✅ 通过 `accountId` 关联隔离 |
| **汇总数据** | `Summary` | 按维度隔离 | ✅ 通过相关实体隔离 |
| **同步日志** | `SyncLog` | 跟随账户隔离 | ✅ 添加 `organizationId` |

---

## 🎨 推荐的隔离策略

### 策略 A: 严格隔离（推荐用于多租户SaaS）

**适用场景**：
- 多个独立公司使用同一系统
- 数据安全要求高
- 竞争对手可能同时使用

**实施方案**：
```typescript
// 所有业务数据都添加 organizationId
{
  organizationId: ObjectId,  // 必需
  createdBy: ObjectId,       // 创建者
  // ... 其他字段
}

// 查询时自动过滤
const data = await Model.find({
  organizationId: currentUser.organizationId
})
```

**优点**：
- ✅ 数据安全性最高
- ✅ 完全独立运营
- ✅ 易于导出/迁移单个组织数据

**缺点**：
- ❌ 无法共享资源（如素材库）
- ❌ 重复数据可能较多

---

### 策略 B: 灵活共享（推荐用于内部团队）

**适用场景**：
- 同一公司的不同部门/团队
- 希望共享部分资源
- 需要协作的场景

**实施方案**：
```typescript
// 核心业务数据隔离
{
  organizationId: ObjectId,  // 必需
  visibility: 'private' | 'organization' | 'public'
}

// 素材库等资源可选共享
{
  organizationId: ObjectId,  // 创建者组织
  sharedWith: [ObjectId],    // 可以共享给哪些组织
  isPublic: Boolean          // 是否全局可见
}
```

**优点**：
- ✅ 核心数据安全
- ✅ 可以共享通用资源
- ✅ 提高协作效率

**缺点**：
- ❌ 实现复杂度较高
- ❌ 权限管理更复杂

---

## 📊 具体模块建议

### 1. 必须隔离（按组织）

#### 账户相关
```typescript
// Account, Campaign, AdSet, Ad
{
  organizationId: { type: ObjectId, required: true, index: true },
  createdBy: { type: ObjectId, ref: 'User' }
}
```

**理由**：这是核心业务资产，涉及资金和营销策略

#### 凭证相关
```typescript
// FbToken, FacebookUser
{
  organizationId: { type: ObjectId, required: true, index: true }
}
```

**理由**：高度敏感，泄露会导致安全问题

#### 任务相关
```typescript
// AdTask, AdDraft
{
  organizationId: { type: ObjectId, required: true, index: true },
  createdBy: { type: ObjectId, ref: 'User' }
}
```

**理由**：包含未发布的策略和计划

---

### 2. 建议隔离（可选共享）

#### 素材库
```typescript
// Material
{
  organizationId: { type: ObjectId, required: true, index: true },
  visibility: { 
    type: String, 
    enum: ['private', 'organization', 'public'],
    default: 'organization'
  },
  sharedWith: [{ type: ObjectId, ref: 'Organization' }] // 可选
}
```

**建议策略**：
- `private`: 仅创建者可见
- `organization`: 组织内可见（默认）
- `public`: 全局可见（需超级管理员审核）

**理由**：
- 优点：允许共享通用素材（如节日素材）
- 缺点：需要权限管理

#### 文案包/定向包
```typescript
// CopywritingPackage, TargetingPackage
{
  organizationId: { type: ObjectId, required: true, index: true },
  isTemplate: { type: Boolean, default: false }, // 是否为模板
  visibility: { type: String, enum: ['private', 'organization', 'public'] }
}
```

**建议策略**：
- 默认组织隔离
- 超级管理员可创建"公共模板"供所有组织使用
- 组织可以基于模板创建自己的版本

---

### 3. 全局共享（系统级）

#### Facebook App 管理
```typescript
// FacebookApp
{
  // 不添加 organizationId
  managedBy: { type: ObjectId, ref: 'User' }, // 管理员
  allowedOrganizations: [{ type: ObjectId, ref: 'Organization' }] // 白名单（可选）
}
```

**理由**：
- Facebook App 用于 API 调用负载均衡
- 属于系统级配置
- 所有组织共享使用

---

### 4. 统计数据（间接隔离）

#### 指标数据
```typescript
// RawInsights, MetricsDaily
{
  accountId: String,  // 通过 accountId 关联
  campaignId: String,
  adId: String
  // 不直接添加 organizationId
  // 通过查询时 JOIN Account 来实现隔离
}
```

**查询示例**：
```typescript
// 获取组织的指标数据
const accounts = await Account.find({ organizationId })
const accountIds = accounts.map(a => a.accountId)
const metrics = await MetricsDaily.find({ 
  accountId: { $in: accountIds } 
})
```

**理由**：
- 数据量大，减少冗余字段
- 通过关联查询实现隔离

---

## 🎯 推荐实施方案

### 阶段 1: 核心隔离（当前优先）

**必须立即实施**：

1. **账户体系** ✅ 优先级最高
   - Account
   - Campaign
   - AdSet
   - Ad
   - FbToken
   - FacebookUser

2. **任务体系** ✅
   - AdTask
   - AdDraft
   - Folder

3. **规则引擎** ✅
   - Rule
   - OptimizationState
   - AiSuggestion
   - OpsLog

### 阶段 2: 资源隔离（中等优先）

**建议实施**：

4. **素材体系**
   - Material (添加 organizationId + visibility)
   - MaterialMetrics
   - Creative
   - CreativeGroup

5. **资产包**
   - CopywritingPackage (添加 organizationId + isTemplate)
   - TargetingPackage (添加 organizationId + isTemplate)
   - Product

### 阶段 3: 可选增强（低优先）

**可选功能**：

6. **共享机制**
   - 实现素材共享功能
   - 模板市场
   - 跨组织协作

---

## 💡 实际使用场景

### 场景 1: 电商公司的多品牌管理

**需求**：
- 公司有多个独立品牌
- 每个品牌独立运营
- 品牌间数据不能互相看到

**方案**：
```
超级管理员（公司 CEO）
├─ 品牌A组织（服装品牌）
│   ├─ 品牌A广告账户
│   ├─ 品牌A素材库
│   └─ 品牌A团队成员
└─ 品牌B组织（电子产品）
    ├─ 品牌B广告账户
    ├─ 品牌B素材库
    └─ 品牌B团队成员
```

**隔离级别**：严格隔离（策略A）

---

### 场景 2: 广告代理公司

**需求**：
- 为多个客户管理广告
- 客户间数据完全隔离
- 可能共享一些通用素材

**方案**：
```
超级管理员（代理公司）
├─ 客户A组织
│   ├─ 客户A的广告账户（完全隔离）
│   └─ 客户A的素材（可选共享公共素材）
└─ 客户B组织
    ├─ 客户B的广告账户（完全隔离）
    └─ 客户B的素材（可选共享公共素材）
```

**隔离级别**：核心隔离 + 可选共享（策略B）

---

### 场景 3: 集团公司内部使用

**需求**：
- 同一公司不同部门
- 各部门独立管理自己的广告
- 可以共享素材和模板

**方案**：
```
超级管理员（集团 IT）
├─ 市场部
│   ├─ 市场部广告账户（隔离）
│   └─ 可访问公共素材库
├─ 销售部
│   ├─ 销售部广告账户（隔离）
│   └─ 可访问公共素材库
└─ 公共素材库（全局共享）
```

**隔离级别**：灵活共享（策略B）

---

## 🛠️ 实施建议

### 立即实施（核心数据隔离）

**必须添加 `organizationId` 的模型**：

1. ✅ `Account` - 广告账户
2. ✅ `Campaign` - 广告系列
3. ✅ `AdSet` - 广告组
4. ✅ `Ad` - 广告
5. ✅ `FbToken` - Facebook Token
6. ✅ `FacebookUser` - Facebook 用户
7. ✅ `AdTask` - 广告任务
8. ✅ `AdDraft` - 广告草稿
9. ✅ `Creative` - 创意
10. ✅ `Folder` - 文件夹
11. ✅ `Rule` - 规则
12. ✅ `AiSuggestion` - AI 建议
13. ✅ `OptimizationState` - 优化状态
14. ✅ `OpsLog` - 操作日志

**统一的模型修改模式**：

```typescript
const schema = new mongoose.Schema({
  // 原有字段...
  
  // 新增字段
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  }
}, { timestamps: true })

// 添加组合索引
schema.index({ organizationId: 1, createdAt: -1 })
```

**统一的查询模式**：

```typescript
// 在 Service 层添加数据隔离
async getItems(currentUser: JwtPayload) {
  const query: any = {}
  
  // 非超级管理员只能看到自己组织的数据
  if (currentUser.role !== UserRole.SUPER_ADMIN) {
    query.organizationId = currentUser.organizationId
  }
  
  return await Model.find(query)
}
```

---

### 后续实施（可选共享）

**素材共享机制**：

```typescript
// Material 模型增强
const materialSchema = new mongoose.Schema({
  // ... 原有字段
  organizationId: { type: ObjectId, required: true },
  visibility: {
    type: String,
    enum: ['private', 'organization', 'public'],
    default: 'organization'
  },
  sharedWith: [{
    organizationId: { type: ObjectId, ref: 'Organization' },
    sharedAt: Date,
    sharedBy: { type: ObjectId, ref: 'User' }
  }],
  isApproved: Boolean, // 公共素材需要审核
})

// 查询逻辑
async getMaterials(currentUser: JwtPayload) {
  const query: any = {
    $or: [
      { organizationId: currentUser.organizationId }, // 自己组织的
      { visibility: 'public', isApproved: true },     // 公共的
      { 'sharedWith.organizationId': currentUser.organizationId } // 共享给我的
    ]
  }
  
  return await Material.find(query)
}
```

---

## ⚠️ 安全注意事项

### 1. 必须在中间件层面强制隔离

```typescript
// middlewares/dataIsolation.ts
export const enforceDataIsolation = (req, res, next) => {
  if (req.user.role !== 'super_admin') {
    // 自动在 query 和 body 中添加 organizationId
    req.organizationFilter = { 
      organizationId: req.user.organizationId 
    }
  }
  next()
}
```

### 2. API 层面验证

所有涉及数据访问的 API 都必须：
- ✅ 验证用户身份（authenticate）
- ✅ 检查权限（authorize）
- ✅ 应用数据隔离（dataIsolation）

### 3. 数据库层面

```typescript
// 为关键字段添加索引
schema.index({ organizationId: 1, status: 1 })
schema.index({ organizationId: 1, createdAt: -1 })

// 添加虚拟字段方便查询
schema.virtual('canAccess').get(function(userId, role) {
  if (role === 'super_admin') return true
  return this.organizationId.toString() === userId
})
```

---

## 📈 性能优化建议

### 1. 索引策略

```javascript
// 为所有添加 organizationId 的集合创建复合索引
db.accounts.createIndex({ organizationId: 1, status: 1 })
db.campaigns.createIndex({ organizationId: 1, status: 1 })
db.materials.createIndex({ organizationId: 1, createdAt: -1 })
```

### 2. 查询优化

```typescript
// 使用 lean() 减少内存占用
const data = await Model.find({ organizationId })
  .lean()
  .select('name status createdAt')
  .limit(100)
```

### 3. 缓存策略

```typescript
// Redis 缓存按组织分组
const cacheKey = `org:${organizationId}:accounts`
await redis.set(cacheKey, JSON.stringify(accounts), 'EX', 300)
```

---

## 🎯 最终推荐

### 当前阶段（MVP）

**采用策略 A（严格隔离）**：

✅ **必须隔离的 14 个模型**：
1. Account
2. Campaign
3. AdSet
4. Ad
5. FbToken
6. FacebookUser
7. AdTask
8. AdDraft
9. Creative
10. Folder
11. Rule
12. AiSuggestion
13. OptimizationState
14. OpsLog

✅ **建议隔离的 5 个模型**：
1. Material
2. MaterialMetrics
3. CopywritingPackage
4. TargetingPackage
5. Product

❌ **保持全局的 1 个模型**：
1. FacebookApp

---

### 未来增强

根据实际使用反馈，可以考虑：
- [ ] 实现素材共享机制
- [ ] 添加模板市场
- [ ] 支持跨组织协作
- [ ] 实现数据导出/导入

---

## 📞 决策建议

**我的建议**：

1. **第一步**：先实施严格隔离（策略A）
   - 保证数据安全
   - 实现简单
   - 满足基本需求

2. **第二步**：根据用户反馈优化
   - 如果用户反馈需要共享素材，再添加共享功能
   - 如果用户只需要完全隔离，保持现状

3. **灵活调整**：
   - 对于内部使用，可以放宽部分限制
   - 对于 SaaS 场景，必须严格隔离

---

**您觉得哪种策略更适合您的使用场景？**

- 🔒 **策略 A（严格隔离）** - 推荐用于多租户 SaaS
- 🤝 **策略 B（灵活共享）** - 推荐用于内部团队协作
- 🔧 **自定义策略** - 说明您的具体需求，我来定制方案
