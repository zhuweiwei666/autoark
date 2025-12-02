#!/bin/bash
# 前端资源加载问题排查脚本

echo "=========================================="
echo "🔍 AutoArk 前端诊断工具"
echo "=========================================="

DIST_DIR="/root/autoark/autoark-frontend/dist"
BACKEND_DIR="/root/autoark/autoark-backend"

# 1. 检查构建目录
echo -e "\n📂 1. 检查构建目录结构:"
if [ -d "$DIST_DIR" ]; then
    echo "✅ dist 目录存在: $DIST_DIR"
    ls -F "$DIST_DIR"
    
    echo -e "\n   assets 目录内容:"
    if [ -d "$DIST_DIR/assets" ]; then
        ls -F "$DIST_DIR/assets"
    else
        echo "❌ assets 目录不存在！"
    fi
else
    echo "❌ dist 目录不存在！请先构建前端。"
fi

# 2. 检查 index.html 中的引用
echo -e "\n📄 2. 检查 index.html 资源引用:"
if [ -f "$DIST_DIR/index.html" ]; then
    grep -o 'href="[^"]*"' "$DIST_DIR/index.html" | head -n 5
    grep -o 'src="[^"]*"' "$DIST_DIR/index.html" | head -n 5
else
    echo "❌ index.html 不存在"
fi

# 3. 模拟请求测试
echo -e "\n🌐 3. 模拟 HTTP 请求 (localhost:3001):"

# 测试首页
echo -n "   GET /fb-token (HTML): "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/fb-token)
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ 200 OK"
else
    echo "❌ $HTTP_CODE"
fi

# 查找 CSS 文件名
CSS_FILE=$(ls $DIST_DIR/assets/*.css 2>/dev/null | head -n 1 | xargs basename 2>/dev/null)

if [ -n "$CSS_FILE" ]; then
    echo -n "   GET /assets/$CSS_FILE (CSS): "
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/assets/$CSS_FILE)
    if [ "$HTTP_CODE" = "200" ]; then
        echo "✅ 200 OK"
    else
        echo "❌ $HTTP_CODE (这就是问题所在!)"
        echo "   尝试带 base 路径请求..."
        echo -n "   GET /$CSS_FILE (Root): "
        curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/$CSS_FILE
    fi
else
    echo "⚠️  未找到 CSS 文件，跳过 CSS 测试"
fi

# 4. 检查后端配置
echo -e "\n⚙️  4. 检查后端 app.js 配置:"
grep -A 5 "express.static" $BACKEND_DIR/dist/app.js || echo "❌ 未找到 express.static 配置"

echo -e "\n=========================================="
echo "诊断完成"
echo "=========================================="

