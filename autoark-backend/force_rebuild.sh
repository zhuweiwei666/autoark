#!/bin/bash
# 在服务器上执行：强制重新编译并重启

cd /root/autoark/autoark-backend

echo "=== 1. 停止 PM2 ==="
pm2 stop autoark

echo -e "\n=== 2. 清理旧的编译文件 ==="
rm -rf dist

echo -e "\n=== 3. 拉取最新代码 ==="
git pull origin main

echo -e "\n=== 4. 重新编译 ==="
npm run build

if [ $? -ne 0 ]; then
  echo "❌ 编译失败！"
  exit 1
fi

echo -e "\n=== 5. 验证编译后的文件 ==="
if [ ! -f "dist/routes/dashboard.routes.js" ]; then
  echo "❌ dashboard.routes.js 不存在！"
  exit 1
fi
if [ ! -f "dist/app.js" ]; then
  echo "❌ app.js 不存在！"
  exit 1
fi

echo "✅ 编译文件存在"
echo "文件时间戳:"
ls -lh dist/app.js dist/routes/dashboard.routes.js | awk '{print $6, $7, $8, $9}'

echo -e "\n=== 6. 验证路由导出 ==="
node -e "
const routes = require('./dist/routes/dashboard.routes.js');
if (!routes.default || typeof routes.default !== 'function') {
  console.log('❌ 路由导出不正确！');
  process.exit(1);
}
if (!routes.default.stack || routes.default.stack.length === 0) {
  console.log('❌ 路由没有注册！');
  process.exit(1);
}
console.log('✅ 路由导出正确，路由数量:', routes.default.stack.length);
routes.default.stack.forEach((layer, i) => {
  if (layer.route) {
    const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
    console.log(\`   \${i + 1}. \${methods} \${layer.route.path}\`);
  }
});
"

if [ $? -ne 0 ]; then
  echo "❌ 路由验证失败！"
  exit 1
fi

echo -e "\n=== 7. 验证 app.js 路由注册 ==="
grep -A 2 "dashboard" dist/app.js

echo -e "\n=== 8. 重启 PM2 ==="
pm2 restart autoark

echo -e "\n=== 9. 等待服务启动（5秒） ==="
sleep 5

echo -e "\n=== 10. 检查服务状态 ==="
pm2 status autoark

echo -e "\n=== 11. 检查启动日志 ==="
pm2 logs autoark --out --lines 10 --nostream | tail -n 10

echo -e "\n=== 12. 测试路由 ==="
echo "测试 /dashboard:"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/dashboard)
echo "HTTP 状态码: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ 路由工作正常！"
  echo "响应内容预览:"
  curl -s http://localhost:3001/dashboard | head -n 20
else
  echo "❌ 路由返回错误状态码: $HTTP_CODE"
  echo "响应内容:"
  curl -s http://localhost:3001/dashboard | head -n 10
fi

echo -e "\n=== 13. 检查域名解析（如果配置了域名） ==="
if [ -n "$DOMAIN" ]; then
  echo "检查域名 $DOMAIN 解析:"
  nslookup $DOMAIN || dig $DOMAIN
else
  echo "未设置 DOMAIN 环境变量，跳过域名检查"
fi

echo -e "\n=== 完成 ==="

