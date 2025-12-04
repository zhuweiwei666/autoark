#!/bin/bash
# 修复 SSL "不安全" 警告

echo "=========================================="
echo "修复 SSL 证书警告"
echo "=========================================="

# 1. 检查证书文件
echo -e "\n=== 1. 检查证书文件 ==="
if [ -f "/etc/nginx/ssl/autoark/origin.crt" ] && [ -f "/etc/nginx/ssl/autoark/origin.key" ]; then
    echo "✅ 证书文件存在"
    
    # 检查证书有效期
    echo "证书有效期："
    openssl x509 -in /etc/nginx/ssl/autoark/origin.crt -noout -dates 2>/dev/null || echo "无法读取证书信息"
else
    echo "❌ 证书文件不存在！"
    exit 1
fi

# 2. 验证 Nginx 配置
echo -e "\n=== 2. 验证 Nginx 配置 ==="
nginx -t
if [ $? -ne 0 ]; then
    echo "❌ Nginx 配置有误！"
    exit 1
fi
echo "✅ Nginx 配置正确"

# 3. 重新加载 Nginx
echo -e "\n=== 3. 重新加载 Nginx ==="
systemctl reload nginx
if [ $? -eq 0 ]; then
    echo "✅ Nginx 重新加载成功"
else
    echo "❌ Nginx 重新加载失败！"
    exit 1
fi

# 4. 测试本地 HTTPS
echo -e "\n=== 4. 测试本地 HTTPS ==="
curl -k -I https://localhost 2>&1 | head -5

# 5. 检查防火墙
echo -e "\n=== 5. 检查防火墙 ==="
if command -v ufw &> /dev/null; then
    ufw status | grep -E "(443|80)" || echo "UFW 未启用或端口未开放"
elif command -v firewall-cmd &> /dev/null; then
    firewall-cmd --list-ports | grep -E "(443|80)" || echo "FirewallD 端口未开放"
else
    echo "未检测到防火墙或防火墙已禁用"
fi

echo -e "\n=========================================="
echo "✅ SSL 配置检查完成"
echo "=========================================="
echo ""
echo "重要提示："
echo "1. 确保 Cloudflare SSL/TLS 模式设置为 'Full' 或 'Full (strict)'"
echo "   - 登录 Cloudflare 控制台"
echo "   - 选择域名 app.autoark.work"
echo "   - 进入 SSL/TLS 设置"
echo "   - 将加密模式设置为 'Full' 或 'Full (strict)'"
echo ""
echo "2. 清除浏览器缓存和 Cookie"
echo "   - Chrome: Ctrl+Shift+Delete"
echo "   - 清除 '缓存的图片和文件' 和 'Cookie 和其他网站数据'"
echo ""
echo "3. 如果问题仍然存在，尝试："
echo "   - 使用无痕模式访问"
echo "   - 检查浏览器控制台的错误信息"
echo "   - 验证证书是否在有效期内"
echo ""

