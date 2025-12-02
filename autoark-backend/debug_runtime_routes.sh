#!/bin/bash
# 在服务器上执行：调试运行时的路由问题

cd /root/autoark/autoark-backend

echo "=== 1. 创建一个测试脚本来检查运行时的路由 ==="
cat > /tmp/test_routes.js << 'NODE_SCRIPT'
require('dotenv').config({ path: '/root/autoark/autoark-backend/.env' });

// 直接加载编译后的 app
const app = require('/root/autoark/autoark-backend/dist/app.js').default;

console.log('=== 检查路由栈 ===');
if (app._router && app._router.stack) {
  console.log(`路由栈总数: ${app._router.stack.length}\n`);
  
  console.log('所有路由和中间件:');
  app._router.stack.forEach((layer, i) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
      console.log(`  [${i}] ${methods} ${layer.route.path}`);
    } else {
      const name = layer.name || 'anonymous';
      const regex = layer.regexp ? layer.regexp.source.substring(0, 60) : 'N/A';
      console.log(`  [${i}] [中间件] ${name}`);
      console.log(`      正则: ${regex}`);
    }
  });
  
  console.log('\n=== 查找 dashboard 相关 ===');
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
        console.log(`      正则: ${regex.substring(0, 80)}`);
        found = true;
      }
    }
  });
  if (!found) {
    console.log('  ❌ 没有找到 dashboard 相关路由！');
  }
  
  // 测试路由匹配
  console.log('\n=== 测试路由匹配 ===');
  const http = require('http');
  const testPaths = ['/dashboard', '/api/dashboard', '/api/dashboard/api/health'];
  
  const server = http.createServer((req, res) => {
    // 手动测试路由匹配
    let matched = false;
    app._router.stack.forEach((layer) => {
      if (layer.route && layer.route.path === req.url) {
        matched = true;
        console.log(`  ✅ 匹配到路由: ${req.method} ${req.url}`);
      }
    });
    if (!matched) {
      console.log(`  ❌ 未匹配: ${req.method} ${req.url}`);
    }
    res.end('test');
  });
  
  server.listen(3004, () => {
    console.log('测试服务器启动在 3004 端口');
    setTimeout(() => {
      testPaths.forEach((path) => {
        http.get(`http://localhost:3004${path}`, (res) => {
          res.on('data', () => {});
          res.on('end', () => {
            console.log(`  测试 ${path} 完成`);
          });
        }).on('error', () => {});
      });
      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 2000);
    }, 500);
  });
} else {
  console.log('❌ app 没有路由栈！');
  process.exit(1);
}
NODE_SCRIPT

echo "=== 2. 运行测试脚本 ==="
node /tmp/test_routes.js

echo -e "\n=== 3. 直接测试实际运行的服务 ==="
echo "使用 curl 测试，并查看详细输出:"
curl -v http://localhost:3001/dashboard 2>&1 | head -n 30

echo -e "\n=== 4. 检查 PM2 日志中的请求记录 ==="
pm2 logs autoark --out --lines 50 --nostream | grep -E "\[GET|\[POST|dashboard" | tail -n 10

