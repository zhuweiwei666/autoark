#!/bin/bash
# 在服务器上执行：直接测试 dashboard 路由

cd /root/autoark/autoark-backend

echo "=== 1. 检查 PM2 状态 ==="
pm2 status autoark

echo -e "\n=== 2. 检查服务是否在运行 ==="
if pm2 describe autoark | grep -q "online"; then
  echo "✅ 服务正在运行"
else
  echo "❌ 服务未运行，正在启动..."
  pm2 restart autoark
  sleep 3
fi

echo -e "\n=== 3. 直接测试 /dashboard 路由 ==="
echo "使用 curl 测试..."
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3001/dashboard)
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')

echo "HTTP 状态码: $HTTP_CODE"
echo "响应长度: ${#BODY} 字节"

if [ "$HTTP_CODE" = "200" ]; then
  if echo "$BODY" | grep -q "AutoArk Dashboard"; then
    echo "✅ 路由工作正常！Dashboard 页面可以访问！"
    echo "响应内容预览（前 500 字符）:"
    echo "$BODY" | head -c 500
    echo "..."
  else
    echo "⚠️  返回 200，但内容不是 Dashboard 页面"
    echo "响应内容:"
    echo "$BODY" | head -c 300
  fi
else
  echo "❌ 路由返回错误状态码: $HTTP_CODE"
  echo "响应内容:"
  echo "$BODY" | head -c 300
fi

echo -e "\n=== 4. 测试 API 路由 ==="
echo "测试 /api/dashboard/api/health:"
curl -s http://localhost:3001/api/dashboard/api/health | head -c 200
echo ""

echo -e "\n=== 5. 检查最近的请求日志 ==="
pm2 logs autoark --out --lines 30 --nostream | grep -E "\[GET|\[POST|dashboard" | tail -n 10

echo -e "\n=== 6. 如果路由不工作，检查路由注册 ==="
if [ "$HTTP_CODE" != "200" ]; then
  echo "检查路由注册..."
  node << 'NODE_SCRIPT'
require('dotenv').config({ path: '/root/autoark/autoark-backend/.env' });
const app = require('./dist/app.js').default;
if (app._router && app._router.stack) {
  console.log('路由栈总数:', app._router.stack.length);
  console.log('\n查找 dashboard 相关路由:');
  app._router.stack.forEach((layer, i) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
      const path = layer.route.path;
      if (path.includes('dashboard') || path === '/') {
        console.log(`  ✅ [${i}] ${methods} ${path}`);
      }
    } else if (layer.regexp) {
      const regex = layer.regexp.source;
      if (regex.includes('dashboard')) {
        console.log(`  ✅ [${i}] [中间件] ${layer.name || 'anonymous'}`);
      }
    }
  });
}
NODE_SCRIPT
fi

