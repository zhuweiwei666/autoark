#!/bin/bash
# 在服务器上执行：全面扫描所有可能的问题

cd /root/autoark/autoark-backend

echo "=========================================="
echo "全面扫描 - 重定向和下载问题诊断"
echo "=========================================="

echo -e "\n【1. 检查 Nginx 配置】"
echo "----------------------------------------"
echo "1.1 所有 Nginx 配置文件:"
sudo find /etc/nginx -name "*.conf" -type f 2>/dev/null | grep -E "autoark|default" | head -n 10

echo -e "\n1.2 autoark.conf 完整内容:"
if [ -f "/etc/nginx/sites-available/autoark.conf" ]; then
  sudo cat /etc/nginx/sites-available/autoark.conf
elif [ -f "/etc/nginx/sites-enabled/autoark.conf" ]; then
  sudo cat /etc/nginx/sites-enabled/autoark.conf
else
  echo "未找到 autoark.conf"
fi

echo -e "\n1.3 所有启用的站点:"
ls -la /etc/nginx/sites-enabled/ 2>/dev/null

echo -e "\n1.4 查找所有 server_name:"
sudo grep -r "server_name" /etc/nginx/sites-available/ /etc/nginx/sites-enabled/ 2>/dev/null | grep -v "#"

echo -e "\n1.5 查找所有重定向规则:"
sudo grep -r "return\|rewrite\|redirect" /etc/nginx/sites-available/ /etc/nginx/sites-enabled/ 2>/dev/null | grep -v "#"

echo -e "\n【2. 检查应用代码】"
echo "----------------------------------------"
echo "2.1 检查 app.ts 中的重定向:"
grep -n "redirect\|Location\|301\|302" src/app.ts dist/app.js 2>/dev/null || echo "未找到重定向代码"

echo -e "\n2.2 检查所有路由文件:"
find src/routes -name "*.ts" -exec grep -l "redirect\|Location" {} \; 2>/dev/null || echo "未找到重定向"

echo -e "\n2.3 检查中间件:"
find src/middlewares -name "*.ts" -exec grep -l "redirect\|Location" {} \; 2>/dev/null || echo "未找到重定向"

echo -e "\n2.4 检查响应头设置:"
grep -r "setHeader\|\.header\|Content-Type\|Content-Disposition" src/ 2>/dev/null | head -n 10

echo -e "\n【3. 测试服务器响应】"
echo "----------------------------------------"
echo "3.1 测试直接访问（绕过 Nginx）:"
echo "http://139.162.24.176:3001/dashboard"
curl -v http://139.162.24.176:3001/dashboard 2>&1 | grep -E "< HTTP|Content-Type|Content-Disposition|Location" | head -n 10

echo -e "\n3.2 测试通过 Nginx（app.autoark.work）:"
echo "使用 Host 头模拟:"
curl -v -H "Host: app.autoark.work" http://localhost/dashboard 2>&1 | grep -E "< HTTP|Content-Type|Content-Disposition|Location" | head -n 10

echo -e "\n3.3 测试通过 Nginx（app.autoark.cloud）:"
curl -v -H "Host: app.autoark.cloud" http://localhost/dashboard 2>&1 | grep -E "< HTTP|Content-Type|Content-Disposition|Location" | head -n 10

echo -e "\n3.4 检查响应体（前 200 字节）:"
echo "app.autoark.work:"
curl -s -H "Host: app.autoark.work" http://localhost/dashboard | head -c 200
echo ""

echo -e "\n【4. 检查 Nginx 日志】"
echo "----------------------------------------"
echo "4.1 最近的访问日志（包含 app.autoark）:"
sudo tail -n 50 /var/log/nginx/access.log 2>/dev/null | grep -i "app.autoark" | tail -n 10 || echo "没有找到相关记录"

echo -e "\n4.2 查找重定向状态码（301/302）:"
sudo tail -n 100 /var/log/nginx/access.log 2>/dev/null | grep -E " 301 | 302 " | tail -n 10 || echo "没有找到重定向"

echo -e "\n4.3 最近的错误日志:"
sudo tail -n 30 /var/log/nginx/error.log 2>/dev/null | tail -n 10 || echo "无法读取错误日志"

echo -e "\n【5. 检查 PM2 进程】"
echo "----------------------------------------"
echo "5.1 PM2 进程状态:"
pm2 list

echo -e "\n5.2 PM2 进程详细信息:"
pm2 describe autoark | grep -E "script|pid|status|restarts"

echo -e "\n5.3 检查进程使用的文件:"
PM2_SCRIPT=$(pm2 describe autoark | grep "script path" | awk '{print $3}')
if [ -n "$PM2_SCRIPT" ]; then
  echo "脚本路径: $PM2_SCRIPT"
  echo "文件时间戳:"
  ls -lh "$PM2_SCRIPT" 2>/dev/null | awk '{print $6, $7, $8, $9}'
fi

echo -e "\n【6. 检查编译后的代码】"
echo "----------------------------------------"
echo "6.1 编译文件时间戳:"
ls -lh dist/app.js dist/routes/dashboard.routes.js dist/server.js 2>/dev/null | awk '{print $6, $7, $8, $9}'

echo -e "\n6.2 检查 dashboard.routes.js 的导出:"
node -e "
const routes = require('./dist/routes/dashboard.routes.js');
console.log('导出类型:', typeof routes.default);
if (routes.default && routes.default.stack) {
  console.log('路由数量:', routes.default.stack.length);
}
" 2>/dev/null || echo "无法加载路由模块"

echo -e "\n【7. 检查 DNS 和网络】"
echo "----------------------------------------"
echo "7.1 测试域名解析:"
echo "app.autoark.work:"
nslookup app.autoark.work 2>/dev/null | grep -A 2 "Name:" || dig app.autoark.work 2>/dev/null | grep -A 2 "IN A" || echo "无法解析"

echo -e "\napp.autoark.cloud:"
nslookup app.autoark.cloud 2>/dev/null | grep -A 2 "Name:" || dig app.autoark.cloud 2>/dev/null | grep -A 2 "IN A" || echo "无法解析"

echo -e "\n7.2 检查端口监听:"
ss -tlnp | grep ":80\|:3001" || netstat -tlnp 2>/dev/null | grep ":80\|:3001" || echo "无法检查端口"

echo -e "\n【8. 检查 Cloudflare 相关】"
echo "----------------------------------------"
echo "8.1 检查是否有 Cloudflare IP 检测:"
curl -s -H "Host: app.autoark.work" http://localhost/dashboard 2>&1 | head -c 100

echo -e "\n8.2 重要提示："
echo "请在 Cloudflare 控制台检查以下内容："
echo "  - Rules > Page Rules"
echo "  - Rules > Redirect Rules"
echo "  - Rules > Transform Rules"
echo "  - SSL/TLS > Overview"
echo "  - 查找包含 'autoark.cloud' 或重定向相关的规则"

echo -e "\n【9. 创建修复后的 Nginx 配置】"
echo "----------------------------------------"
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
        
        # 禁止重定向
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

echo -e "\n【10. 重新加载并测试】"
echo "----------------------------------------"
sudo nginx -t && sudo systemctl reload nginx

if [ $? -eq 0 ]; then
  echo "✅ Nginx 重新加载成功"
  echo -e "\n等待 2 秒后测试..."
  sleep 2
  
  echo -e "\n测试 app.autoark.work:"
  curl -v -H "Host: app.autoark.work" http://localhost/dashboard 2>&1 | head -n 30
else
  echo "❌ Nginx 重新加载失败！"
fi

echo -e "\n=========================================="
echo "扫描完成"
echo "=========================================="

