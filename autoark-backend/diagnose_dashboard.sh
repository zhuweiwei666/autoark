#!/bin/bash
# 在服务器上执行：诊断 dashboard 路由问题

cd /root/autoark/autoark-backend

echo "=== 1. 检查当前代码版本 ==="
git log -1 --oneline

echo -e "\n=== 2. 检查编译后的文件是否存在 ==="
ls -la dist/routes/dashboard.routes.js dist/app.js dist/utils/logger.js

echo -e "\n=== 3. 检查 dashboard.routes.js 的导出 ==="
tail -n 5 dist/routes/dashboard.routes.js

echo -e "\n=== 4. 检查 app.js 中的路由注册 ==="
grep -B 2 -A 2 "dashboard" dist/app.js

echo -e "\n=== 5. 检查 logger.js 是否有 try-catch ==="
grep -A 5 "hasDailyRotateFile" dist/utils/logger.js | head -n 10

echo -e "\n=== 6. 检查 PM2 进程状态 ==="
pm2 describe autoark | grep -E "(status|restarts|uptime|script)"

echo -e "\n=== 7. 检查最近的错误日志 ==="
pm2 logs autoark --err --lines 30 --nostream | tail -n 20

echo -e "\n=== 8. 检查最近的输出日志（看路由请求） ==="
pm2 logs autoark --out --lines 50 --nostream | grep -E "(GET|POST|dashboard|404)" | tail -n 20

echo -e "\n=== 9. 直接测试路由（使用 node 直接加载） ==="
node -e "
const app = require('./dist/app.js').default;
const http = require('http');
const server = http.createServer(app);
server.listen(3002, () => {
  console.log('Test server started on port 3002');
  setTimeout(() => {
    const http = require('http');
    http.get('http://localhost:3002/dashboard', (res) => {
      console.log('Dashboard route status:', res.statusCode);
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (data.includes('AutoArk Dashboard')) {
          console.log('✅ Dashboard route works!');
        } else {
          console.log('❌ Dashboard route returned:', data.substring(0, 200));
        }
        process.exit(0);
      });
    }).on('error', (e) => {
      console.log('❌ Error:', e.message);
      process.exit(1);
    });
  }, 2000);
});
" 2>&1

echo -e "\n=== 10. 检查所有注册的路由（如果可能） ==="
# 这个需要应用支持，暂时跳过

