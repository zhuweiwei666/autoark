#!/bin/bash
# 在服务器上执行：最终路由测试

cd /root/autoark/autoark-backend

echo "=== 1. 检查 PM2 进程状态 ==="
pm2 status autoark

echo -e "\n=== 2. 等待服务完全启动（3秒） ==="
sleep 3

echo -e "\n=== 3. 检查服务日志 ==="
pm2 logs autoark --out --lines 5 --nostream | tail -n 5

echo -e "\n=== 4. 测试 /dashboard 路由 ==="
echo "使用 curl 测试..."
HTTP_CODE=$(curl -s -o /tmp/dashboard_response.html -w "%{http_code}" http://localhost:3001/dashboard)
echo "HTTP 状态码: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ 路由工作正常！"
  echo "响应内容预览（前 500 字符）:"
  head -c 500 /tmp/dashboard_response.html
  echo ""
  if grep -q "AutoArk Dashboard" /tmp/dashboard_response.html; then
    echo "✅ 确认：响应包含 'AutoArk Dashboard'"
  else
    echo "⚠️  警告：响应不包含 'AutoArk Dashboard'"
  fi
else
  echo "❌ 路由返回错误状态码: $HTTP_CODE"
  echo "响应内容:"
  head -c 300 /tmp/dashboard_response.html
  echo ""
fi

echo -e "\n=== 5. 测试其他路由 ==="
echo "测试 / (根路径):"
curl -s -w "\nHTTP: %{http_code}\n" http://localhost:3001/ | head -n 3

echo -e "\n测试 /api/dashboard/api/health:"
curl -s -w "\nHTTP: %{http_code}\n" http://localhost:3001/api/dashboard/api/health | head -n 5

echo -e "\n=== 6. 检查 PM2 日志中的请求记录 ==="
echo "等待 2 秒后检查日志..."
sleep 2
pm2 logs autoark --out --lines 20 --nostream | grep -E "\[GET|\[POST" | tail -n 5

echo -e "\n=== 7. 如果路由不工作，检查运行时路由注册 ==="
if [ "$HTTP_CODE" != "200" ]; then
  echo "检查运行时的路由注册..."
  node << 'NODE_SCRIPT'
require('dotenv').config({ path: '/root/autoark/autoark-backend/.env' });
const app = require('./dist/app.js').default;

// 触发路由栈初始化（发送一个虚拟请求）
const http = require('http');
const server = http.createServer((req, res) => {
  app(req, res, () => {
    res.statusCode = 404;
    res.end('not found');
  });
});

server.listen(3007, () => {
  setTimeout(() => {
    http.get('http://localhost:3007/dashboard', (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        if (app._router && app._router.stack) {
          console.log(`路由栈数量: ${app._router.stack.length}`);
          console.log('\n查找 dashboard 相关路由:');
          let found = false;
          app._router.stack.forEach((layer, i) => {
            if (layer.route) {
              const path = layer.route.path;
              if (path.includes('dashboard') || path === '/') {
                const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
                console.log(`  ✅ [${i}] ${methods} ${path}`);
                found = true;
              }
            } else {
              const regex = layer.regexp ? layer.regexp.source : '';
              if (regex.includes('dashboard')) {
                console.log(`  ✅ [${i}] [中间件] ${layer.name || 'anonymous'}`);
                found = true;
              }
            }
          });
          if (!found) {
            console.log('  ❌ 没有找到 dashboard 相关路由！');
          }
        } else {
          console.log('❌ app 没有路由栈！');
        }
        server.close();
        process.exit(0);
      });
    }).on('error', () => {
      server.close();
      process.exit(1);
    });
  }, 500);
});
NODE_SCRIPT
fi

echo -e "\n=== 完成 ==="

