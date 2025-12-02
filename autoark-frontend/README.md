# AutoArk Frontend - Facebook Token 管理

## 功能特性

✅ **绑定 Token**
- 输入 Facebook Access Token
- 可选绑定优化师
- 自动验证 token 有效性

✅ **Token 列表管理**
- 查看所有 token
- 显示 token 状态（有效/已过期/无效）
- 显示 Facebook 用户信息
- 显示过期时间和最后检查时间

✅ **筛选功能**
- 按优化师筛选
- 按状态筛选（有效/已过期/无效）
- 按日期范围筛选

✅ **操作功能**
- 手动检查 token 状态
- 编辑优化师
- 删除 token

## 技术栈

- React 18
- TypeScript
- React Router
- Tailwind CSS

## 安装和运行

### 1. 安装依赖

```bash
cd autoark-frontend
npm install
```

### 2. 配置环境变量

创建 `.env` 文件：

```env
VITE_API_BASE_URL=http://localhost:3001
```

### 3. 启动开发服务器

```bash
npm run dev
```

访问 `http://localhost:5173`（或 Vite 显示的端口）

## 项目结构

```
autoark-frontend/
├── src/
│   ├── App.tsx                 # 主应用组件，路由配置
│   ├── pages/
│   │   └── FacebookTokenPage.tsx  # Token 管理页面
│   └── services/
│       └── api.ts              # API 服务层
└── README.md
```

## API 接口

所有 API 调用都通过 `src/services/api.ts` 中的服务函数：

- `bindToken()` - 绑定 token
- `getTokens()` - 获取 token 列表（支持筛选）
- `getTokenById()` - 获取单个 token
- `checkTokenStatus()` - 检查 token 状态
- `updateToken()` - 更新 token
- `deleteToken()` - 删除 token

## 使用说明

### 绑定新 Token

1. 在"绑定新 Token"表单中输入 Facebook Access Token
2. （可选）输入优化师名称
3. 点击"绑定 Token"按钮
4. 系统会自动验证 token 有效性

### 筛选 Token

1. 在"筛选条件"区域设置筛选条件：
   - 优化师：输入优化师名称
   - 状态：选择状态（有效/已过期/无效）
   - 开始日期/结束日期：选择日期范围
2. 点击"应用筛选"按钮
3. 点击"清除筛选"可重置所有筛选条件

### 管理 Token

- **检查状态**：点击"检查"按钮手动触发状态检查
- **编辑优化师**：点击"编辑"按钮，修改优化师名称，然后点击"保存"
- **删除 Token**：点击"删除"按钮，确认后删除 token

## 注意事项

1. **API 地址**：确保后端服务运行在 `http://localhost:3001`（或修改 `.env` 中的 `VITE_API_BASE_URL`）
2. **CORS**：确保后端已配置 CORS 允许前端域名访问
3. **Token 安全**：前端不会显示完整的 token，只显示元数据信息

## 样式说明

使用 Tailwind CSS，采用深色主题（slate-950 背景），与后端 dashboard 保持一致的设计风格。

