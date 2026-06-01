# Legacy Note

This document describes an old PM2 deployment path and is kept only for history.
Production now uses Docker Compose. Use `docs/deployment.md` or
`deploy/README.md` for the current deploy flow.

---

# Dashboard 修复部署指南

## ✅ 已完成的工作

1. **代码修改**
   - ✅ 在 Dashboard 页面添加了 "Facebook Token 管理" 导航链接
   - ✅ 添加了前端静态文件服务支持
   - ✅ 代码已提交并推送到 Git 仓库

2. **部署脚本**
   - ✅ 创建了完整的部署脚本 `deploy_dashboard_fix.sh`
   - ✅ 创建了快速部署脚本 `quick_deploy.sh`

## 🚀 在服务器上部署

### 方法 1: 使用完整部署脚本（推荐）

```bash
ssh your-server
cd /root/autoark/autoark-backend

# 拉取最新代码（包含部署脚本）
git pull origin main

# 执行部署脚本
./deploy_dashboard_fix.sh
```

这个脚本会：
- ✅ 自动备份当前代码
- ✅ 拉取最新代码
- ✅ 重新编译 TypeScript
- ✅ 重启 PM2 服务
- ✅ 验证部署是否成功

### 方法 2: 使用快速部署脚本

```bash
ssh your-server
cd /root/autoark/autoark-backend
git pull origin main
./quick_deploy.sh
```

### 方法 3: 手动部署

```bash
ssh your-server
cd /root/autoark/autoark-backend

# 拉取代码
git pull origin main

# 编译
npm run build

# 重启服务
pm2 restart autoark

# 验证
curl -s http://localhost:3001/dashboard | grep -q "Facebook Token" && echo "✅ 部署成功" || echo "❌ 部署失败"
```

## 🔍 验证部署

部署完成后，访问 http://app.autoark.work/dashboard 应该能看到：

1. **页面右上角**有一个蓝色的 **"Facebook Token 管理"** 按钮
2. **点击按钮**可以跳转到 `/fb-token` 页面
3. **所有数据**正常加载（System Health, Facebook Overview, Logs）

## 🐛 故障排查

### 如果页面没有更新：

1. **清除浏览器缓存**
   - Chrome/Edge: `Ctrl+Shift+Delete` (Windows) 或 `Cmd+Shift+Delete` (Mac)
   - 或者使用无痕模式访问

2. **检查服务状态**
   ```bash
   pm2 status autoark
   pm2 logs autoark --lines 50
   ```

3. **检查编译文件**
   ```bash
   ls -lh /root/autoark/autoark-backend/dist/routes/dashboard.routes.js
   grep "Facebook Token" /root/autoark/autoark-backend/dist/routes/dashboard.routes.js
   ```

4. **检查 Nginx 配置**
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

5. **直接测试后端**
   ```bash
   curl http://localhost:3001/dashboard | grep "Facebook Token"
   ```

### 如果前端路由不工作：

确保前端已经构建：
```bash
cd /root/autoark/autoark-frontend
npm run build
```

检查前端 dist 目录是否存在：
```bash
ls -la /root/autoark/autoark-frontend/dist
```

## 📝 修改内容详情

### 1. Dashboard 路由 (`src/routes/dashboard.routes.ts`)
- 在 header 中添加了导航链接到 `/fb-token`

### 2. 应用配置 (`src/app.ts`)
- 添加了前端静态文件服务支持
- 配置了 React Router 的 fallback 路由

## 🔗 相关文件

- `autoark-backend/src/routes/dashboard.routes.ts` - Dashboard 路由
- `autoark-backend/src/app.ts` - 应用主配置
- `autoark-backend/deploy_dashboard_fix.sh` - 完整部署脚本
- `autoark-backend/quick_deploy.sh` - 快速部署脚本

## 📞 需要帮助？

如果部署过程中遇到问题，请检查：
1. PM2 日志: `pm2 logs autoark`
2. Nginx 日志: `sudo tail -f /var/log/nginx/error.log`
3. 服务状态: `pm2 status`
