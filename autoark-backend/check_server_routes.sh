#!/bin/bash
# 在服务器上执行这个脚本来检查路由问题

cd /root/autoark/autoark-backend

echo "=== 1. 检查 dashboard.routes.js 是否存在和导出 ==="
if [ -f "dist/routes/dashboard.routes.js" ]; then
  echo "✅ 文件存在"
  echo "最后 5 行:"
  tail -n 5 dist/routes/dashboard.routes.js
  echo ""
  echo "检查导出:"
  grep -E "exports\.default|module\.exports" dist/routes/dashboard.routes.js
else
  echo "❌ 文件不存在！"
  exit 1
fi

echo -e "\n=== 2. 检查 app.js 中的路由注册 ==="
echo "查找 dashboard 相关代码:"
grep -B 3 -A 3 "dashboard" dist/app.js

echo -e "\n=== 3. 检查路由是否正确导入 ==="
echo "查找 dashboard_routes 导入:"
grep "dashboard_routes" dist/app.js

echo -e "\n=== 4. 直接测试路由模块加载 ==="
node -e "
try {
  const dashboardRoutes = require('./dist/routes/dashboard.routes.js');
  console.log('✅ dashboard.routes.js 加载成功');
  console.log('导出类型:', typeof dashboardRoutes);
  console.log('default 导出:', typeof dashboardRoutes.default);
  if (dashboardRoutes.default) {
    console.log('✅ default 导出存在');
    console.log('路由类型:', typeof dashboardRoutes.default);
    if (typeof dashboardRoutes.default === 'function') {
      console.log('✅ 路由是一个函数（Express Router）');
    }
  } else {
    console.log('❌ default 导出不存在');
  }
} catch (e) {
  console.log('❌ 加载失败:', e.message);
  console.log(e.stack);
}
"

echo -e "\n=== 5. 检查完整的 app.js 路由注册部分 ==="
node -e "
try {
  const app = require('./dist/app.js');
  console.log('✅ app.js 加载成功');
  console.log('app 类型:', typeof app);
  console.log('app.default 类型:', typeof app.default);
} catch (e) {
  console.log('❌ app.js 加载失败:', e.message);
  console.log(e.stack);
}
"

