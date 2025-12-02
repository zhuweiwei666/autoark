#!/bin/bash
# 在服务器上执行：强制更新并重新部署

cd /root/autoark/autoark-backend

echo "=== 1. 丢弃所有本地修改（dist/ 目录会被重新编译） ==="
git reset --hard HEAD
git clean -fd

echo -e "\n=== 2. 拉取最新代码 ==="
git pull origin main

echo -e "\n=== 3. 重新安装依赖（如果需要） ==="
npm install

echo -e "\n=== 4. 重新编译 ==="
npm run build

echo -e "\n=== 5. 检查编译后的文件 ==="
echo "检查 dashboard.routes.js:"
if [ -f "dist/routes/dashboard.routes.js" ]; then
  echo "✅ dashboard.routes.js 存在"
  echo "文件大小: $(wc -l < dist/routes/dashboard.routes.js) 行"
  echo "最后几行:"
  tail -n 3 dist/routes/dashboard.routes.js
else
  echo "❌ dashboard.routes.js 不存在！"
  exit 1
fi

echo -e "\n检查 app.js 中的路由注册:"
grep -A 1 "dashboard" dist/app.js

echo -e "\n=== 6. 确保 logs 目录存在 ==="
mkdir -p logs

echo -e "\n=== 7. 重启 PM2 ==="
pm2 restart autoark

echo -e "\n=== 8. 等待服务启动（5秒） ==="
sleep 5

echo -e "\n=== 9. 检查服务状态和日志 ==="
pm2 status autoark
echo -e "\n最近的日志:"
pm2 logs autoark --out --lines 20 --nostream | tail -n 20

echo -e "\n=== 10. 测试路由 ==="
echo -e "\n测试根路由 /:"
curl -s http://localhost:3001/ | head -n 3

echo -e "\n测试 /dashboard:"
curl -s -w "\nHTTP Status: %{http_code}\n" http://localhost:3001/dashboard | head -n 10

echo -e "\n测试 /api/dashboard/api/health:"
curl -s http://localhost:3001/api/dashboard/api/health | head -n 5

