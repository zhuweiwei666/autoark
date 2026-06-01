# AutoArk 三级权限系统使用指南

## 📋 系统概述

AutoArk 已配置完整的三级权限账号系统，支持：

- **超级管理员 (Super Admin)**: 系统最高权限，可管理所有组织和用户
- **组织管理员 (Org Admin)**: 组织负责人，可管理本组织内的用户
- **普通成员 (Member)**: 基础用户，只能访问自己组织的数据

### 核心特性

✅ 三级权限体系（super_admin、org_admin、member）  
✅ 组织数据完全隔离  
✅ JWT Token 认证  
✅ 密码加密存储（bcrypt）  
✅ 角色权限控制  
✅ 前后端路由保护  

---

## 🚀 快速开始

### 1. 配置环境变量

在 `autoark-backend/.env` 文件中添加以下配置：

```bash
# JWT 配置
JWT_SECRET=<生成一个长随机字符串>
JWT_EXPIRES_IN=7d

# 超级管理员初始账号（可选自定义）
SUPER_ADMIN_USERNAME=admin
SUPER_ADMIN_PASSWORD=<设置强密码>
SUPER_ADMIN_EMAIL=admin@autoark.com

# MongoDB 配置
MONGO_URI=mongodb://localhost:27017/autoark
```

### 2. 安装依赖

```bash
# 后端
cd autoark-backend
npm install

# 前端
cd autoark-frontend
npm install
```

### 3. 初始化超级管理员

首次部署时，运行以下命令创建超级管理员账号：

```bash
cd autoark-backend
npm run init:super-admin
```

执行成功后会显示：

```
✅ 超级管理员创建成功!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
用户名: admin
密码: 使用部署环境中的 `SUPER_ADMIN_PASSWORD`
邮箱: admin@autoark.com
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  请妥善保管超级管理员密码，并在首次登录后修改!
```

### 4. 启动系统

```bash
# 后端
cd autoark-backend
npm run build
npm start

# 前端（开发模式）
cd autoark-frontend
npm run dev

# 或者编译生产版本
npm run build
```

### 5. 登录系统

访问 `http://localhost:3000/login`，使用超级管理员账号登录：

- 用户名：`admin`
- 密码：使用部署环境中的 `SUPER_ADMIN_PASSWORD`

**⚠️ 重要：首次登录后请立即修改密码！**

---

## 👥 用户管理流程

### 创建组织

1. 使用超级管理员账号登录
2. 进入"组织管理"页面
3. 点击"创建组织"按钮
4. 填写组织信息和管理员账号：
   - 组织名称
   - 组织描述
   - 管理员用户名
   - 管理员密码
   - 管理员邮箱
5. 提交后，系统会自动创建：
   - 新组织
   - 组织管理员账号

### 创建子账号

#### 方式一：超级管理员创建

1. 登录超级管理员账号
2. 进入"用户管理"页面
3. 点击"创建用户"
4. 选择组织和角色
5. 填写用户信息并提交

#### 方式二：组织管理员创建

1. 使用组织管理员账号登录
2. 进入"用户管理"页面
3. 点击"创建用户"（只能创建普通成员）
4. 填写用户信息并提交

### 用户角色权限对比

| 功能 | 超级管理员 | 组织管理员 | 普通成员 |
|------|-----------|-----------|---------|
| 查看所有组织 | ✅ | ❌ | ❌ |
| 创建/删除组织 | ✅ | ❌ | ❌ |
| 创建组织管理员 | ✅ | ❌ | ❌ |
| 查看所有用户 | ✅ | 本组织内 | 仅自己 |
| 创建普通成员 | ✅ | ✅ (本组织) | ❌ |
| 删除用户 | ✅ | ✅ (本组织成员) | ❌ |
| 重置密码 | ✅ | ✅ (本组织) | 仅自己 |
| 访问业务数据 | 全部 | 本组织 | 本组织 |

---

## 🔒 数据隔离机制

### 工作原理

1. **用户层面**：每个用户（除超级管理员外）都关联一个组织 ID
2. **数据层面**：所有业务数据（广告、素材等）都会自动关联创建者的组织 ID
3. **查询层面**：API 自动过滤，只返回用户所属组织的数据
4. **权限层面**：超级管理员可以看到所有数据

### 数据隔离示例

假设有以下组织结构：

```
超级管理员 (admin)
├─ 组织A (org_a_admin + 3个成员)
└─ 组织B (org_b_admin + 2个成员)
```

- 组织A的成员只能看到组织A创建的广告、素材等数据
- 组织B的成员只能看到组织B创建的数据
- 超级管理员可以看到所有组织的数据

---

## 🔐 安全建议

### 1. 修改默认密码

首次登录后立即修改超级管理员密码：

1. 登录后点击右上角用户信息
2. 选择"修改密码"
3. 输入旧密码和新密码

### 2. 使用强密码

- 密码长度至少 8 位
- 包含大小写字母、数字和特殊字符
- 不使用常见密码（如：123456、password）

### 3. 定期更换密码

