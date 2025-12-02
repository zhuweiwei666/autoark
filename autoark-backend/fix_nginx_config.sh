#!/bin/bash
# 在服务器上执行：修复 Nginx 配置

cd /root/autoark/autoark-backend

echo "=== 1. 备份现有 Nginx 配置 ==="
sudo cp /etc/nginx/sites-available/autoark.conf /etc/nginx/sites-available/autoark.conf.backup.$(date +%Y%m%d_%H%M%S)
echo "✅ 配置已备份"

echo -e "\n=== 2. 创建正确的 Nginx 配置 ==="
sudo tee /etc/nginx/sites-available/autoark.conf > /dev/null << 'NGINX_CONFIG'
server {
    listen 80;
    server_name app.autoark.cloud;

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

echo "✅ Nginx 配置已更新"

echo -e "\n=== 3. 检查配置语法 ==="
sudo nginx -t

if [ $? -ne 0 ]; then
  echo "❌ Nginx 配置语法错误！"
  echo "恢复备份..."
  sudo cp /etc/nginx/sites-available/autoark.conf.backup.* /etc/nginx/sites-available/autoark.conf
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

echo -e "\n=== 6. 测试路由（通过 Nginx） ==="
echo "等待 2 秒..."
sleep 2

echo -e "\n测试 http://app.autoark.cloud/dashboard:"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://app.autoark.cloud/dashboard)
echo "HTTP 状态码: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ 路由工作正常！"
  echo "响应内容预览:"
  curl -s http://app.autoark.cloud/dashboard | head -n 20
else
  echo "❌ 路由返回错误状态码: $HTTP_CODE"
  echo "响应内容:"
  curl -s http://app.autoark.cloud/dashboard | head -n 10
fi

echo -e "\n=== 7. 测试本地路由（直接访问 3001） ==="
echo "测试 http://localhost:3001/dashboard:"
HTTP_CODE_LOCAL=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/dashboard)
echo "HTTP 状态码: $HTTP_CODE_LOCAL"

if [ "$HTTP_CODE_LOCAL" = "200" ]; then
  echo "✅ 本地路由工作正常！"
else
  echo "❌ 本地路由返回错误状态码: $HTTP_CODE_LOCAL"
  echo "这可能是路由注册问题，需要进一步检查"
fi

echo -e "\n=== 完成 ==="
echo "如果两个测试都返回 200，说明问题已解决！"

