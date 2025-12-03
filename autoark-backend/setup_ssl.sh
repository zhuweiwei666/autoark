#!/bin/bash
# 配置 Cloudflare Origin Certificate SSL 证书

echo "=========================================="
echo "配置 Cloudflare Origin Certificate SSL"
echo "=========================================="

# 创建 SSL 证书目录
SSL_DIR="/etc/nginx/ssl/autoark"
sudo mkdir -p "$SSL_DIR"
echo "✅ SSL 目录已创建: $SSL_DIR"

# 创建证书文件
echo -e "\n=== 1. 创建证书文件 ==="
sudo tee "$SSL_DIR/origin.crt" > /dev/null << 'CERT_END'
-----BEGIN CERTIFICATE-----
MIIEpDCCA4ygAwIBAgIUf6MKwVRoN3kRIlZ4mf58MK6s98MwDQYJKoZIhvcNAQEL
BQAwgYsxCzAJBgNVBAYTAlVTMRkwFwYDVQQKExBDbG91ZEZsYXJlLCBJbmMuMTQw
MgYDVQQLEytDbG91ZEZsYXJlIE9yaWdpbiBTU0wgQ2VydGlmaWNhdGUgQXV0aG9y
aXR5MRYwFAYDVQQHEw1TYW4gRnJhbmNpc2NvMRMwEQYDVQQIEwpDYWxpZm9ybmlh
MB4XDTI1MTIwMzA0MDIwMFoXDTQwMTEyOTA0MDIwMFowYjEZMBcGA1UEChMQQ2xv
dWRGbGFyZSwgSW5jLjEdMBsGA1UECxMUQ2xvdWRGbGFyZSBPcmlnaW4gQ0ExJjAk
BgNVBAMTHUNsb3VkRmxhcmUgT3JpZ2luIENlcnRpZmljYXRlMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsjlKzaFvyL74enEZXS73DXTRSEE8b+qpJdah
3SpcHdSzau+tlvNLuX3/8BtVQMsSv/lauoYCICaCkrgOh30OJtxtkAJT3mCHubj3
Y2/S+ZaXq39ebFZRzK9oM6dsO+DrGIljrexyKv1Era4uD56tjx5qw1mroD4MnQLe
du2yC+kxHuv24f+dkZIfBD6RQGorMe0IOyyuVPm3OCESd2W5j2K5yTg8GrQ+5n8a
gIGxktUFhl91zsyp4IIBidsB8mSyeVGqDSdBQrIg0PYo8vjI7Wn7lXFCKmAI6jsY
0o5b7YNenjLIYkBMGUymXPbcaSBl09TXzpBSHFuCzWymtjdQ9QIDAQABo4IBJjCC
ASIwDgYDVR0PAQH/BAQDAgWgMB0GA1UdJQQWMBQGCCsGAQUFBwMCBggrBgEFBQcD
ATAMBgNVHRMBAf8EAjAAMB0GA1UdDgQWBBSr1+Yfwgw93+8njVExdMeHrTTPKjAf
BgNVHSMEGDAWgBQk6FNXXXw0QIep65TbuuEWePwppDBABggrBgEFBQcBAQQ0MDIw
MAYIKwYBBQUHMAGGJGh0dHA6Ly9vY3NwLmNsb3VkZmxhcmUuY29tL29yaWdpbl9j
YTAnBgNVHREEIDAegg4qLmF1dG9hcmsud29ya4IMYXV0b2Fyay53b3JrMDgGA1Ud
HwQxMC8wLaAroCmGJ2h0dHA6Ly9jcmwuY2xvdWRmbGFyZS5jb20vb3JpZ2luX2Nh
LmNybDANBgkqhkiG9w0BAQsFAAOCAQEAvV7ZBDBLKML+u6wH2TYmN6h66J5k5Kbv
mwC+DStm/mM9PhAT2HgWcde+5JkPz2DFNyK4XqCxvba4FwulhcOpE29RDMu0Ch6B
jRCbrHxesLdpiRZyDEWPj9YXX+vJScSMyJNz56ZFP1QKWdIccwLzlofusj7z0NMB
ydeiJsvgshx84XGfX7Mj/TmoQSdFUhr3cCRCVV6gJQ+NDQ1WMrSkkQqVJU8BJ5mo
/afwqZAu9Nxu5kPQMI6wxfHsLG61AED5B0tS8pF8+Q+SRR1LpyXvIrsg7i2QE2n4
AFBPYkQIAqVUfXtqXl4035Ru+fVpwcRo2PgwTHIKgz5kyGXukiDVUw==
-----END CERTIFICATE-----
CERT_END

