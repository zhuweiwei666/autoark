#!/bin/bash
# 在服务器上执行：修复 Nginx 配置冲突

cd /root/autoark/autoark-backend

echo "=== 1. 检查所有 Nginx 配置文件 ==="
echo "1.1 autoark-webhook.conf 内容:"
sudo cat /etc/nginx/sites-enabled/autoark-webhook.conf

echo -e "\n1.2 autoark.conf 内容:"
sudo cat /etc/nginx/sites-available/autoark.conf

echo -e "\n=== 2. 修复配置冲突 ==="
echo "问题：autoark-webhook.conf 也配置了 app.autoark.work，导致冲突"
echo "解决方案：修改 webhook 配置，只处理 /webhook 路径"

# 修复 webhook 配置
sudo tee /etc/nginx/sites-enabled/autoark-webhook.conf > /dev/null << 'WEBHOOK_CONFIG'
server {
    listen 80;
    server_name _;  # 使用默认 server，不指定具体域名

    # 只处理 /webhook 路径
    location /webhook {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 其他路径返回 404
    location / {
        return 404;
    }
}
WEBHOOK_CONFIG

echo "✅ webhook 配置已修复"

echo -e "\n=== 3. 确保 autoark.conf 正确 ==="
sudo tee /etc/nginx/sites-available/autoark.conf > /dev/null << 'MAIN_CONFIG'
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
MAIN_CONFIG

echo "✅ 主配置已更新"

echo -e "\n=== 4. 检查配置语法 ==="
sudo nginx -t

if [ $? -ne 0 ]; then
  echo "❌ Nginx 配置语法错误！"
  exit 1
fi

echo -e "\n=== 5. 重新加载 Nginx ==="
sudo systemctl reload nginx

if [ $? -eq 0 ]; then
  echo "✅ Nginx 重新加载成功"
else
  echo "❌ Nginx 重新加载失败！"
  exit 1
fi

echo -e "\n=== 6. 验证配置（检查是否还有冲突） ==="
sudo nginx -t 2>&1 | grep -i "conflicting\|warn" || echo "✅ 没有配置冲突"

echo -e "\n=== 7. 测试路由 ==="
echo "等待 2 秒..."
sleep 2

echo -e "\n测试 app.autoark.work（完整响应）:"
curl -v -H "Host: app.autoark.work" http://localhost/dashboard 2>&1 | head -n 40

echo -e "\n测试响应内容:"
RESPONSE=$(curl -s -H "Host: app.autoark.work" http://localhost/dashboard)
echo "响应长度: ${#RESPONSE} 字节"
echo "响应开头（前 200 字符）:"
echo "$RESPONSE" | head -c 200
echo ""

if echo "$RESPONSE" | grep -q "AutoArk Dashboard"; then
  echo "✅ 响应包含 'AutoArk Dashboard'，路由工作正常！"
else
  echo "❌ 响应不包含 'AutoArk Dashboard'"
  echo "完整响应:"
  echo "$RESPONSE" | head -c 500
fi

echo -e "\n=== 8. 检查 Content-Type ==="
CONTENT_TYPE=$(curl -I -H "Host: app.autoark.work" http://localhost/dashboard 2>&1 | grep -i "Content-Type" | head -1)
echo "Content-Type: $CONTENT_TYPE"

if echo "$CONTENT_TYPE" | grep -q "text/html"; then
  echo "✅ Content-Type 正确"
else
  echo "❌ Content-Type 不正确，应该是 text/html"
fi

echo -e "\n=== 完成 ==="

