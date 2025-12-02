#!/bin/bash
# 在服务器上执行：检查域名配置问题

cd /root/autoark/autoark-backend

echo "=== 1. 检查 Nginx 配置的所有 server_name ==="
echo "查找所有 server_name 配置:"
sudo grep -r "server_name" /etc/nginx/sites-available/ /etc/nginx/sites-enabled/ 2>/dev/null | grep -v "#" | sort -u

echo -e "\n=== 2. 检查 app.autoark.cloud 的 Nginx 配置 ==="
if [ -f "/etc/nginx/sites-available/autoark.conf" ]; then
  echo "autoark.conf 内容:"
  sudo cat /etc/nginx/sites-available/autoark.conf
elif [ -f "/etc/nginx/sites-enabled/autoark.conf" ]; then
  echo "autoark.conf 内容 (from sites-enabled):"
  sudo cat /etc/nginx/sites-enabled/autoark.conf
else
  echo "未找到 autoark.conf"
  echo "查找包含 autoark 的配置文件:"
  sudo find /etc/nginx -name "*autoark*" -type f 2>/dev/null
fi

echo -e "\n=== 3. 检查所有启用的 Nginx 站点 ==="
echo "sites-enabled 目录:"
ls -la /etc/nginx/sites-enabled/ 2>/dev/null || echo "sites-enabled 目录不存在"

echo -e "\n=== 4. 测试域名解析 ==="
echo "测试 app.autoark.cloud 解析:"
nslookup app.autoark.cloud 2>/dev/null || dig app.autoark.cloud 2>/dev/null || echo "无法解析"

echo -e "\n测试 app.autoark.work 解析:"
nslookup app.autoark.work 2>/dev/null || dig app.autoark.work 2>/dev/null || echo "无法解析"

echo -e "\n=== 5. 检查 Nginx 错误日志 ==="
echo "最近的错误日志:"
sudo tail -n 20 /var/log/nginx/error.log 2>/dev/null || echo "无法读取错误日志"

echo -e "\n=== 6. 检查 Nginx 访问日志 ==="
echo "查找 app.autoark 相关的访问:"
sudo tail -n 20 /var/log/nginx/access.log 2>/dev/null | grep -i "app.autoark" || echo "没有找到相关访问记录"

echo -e "\n=== 7. 测试本地 Nginx 配置 ==="
echo "测试 Nginx 配置语法:"
sudo nginx -t

echo -e "\n=== 8. 检查 Nginx 是否在监听 80 端口 ==="
ss -tlnp | grep ":80 " || netstat -tlnp 2>/dev/null | grep ":80 " || echo "80 端口未监听"

echo -e "\n=== 9. 测试通过 Nginx 访问（使用 Host 头） ==="
echo "测试 app.autoark.cloud:"
curl -v -H "Host: app.autoark.cloud" http://localhost/dashboard 2>&1 | head -n 30

echo -e "\n测试 app.autoark.work:"
curl -v -H "Host: app.autoark.work" http://localhost/dashboard 2>&1 | head -n 30

echo -e "\n=== 10. 检查是否有多个 server 块冲突 ==="
echo "查找所有 server 块:"
sudo grep -A 5 "server {" /etc/nginx/sites-enabled/* 2>/dev/null | grep -E "server_name|listen" | head -n 20