echo "✅ 证书文件已创建"

# 创建私钥文件
echo -e "\n=== 2. 创建私钥文件 ==="
sudo tee "$SSL_DIR/origin.key" > /dev/null << 'KEY_END'
-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCyOUrNoW/Ivvh6
cRldLvcNdNFIQTxv6qkl1qHdKlwd1LNq762W80u5ff/wG1VAyxK/+Vq6hgIgJoKS
uA6HfQ4m3G2QAlPeYIe5uPdjb9L5lperf15sVlHMr2gzp2w74OsYiWOt7HIq/USt
ri4Pnq2PHmrDWaugPgydAt527bIL6TEe6/bh/52Rkh8EPpFAaisx7Qg7LK5U+bc4
IRJ3ZbmPYrnJODwatD7mfxqAgbGS1QWGX3XOzKngggGJ2wHyZLJ5UaoNJ0FCsiDQ
9ijy+MjtafuVcUIqYAjqOxjSjlvtg16eMshiQEwZTKZc9txpIGXT1NfOkFIcW4LN
bKa2N1D1AgMBAAECggEANxwCJm2Z7EApA2t/hVHlcNLDeA08C/tKzHl+2a2kiFDi
Hdn5Gmkm7Deq8WryRLPGm3gWdwDDHX/q9kVVsM2Zl6indFVT67p7nZE1ZhkI6saH
Ja+f2e4jIyDGHtrRW/6jk5XALeKkNujT2MS4V3ogftXP+5H5wPYO3mopsiqz2HyB
WI+R+4yvi1zz+XAe0ppT/6JEjV/x7CFIMCQjGW+zDAQtYIDUusdiRKiuJYGeqoHQ
1GDqhvmTTImYRq0Vy/S8pgx+S9V6VpfasLvgeMReF2XBqxMwkJv9GRDmwj0Esvln
wO/6XzVvuogsyX3ulmi/RbBQKBNLJUh8CHSZPgFjbQKBgQDqd5uK58/VA1Dp5hfq
u4D7r70JUy/PtZMDCz6jmvEsBLWqCVBHDi+gKNr3vcF2HiX1+dM13i1ps4F9Y/tV
/cEm/12v/yeWp2Ux/u81bAj7IPDtrA2f6f2ZzrInwUOXOMixAoO76RfuR4Hht/MV
caiiEqT+//1/RrtSjFy+xLpU9wKBgQDCl2KugwPFK2XwWn7shR+s0xiVy3HEouxQ
ozkGz8mNOr8iQq0jBh/f1gxLTyCkZ+5ybAweSbs0BZOzgROfqd9NVthewf24BYaY
4svNgeX6PkT4H17DHIntYeyDoSE+6fyspMuYM0bGI9rR9qzwiUtnJuwwRTAo+BEh
+uSBEXqKcwKBgQDO9Ionnpu1Irst6bocqCqefa026OVfyp6b5jYBBQdxWirbjmL8
hQoGrWkxmZ2E2/GX307N0nF1Rku62SCE83mlKWyRp39THChXa/XKyrRWrenbb62L
BGejdm2MZ6t4dFe43kZW+9Tyrs125f47ZFp7zEc1CdHAoTdBEsHeZRkvWwKBgQCX
dH6xN3X6w9F+5uC9NMw3lsIe7Q8qrmhiRvh+zcGhM+VKRD0/8mdir9Y302mjrOUR
l/lCpb6YOfMBFujwL6aHKp4T+seAsIRXgMaBuKYIROknejsmf5L2+W298e7Pag1p
TobMerSOSZ/qJiXqveG7crcIxwE6EgI7wWyS7MjE8wKBgEwYGvYX8R60k8uTcjN+
Yx/JT482vnr2L3E1IzHya5Goz/8blSCcKpf45SB374isPef9UDG/awAj13LSf5hJ
M/xQoAGVKLYvloIDB3dep57l/xn51RIW1Yxr6ClveFw+JYjgNhXJW18D0nnE8SkP
1UBVU91c7tg+YmOJB8sBC/Y8
-----END PRIVATE KEY-----
KEY_END

