#!/bin/bash
# 在服务器上执行：检查运行中的服务

cd /root/autoark/autoark-backend

echo "=== 1. 检查 PM2 进程状态 ==="
pm2 status autoark

echo -e "\n=== 2. 检查 MongoDB 连接 ==="
pm2 logs autoark --out --lines 50 --nostream | grep -i "mongo\|connected\|error" | tail -n 10

echo -e "\n=== 3. 检查最近的请求日志 ==="
pm2 logs autoark --out --lines 100 --nostream | grep -E "\[GET|\[POST|dashboard" | tail -n 20

echo -e "\n=== 4. 测试所有可能的路由路径 ==="
echo "测试 /dashboard:"
curl -s -w "\nHTTP Status: %{http_code}\n" http://localhost:3001/dashboard | head -n 10

echo -e "\n测试 /api/dashboard:"
curl -s -w "\nHTTP Status: %{http_code}\n" http://localhost:3001/api/dashboard | head -n 5

echo -e "\n测试 /api/dashboard/api/health:"
curl -s -w "\nHTTP Status: %{http_code}\n" http://localhost:3001/api/dashboard/api/health | head -n 5

echo -e "\n测试 / (根路径):"
curl -s -w "\nHTTP Status: %{http_code}\n" http://localhost:3001/ | head -n 5

echo -e "\n=== 5. 检查应用是否真的在监听端口 ==="
netstat -tlnp | grep 3001 || ss -tlnp | grep 3001

echo -e "\n=== 6. 直接测试路由注册（使用 node） ==="
node << 'NODE_SCRIPT'
require('dotenv').config({ path: '/root/autoark/autoark-backend/.env' });
const app = require('./dist/app.js').default;

if (app._router && app._router.stack) {
  console.log('注册的路由/中间件总数:', app._router.stack.length);
  console.log('\n查找 dashboard 相关路由:');
  let foundDashboard = false;
  app._router.stack.forEach((layer, i) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
      const path = layer.route.path;
      if (path.includes('dashboard') || path === '/') {
        console.log(`  ✅ [${i}] ${methods} ${path}`);
        foundDashboard = true;
      }
    } else if (layer.regexp) {
      const regexStr = layer.regexp.source;
      if (regexStr.includes('dashboard')) {
        console.log(`  ✅ [${i}] [中间件] ${layer.name || 'anonymous'}`);
        foundDashboard = true;
      }
    }
  });
  if (!foundDashboard) {
    console.log('  ❌ 没有找到 dashboard 相关路由！');
  }
  
  console.log('\n所有路由（前 15 个）:');
  app._router.stack.slice(0, 15).forEach((layer, i) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
      console.log(`  [${i}] ${methods} ${layer.route.path}`);
    } else {
      const name = layer.name || 'anonymous';
      console.log(`  [${i}] [中间件] ${name}`);
    }
  });
}
NODE_SCRIPT

