#!/bin/bash
# 在服务器上执行：测试路由导入问题

cd /root/autoark/autoark-backend

echo "=== 1. 检查 dashboard.routes.js 的导出 ==="
node -e "
const routes = require('./dist/routes/dashboard.routes.js');
console.log('导出对象:', Object.keys(routes));
console.log('default 类型:', typeof routes.default);
console.log('default 值:', routes.default);
if (routes.default) {
  console.log('是函数:', typeof routes.default === 'function');
  console.log('有 stack:', routes.default.stack ? '是' : '否');
  if (routes.default.stack) {
    console.log('路由数量:', routes.default.stack.length);
  }
}
"

echo -e "\n=== 2. 检查 app.js 中的导入 ==="
node -e "
const appModule = require('./dist/app.js');
console.log('app 模块导出:', Object.keys(appModule));
console.log('app.default 类型:', typeof appModule.default);
"

echo -e "\n=== 3. 直接测试路由注册（模拟 app.js 的加载过程）==="
node << 'NODE_SCRIPT'
require('dotenv').config({ path: '/root/autoark/autoark-backend/.env' });

console.log('1. 导入 dashboard routes...');
const dashboardRoutes = require('/root/autoark/autoark-backend/dist/routes/dashboard.routes.js');
console.log('   dashboardRoutes:', typeof dashboardRoutes);
console.log('   dashboardRoutes.default:', typeof dashboardRoutes.default);

if (!dashboardRoutes.default) {
  console.log('   ❌ dashboardRoutes.default 是 undefined！');
  process.exit(1);
}

console.log('\n2. 创建 Express app...');
const express = require('express');
const app = express();

console.log('3. 注册路由...');
app.use('/dashboard', dashboardRoutes.default);

console.log('4. 检查路由栈...');
if (app._router && app._router.stack) {
  console.log('   路由栈数量:', app._router.stack.length);
  app._router.stack.forEach((layer, i) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
      console.log(`   [${i}] ${methods} ${layer.route.path}`);
    } else {
      console.log(`   [${i}] [中间件] ${layer.name || 'anonymous'}`);
    }
  });
} else {
  console.log('   ❌ 没有路由栈！');
}

console.log('\n5. 测试路由...');
const http = require('http');
const server = http.createServer(app);
server.listen(3005, () => {
  console.log('   测试服务器启动在 3005 端口');
  setTimeout(() => {
    http.get('http://localhost:3005/dashboard', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`   状态码: ${res.statusCode}`);
        console.log(`   响应长度: ${data.length}`);
        if (res.statusCode === 200 && data.includes('AutoArk Dashboard')) {
          console.log('   ✅ 路由工作正常！');
        } else {
          console.log(`   ❌ 路由不工作，响应: ${data.substring(0, 200)}`);
        }
        server.close();
        process.exit(res.statusCode === 200 ? 0 : 1);
      });
    }).on('error', (e) => {
      console.log(`   ❌ 错误: ${e.message}`);
      server.close();
      process.exit(1);
    });
  }, 500);
});
NODE_SCRIPT

