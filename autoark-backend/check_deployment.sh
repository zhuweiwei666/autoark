#!/bin/bash
# 在服务器上执行：检查部署状态

cd /root/autoark/autoark-backend

echo "=== 1. 检查域名解析 ==="
echo "检查 app.autoark.cloud 解析:"
nslookup app.autoark.cloud 2>/dev/null || dig app.autoark.cloud 2>/dev/null || echo "无法解析域名"

echo -e "\n=== 2. 检查服务器 IP ==="
echo "服务器 IP:"
hostname -I | awk '{print $1}'
curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo "无法获取公网 IP"

echo -e "\n=== 3. 检查端口监听 ==="
echo "检查 3001 端口:"
ss -tlnp | grep 3001 || netstat -tlnp | grep 3001 || echo "端口未监听"

echo -e "\n=== 4. 检查防火墙 ==="
echo "检查防火墙状态:"
if command -v ufw &> /dev/null; then
  ufw status | grep 3001 || echo "3001 端口未在防火墙规则中"
elif command -v firewall-cmd &> /dev/null; then
  firewall-cmd --list-ports | grep 3001 || echo "3001 端口未在防火墙规则中"
else
  echo "未找到防火墙管理工具"
fi

echo -e "\n=== 5. 检查 PM2 进程 ==="
pm2 status autoark

echo -e "\n=== 6. 检查编译文件时间戳 ==="
echo "当前编译文件时间:"
ls -lh dist/app.js dist/routes/dashboard.routes.js 2>/dev/null | awk '{print $6, $7, $8, $9}' || echo "编译文件不存在"

echo -e "\n=== 7. 检查源代码时间戳 ==="
echo "源代码最后修改时间:"
ls -lh src/app.ts src/routes/dashboard.routes.ts 2>/dev/null | awk '{print $6, $7, $8, $9}' || echo "源代码文件不存在"

echo -e "\n=== 8. 测试本地路由 ==="
echo "测试 http://localhost:3001/dashboard:"
curl -s -w "\nHTTP: %{http_code}\n" http://localhost:3001/dashboard | head -n 5

echo -e "\n=== 9. 检查 Nginx 配置（如果使用） ==="
if [ -f "/etc/nginx/sites-available/default" ] || [ -f "/etc/nginx/conf.d/default.conf" ]; then
  echo "找到 Nginx 配置文件"
  grep -r "app.autoark.cloud\|3001" /etc/nginx/ 2>/dev/null | head -n 5 || echo "未找到相关配置"
else
  echo "未找到 Nginx 配置文件"
fi

echo -e "\n=== 10. 检查反向代理配置 ==="
if [ -f "/etc/nginx/sites-available/autoark" ] || [ -f "/etc/nginx/conf.d/autoark.conf" ]; then
  echo "找到 AutoArk Nginx 配置:"
  cat /etc/nginx/sites-available/autoark 2>/dev/null || cat /etc/nginx/conf.d/autoark.conf 2>/dev/null
else
  echo "未找到 AutoArk 专用 Nginx 配置"
fi

