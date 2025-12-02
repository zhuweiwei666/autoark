#!/bin/bash
# 快速部署脚本 - 简化版本
# 适用于快速更新和重启

cd /root/autoark/autoark-backend || exit 1

echo ">>> 快速部署开始..."

# 拉取代码
[ -d ".git" ] && git pull origin main

# 编译
npm run build

# 重启
pm2 restart autoark

echo ">>> 部署完成！"
echo ">>> 等待 3 秒后测试..."
sleep 3

# 快速测试
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/dashboard)
echo ">>> Dashboard 状态: HTTP $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ 服务正常"
else
    echo "❌ 服务异常，请检查: pm2 logs autoark"
fi

