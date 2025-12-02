#!/bin/bash
# 在服务器上执行：检查运行时的路由注册

cd /root/autoark/autoark-backend

echo "=== 1. 检查 PM2 进程 ==="
pm2 describe autoark | grep -E "pid|script|status"

echo -e "\n=== 2. 获取 PM2 进程的实际 PID ==="
PM2_PID=$(pm2 jlist | python3 -c "import sys, json; data=json.load(sys.stdin); print([x['pid'] for x in data if x.get('name')=='autoark'][0])" 2>/dev/null)
if [ -z "$PM2_PID" ]; then
  PM2_PID=$(pm2 jlist | grep -A 10 '"name":"autoark"' | grep '"pid"' | head -1 | sed 's/.*"pid":\([0-9]*\).*/\1/')
fi

if [ -n "$PM2_PID" ]; then
  echo "PM2 进程 PID: $PM2_PID"
  echo "进程命令行:"
  ps -p $PM2_PID -o cmd --no-headers 2>/dev/null || echo "进程不存在"
else
  echo "无法获取 PM2 进程 PID"
fi

echo -e "\n=== 3. 检查所有 Node 进程 ==="
ps aux | grep "node.*dist" | grep -v grep

echo -e "\n=== 4. 检查编译后的代码 ==="
echo "检查 dashboard.routes.js 的导出:"
node -e "
const routes = require('./dist/routes/dashboard.routes.js');
console.log('导出类型:', typeof routes.default);
if (routes.default && routes.default.stack) {
  console.log('路由数量:', routes.default.stack.length);
}
"

echo -e "\n=== 5. 直接测试路由（不通过 PM2） ==="
node << 'NODE_SCRIPT'
require('dotenv').config({ path: '/root/autoark/autoark-backend/.env' });

// 直接加载 app，不通过 server.js
const app = require('/root/autoark/autoark-backend/dist/app.js').default;

// 创建一个简单的测试服务器
const http = require('http');
const server = http.createServer((req, res) => {
  app(req, res, () => {
    if (!res.headersSent) {
      res.statusCode = 404;
      res.end('Not found');
    }
  });
});

server.listen(3008, () => {
  console.log('测试服务器启动在 3008 端口');
  
  setTimeout(() => {
    http.get('http://localhost:3008/dashboard', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`\n/dashboard 测试结果:`);
        console.log(`  状态码: ${res.statusCode}`);
        console.log(`  响应长度: ${data.length} 字节`);
        if (res.statusCode === 200 && data.includes('AutoArk Dashboard')) {
          console.log('  ✅ 路由工作正常！');
        } else {
          console.log(`  ❌ 路由不工作`);
          console.log(`  响应内容: ${data.substring(0, 300)}`);
        }
        
        // 检查路由栈
        if (app._router && app._router.stack) {
          console.log(`\n路由栈数量: ${app._router.stack.length}`);
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
                console.log(`      正则: ${regex.substring(0, 60)}`);
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
        process.exit(res.statusCode === 200 ? 0 : 1);
      });
    }).on('error', (e) => {
      console.log(`错误: ${e.message}`);
      server.close();
      process.exit(1);
    });
  }, 1000);
});
NODE_SCRIPT

echo -e "\n=== 6. 如果测试成功，说明问题在 PM2 ==="
echo "需要检查 PM2 进程是否使用了正确的代码"

