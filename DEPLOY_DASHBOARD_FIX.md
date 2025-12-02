# Dashboard 页面修复部署指南

## 问题
Dashboard 页面缺少 "Facebook Token 管理" 导航链接。

## 已完成的修改
1. ✅ 在 `dashboard.routes.ts` 中添加了导航链接
2. ✅ 在 `app.ts` 中添加了前端静态文件服务支持
3. ✅ 本地代码已编译成功

## 需要执行的部署步骤

### 选项 1: 使用 Git 部署（推荐）

1. **提交并推送代码到 Git**:
   ```bash
   cd /Users/zhuweiwei/Desktop/autoark/autoark-backend
   git add src/routes/dashboard.routes.ts src/app.ts
   git commit -m "Add Facebook Token management link to dashboard"
   git push origin main
   ```

2. **在服务器上执行部署**:
   ```bash
   ssh your-server
   cd /root/autoark/autoark-backend
   ./auto-deploy.sh
   # 或者手动执行：
   git pull origin main
   npm run build
   pm2 restart autoark
   ```

### 选项 2: 直接在服务器上修改

如果你有服务器访问权限，可以直接在服务器上执行：

```bash
ssh your-server
cd /root/autoark/autoark-backend

# 拉取最新代码（如果使用 git）
git pull origin main

# 或者直接修改文件（文件路径：/root/autoark/autoark-backend/src/routes/dashboard.routes.ts）
# 在第 37 行后添加导航链接代码

# 重新编译
npm run build

# 重启服务
pm2 restart autoark
```

### 选项 3: 使用现有的部署脚本

如果服务器上已有 `force_rebuild.sh` 脚本：

```bash
ssh your-server
cd /root/autoark/autoark-backend
./force_rebuild.sh
```

## 验证部署

部署完成后，访问 http://app.autoark.work/dashboard 应该能看到：
- 页面右上角有一个蓝色的 "Facebook Token 管理" 按钮
- 点击按钮可以跳转到 `/fb-token` 页面

## 注意事项

1. 确保服务器上的代码已更新
2. 确保 TypeScript 代码已重新编译（`npm run build`）
3. 确保 PM2 服务已重启（`pm2 restart autoark`）
4. 如果前端还没有构建，需要先构建前端：
   ```bash
   cd /root/autoark/autoark-frontend
   npm run build
   ```

