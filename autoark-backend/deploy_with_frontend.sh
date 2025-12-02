#!/bin/bash
# 完整部署脚本 - 包括前端构建
# 在服务器上执行此脚本来部署最新的代码（包括前端）

set -e  # 遇到错误立即退出

echo "=========================================="
echo "AutoArk 完整部署脚本（后端 + 前端）"
echo "=========================================="
echo ""

# 部署后端
echo "【后端部署】"
echo "----------------------------------------"
cd /root/autoark/autoark-backend || {
    echo "❌ 错误: 无法进入 /root/autoark/autoark-backend 目录"
    exit 1
}

echo "1. 拉取最新代码..."
if [ -d ".git" ]; then
    git pull origin main
    echo "✅ 代码拉取完成"
else
    echo "⚠️  警告: 未找到 .git 目录，跳过代码拉取"
fi

echo ""
echo "2. 安装依赖..."
npm install --production=false

echo ""
echo "3. 重新编译 TypeScript..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ 后端编译失败！"
    exit 1
fi

echo "✅ 后端编译成功"

echo ""
echo "【前端部署】"
echo "----------------------------------------"
cd /root/autoark/autoark-frontend || {
    echo "❌ 错误: 无法进入 /root/autoark/autoark-frontend 目录"
    exit 1
}

echo "1. 拉取最新代码..."
if [ -d ".git" ]; then
    git pull origin main
    echo "✅ 代码拉取完成"
else
    echo "⚠️  警告: 未找到 .git 目录，跳过代码拉取"
fi

echo ""
echo "2. 安装依赖..."
npm install

echo ""
echo "3. 构建前端..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ 前端构建失败！"
    exit 1
fi

# 验证构建结果
if [ ! -f "dist/index.html" ]; then
    echo "❌ 错误: 前端构建失败，dist/index.html 不存在！"
    exit 1
fi

echo "✅ 前端构建成功"
echo "   构建输出: $(pwd)/dist"
ls -lh dist/ | head -5

echo ""
echo "【重启服务】"
echo "----------------------------------------"
cd /root/autoark/autoark-backend

echo "重启 PM2 服务..."
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
echo "【验证部署】"
echo "----------------------------------------"
echo "检查服务状态..."
pm2 status autoark

echo ""
echo "检查服务日志（最近 10 行）..."
pm2 logs autoark --out --lines 10 --nostream | tail -n 10

echo ""
echo "测试路由..."
echo "1. 测试 Dashboard:"
HTTP_CODE_DASHBOARD=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/dashboard || echo "000")
echo "   HTTP $HTTP_CODE_DASHBOARD"

echo ""
echo "2. 测试 /fb-token:"
HTTP_CODE_TOKEN=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/fb-token || echo "000")
echo "   HTTP $HTTP_CODE_TOKEN"

if [ "$HTTP_CODE_TOKEN" = "200" ]; then
    echo "   ✅ /fb-token 路由正常"
    
    # 检查页面内容
    RESPONSE=$(curl -s http://localhost:3001/fb-token)
    if echo "$RESPONSE" | grep -q "Facebook Token\|root\|React"; then
        echo "   ✅ 页面内容正常（包含 React 应用）"
    else
        echo "   ⚠️  警告: 页面内容可能不正确"
        echo "   响应前 200 字符:"
        echo "$RESPONSE" | head -c 200
        echo ""
    fi
else
    echo "   ❌ /fb-token 路由异常"
    echo "   响应内容:"
    curl -s http://localhost:3001/fb-token | head -c 200
    echo ""
fi

echo ""
echo "=========================================="
echo "部署完成！"
echo "=========================================="
echo ""
echo "访问地址:"
echo "  - Dashboard: http://app.autoark.work/dashboard"
echo "  - Token 管理: http://app.autoark.work/fb-token"
echo ""
echo "如果页面没有更新，请尝试："
echo "  1. 清除浏览器缓存"
echo "  2. 检查服务日志: pm2 logs autoark"
echo "  3. 检查前端构建: ls -la /root/autoark/autoark-frontend/dist"
echo ""