echo "✅ 私钥文件已创建"

# 设置正确的权限
echo -e "\n=== 3. 设置文件权限 ==="
sudo chmod 600 "$SSL_DIR/origin.key"
sudo chmod 644 "$SSL_DIR/origin.crt"
echo "✅ 文件权限已设置"

# 备份现有配置
echo -e "\n=== 4. 备份现有 Nginx 配置 ==="
sudo cp /etc/nginx/sites-available/autoark.conf /etc/nginx/sites-available/autoark.conf.backup.$(date +%Y%m%d_%H%M%S)
echo "✅ 配置已备份"

# 更新 Nginx 配置以支持 HTTPS
echo -e "\n=== 5. 更新 Nginx 配置（支持 HTTPS） ==="
sudo tee /etc/nginx/sites-available/autoark.conf > /dev/null << 'NGINX_CONFIG'
# HTTP 服务器 - 重定向到 HTTPS
server {
    listen 80;
    server_name app.autoark.work app.autoark.cloud;

    # 重定向所有 HTTP 请求到 HTTPS
    return 301 https://$server_name$request_uri;
}

# HTTPS 服务器
server {
    listen 443 ssl http2;
    server_name app.autoark.work app.autoark.cloud;

    # SSL 证书配置
    ssl_certificate /etc/nginx/ssl/autoark/origin.crt;
    ssl_certificate_key /etc/nginx/ssl/autoark/origin.key;

    # SSL 配置优化
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # 安全头
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

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

# 检查配置语法
echo -e "\n=== 6. 检查 Nginx 配置语法 ==="
sudo nginx -t

if [ $? -ne 0 ]; then
  echo "❌ Nginx 配置语法错误！"
  echo "恢复备份..."
  sudo cp /etc/nginx/sites-available/autoark.conf.backup.* /etc/nginx/sites-available/autoark.conf 2>/dev/null || true
  exit 1
fi

# 重新加载 Nginx
echo -e "\n=== 7. 重新加载 Nginx ==="
sudo systemctl reload nginx

if [ $? -eq 0 ]; then
  echo "✅ Nginx 重新加载成功"
else
  echo "❌ Nginx 重新加载失败！"
  exit 1
fi

# 检查 Nginx 状态
echo -e "\n=== 8. 检查 Nginx 状态 ==="
sudo systemctl status nginx --no-pager | head -n 10

# 测试 HTTPS
echo -e "\n=== 9. 测试 HTTPS 连接 ==="
echo "测试 https://app.autoark.work:"
curl -k -I https://localhost 2>&1 | head -n 5 || echo "注意：需要从外部访问才能看到完整效果"

echo -e "\n=========================================="
echo "✅ SSL 配置完成！"
echo "=========================================="
echo ""
echo "重要提示："
echo "1. 确保 Cloudflare SSL/TLS 模式设置为 'Full' 或 'Full (strict)'"
echo "2. 证书文件位置: $SSL_DIR/origin.crt"
echo "3. 私钥文件位置: $SSL_DIR/origin.key"
echo "4. HTTP 请求会自动重定向到 HTTPS"
echo ""
echo "测试命令:"
echo "  curl -I https://app.autoark.work"
echo ""

