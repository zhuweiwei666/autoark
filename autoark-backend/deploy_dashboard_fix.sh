#!/bin/bash
# 自动部署 Dashboard 修复脚本
# 在服务器上执行此脚本来部署最新的 Dashboard 修复

set -e  # 遇到错误立即退出

echo "=========================================="
echo "AutoArk Dashboard 修复部署脚本"
echo "=========================================="
echo ""

cd /root/autoark/autoark-backend || {
    echo "❌ 错误: 无法进入 /root/autoark/autoark-backend 目录"
    exit 1
}

echo "【1/6】备份当前代码..."
BACKUP_DIR="/root/autoark/backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r dist "$BACKUP_DIR/" 2>/dev/null || true
echo "✅ 备份完成: $BACKUP_DIR"

echo ""
echo "【2/6】拉取最新代码..."
if [ -d ".git" ]; then
    git fetch origin
    git pull origin main
    echo "✅ 代码拉取完成"
else
    echo "⚠️  警告: 未找到 .git 目录，跳过代码拉取"
    echo "   请确保代码已手动更新"
fi

echo ""
echo "【3/6】检查源文件修改..."
if git log -1 --oneline | grep -q "dashboard\|token"; then
    echo "✅ 检测到相关更新"
else
    echo "⚠️  警告: 未检测到相关更新，继续执行..."
fi

echo ""
echo "【4/6】安装依赖（如果需要）..."
npm install --production=false
echo "✅ 依赖检查完成"

echo ""
echo "【5/6】重新编译 TypeScript..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ 编译失败！"
    echo "恢复备份..."
    cp -r "$BACKUP_DIR/dist" . 2>/dev/null || true
    exit 1
fi

# 验证编译后的文件
if [ ! -f "dist/routes/dashboard.routes.js" ]; then
    echo "❌ 错误: 编译后的 dashboard.routes.js 不存在！"
    exit 1
fi

if [ ! -f "dist/app.js" ]; then
    echo "❌ 错误: 编译后的 app.js 不存在！"
    exit 1
fi

echo "✅ 编译成功"
echo "   文件时间戳:"
ls -lh dist/app.js dist/routes/dashboard.routes.js | awk '{print "   " $6, $7, $8, $9}'

echo ""
echo "【6/6】重启 PM2 服务..."
pm2 restart autoark

if [ $? -eq 0 ]; then
    echo "✅ PM2 服务重启成功"
else
    echo "❌ PM2 服务重启失败！"
    echo "尝试使用 ecosystem.config.js 启动..."
    pm2 delete autoark 2>/dev/null || true
    pm2 start ecosystem.config.js
    pm2 save
fi

echo ""
echo "等待服务启动（5秒）..."
sleep 5

echo ""
echo "【验证】检查服务状态..."
pm2 status autoark

echo ""
echo "【验证】检查服务日志（最近 10 行）..."
pm2 logs autoark --out --lines 10 --nostream | tail -n 10

echo ""
echo "【验证】测试 Dashboard 路由..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/dashboard || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Dashboard 路由正常 (HTTP $HTTP_CODE)"
    
    # 检查页面内容是否包含新链接
    RESPONSE=$(curl -s http://localhost:3001/dashboard)
    if echo "$RESPONSE" | grep -q "Facebook Token 管理"; then
        echo "✅ 页面包含 'Facebook Token 管理' 链接"
    else
        echo "⚠️  警告: 页面未找到 'Facebook Token 管理' 链接"
    fi
else
    echo "❌ Dashboard 路由异常 (HTTP $HTTP_CODE)"
    echo "请检查服务日志: pm2 logs autoark"
fi

echo ""
echo "=========================================="
echo "部署完成！"
echo "=========================================="
echo ""
echo "访问地址: http://app.autoark.work/dashboard"
echo "应该能看到右上角的 'Facebook Token 管理' 按钮"
echo ""
echo "如果页面没有更新，请尝试："
echo "  1. 清除浏览器缓存"
echo "  2. 检查 Nginx 配置: sudo nginx -t"
echo "  3. 查看服务日志: pm2 logs autoark"
echo ""

