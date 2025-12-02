#!/bin/bash
# 在服务器上执行这个脚本来修复部署问题

cd /root/autoark/autoark-backend

echo "=== 1. 保存本地修改（如果有） ==="
git stash

echo -e "\n=== 2. 拉取最新代码 ==="
git pull origin main

echo -e "\n=== 3. 重新编译 ==="
npm run build

echo -e "\n=== 4. 确保 logs 目录存在 ==="
mkdir -p logs

echo -e "\n=== 5. 检查编译后的路由文件 ==="
echo "检查 dashboard.routes.js 是否存在："
ls -la dist/routes/dashboard.routes.js

echo -e "\n检查 app.js 中的路由注册："
grep -A 2 "dashboard" dist/app.js | head -n 10

echo -e "\n=== 6. 重启 PM2 ==="
pm2 restart autoark

echo -e "\n=== 7. 等待服务启动 ==="
sleep 5

echo -e "\n=== 8. 检查服务状态 ==="
pm2 status autoark

echo -e "\n=== 9. 检查启动日志（看是否有错误） ==="
pm2 logs autoark --out --lines 30 --nostream | tail -n 30

echo -e "\n=== 10. 测试路由 ==="
echo "测试 /dashboard:"
curl -s http://localhost:3001/dashboard | head -n 5

echo -e "\n测试 /api/dashboard/api/health:"
curl -s http://localhost:3001/api/dashboard/api/health | head -n 5

