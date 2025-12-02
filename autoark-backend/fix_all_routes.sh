#!/bin/bash
# 在服务器上执行：全面修复路由问题

cd /root/autoark/autoark-backend

echo "=== 1. 检查当前状态 ==="
pm2 status autoark

echo -e "\n=== 2. 停止 PM2 进程 ==="
pm2 stop autoark

echo -e "\n=== 3. 清理并重新编译 ==="
rm -rf dist
npm run build

echo -e "\n=== 4. 检查编译后的文件 ==="
if [ ! -f "dist/routes/dashboard.routes.js" ]; then
  echo "❌ dashboard.routes.js 不存在！"
  exit 1
fi
if [ ! -f "dist/app.js" ]; then
  echo "❌ app.js 不存在！"
  exit 1
fi
echo "✅ 编译文件存在"

echo -e "\n=== 5. 验证路由导出 ==="
node -e "
const routes = require('./dist/routes/dashboard.routes.js');
console.log('dashboard.routes 导出类型:', typeof routes.default);
if (routes.default && routes.default.stack) {
  console.log('✅ 路由有 stack，路由数量:', routes.default.stack.length);
  routes.default.stack.forEach((layer, i) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
      console.log(\`   \${i + 1}. \${methods} \${layer.route.path}\`);
    }
  });
} else {
  console.log('❌ 路由没有 stack 或不是有效的 Router');
  process.exit(1);
}
"

if [ $? -ne 0 ]; then
  echo "❌ 路由验证失败！"
  exit 1
fi

echo -e "\n=== 6. 验证 app.js 路由注册 ==="
node -e "
require('dotenv').config({ path: '/root/autoark/autoark-backend/.env' });
const app = require('./dist/app.js').default;
if (app._router && app._router.stack) {
  console.log('✅ app 有路由栈，总数:', app._router.stack.length);
  let foundDashboard = false;
  app._router.stack.forEach((layer, i) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
      const path = layer.route.path;
      if (path.includes('dashboard') || path === '/') {
        console.log(\`   ✅ [\${i}] \${methods} \${path}\`);
        foundDashboard = true;
      }
    } else if (layer.regexp) {
      const regex = layer.regexp.source;
      if (regex.includes('dashboard')) {
        console.log(\`   ✅ [\${i}] [中间件] \${layer.name || 'anonymous'}\`);
        foundDashboard = true;
      }
    }
  });
  if (!foundDashboard) {
    console.log('❌ 没有找到 dashboard 路由！');
    process.exit(1);
  }
} else {
  console.log('❌ app 没有路由栈！');
  process.exit(1);
}
"

if [ $? -ne 0 ]; then
  echo "❌ app.js 路由验证失败！"
  exit 1
fi

echo -e "\n=== 7. 测试路由（使用 node 直接启动） ==="
node << 'NODE_SCRIPT'
require('dotenv').config({ path: '/root/autoark/autoark-backend/.env' });
const app = require('./dist/app.js').default;
const http = require('http');

const server = http.createServer(app);
server.listen(3003, () => {
  console.log('✅ 测试服务器启动在端口 3003');
  
  setTimeout(() => {
    http.get('http://localhost:3003/dashboard', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`\n/dashboard 测试结果:`);
        console.log(`  状态码: ${res.statusCode}`);
        console.log(`  响应长度: ${data.length} 字节`);
        if (res.statusCode === 200 && data.includes('AutoArk Dashboard')) {
          console.log('  ✅ 路由工作正常！');
          server.close();
          process.exit(0);
        } else {
          console.log(`  ❌ 路由不工作！`);
          console.log(`  响应内容: ${data.substring(0, 300)}`);
          server.close();
          process.exit(1);
        }
      });
    }).on('error', (e) => {
      console.log(`  ❌ 错误: ${e.message}`);
      server.close();
      process.exit(1);
    });
  }, 1000);
});
NODE_SCRIPT

if [ $? -ne 0 ]; then
  echo "❌ 路由测试失败！"
  exit 1
fi

echo -e "\n=== 8. 重启 PM2 ==="
pm2 restart autoark

echo -e "\n=== 9. 等待服务启动 ==="
sleep 5

echo -e "\n=== 10. 检查服务状态 ==="
pm2 status autoark

echo -e "\n=== 11. 测试实际路由 ==="
echo "测试 /dashboard:"
curl -s -w "\nHTTP Status: %{http_code}\n" http://localhost:3001/dashboard | head -n 10

echo -e "\n=== 12. 检查启动日志 ==="
pm2 logs autoark --out --lines 20 --nostream | tail -n 20

echo -e "\n=== 完成 ==="
echo "如果看到 HTTP Status: 200 和 HTML 内容，说明路由工作正常！"

