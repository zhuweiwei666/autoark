#!/bin/bash
# 在服务器上执行：测试正在运行的 PM2 应用

cd /root/autoark/autoark-backend

echo "=== 1. 检查 PM2 进程状态 ==="
pm2 describe autoark | grep -E "(status|script|cwd|exec_mode)"

echo -e "\n=== 2. 检查 PM2 进程的环境变量 ==="
pm2 describe autoark | grep -A 20 "env:"

echo -e "\n=== 3. 检查最近的请求日志（看是否有 /dashboard 请求） ==="
pm2 logs autoark --out --lines 100 --nostream | grep -E "(GET|POST|dashboard|404)" | tail -n 20

echo -e "\n=== 4. 直接测试路由（使用 curl） ==="
echo "测试 /dashboard:"
curl -v http://localhost:3001/dashboard 2>&1 | head -n 40

echo -e "\n测试 /api/dashboard/api/health:"
curl -v http://localhost:3001/api/dashboard/api/health 2>&1 | head -n 20

echo -e "\n=== 5. 检查编译后的 app.js 路由注册 ==="
grep -B 2 -A 2 "dashboard" dist/app.js

echo -e "\n=== 6. 检查是否有其他中间件拦截请求 ==="
node << 'NODE_SCRIPT'
require('dotenv').config();
const app = require('./dist/app.js').default;

// 检查路由栈
if (app._router && app._router.stack) {
  console.log('注册的中间件/路由数量:', app._router.stack.length);
  console.log('\n所有路由（前 20 个）:');
  app._router.stack.slice(0, 20).forEach((layer, i) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
      console.log(`  ${i + 1}. ${methods} ${layer.route.path}`);
    } else if (layer.regexp) {
      const path = layer.regexp.source.replace(/\\\//g, '/').replace(/\^|\$/g, '').substring(0, 50);
      const name = layer.name || 'anonymous';
      console.log(`  ${i + 1}. [中间件] ${name} - ${path}`);
    }
  });
  
  // 查找 dashboard 相关
  console.log('\n查找 dashboard 相关路由:');
  let found = false;
  app._router.stack.forEach((layer, i) => {
    if (layer.route) {
      const path = layer.route.path;
      if (path.includes('dashboard') || path === '/') {
        const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
        console.log(`  ✅ 找到: ${methods} ${path} (索引: ${i})`);
        found = true;
      }
    } else if (layer.regexp) {
      const regexStr = layer.regexp.source;
      if (regexStr.includes('dashboard')) {
        console.log(`  ✅ 找到中间件: ${layer.name || 'anonymous'} (索引: ${i})`);
        found = true;
      }
    }
  });
  if (!found) {
    console.log('  ❌ 没有找到 dashboard 相关路由！');
  }
}
NODE_SCRIPT

