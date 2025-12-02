#!/bin/bash
# 强制清理并重新构建前端
# 用于解决页面不更新的问题

echo ">>> 开始强制重构前端..."

cd /root/autoark/autoark-frontend || exit 1

echo "1. 拉取最新代码..."
git fetch origin
git reset --hard origin/main

echo "2. 清理旧文件 (dist, node_modules)..."
rm -rf dist
# rm -rf node_modules # 如果安装时间太长，可以注释掉这行，除非依赖有问题

echo "3. 安装依赖..."
npm install

echo "4. 构建前端..."
npm run build

if [ -f "dist/index.html" ]; then
    echo "✅ 前端构建成功！"
    echo "   文件时间: $(date -r dist/index.html)"
else
    echo "❌ 前端构建失败！"
    exit 1
fi

echo "5. 检查文件内容..."
# 检查是否包含新功能的关键词
if grep -q "添加 Token" dist/assets/*.js; then
    echo "✅ 检测到新功能代码 ('添加 Token' 按钮)"
else
    echo "⚠️  警告: 未在构建产物中检测到新功能代码"
fi

echo "6. 重启后端服务..."
cd /root/autoark/autoark-backend
pm2 restart autoark

echo ">>> 完成！请在浏览器中【强制刷新】页面 (Ctrl+F5 或 Shift+Cmd+R)"

