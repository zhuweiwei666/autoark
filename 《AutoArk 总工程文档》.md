# Facebook OAuth 自动登录配置指南

## 功能概述

实现了 Facebook OAuth 自动登录功能，用户可以通过 Facebook 登录自动获取长期有效的 User Token，并自动存储到 Token Pool 中。

## 工作流程

1. 用户点击"连接 Facebook"按钮
2. 跳转到 Facebook 登录页面
3. 用户授权后，Facebook 返回授权码（code）
4. 后端将 code 交换为 Short-Lived Token
5. 将 Short-Lived Token 交换为 Long-Lived Token（60 天有效期）
6. 自动获取用户信息（ID、名称）
7. 存储 Token 到数据库（使用 fbUserId 作为唯一标识）
8. 自动检查权限（BM / Pixels / Ads 等）
9. 重新初始化 Token Pool
10. 重定向回 Token 管理页面，显示成功消息

## 环境变量配置

在 `.env` 文件中配置以下变量：

```bash
# Facebook OAuth 配置
FACEBOOK_APP_ID=your_facebook_app_id
FACEBOOK_APP_SECRET=your_facebook_app_secret
FACEBOOK_REDIRECT_URI=https://your-domain.com/api/facebook/oauth/callback
```

### 获取 Facebook App ID 和 Secret

1. 访问 [Facebook Developers](https://developers.facebook.com/)
2. 创建或选择你的应用
3. 在"设置" → "基本"中获取：
   - **应用 ID** → `FACEBOOK_APP_ID`
   - **应用密钥** → `FACEBOOK_APP_SECRET`

### 配置重定向 URI

1. 在 Facebook 应用设置中，进入"Facebook 登录" → "设置"
2. 在"有效的 OAuth 重定向 URI"中添加：
   ```
   https://your-domain.com/api/facebook/oauth/callback
   ```
   或开发环境：
   ```
   http://localhost:3001/api/facebook/oauth/callback
   ```

### 配置应用权限

在 Facebook 应用设置中，确保已申请以下权限：

- `ads_read` - 读取广告数据
- `ads_management` - 管理广告
- `business_management` - 访问 Business Manager
- `pages_read_engagement` - 读取页面互动数据
- `pages_manage_metadata` - 管理页面元数据
- `pixel_read` - 读取 Pixel 数据
- `pixel_write` - 管理 Pixel
- `offline_access` - **重要**：获取长期 Token

## API 端点

### 1. 获取登录 URL
```
GET /api/facebook/oauth/login-url?state=optional_state
```

**响应：**
```json
{
  "success": true,
  "data": {
    "loginUrl": "https://www.facebook.com/v19.0/dialog/oauth?..."
  }
}
```

### 2. OAuth 回调处理
```
GET /api/facebook/oauth/callback?code=authorization_code
```

**流程：**
- 自动处理授权码
- 交换为 Long-Lived Token
- 存储到数据库
- 检查权限
- 重定向到 `/fb-token?oauth_success=true&token_id=...`

### 3. 检查 OAuth 配置状态
```
GET /api/facebook/oauth/config
```

**响应：**
```json
{
  "success": true,
  "data": {
    "configured": true,
    "missing": [],
    "redirectUri": "https://your-domain.com/api/facebook/oauth/callback"
  }
}
```

## 前端使用

### Token 管理页面

在 Token 管理页面（`/fb-token`）中：

1. **自动登录按钮**（如果 OAuth 已配置）：
   - 显示蓝色的"连接 Facebook"按钮
   - 点击后跳转到 Facebook 登录页面

2. **手动添加 Token**：
   - 仍然支持手动输入 Token
   - 在弹窗中会提示推荐使用自动登录

3. **OAuth 回调处理**：
   - 自动检测 URL 参数中的 `oauth_success` 或 `oauth_error`
   - 显示成功或错误消息
   - 自动刷新 Token 列表

## 权限检查

登录成功后，系统会自动检查以下权限：

- ✅ `ads_read` - 读取广告账户
- ✅ `ads_management` - 管理广告
- ✅ `business_management` - 访问 Business Manager
- ✅ `pixel_read` - 读取 Pixel
- ✅ `pixel_write` - 管理 Pixel
- ✅ `event_access` - 访问事件数据
- ✅ `offline_conversions` - 离线转化

权限检查结果会显示在权限诊断页面（`/api/facebook/diagnose`）。

## 优势

### ✅ 自动 Token 管理
- 自动获取长期 Token（60 天）
- 自动存储到 Token Pool
- 自动检查权限

### ✅ 用户体验
- 一键登录，无需手动复制 Token
- 自动检查权限，快速发现问题
- 专业的 OAuth 流程

### ✅ 安全性
- 使用标准 OAuth 2.0 流程
- Token 存储在服务器端
- 支持多用户（每个 Facebook 用户一个 Token）

### ✅ 稳定性
- Long-Lived Token 有效期 60 天
- 自动 Token Pool 管理
- 权限自动检查

## 故障排查

### OAuth 配置未完成

**症状：** 页面不显示"连接 Facebook"按钮

**解决：**
1. 检查环境变量是否配置
2. 访问 `/api/facebook/oauth/config` 查看缺少的配置
3. 确保所有必需的环境变量都已设置

### 重定向 URI 不匹配

**症状：** Facebook 返回错误 "redirect_uri_mismatch"

**解决：**
1. 检查 `FACEBOOK_REDIRECT_URI` 是否与 Facebook 应用设置中的 URI 完全一致
2. 确保协议（http/https）和域名都正确
3. 确保没有多余的斜杠或参数

### Token 交换失败

**症状：** 登录后显示错误消息

**解决：**
1. 检查 App ID 和 App Secret 是否正确
2. 确保应用已通过 Facebook 审核（某些权限需要审核）
3. 检查应用是否处于开发模式（开发模式只能授权给测试用户）

### 权限不足

**症状：** 登录成功但权限检查失败

**解决：**
1. 在 Facebook 应用设置中申请所需权限
2. 某些权限需要提交审核
3. 确保用户已授权所有权限

## 开发环境配置

开发环境可以使用 `http://localhost:3001` 作为重定向 URI：

```bash
FACEBOOK_APP_ID=your_app_id
FACEBOOK_APP_SECRET=your_app_secret
FACEBOOK_REDIRECT_URI=http://localhost:3001/api/facebook/oauth/callback
```

**注意：** 开发环境只能授权给添加到应用测试用户列表中的 Facebook 账号。

## 生产环境配置

生产环境需要：

1. 使用 HTTPS
2. 配置正确的域名
3. 确保应用已通过 Facebook 审核（如果需要）

```bash
FACEBOOK_APP_ID=your_app_id
FACEBOOK_APP_SECRET=your_app_secret
FACEBOOK_REDIRECT_URI=https://app.autoark.work/api/facebook/oauth/callback
```

## 相关文件

- **后端服务：** `autoark-backend/src/services/facebook.oauth.service.ts`
- **后端控制器：** `autoark-backend/src/controllers/facebook.oauth.controller.ts`
- **前端页面：** `autoark-frontend/src/pages/FacebookTokenPage.tsx`
- **API 路由：** `autoark-backend/src/routes/facebook.routes.ts`

