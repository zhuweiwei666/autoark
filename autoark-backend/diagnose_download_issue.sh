#!/bin/bash
# 在服务器上执行：诊断自动下载和重定向问题

cd /root/autoark/autoark-backend

echo "=== 1. 检查 Nginx 响应头 ==="
echo "测试 app.autoark.work 的完整响应头:"
curl -v -H "Host: app.autoark.work" http://localhost/dashboard 2>&1 | grep -E "< HTTP|Location|Content-Type|Content-Disposition|Content-Length" | head -n 20

echo -e "\n=== 2. 检查是否有下载相关的响应头 ==="
echo "查找 Content-Disposition:"
curl -I -H "Host: app.autoark.work" http://localhost/dashboard 2>&1 | grep -i "content-disposition\|content-type\|location"

echo -e "\n=== 3. 检查 Nginx 配置中的特殊设置 ==="
echo "查找 add_header 和 proxy_hide_header:"
sudo grep -r "add_header\|proxy_hide_header\|proxy_set_header.*Content" /etc/nginx/sites-available/autoark.conf /etc/nginx/sites-enabled/autoark.conf 2>/dev/null

echo -e "\n=== 4. 检查应用代码中的响应头设置 ==="
echo "查找 res.setHeader 和 res.header:"
grep -r "setHeader\|\.header\|Content-Type\|Content-Disposition" src/app.ts src/routes/dashboard.routes.ts 2>/dev/null | head -n 10

echo -e "\n=== 5. 测试直接访问（绕过 Nginx） ==="
echo "测试 http://139.162.24.176:3001/dashboard:"
curl -I http://139.162.24.176:3001/dashboard 2>&1 | grep -E "HTTP|Content-Type|Content-Disposition|Location"

echo -e "\n=== 6. 检查 Cloudflare 的 Transform Rules ==="
echo "注意：需要在 Cloudflare 控制台检查"
echo "路径：Rules > Transform Rules"
echo "检查是否有规则修改响应头"

echo -e "\n=== 7. 检查完整的响应（包括 body） ==="
echo "测试 app.autoark.work（查看前 500 字节）:"
curl -s -H "Host: app.autoark.work" http://localhost/dashboard | head -c 500
echo ""

echo -e "\n=== 8. 检查 Nginx 错误日志 ==="
echo "最近的错误:"
sudo tail -n 20 /var/log/nginx/error.log 2>/dev/null | grep -i "error\|warn" | tail -n 10

echo -e "\n=== 9. 检查 Nginx 访问日志 ==="
echo "最近的访问记录:"
sudo tail -n 20 /var/log/nginx/access.log 2>/dev/null | grep "app.autoark" | tail -n 10

echo -e "\n=== 10. 修复 Nginx 配置（确保正确的 Content-Type） ==="
sudo tee /etc/nginx/sites-available/autoark.conf > /dev/null << 'NGINX_CONFIG'
server {
    listen 80;
    server_name app.autoark.work app.autoark.cloud;

    # 所有请求代理到 Node.js 服务（3001 端口）
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
        
        # 确保不重定向
        proxy_redirect off;
        
        # 确保正确的 Content-Type（让后端决定）
        proxy_pass_header Content-Type;
        proxy_hide_header Content-Disposition;
        
        # 增加超时时间
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
NGINX_CONFIG

echo "✅ Nginx 配置已更新"

echo -e "\n=== 11. 检查配置并重新加载 ==="
sudo nginx -t && sudo systemctl reload nginx

if [ $? -eq 0 ]; then
  echo "✅ Nginx 重新加载成功"
else
  echo "❌ Nginx 重新加载失败！"
  exit 1
fi

echo -e "\n=== 12. 再次测试 ==="
echo "测试 app.autoark.work（完整响应头）:"
curl -v -H "Host: app.autoark.work" http://localhost/dashboard 2>&1 | head -n 40

echo -e "\n=== 重要提示 ==="
echo ""
echo "如果问题仍然存在，请检查 Cloudflare 控制台："
echo "1. Rules > Transform Rules - 检查是否有规则修改响应头"
echo "2. Rules > Page Rules - 检查是否有重定向规则"
echo "3. Rules > Redirect Rules - 检查是否有重定向规则"
echo "4. SSL/TLS > Overview - 检查 SSL 模式"
echo "5. 尝试暂时关闭 Cloudflare 代理（将 DNS 记录改为 '仅 DNS'）"
echo ""

