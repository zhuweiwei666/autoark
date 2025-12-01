# AutoArk Backend

![Version](https://img.shields.io/badge/version-0.1.0-blue.svg) ![License](https://img.shields.io/badge/license-ISC-green.svg)

**AutoArk** 是一个智能化的广告投放优化平台后端系统。它旨在为跨平台的广告投放提供自动化管理、数据抓取、实时监控及智能优化策略执行。当前版本核心集成了 Facebook Marketing API，支持自动化的数据拉取与存储。

---

## 🛠 技术栈

本系统基于现代化的 **Node.js** 生态构建，强调类型安全与高扩展性。

- **Runtime**: Node.js (v18+)
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: MongoDB Atlas (Mongoose ODM)
- **Networking**: Axios (REST API Client)
- **Scheduler**: Node-cron (定时任务)
- **Tooling**: Nodemon, Dotenv

---

## 🚀 快速开始

### 1. 安装依赖

确保本地已安装 Node.js 和 npm。

```bash
cd autoark-backend
npm install
```

### 2. 配置环境变量

复制配置文件模板并设置你的私有密钥：

```bash
cp .env.example .env
```

编辑 `.env` 文件填入以下必要信息：

```properties
PORT=3001
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/autoark
FB_ACCESS_TOKEN=<your_facebook_system_user_access_token>
```

### 3. 启动开发服务器

开发模式下使用 Nodemon 支持热重载：

```bash
npm run dev
```

成功启动后控制台将输出：
```
[INFO] MongoDB Connected: ...
[INFO] Cron jobs initialized
AutoArk backend running on port 3001
```

---

## 📂 项目结构

```text
autoark-backend/
├── src/
│   ├── config/             # 数据库连接与核心配置
│   ├── controllers/        # REST API 控制器 (请求处理)
│   ├── models/             # Mongoose 数据模型 (Schema 定义)
│   ├── routes/             # API 路由定义
│   ├── services/           # 外部服务集成 (Facebook API 逻辑)
│   ├── cron/               # 定时任务系统 (自动化数据抓取)
│   ├── utils/              # 通用工具 (Logger, Helpers)
│   ├── app.ts              # Express 应用实例与中间件配置
│   └── server.ts           # HTTP 服务入口
├── .env.example            # 环境变量示例
├── package.json            # 依赖管理
└── tsconfig.json           # TypeScript 编译配置
```

---

## ⏰ 定时任务 (Cron Jobs)

系统内置了自动化调度模块，用于定期同步广告平台数据。

- **Facebook Daily Insights Sync**
  - **频率**: 每小时执行一次 (`0 * * * *`)
  - **逻辑**: 扫描所有状态为 `active` 的 Facebook 广告账户，拉取昨日的 Campaign/AdSet/Ad 层级成效数据，并更新至 `metrics_daily` 集合。
  - **文件**: `src/cron/fetchFacebookDaily.ts`

在 `src/server.ts` 启动时会自动初始化所有 Cron 任务。

---

## 📡 API 接口与数据抓取

虽然数据主要通过 Cron 自动同步，但你也可以通过 REST API 手动触发或查询数据。

### Facebook 模块

| Method | Endpoint | 描述 |
| :--- | :--- | :--- |
| `GET` | `/facebook/accounts/:id/campaigns` | 获取指定账户的所有广告系列 |
| `GET` | `/facebook/accounts/:id/adsets` | 获取指定账户的所有广告组 |
| `GET` | `/facebook/accounts/:id/ads` | 获取指定账户的所有广告 |
| `GET` | `/facebook/accounts/:id/insights/daily` | 手动触发获取账户昨日成效数据 |

**测试示例**:
访问 `http://localhost:3001/facebook/accounts/<ACT_ID>/insights/daily` 可立即拉取该账户数据并存入数据库。

---

## 📅 开发计划 (Roadmap)

- [x] **v0.1.0**: 项目初始化，MongoDB 接入，Facebook 基础数据抓取，定时任务系统。
- [ ] **v0.2.0**: 集成 TikTok Ads API。
- [ ] **v0.3.0**: 实现自动化规则引擎 (Rules Engine)。
- [ ] **v0.4.0**: 用户权限与认证系统 (JWT)。
- [ ] **v1.0.0**: 正式版发布，支持多租户与完整前端对接。

---

## 📝 版本说明

### v0.1.0 (Current)
- 完成了后端基础架构搭建。
- 实现了 Facebook Marketing API 的核心数据（Campaign, AdSet, Ad, Insights）对接。
- 建立了基于 MongoDB 的数据仓库模型。
- 集成了全局错误处理与日志系统。

---

**AutoArk Team** © 2025
