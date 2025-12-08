# 🚀 AutoArk 服务器部署指南（包含三级权限系统）

## 📋 服务器要求

### 最低配置
- **CPU**: 2核
- **内存**: 4GB
- **硬盘**: 20GB SSD
- **操作系统**: Ubuntu 20.04+ / CentOS 7+
- **网络**: 公网 IP 或域名

### 推荐配置
- **CPU**: 4核
- **内存**: 8GB
- **硬盘**: 40GB SSD
- **操作系统**: Ubuntu 22.04 LTS

---

## 🛠️ 环境准备

### 1. 安装 Node.js (v18+)

```bash
# 使用 nvm 安装（推荐）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18

# 验证安装
node -v  # 应显示 v18.x.x
npm -v   # 应显示 9.x.x
```

### 2. 安装 MongoDB

```bash
# Ubuntu 22.04
wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org

# 启动 MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod

# 验证安装
mongosh --version
```

### 3. 安装 Redis

```bash
# Ubuntu
sudo apt-get update
sudo apt-get install -y redis-server

# 启动 Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# 验证安装
redis-cli ping  # 应返回 PONG
```

### 4. 安装 PM2

```bash
npm install -g pm2

# 设置开机自启
pm2 startup
pm2 save
```

### 5. 安装 Nginx

```bash
sudo apt-get update
sudo apt-get install -y nginx

# 启动 Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

### 6. 安装 Git

```bash
sudo apt-get install -y git
git --version
```

---

## 📦 部署步骤

### 步骤 1: 克隆项目

```bash
# 切换到部署目录
cd /root

# 克隆项目
git clone https://github.com/your-username/autoark.git
cd autoark
```

### 步骤 2: 配置环境变量

```bash
cd /root/autoark/autoark-backend

# 复制环境变量模板
cp .env.example .env

# 编辑环境变量
nano .env
```

**必须配置的环境变量：**

```bash
# MongoDB 配置
MONGO_URI=mongodb://localhost:27017/autoark

# JWT 配置（务必修改为随机字符串）
JWT_SECRET=生成的随机密钥（见下方命令）
JWT_EXPIRES_IN=7d

# 超级管理员配置
SUPER_ADMIN_USERNAME=admin
SUPER_ADMIN_PASSWORD=请设置强密码
SUPER_ADMIN_EMAIL=admin@yourdomain.com

# Redis 配置
REDIS_HOST=localhost
REDIS_PORT=6379

# 服务器配置
PORT=3000
NODE_ENV=production
```

**生成安全的 JWT_SECRET：**

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 步骤 3: 运行部署脚本

```bash
cd /root/autoark

# 给脚本执行权限
chmod +x deploy-with-auth.sh

# 运行部署脚本
./deploy-with-auth.sh
```

部署脚本会自动：
- ✅ 创建备份
- ✅ 拉取最新代码
- ✅ 安装依赖
- ✅ 编译前后端
- ✅ 初始化超级管理员
- ✅ 重启服务
- ✅ 验证部署

### 步骤 4: 配置 Nginx

创建 Nginx 配置文件：

```bash
sudo nano /etc/nginx/sites-available/autoark
```

添加以下配置：

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 修改为你的域名

    # 日志配置
    access_log /var/log/nginx/autoark_access.log;
    error_log /var/log/nginx/autoark_error.log;

    # 静态文件（前端）
    root /root/autoark/autoark-frontend/dist;
    index index.html;

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml+rss;

    # 前端路由（SPA）
    location / {
        try_files $uri $uri/ /index.html;
        
        # 缓存控制
        add_header Cache-Control "no-cache, must-revalidate";
    }

    # 静态资源缓存
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API 代理到后端
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

启用配置：

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/autoark /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl reload nginx
```

### 步骤 5: 配置 SSL（可选但推荐）

使用 Let's Encrypt 免费 SSL 证书：

```bash
# 安装 Certbot
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx

# 获取证书并自动配置 Nginx
sudo certbot --nginx -d your-domain.com

# 测试自动续期
sudo certbot renew --dry-run
```

---

## ✅ 验证部署

### 1. 检查服务状态

```bash
# PM2 状态
pm2 status

# 查看日志
pm2 logs autoark --lines 50

# Nginx 状态
sudo systemctl status nginx

# MongoDB 状态
sudo systemctl status mongod

# Redis 状态
sudo systemctl status redis-server
```

### 2. 测试后端接口

```bash
# 测试认证接口
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your_password"}'

# 应返回 token 或错误信息
```

### 3. 访问前端

在浏览器中访问：
- **生产地址**: `https://your-domain.com`
- **登录页面**: `https://your-domain.com/login`

使用以下凭据登录：
- 用户名：在 `.env` 中配置的 `SUPER_ADMIN_USERNAME`
- 密码：在 `.env` 中配置的 `SUPER_ADMIN_PASSWORD`

---

## 🔄 更新部署

当代码有更新时，运行以下命令：

```bash
cd /root/autoark
git pull origin main
./deploy-with-auth.sh
```

或手动更新：

```bash
cd /root/autoark/autoark-backend
git pull origin main
npm install
npm run build
pm2 restart autoark

cd /root/autoark/autoark-frontend
npm install
npm run build
```

---

## 🔒 安全加固

### 1. 防火墙配置

```bash
# 安装 UFW
sudo apt-get install -y ufw

# 允许 SSH
sudo ufw allow 22/tcp

# 允许 HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 启用防火墙
sudo ufw enable

# 查看状态
sudo ufw status
```

### 2. MongoDB 安全配置

