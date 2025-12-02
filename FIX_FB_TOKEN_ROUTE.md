# 修复 /fb-token 路由 404 错误

## 问题描述

访问 `http://app.autoark.work/fb-token` 时出现 404 错误：
```json
{"success": false, "message": "Route GET /fb-token not found"}
```

## 问题原因

1. **前端未构建**: 前端 React 应用还没有构建，`dist` 目录不存在
2. **路径配置问题**: 后端无法找到前端构建后的静态文件
3. **路由配置**: 前端路由需要正确的静态文件服务支持

## 解决方案

### 1. 改进路径检测逻辑

修改了 `app.ts`，现在会尝试多个可能的路径来查找前端 `dist` 目录：
- `../../autoark-frontend/dist` (相对路径)
- `autoark-frontend/dist` (从项目根目录)
- `../autoark-frontend/dist` (从后端目录)
- `/root/autoark/autoark-frontend/dist` (服务器绝对路径)

### 2. 添加错误处理

如果前端未构建，会显示友好的错误信息，提示需要构建前端。

### 3. 创建完整部署脚本

创建了 `deploy_with_frontend.sh`，会自动：
- 拉取最新代码
- 构建后端
- 构建前端
- 重启服务
- 验证部署

## 部署步骤

### 在服务器上执行：

```bash
ssh your-server
cd /root/autoark/autoark-backend

# 拉取最新代码
git pull origin main

# 执行完整部署脚本（包括前端构建）
./deploy_with_frontend.sh
```

### 或者手动执行：

```bash
# 1. 部署后端
cd /root/autoark/autoark-backend
git pull origin main
npm install
npm run build
pm2 restart autoark

# 2. 构建前端
cd /root/autoark/autoark-frontend
git pull origin main
npm install
npm run build

# 3. 验证前端构建
ls -la /root/autoark/autoark-frontend/dist

# 4. 重启后端（如果需要）
cd /root/autoark/autoark-backend
pm2 restart autoark
```

## 验证

部署完成后，访问：
- `http://app.autoark.work/fb-token` - 应该显示 Facebook Token 管理页面
- `http://app.autoark.work/dashboard` - 应该显示 Dashboard，右上角有 "Facebook Token 管理" 按钮

## 故障排查

### 如果仍然出现 404：

1. **检查前端是否已构建**:
   ```bash
   ls -la /root/autoark/autoark-frontend/dist
   ```
   应该看到 `index.html` 文件

2. **检查后端日志**:
   ```bash
   pm2 logs autoark --lines 50
   ```
   查找 "Frontend static files served from" 或相关错误信息

3. **检查路径**:
   ```bash
   # 在服务器上检查路径是否存在
   ls -la /root/autoark/autoark-frontend/dist/index.html
   ```

4. **测试后端路由**:
   ```bash
   curl http://localhost:3001/fb-token
   ```
   如果返回 HTML 内容，说明路由正常；如果返回 JSON 错误，说明前端未构建

5. **清除浏览器缓存**:
   - 使用无痕模式访问
   - 或清除浏览器缓存

## 相关文件

- `autoark-backend/src/app.ts` - 后端应用配置（已修复）
- `autoark-backend/deploy_with_frontend.sh` - 完整部署脚本
- `autoark-frontend/src/App.tsx` - 前端路由配置

