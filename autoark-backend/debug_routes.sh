#!/bin/bash
# 在服务器上执行：调试路由问题

cd /root/autoark/autoark-backend

echo "=== 1. 检查编译后的路由文件 ==="
echo "检查 dashboard.routes.js 的最后几行（看导出）:"
tail -n 5 dist/routes/dashboard.routes.js

echo -e "\n=== 2. 检查 app.js 中的路由注册 ==="
grep -A 5 "dashboard" dist/app.js

echo -e "\n=== 3. 直接测试路由模块加载 ==="
node << 'NODE_SCRIPT'
require('dotenv').config({ path: '/root/autoark/autoark-backend/.env' });

console.log('1. 测试 dashboard.routes.js 加载...');
try {
  const dashboardRoutes = require('./dist/routes/dashboard.routes.js');
  console.log('   ✅ 模块加载成功');
  console.log('   default 导出类型:', typeof dashboardRoutes.default);
  
  if (dashboardRoutes.default && dashboardRoutes.default.stack) {
    console.log('   ✅ 路由有 stack，路由数量:', dashboardRoutes.default.stack.length);
    console.log('   路由列表:');
    dashboardRoutes.default.stack.forEach((layer, i) => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
        console.log(`     ${i + 1}. ${methods} ${layer.route.path}`);
      }
    });
  }
} catch (e) {
  console.log('   ❌ 加载失败:', e.message);
}

console.log('\n2. 测试 app.js 加载和路由注册...');
try {
  const app = require('./dist/app.js').default;
  console.log('   ✅ app 加载成功');
  
  if (app._router && app._router.stack) {
    console.log('   ✅ app 有路由栈，总数:', app._router.stack.length);
    
    // 查找所有路由
    console.log('\n   所有路由和中间件:');
    app._router.stack.forEach((layer, i) => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
        console.log(`     [${i}] ${methods} ${layer.route.path}`);
      } else {
        const name = layer.name || 'anonymous';
        const regex = layer.regexp ? layer.regexp.source.substring(0, 50) : 'N/A';
        console.log(`     [${i}] [中间件] ${name} - ${regex}`);
      }
    });
    
    // 专门查找 dashboard 相关
    console.log('\n   查找 dashboard 相关:');
    let found = false;
    app._router.stack.forEach((layer, i) => {
      if (layer.route) {
        const path = layer.route.path;
        if (path.includes('dashboard') || path === '/') {
          const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
          console.log(`     ✅ [${i}] ${methods} ${path}`);
          found = true;
        }
      } else {
        const regex = layer.regexp ? layer.regexp.source : '';
        if (regex.includes('dashboard')) {
          console.log(`     ✅ [${i}] [中间件] ${layer.name || 'anonymous'} - ${regex.substring(0, 50)}`);
          found = true;
        }
      }
    });
    if (!found) {
      console.log('     ❌ 没有找到 dashboard 相关路由！');
    }
  }
} catch (e) {
  console.log('   ❌ 加载失败:', e.message);
  console.log('   错误堆栈:', e.stack);
}
NODE_SCRIPT

echo -e "\n=== 4. 测试实际的路由匹配 ==="
node << 'NODE_SCRIPT'
require('dotenv').config({ path: '/root/autoark/autoark-backend/.env' });
const http = require('http');
const app = require('./dist/app.js').default;

const server = http.createServer(app);
server.listen(3002, () => {
  console.log('测试服务器启动在端口 3002');
  
  setTimeout(() => {
    const tests = [
      { path: '/dashboard', name: '/dashboard' },
      { path: '/api/dashboard', name: '/api/dashboard' },
      { path: '/api/dashboard/api/health', name: '/api/dashboard/api/health' },
    ];
    
    let completed = 0;
    tests.forEach((test) => {
      http.get(`http://localhost:3002${test.path}`, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          console.log(`\n${test.name}:`);
          console.log(`  状态码: ${res.statusCode}`);
          console.log(`  响应长度: ${data.length} 字节`);
          if (data.length < 200) {
            console.log(`  响应内容: ${data.substring(0, 100)}`);
          } else {
            console.log(`  响应开头: ${data.substring(0, 100)}...`);
          }
          
          completed++;
          if (completed === tests.length) {
            server.close();
            process.exit(0);
          }
        });
      }).on('error', (e) => {
        console.log(`\n${test.name}: 错误 - ${e.message}`);
        completed++;
        if (completed === tests.length) {
          server.close();
          process.exit(0);
        }
      });
    });
  }, 1000);
});
NODE_SCRIPT

