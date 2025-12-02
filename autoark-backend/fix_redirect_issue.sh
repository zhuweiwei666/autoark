#!/bin/bash
# 在服务器上执行：修复重定向问题

cd /root/autoark/autoark-backend

echo "=== 1. 检查 Nginx 配置中的重定向 ==="
echo "查找所有重定向规则:"
sudo grep -r "return\|rewrite" /etc/nginx/sites-available/autoark.conf /etc/nginx/sites-enabled/autoark.conf 2>/dev/null | grep -v "#"

echo -e "\n=== 2. 检查 Nginx 配置的 server_name ==="
echo "当前配置的域名:"
sudo grep "server_name" /etc/nginx/sites-available/autoark.conf /etc/nginx/sites-enabled/autoark.conf 2>/dev/null | grep -v "#"

echo -e "\n=== 3. 测试重定向（使用 curl） ==="
echo "测试 app.autoark.work（查看响应头）:"
curl -I -H "Host: app.autoark.work" http://localhost/dashboard 2>&1 | grep -E "HTTP|Location|301|302|307|308"

echo -e "\n=== 4. 修复 Nginx 配置（确保没有重定向） ==="
sudo tee /etc/nginx/sites-available/autoark.conf > /dev/null << 'NGINX_CONFIG'
server {
    listen 80;
    server_name app.autoark.work app.autoark.cloud;

    # 禁止任何重定向
    # 所有请求直接代理到 Node.js 服务（3001 端口）
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 增加超时时间
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # 确保不重定向
        proxy_redirect off;
    }
}
NGINX_CONFIG

echo "✅ Nginx 配置已更新（添加了 proxy_redirect off）"

echo -e "\n=== 5. 检查配置语法 ==="
sudo nginx -t

if [ $? -ne 0 ]; then
  echo "❌ Nginx 配置语法错误！"
  exit 1
fi

echo -e "\n=== 6. 重新加载 Nginx ==="
sudo systemctl reload nginx

if [ $? -eq 0 ]; then
  echo "✅ Nginx 重新加载成功"
else
  echo "❌ Nginx 重新加载失败！"
  exit 1
fi

echo -e "\n=== 7. 再次测试重定向 ==="
echo "测试 app.autoark.work（查看响应头）:"
curl -I -H "Host: app.autoark.work" http://localhost/dashboard 2>&1 | grep -E "HTTP|Location|301|302|307|308"

echo -e "\n=== 8. 重要提示：检查 Cloudflare 设置 ==="
echo ""
echo "⚠️  如果重定向仍然存在，问题可能在 Cloudflare："
echo ""
echo "请在 Cloudflare 控制台检查："
echo "1. 页面规则 (Page Rules)"
echo "   - 检查是否有规则重定向 app.autoark.work 到 app.autoark.cloud"
echo "   - 路径：Rules > Page Rules"
echo ""
echo "2. 重定向规则 (Redirect Rules)"
echo "   - 检查是否有重定向规则"
echo "   - 路径：Rules > Redirect Rules"
echo ""
echo "3. SSL/TLS 设置"
echo "   - 检查是否启用了 'Always Use HTTPS'"
echo "   - 路径：SSL/TLS > Overview"
echo ""
echo "4. 如果需要禁用重定向："
echo "   - 删除或禁用相关的页面规则"
echo "   - 或者修改规则，只对特定路径生效"
echo ""

echo -e "\n=== 完成 ==="
echo "如果 Nginx 配置正确但仍有重定向，请在 Cloudflare 控制台检查页面规则"

