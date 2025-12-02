#!/bin/bash
# 在服务器上执行：检查重定向问题

cd /root/autoark/autoark-backend

echo "=== 1. 检查 Nginx 配置中的重定向 ==="
echo "查找所有 return 和 rewrite 指令:"
sudo grep -r "return\|rewrite" /etc/nginx/sites-available/ /etc/nginx/sites-enabled/ 2>/dev/null | grep -v "#" | grep -i "autoark\|cloud"

echo -e "\n=== 2. 检查完整的 Nginx 配置 ==="
if [ -f "/etc/nginx/sites-available/autoark.conf" ]; then
  echo "autoark.conf 完整内容:"
  sudo cat /etc/nginx/sites-available/autoark.conf
fi

echo -e "\n=== 3. 检查应用代码中的重定向 ==="
echo "查找 app.ts 中的重定向:"
grep -i "redirect\|res.redirect" src/app.ts dist/app.js 2>/dev/null || echo "未找到重定向代码"

echo -e "\n=== 4. 测试重定向（使用 curl 跟随重定向） ==="
echo "测试 app.autoark.work（不跟随重定向）:"
curl -v -L -H "Host: app.autoark.work" http://localhost/dashboard 2>&1 | grep -E "< HTTP|Location:|301|302|307|308" | head -n 10

echo -e "\n测试 app.autoark.work（跟随重定向）:"
curl -L -H "Host: app.autoark.work" http://localhost/dashboard 2>&1 | head -n 20

echo -e "\n=== 5. 检查 Cloudflare 页面规则（如果使用） ==="
echo "注意：Cloudflare 页面规则需要在 Cloudflare 控制台检查"
echo "可能的规则："
echo "  - 重定向 app.autoark.work 到 app.autoark.cloud"
echo "  - 自动 HTTPS 重定向"

echo -e "\n=== 6. 检查 Nginx 访问日志中的重定向 ==="
echo "查找 301/302 状态码:"
sudo tail -n 50 /var/log/nginx/access.log 2>/dev/null | grep -E "301|302" | tail -n 10 || echo "没有找到重定向记录"

echo -e "\n=== 7. 测试直接访问（绕过 Nginx） ==="
echo "测试 http://139.162.24.176:3001/dashboard:"
HTTP_CODE_DIRECT=$(curl -s -o /dev/null -w "%{http_code}" http://139.162.24.176:3001/dashboard)
echo "HTTP 状态码: $HTTP_CODE_DIRECT"

if [ "$HTTP_CODE_DIRECT" = "200" ]; then
  echo "✅ 直接访问工作正常"
else
  echo "❌ 直接访问失败"
fi

echo -e "\n=== 8. 检查是否有多个 Nginx server 块 ==="
echo "所有 server 块:"
sudo grep -A 10 "server {" /etc/nginx/sites-enabled/* 2>/dev/null | grep -E "server_name|listen|return|rewrite" | head -n 30

