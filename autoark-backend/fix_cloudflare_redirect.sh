#!/bin/bash
# 在服务器上执行：修复 Cloudflare 重定向问题

cd /root/autoark/autoark-backend

echo "=== 诊断和修复 Cloudflare 重定向问题 ==="
echo ""
echo "根据你的描述，问题很可能是 Cloudflare 的页面规则或重定向规则导致的。"
echo ""

echo "=== 1. 检查服务器端配置 ==="
echo "测试本地 Nginx 响应:"
curl -I -H "Host: app.autoark.work" http://localhost/dashboard 2>&1 | grep -E "HTTP|Location|Content-Type|Content-Disposition"

echo -e "\n=== 2. 检查是否有重定向 ==="
echo "测试完整响应:"
curl -v -H "Host: app.autoark.work" http://localhost/dashboard 2>&1 | grep -E "< HTTP|Location:|301|302|307|308" | head -n 5

echo -e "\n=== 3. 修复 Nginx 配置（确保没有重定向） ==="
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
        
        # 确保正确的 Content-Type
        proxy_pass_header Content-Type;
        
        # 增加超时时间
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
NGINX_CONFIG

echo "✅ Nginx 配置已更新"

echo -e "\n=== 4. 重新加载 Nginx ==="
sudo nginx -t && sudo systemctl reload nginx

echo -e "\n=== 5. 重要：Cloudflare 设置检查清单 ==="
echo ""
echo "请在 Cloudflare 控制台执行以下操作："
echo ""
echo "【步骤 1】检查页面规则 (Page Rules)"
echo "  路径：Rules > Page Rules"
echo "  操作："
echo "    - 查找包含 'app.autoark.work' 或 'autoark.cloud' 的规则"
echo "    - 删除或禁用这些规则"
echo ""
echo "【步骤 2】检查重定向规则 (Redirect Rules)"
echo "  路径：Rules > Redirect Rules"
echo "  操作："
echo "    - 查找从 'app.autoark.work' 到 'app.autoark.cloud' 的重定向规则"
echo "    - 删除这些规则"
echo ""
echo "【步骤 3】检查 Transform Rules"
echo "  路径：Rules > Transform Rules"
echo "  操作："
echo "    - 检查是否有规则修改响应头或 URL"
echo "    - 如果有，删除或禁用"
echo ""
echo "【步骤 4】临时测试：关闭 Cloudflare 代理"
echo "  路径：DNS > Records"
echo "  操作："
echo "    - 找到 'app' 的 A 记录"
echo "    - 点击云朵图标，将其改为灰色（仅 DNS，不通过代理）"
echo "    - 等待几分钟让 DNS 生效"
echo "    - 测试访问 http://app.autoark.work/dashboard"
echo "    - 如果这样可以工作，说明问题在 Cloudflare 规则"
echo ""
echo "【步骤 5】检查 SSL/TLS 设置"
echo "  路径：SSL/TLS > Overview"
echo "  操作："
echo "    - 确保 SSL 模式不是 'Flexible'（如果后端是 HTTP）"
echo "    - 如果后端是 HTTP，使用 'Flexible' 模式"
echo "    - 如果后端是 HTTPS，使用 'Full' 或 'Full (strict)' 模式"
echo ""

echo "=== 6. 测试修复后的配置 ==="
echo "等待 2 秒..."
sleep 2

echo -e "\n测试 app.autoark.work（本地）:"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: app.autoark.work" http://localhost/dashboard)
echo "HTTP 状态码: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ 本地测试成功"
  echo "响应内容预览:"
  curl -s -H "Host: app.autoark.work" http://localhost/dashboard | head -n 10
else
  echo "❌ 本地测试失败，状态码: $HTTP_CODE"
fi

echo -e "\n=== 完成 ==="
echo "如果本地测试成功但通过域名访问仍有问题，"
echo "请按照上面的清单在 Cloudflare 控制台检查并删除相关规则。"

