#!/bin/bash
# 在服务器上执行：修复 PM2 错误并重启应用

cd /root/autoark/autoark-backend

echo "=== 1. 检查 PM2 错误日志 ==="
pm2 logs autoark --err --lines 50 --nostream | tail -n 30

echo -e "\n=== 2. 检查 .env 文件是否存在 ==="
if [ -f ".env" ]; then
  echo "✅ .env 文件存在"
  echo "检查 MONGO_URI:"
  if grep -q "MONGO_URI" .env; then
    echo "✅ MONGO_URI 已设置"
    grep "MONGO_URI" .env | sed 's/=.*/=***/' # 隐藏实际值
  else
    echo "❌ MONGO_URI 未设置！"
  fi
else
  echo "❌ .env 文件不存在！"
  echo "创建 .env.example 的副本..."
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo "✅ 已创建 .env 文件，请编辑它并设置 MONGO_URI"
  else
    echo "❌ .env.example 也不存在！"
  fi
fi

echo -e "\n=== 3. 检查 PM2 进程状态 ==="
pm2 describe autoark

echo -e "\n=== 4. 删除并重新启动 PM2 进程 ==="
pm2 delete autoark 2>/dev/null || true

echo -e "\n=== 5. 重新编译（如果需要） ==="
npm run build

echo -e "\n=== 6. 使用 PM2 重新启动应用 ==="
if [ -f "ecosystem.config.js" ]; then
  echo "使用 ecosystem.config.js 启动..."
  pm2 start ecosystem.config.js
else
  echo "直接启动（使用当前目录的 .env）..."
  pm2 start dist/server.js --name autoark --cwd $(pwd)
fi

# 确保 PM2 保存配置
pm2 save

echo -e "\n=== 7. 等待服务启动（5秒） ==="
sleep 5

echo -e "\n=== 8. 检查 PM2 进程状态 ==="
pm2 status autoark

echo -e "\n=== 9. 检查启动日志 ==="
pm2 logs autoark --out --lines 20 --nostream | tail -n 20

echo -e "\n=== 10. 测试路由 ==="
if pm2 describe autoark | grep -q "online"; then
  echo "✅ 服务正在运行，测试路由..."
  curl -s http://localhost:3001/dashboard | head -n 5
else
  echo "❌ 服务未运行，请检查错误日志："
  pm2 logs autoark --err --lines 20 --nostream | tail -n 20
fi

