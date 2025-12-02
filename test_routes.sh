#!/bin/bash
# 在服务器上执行这个脚本来测试路由

cd /root/autoark/autoark-backend

echo "=== 1. 检查服务是否运行 ==="
pm2 list | grep autoark

echo -e "\n=== 2. 检查所有注册的路由 ==="
# 直接运行 node 并检查路由
node -e "
const app = require('./dist/app.js').default;
const server = require('http').createServer(app);
server.listen(3002, () => {
  console.log('Test server started on port 3002');
  setTimeout(() => {
    const http = require('http');
    http.get('http://localhost:3002/dashboard', (res) => {
      console.log('Dashboard route status:', res.statusCode);
      res.on('data', (chunk) => {
        if (chunk.toString().includes('AutoArk Dashboard')) {
          console.log('✅ Dashboard route works!');
        } else {
          console.log('❌ Dashboard route returned:', chunk.toString().substring(0, 100));
        }
      });
      setTimeout(() => process.exit(0), 1000);
    }).on('error', (e) => {
      console.log('❌ Error:', e.message);
      process.exit(1);
    });
  }, 2000);
});
"

echo -e "\n=== 3. 检查 PM2 进程的请求日志 ==="
pm2 logs autoark --out --lines 20 --nostream | grep -E "(GET|POST|dashboard)" | tail -n 10

echo -e "\n=== 4. 测试所有可能的路由 ==="
for route in "/" "/dashboard" "/api/dashboard" "/api/dashboard/api/health"; do
  echo "Testing $route:"
  curl -s -o /dev/null -w "  Status: %{http_code}\n" "http://localhost:3001$route"
done