```bash
# 连接 MongoDB
mongosh

# 创建管理员用户
use admin
db.createUser({
  user: "admin",
  pwd: "strong_password_here",
  roles: [ { role: "userAdminAnyDatabase", db: "admin" } ]
})

# 创建应用数据库用户
use autoark
db.createUser({
  user: "autoark_user",
  pwd: "strong_password_here",
  roles: [ { role: "readWrite", db: "autoark" } ]
})

# 退出
exit
```

编辑 MongoDB 配置启用认证：

```bash
sudo nano /etc/mongod.conf
```

添加：

```yaml
security:
  authorization: enabled
```

更新 `.env` 中的连接字符串：

```bash
MONGO_URI=mongodb://autoark_user:strong_password_here@localhost:27017/autoark
```

重启 MongoDB：

```bash
sudo systemctl restart mongod
```

### 3. Redis 安全配置

```bash
sudo nano /etc/redis/redis.conf
```

配置：

```conf
# 设置密码
requirepass your_redis_password

# 绑定本地
bind 127.0.0.1

# 禁用危险命令
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command CONFIG ""
```

重启 Redis：

```bash
sudo systemctl restart redis-server
```

更新 `.env`：

```bash
REDIS_PASSWORD=your_redis_password
```

### 4. 定期备份

创建备份脚本：

```bash
sudo nano /root/backup-autoark.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/root/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# 备份 MongoDB
mongodump --uri="mongodb://autoark_user:password@localhost:27017/autoark" \
  --out="$BACKUP_DIR/mongo_$TIMESTAMP"

# 压缩备份
tar -czf "$BACKUP_DIR/mongo_$TIMESTAMP.tar.gz" "$BACKUP_DIR/mongo_$TIMESTAMP"
rm -rf "$BACKUP_DIR/mongo_$TIMESTAMP"

# 只保留最近7天的备份
find $BACKUP_DIR -name "mongo_*.tar.gz" -mtime +7 -delete

echo "Backup completed: $TIMESTAMP"
```

设置定时任务：

```bash
chmod +x /root/backup-autoark.sh
crontab -e
```

添加（每天凌晨2点备份）：

```cron
0 2 * * * /root/backup-autoark.sh >> /var/log/autoark-backup.log 2>&1
```

---

## 🐛 故障排查

### 问题 1: 服务无法启动

**症状**: `pm2 status` 显示 `errored` 或 `stopped`

**排查步骤**:

```bash
# 查看详细日志
pm2 logs autoark --lines 100

# 检查端口占用
sudo lsof -i :3000

# 检查编译文件
ls -la /root/autoark/autoark-backend/dist/
```

**常见原因**:
- 端口被占用
- MongoDB 连接失败
- 环境变量配置错误

### 问题 2: 登录失败

**症状**: 前端显示"登录失败"或"网络错误"

**排查步骤**:

```bash
# 测试后端接口
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123456"}'

# 检查 MongoDB 中的用户
mongosh autoark
db.users.findOne({role: 'super_admin'})

# 查看后端日志
pm2 logs autoark | grep -i error
```

### 问题 3: 前端资源 404

**症状**: 页面空白或样式丢失

**排查步骤**:

```bash
# 检查前端文件
ls -la /root/autoark/autoark-frontend/dist/

# 检查 Nginx 配置
sudo nginx -t
sudo systemctl status nginx

# 查看 Nginx 日志
sudo tail -f /var/log/nginx/autoark_error.log
```

### 问题 4: 数据库连接失败

**症状**: 日志显示 `MongoError: Authentication failed`

**排查步骤**:

```bash
# 测试 MongoDB 连接
mongosh "mongodb://localhost:27017/autoark"

# 检查 MongoDB 状态
sudo systemctl status mongod

# 查看 MongoDB 日志
sudo tail -f /var/log/mongodb/mongod.log
```

### 问题 5: 内存不足

**症状**: 服务频繁重启，系统卡顿

**解决方案**:

```bash
# 增加 Node.js 内存限制
pm2 delete autoark
pm2 start /root/autoark/autoark-backend/dist/server.js \
  --name autoark \
  --node-args="--max-old-space-size=2048"
pm2 save

# 配置 swap（如果没有）
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 📊 监控和维护

### 1. 监控服务状态

```bash
# 实时查看服务状态
pm2 monit

# 查看资源使用
pm2 status
```

### 2. 日志管理

```bash
# 查看实时日志
pm2 logs autoark

# 查看错误日志
pm2 logs autoark --err

# 清空日志
pm2 flush autoark
```

### 3. 性能优化

```bash
# 启用 PM2 集群模式（多核 CPU）
pm2 delete autoark
pm2 start /root/autoark/autoark-backend/dist/server.js \
  --name autoark \
  -i max \
  --node-args="--max-old-space-size=2048"
pm2 save
```

---

## 📞 技术支持

如遇到问题，请提供以下信息：

1. **错误日志**:
   ```bash
   pm2 logs autoark --lines 100 > error.log
   ```

2. **系统信息**:
   ```bash
   uname -a
   node -v
   npm -v
   pm2 -v
   ```

3. **服务状态**:
   ```bash
   pm2 status
   sudo systemctl status nginx
   sudo systemctl status mongod
   ```

---

## 📝 更新日志

### v1.0.0 (2024-12-08)
- ✅ 初始部署脚本
- ✅ 三级权限系统集成
- ✅ 完整部署文档
- ✅ 安全加固指南

---

## 🎉 部署完成

恭喜！您的 AutoArk 系统已成功部署到服务器。

**下一步**:
1. ✅ 访问登录页面测试
2. ✅ 修改超级管理员密码
3. ✅ 创建第一个组织
4. ✅ 配置 SSL 证书
5. ✅ 设置定期备份

祝使用愉快！🚀