建议每 3-6 个月更换一次密码。

### 4. JWT Secret 配置

在生产环境中，务必修改 `JWT_SECRET` 为复杂的随机字符串：

```bash
# 生成随机 Secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 5. 禁用不活跃账号

定期检查并禁用不再使用的账号：

1. 进入"用户管理"
2. 找到需要禁用的用户
3. 将状态设置为"停用"

---

## 🛠️ API 使用指南

### 认证 API

#### 登录

```bash
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "<strong-password>"
}

# 响应
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "username": "admin",
      "email": "admin@autoark.com",
      "role": "super_admin"
    }
  }
}
```

#### 获取当前用户信息

```bash
GET /api/auth/me
Authorization: Bearer <token>

# 响应
{
  "success": true,
  "data": {
    "username": "admin",
    "email": "admin@autoark.com",
    "role": "super_admin",
    "status": "active"
  }
}
```

#### 修改密码

```bash
POST /api/auth/change-password
Authorization: Bearer <token>
Content-Type: application/json

{
  "oldPassword": "<current-password>",
  "newPassword": "new_secure_password"
}
```

### 用户管理 API

#### 获取用户列表

```bash
GET /api/users
Authorization: Bearer <token>

# 可选查询参数
?organizationId=xxx&role=member&status=active
```

#### 创建用户

```bash
POST /api/users
Authorization: Bearer <token>
Content-Type: application/json

{
  "username": "user01",
  "password": "password123",
  "email": "user01@example.com",
  "role": "member",
  "organizationId": "organization_id"
}
```

#### 删除用户

```bash
DELETE /api/users/:userId
Authorization: Bearer <token>
```

### 组织管理 API

#### 创建组织

```bash
POST /api/organizations
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "组织名称",
  "description": "组织描述",
  "adminUsername": "org_admin",
  "adminPassword": "password123",
  "adminEmail": "admin@org.com"
}
```

#### 获取组织列表

```bash
GET /api/organizations
Authorization: Bearer <token>
```

---

## 📊 前端集成

### 使用认证钩子

```typescript
import { useAuth } from '../contexts/AuthContext'

function MyComponent() {
  const { user, token, isAuthenticated, isSuperAdmin, isOrgAdmin, logout } = useAuth()
  
  return (
    <div>
      <h1>欢迎, {user?.username}</h1>
      {isSuperAdmin && <AdminPanel />}
      <button onClick={logout}>登出</button>
    </div>
  )
}
```

### 路由保护

```typescript
import ProtectedRoute from './components/ProtectedRoute'

// 普通保护（需要登录）
<Route path="/dashboard" element={
  <ProtectedRoute>
    <DashboardPage />
  </ProtectedRoute>
} />

// 角色保护（需要特定角色）
<Route path="/organizations" element={
  <ProtectedRoute requireRole="super_admin">
    <OrganizationManagementPage />
  </ProtectedRoute>
} />
```

### API 请求携带 Token

```typescript
const { token } = useAuth()

const response = await fetch('/api/users', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
})
```

---

## 🐛 常见问题

### Q1: 忘记超级管理员密码怎么办？

**A**: 重新运行初始化脚本会提示已存在管理员，可以手动修改数据库：

```bash
# 连接 MongoDB
mongo autoark

# 删除旧的超级管理员
db.users.deleteOne({ role: 'super_admin' })

# 重新运行初始化脚本
npm run init:super-admin
```

### Q2: 如何批量导入用户？

**A**: 可以使用 API 批量创建，或编写导入脚本。

### Q3: 子账号之间能看到对方的数据吗？

**A**: 同一组织内的账号可以看到组织内所有数据，不同组织的账号数据完全隔离。

### Q4: 如何转移组织管理员？

**A**: 使用超级管理员账号调用转移 API：

```bash
POST /api/organizations/:orgId/transfer-admin
Authorization: Bearer <super_admin_token>
Content-Type: application/json

{
  "newAdminId": "new_admin_user_id"
}
```

### Q5: Token 过期时间是多久？

**A**: 默认 7 天，可在 `.env` 中通过 `JWT_EXPIRES_IN` 配置。

---

## 📝 待办事项（可选增强）

- [ ] 添加双因素认证 (2FA)
- [ ] 实现 OAuth 第三方登录
- [ ] 添加登录日志和审计
- [ ] 支持用户头像上传
- [ ] 实现更细粒度的权限控制 (RBAC)
- [ ] 添加 API 调用速率限制
- [ ] 支持单点登录 (SSO)

---

## 📞 技术支持

如有问题，请联系系统管理员或查看以下文档：

- [后端架构文档](./docs/backend-architecture.md)
- [部署指南](./docs/deployment.md)
- [API 文档](./docs/api-docs.md)

---

## 更新日志

### v1.0.0 (2024-12-08)

- ✅ 完成三级权限系统搭建
- ✅ 实现用户和组织管理
- ✅ 添加数据隔离机制
- ✅ 完成前后端认证集成
- ✅ 添加初始化脚本
