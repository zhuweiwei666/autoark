# 🚀 快速启动三级权限系统

## 一分钟快速开始

### 1. 配置环境变量（必须）

```bash
cd autoark-backend
cp .env.example .env
```

编辑 `.env` 文件，至少配置以下项：

```bash
MONGO_URI=mongodb://localhost:27017/autoark
JWT_SECRET=your-super-secret-key-please-change-this
```

### 2. 安装依赖

```bash
# 后端
cd autoark-backend
npm install

# 前端
cd ../autoark-frontend  
npm install
```

### 3. 初始化超级管理员

```bash
cd autoark-backend
npm run init:super-admin
```

看到以下输出说明成功：

```
✅ 超级管理员创建成功!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
用户名: admin
密码: admin123456
邮箱: admin@autoark.com
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 4. 启动系统

```bash
# 终端1：启动后端
cd autoark-backend
npm run build
npm start

# 终端2：启动前端
cd autoark-frontend
npm run dev
```

### 5. 登录测试

1. 打开浏览器访问：`http://localhost:5173/login`
2. 使用以下凭据登录：
   - 用户名：`admin`
   - 密码：`admin123456`
3. 登录成功后会跳转到仪表盘

---

## 📝 快速测试流程

### 测试1：创建组织

1. 登录超级管理员账号
2. 左侧菜单 → "组织管理"
3. 点击"创建组织"
4. 填写信息：
   ```
   组织名称：测试组织A
   描述：第一个测试组织
   管理员用户名：org_admin_a
   管理员密码：password123
   管理员邮箱：admin_a@test.com
   ```
5. 提交后查看组织列表

### 测试2：创建子账号

1. 登录组织管理员（org_admin_a / password123）
2. 左侧菜单 → "用户管理"
3. 点击"创建用户"
4. 填写信息：
   ```
   用户名：member1
   密码：password123
   邮箱：member1@test.com
   ```
5. 查看用户列表

### 测试3：数据隔离验证

1. 创建第二个组织"测试组织B"
2. 在组织B中创建一些用户
3. 用组织A的账号登录，验证只能看到组织A的用户
4. 用组织B的账号登录，验证只能看到组织B的用户
5. 用超级管理员登录，验证可以看到所有用户

### 测试4：权限验证

| 操作 | 超级管理员 | 组织管理员 | 普通成员 |
|------|-----------|-----------|---------|
| 查看组织列表 | ✅ | ❌ (403) | ❌ (403) |
| 创建组织 | ✅ | ❌ (403) | ❌ (403) |
| 创建用户 | ✅ | ✅ (本组织) | ❌ (403) |
| 删除用户 | ✅ | ✅ (本组织成员) | ❌ (403) |

---

## 🔧 常用命令

```bash
# 后端编译
cd autoark-backend && npm run build

# 后端开发模式（自动重启）
cd autoark-backend && npm run dev

# 前端开发模式
cd autoark-frontend && npm run dev

# 前端生产构建
cd autoark-frontend && npm run build

# 初始化超级管理员
cd autoark-backend && npm run init:super-admin

# 查看日志
cd autoark-backend && tail -f logs/combined.log
```

---

## 🐛 故障排查

### 问题1：无法创建超级管理员

**错误**：`MONGO_URI not found in environment variables`

**解决**：
```bash
cd autoark-backend
cp .env.example .env
# 编辑 .env 文件，配置 MONGO_URI
```

### 问题2：登录后立即跳转到登录页

**原因**：Token 验证失败

**解决**：
1. 检查 `.env` 中的 `JWT_SECRET` 是否配置
2. 清除浏览器缓存和 localStorage
3. 重新登录

### 问题3：前端无法连接后端

**错误**：`Failed to fetch` 或 `Network Error`

**解决**：
1. 确认后端已启动（访问 `http://localhost:3000/api/auth/login`）
2. 检查前端代理配置
3. 检查防火墙设置

### 问题4：编译错误

**错误**：`Cannot find module 'bcryptjs'`

**解决**：
```bash
cd autoark-backend
npm install bcryptjs jsonwebtoken
npm install --save-dev @types/bcryptjs @types/jsonwebtoken
```

---

## 📱 API 快速测试

### 测试登录 API

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123456"
  }'
```

### 测试获取用户信息

```bash
# 先登录获取 token，然后：
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### 测试创建组织

```bash
curl -X POST http://localhost:3000/api/organizations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "name": "测试组织",
    "description": "API测试创建的组织",
    "adminUsername": "test_admin",
    "adminPassword": "password123",
    "adminEmail": "test@example.com"
  }'
```

---

## 🎯 下一步

系统已配置完成，您可以：

1. ✅ 修改超级管理员密码
2. ✅ 创建您的第一个组织
3. ✅ 邀请团队成员
4. ✅ 配置数据源和业务功能
5. ✅ 开始使用广告管理功能

详细文档请查看：[AUTH_SYSTEM_README.md](./AUTH_SYSTEM_README.md)

---

## 📞 需要帮助？

- 查看完整文档：[AUTH_SYSTEM_README.md](./AUTH_SYSTEM_README.md)
- 查看后端架构：[docs/backend-architecture.md](./docs/backend-architecture.md)
- 查看部署指南：[docs/deployment.md](./docs/deployment.md)
