#!/bin/bash
# 在服务器上执行：强制 PM2 重新加载最新代码

cd /root/autoark/autoark-backend

echo "=== 1. 停止 PM2 进程 ==="
pm2 stop autoark
pm2 delete autoark

echo -e "\n=== 2. 清理 PM2 缓存 ==="
pm2 kill
sleep 2
pm2 resurrect 2>/dev/null || true

echo -e "\n=== 3. 确保编译文件是最新的 ==="
npm run build

echo -e "\n=== 4. 验证编译文件 ==="
if [ ! -f "dist/server.js" ] || [ ! -f "dist/app.js" ] || [ ! -f "dist/routes/dashboard.routes.js" ]; then
  echo "❌ 编译文件不存在！"
  exit 1
fi
echo "✅ 编译文件存在"
echo "文件时间戳:"
ls -lh dist/server.js dist/app.js dist/routes/dashboard.routes.js | awk '{print $6, $7, $8, $9}'

echo -e "\n=== 5. 验证路由模块 ==="
node -e "
const routes = require('./dist/routes/dashboard.routes.js');
if (!routes.default || typeof routes.default !== 'function') {
  console.log('❌ 路由导出不正确！');
  process.exit(1);
}
if (!routes.default.stack || routes.default.stack.length === 0) {
  console.log('❌ 路由没有注册！');
  process.exit(1);
}
console.log('✅ 路由模块正确，路由数量:', routes.default.stack.length);
"

if [ $? -ne 0 ]; then
  echo "❌ 路由验证失败！"
  exit 1
fi

echo -e "\n=== 6. 使用 ecosystem.config.js 启动 ==="
pm2 start ecosystem.config.js

echo -e "\n=== 7. 等待服务启动（5秒） ==="
sleep 5

echo -e "\n=== 8. 检查 PM2 进程状态 ==="
pm2 status autoark

echo -e "\n=== 9. 检查启动日志 ==="
pm2 logs autoark --out --lines 10 --nostream | tail -n 10

echo -e "\n=== 10. 测试路由 ==="
echo "等待 2 秒后测试..."
sleep 2

HTTP_CODE=$(curl -s -o /tmp/dashboard_test.html -w "%{http_code}" http://localhost:3001/dashboard)
echo "HTTP 状态码: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ 路由工作正常！"
  echo "响应内容预览（前 500 字符）:"
  head -c 500 /tmp/dashboard_test.html
  echo ""
  if grep -q "AutoArk Dashboard" /tmp/dashboard_test.html; then
    echo "✅ 确认：响应包含 'AutoArk Dashboard'"
  fi
else
  echo "❌ 路由返回错误状态码: $HTTP_CODE"
  echo "响应内容:"
  head -c 300 /tmp/dashboard_test.html
  echo ""
  
  echo -e "\n检查 PM2 日志中的请求记录:"
  pm2 logs autoark --out --lines 20 --nostream | grep -E "\[GET|\[POST" | tail -n 5
fi

echo -e "\n=== 11. 测试通过 Nginx（如果配置了域名） ==="
if command -v nginx &> /dev/null; then
  echo "测试 http://app.autoark.cloud/dashboard:"
  HTTP_CODE_NGINX=$(curl -s -o /dev/null -w "%{http_code}" http://app.autoark.cloud/dashboard 2>/dev/null || echo "000")
  echo "HTTP 状态码: $HTTP_CODE_NGINX"
  
  if [ "$HTTP_CODE_NGINX" = "200" ]; then
    echo "✅ 通过 Nginx 访问成功！"
  elif [ "$HTTP_CODE_NGINX" = "000" ]; then
    echo "⚠️  无法连接到域名（可能是 DNS 问题）"
  else
    echo "❌ 通过 Nginx 访问失败，状态码: $HTTP_CODE_NGINX"
  fi
fi

echo -e "\n=== 完成 ==="
if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ 路由已修复！现在可以通过 http://localhost:3001/dashboard 访问"
  if [ "$HTTP_CODE_NGINX" = "200" ]; then
    echo "✅ 也可以通过 http://app.autoark.cloud/dashboard 访问"
  fi
else
  echo "❌ 路由仍然有问题，需要进一步检查"
fi

