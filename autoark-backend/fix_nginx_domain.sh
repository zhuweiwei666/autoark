#!/bin/bash
# 在服务器上执行：修复 Nginx 域名配置

cd /root/autoark/autoark-backend

echo "=== 1. 备份现有配置 ==="
sudo cp /etc/nginx/sites-available/autoark.conf /etc/nginx/sites-available/autoark.conf.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
echo "✅ 配置已备份"

echo -e "\n=== 2. 创建正确的 Nginx 配置（支持 app.autoark.work） ==="
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
        
        # 增加超时时间
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
NGINX_CONFIG

echo "✅ Nginx 配置已更新（支持 app.autoark.work 和 app.autoark.cloud）"

echo -e "\n=== 3. 检查配置语法 ==="
sudo nginx -t

if [ $? -ne 0 ]; then
  echo "❌ Nginx 配置语法错误！"
  echo "恢复备份..."
  sudo cp /etc/nginx/sites-available/autoark.conf.backup.* /etc/nginx/sites-available/autoark.conf 2>/dev/null || true
  exit 1
fi

echo -e "\n=== 4. 重新加载 Nginx ==="
sudo systemctl reload nginx

if [ $? -eq 0 ]; then
  echo "✅ Nginx 重新加载成功"
else
  echo "❌ Nginx 重新加载失败！"
  exit 1
fi

echo -e "\n=== 5. 检查 Nginx 状态 ==="
sudo systemctl status nginx --no-pager | head -n 10

echo -e "\n=== 6. 测试域名解析 ==="
echo "测试 app.autoark.work 解析:"
nslookup app.autoark.work 2>/dev/null || dig app.autoark.work 2>/dev/null || echo "无法解析"

echo -e "\n测试 app.autoark.cloud 解析:"
nslookup app.autoark.cloud 2>/dev/null || dig app.autoark.cloud 2>/dev/null || echo "无法解析（这是正常的，如果 DNS 没有配置）"

echo -e "\n=== 7. 测试通过 Nginx 访问（使用 Host 头） ==="
echo "等待 2 秒..."
sleep 2

echo -e "\n测试 app.autoark.work:"
HTTP_CODE_WORK=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: app.autoark.work" http://localhost/dashboard)
echo "HTTP 状态码: $HTTP_CODE_WORK"

if [ "$HTTP_CODE_WORK" = "200" ]; then
  echo "✅ app.autoark.work 路由工作正常！"
  echo "响应内容预览:"
  curl -s -H "Host: app.autoark.work" http://localhost/dashboard | head -n 20
else
  echo "❌ app.autoark.work 返回错误状态码: $HTTP_CODE_WORK"
fi

echo -e "\n测试 app.autoark.cloud:"
HTTP_CODE_CLOUD=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: app.autoark.cloud" http://localhost/dashboard)
echo "HTTP 状态码: $HTTP_CODE_CLOUD"

if [ "$HTTP_CODE_CLOUD" = "200" ]; then
  echo "✅ app.autoark.cloud 路由工作正常！"
else
  echo "⚠️  app.autoark.cloud 返回错误状态码: $HTTP_CODE_CLOUD（如果 DNS 未配置，这是正常的）"
fi

echo -e "\n=== 8. 检查 DNS 配置建议 ==="
echo "根据 Cloudflare DNS 配置，你应该："
echo "1. 确保 app.autoark.work 的 A 记录指向 139.162.24.176"
echo "2. 如果需要使用 app.autoark.cloud，需要在 Cloudflare 添加相应的 DNS 记录"
echo "3. 或者修改浏览器访问地址为: http://app.autoark.work/dashboard"

echo -e "\n=== 完成 ==="
if [ "$HTTP_CODE_WORK" = "200" ]; then
  echo "✅ Nginx 配置已修复！现在可以通过 http://app.autoark.work/dashboard 访问"
else
  echo "⚠️  请检查 DNS 配置和 Nginx 日志"
fi

