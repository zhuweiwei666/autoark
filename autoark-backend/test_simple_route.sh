#!/bin/bash
# 在服务器上执行：简单测试路由注册

cd /root/autoark/autoark-backend

echo "=== 直接测试路由注册（不加载整个 app） ==="
node << 'NODE_SCRIPT'
const express = require('express');
const dashboardRoutes = require('./dist/routes/dashboard.routes.js');

console.log('1. 创建 Express app...');
const app = express();

console.log('2. 注册 /dashboard 路由...');
app.use('/dashboard', dashboardRoutes.default);

console.log('3. 检查路由栈...');
if (app._router && app._router.stack) {
  console.log(`   路由栈数量: ${app._router.stack.length}`);
  console.log('\n   路由列表:');
  app._router.stack.forEach((layer, i) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
      console.log(`     [${i}] ${methods} ${layer.route.path}`);
    } else {
      const name = layer.name || 'anonymous';
      const regex = layer.regexp ? layer.regexp.source.substring(0, 50) : 'N/A';
      console.log(`     [${i}] [中间件] ${name}`);
      if (regex.includes('dashboard')) {
        console.log(`         正则: ${regex}`);
      }
    }
  });
} else {
  console.log('   ❌ 没有路由栈！');
  process.exit(1);
}

console.log('\n4. 启动测试服务器...');
const http = require('http');
const server = http.createServer(app);
server.listen(3006, () => {
  console.log('   服务器启动在 3006 端口');
  
  setTimeout(() => {
    console.log('\n5. 测试 /dashboard 路由...');
    http.get('http://localhost:3006/dashboard', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`   状态码: ${res.statusCode}`);
        console.log(`   响应长度: ${data.length} 字节`);
        if (res.statusCode === 200 && data.includes('AutoArk Dashboard')) {
          console.log('   ✅ 路由工作正常！');
          console.log('   响应内容预览（前 200 字符）:');
          console.log(`   ${data.substring(0, 200)}...`);
        } else {
          console.log(`   ❌ 路由不工作！`);
          console.log(`   响应内容: ${data.substring(0, 300)}`);
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

if [ $? -eq 0 ]; then
  echo -e "\n✅ 路由测试成功！说明路由模块本身是正确的。"
  echo "问题可能在于 PM2 进程使用的代码版本或运行时环境。"
else
  echo -e "\n❌ 路由测试失败！"
fi

echo -e "\n=== 检查 PM2 进程使用的代码 ==="
echo "PM2 进程 ID:"
pm2 describe autoark | grep "script path"

echo -e "\n检查 PM2 进程的文件时间戳:"
pm2 describe autoark | grep "script path" | awk '{print $3}' | xargs ls -lh 2>/dev/null | awk '{print $6, $7, $8, $9}'

echo -e "\n检查编译后的文件时间戳:"
ls -lh dist/server.js dist/app.js | awk '{print $6, $7, $8, $9}'

echo -e "\n=== 如果时间戳不一致，需要重启 PM2 ==="
echo "运行: pm2 restart autoark"

