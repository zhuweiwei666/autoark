#!/bin/bash
# 快速修复 Express 5.x 路由问题

cd /root/autoark/autoark-backend || exit 1

echo ">>> 快速修复 Express 5.x 路由问题..."

# 拉取最新代码
git pull origin main

# 重新编译
npm run build

# 重启服务
pm2 restart autoark

echo ">>> 等待服务启动（3秒）..."
sleep 3

# 检查日志
echo ">>> 检查服务日志..."
pm2 logs autoark --out --lines 5 --nostream | tail -n 5

echo ""
echo ">>> 测试路由..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/fb-token 2>/dev/null || echo "000")
echo ">>> /fb-token 状态: HTTP $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ 路由修复成功！"
else
    echo "⚠️  路由可能还有问题，请检查日志: pm2 logs autoark"
fi

