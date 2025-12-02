#!/bin/bash
# 在服务器上执行：快速测试路由

cd /root/autoark/autoark-backend

echo "=== 1. 检查 PM2 使用的文件 ==="
pm2 describe autoark | grep "script path"

echo -e "\n=== 2. 检查文件是否存在 ==="
ls -la dist/server.js dist/app.js dist/routes/dashboard.routes.js

echo -e "\n=== 3. 检查 dashboard.routes.js 的导出 ==="
node -e "const r = require('./dist/routes/dashboard.routes.js'); console.log('导出类型:', typeof r.default); console.log('是函数:', typeof r.default === 'function'); if (r.default && r.default.stack) console.log('路由数量:', r.default.stack.length);"

echo -e "\n=== 4. 检查 app.js 中的路由导入 ==="
node -e "const app = require('./dist/app.js'); console.log('app 类型:', typeof app.default); const a = app.default; if (a._router) console.log('路由栈数量:', a._router.stack.length);"

echo -e "\n=== 5. 测试路由（使用 node 直接启动） ==="
node << 'NODE_SCRIPT'
require('dotenv').config({ path: '/root/autoark/autoark-backend/.env' });
const app = require('./dist/app.js').default;
const http = require('http');

const server = http.createServer(app);
server.listen(3003, () => {
  console.log('测试服务器启动在端口 3003');
  
  setTimeout(() => {
    http.get('http://localhost:3003/dashboard', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`\n/dashboard 测试:`);
        console.log(`  状态码: ${res.statusCode}`);
        console.log(`  响应长度: ${data.length} 字节`);
        if (data.includes('AutoArk Dashboard')) {
          console.log('  ✅ 路由工作正常！');
        } else {
          console.log(`  响应内容: ${data.substring(0, 200)}`);
        }
        server.close();
        process.exit(0);
      });
    }).on('error', (e) => {
      console.log(`错误: ${e.message}`);
      server.close();
      process.exit(1);
    });
  }, 1000);
});
NODE_SCRIPT

