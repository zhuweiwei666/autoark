#!/bin/bash
# 在服务器上执行：测试路由加载

cd /root/autoark/autoark-backend

echo "=== 测试路由模块加载 ==="
node << 'NODE_SCRIPT'
const path = require('path');

console.log('1. 测试 dashboard.routes.js 加载...');
try {
  const dashboardRoutes = require('./dist/routes/dashboard.routes.js');
  console.log('   ✅ 模块加载成功');
  console.log('   导出类型:', typeof dashboardRoutes);
  console.log('   default 导出:', typeof dashboardRoutes.default);
  
  if (dashboardRoutes.default) {
    console.log('   ✅ default 导出存在');
    console.log('   路由类型:', typeof dashboardRoutes.default);
    if (typeof dashboardRoutes.default === 'function') {
      console.log('   ✅ 路由是一个函数（Express Router）');
      // 尝试检查路由栈
      if (dashboardRoutes.default.stack) {
        console.log('   ✅ 路由有 stack 属性（Express Router）');
        console.log('   注册的路由数量:', dashboardRoutes.default.stack.length);
        console.log('   路由列表:');
        dashboardRoutes.default.stack.forEach((layer, i) => {
          if (layer.route) {
            const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
            console.log(`     ${i + 1}. ${methods} ${layer.route.path}`);
          } else if (layer.regexp) {
            console.log(`     ${i + 1}. [中间件或未匹配的路由]`);
          }
        });
      }
    } else {
      console.log('   ❌ 路由不是函数');
    }
  } else {
    console.log('   ❌ default 导出不存在');
    console.log('   所有导出:', Object.keys(dashboardRoutes));
  }
} catch (e) {
  console.log('   ❌ 加载失败:', e.message);
  console.log('   错误堆栈:', e.stack);
}

console.log('\n2. 测试 app.js 加载...');
try {
  const appModule = require('./dist/app.js');
  console.log('   ✅ app.js 加载成功');
  console.log('   导出类型:', typeof appModule);
  console.log('   default 导出:', typeof appModule.default);
  
  if (appModule.default) {
    const app = appModule.default;
    console.log('   ✅ app 对象存在');
    console.log('   app 类型:', typeof app);
    if (typeof app === 'function') {
      console.log('   ✅ app 是一个函数（Express App）');
      // 检查路由栈
      if (app._router && app._router.stack) {
        console.log('   ✅ app 有路由栈');
        console.log('   注册的中间件/路由数量:', app._router.stack.length);
        console.log('   路由列表（前 10 个）:');
        app._router.stack.slice(0, 10).forEach((layer, i) => {
          if (layer.route) {
            const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
            console.log(`     ${i + 1}. ${methods} ${layer.route.path}`);
          } else if (layer.regexp) {
            const path = layer.regexp.source.replace(/\\\//g, '/').replace(/\^|\$/g, '');
            console.log(`     ${i + 1}. [中间件] ${path}`);
          }
        });
        
        // 查找 dashboard 相关路由
        console.log('\n   查找 dashboard 相关路由:');
        app._router.stack.forEach((layer, i) => {
          if (layer.route) {
            const path = layer.route.path;
            if (path.includes('dashboard')) {
              const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
              console.log(`     找到: ${methods} ${path}`);
            }
          }
        });
      }
    }
  }
} catch (e) {
  console.log('   ❌ 加载失败:', e.message);
  console.log('   错误堆栈:', e.stack);
}
NODE_SCRIPT

