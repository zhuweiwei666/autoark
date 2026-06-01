# Legacy Note

This document describes an old PM2 deployment path and is kept only for history.
Production now uses Docker Compose. Use `docs/deployment.md` or
`deploy/README.md` for the current deploy flow.

---

# 🚀 立即部署到服务器

## 📋 前置条件检查

确保服务器已安装：
- ✅ Node.js 18+
- ✅ MongoDB
- ✅ Redis
- ✅ PM2
- ✅ Nginx
- ✅ Git

---

## ⚡ 5分钟快速部署

### 第一步：SSH 连接到服务器

```bash
ssh root@your-server-ip
```

### 第二步：拉取最新代码

如果是首次部署：
```bash
cd /root
git clone https://github.com/zhuweiwei666/autoark.git
cd autoark
```

如果已存在项目：
```bash
cd /root/autoark
git pull origin main
```

### 第三步：配置环境变量

```bash
cd /root/autoark/autoark-backend

# 如果 .env 不存在，从模板创建
if [ ! -f .env ]; then cp .env.example .env; fi

# 编辑环境变量（必须配置）
nano .env
```

**必须修改的配置：**
```bash
# MongoDB 配置
MONGO_URI=mongodb://localhost:27017/autoark

# JWT 密钥（执行下面命令生成）
JWT_SECRET=粘贴生成的随机字符串

# 超级管理员配置
SUPER_ADMIN_USERNAME=admin
SUPER_ADMIN_PASSWORD=设置强密码
SUPER_ADMIN_EMAIL=your@email.com
```

**生成 JWT_SECRET：**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# 复制输出结果，粘贴到 .env 的 JWT_SECRET
```

保存并退出（`Ctrl+X`，然后 `Y`，再按 `Enter`）

### 第四步：运行部署脚本

```bash
cd /root/autoark
chmod +x deploy-with-auth.sh
./deploy-with-auth.sh
```

**等待3-5分钟**，脚本会自动完成：
- ✅ 安装依赖
- ✅ 编译前后端
- ✅ 初始化超级管理员
- ✅ 启动服务

### 第五步：配置 Nginx

```bash
# 创建 Nginx 配置
sudo nano /etc/nginx/sites-available/autoark
```

**复制以下内容（修改域名）：**

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 改成你的域名

    root /root/autoark/autoark-frontend/dist;
    index index.html;

    # 前端路由
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

**启用配置并重启：**

```bash
sudo ln -s /etc/nginx/sites-available/autoark /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 第六步：验证部署

```bash
# 检查服务状态
pm2 status

# 测试后端
curl http://localhost:3000/api/auth/login

# 查看日志
pm2 logs autoark --lines 20
```

---

## 🎯 访问系统

1. **在浏览器中打开**: `http://your-domain.com/login`

2. **使用超级管理员登录**:
   - 用户名: 在 `.env` 中设置的 `SUPER_ADMIN_USERNAME`
   - 密码: 在 `.env` 中设置的 `SUPER_ADMIN_PASSWORD`

3. **首次登录后立即修改密码**

---

## 🔐 配置 SSL（推荐）

```bash
# 安装 Certbot
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 测试自动续期
sudo certbot renew --dry-run
```

---

## 🔄 后续更新

当代码有更新时，只需运行：

```bash
cd /root/autoark
git pull origin main
./deploy-with-auth.sh
```

---

## 📱 常用命令

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs autoark

# 重启服务
pm2 restart autoark

# 停止服务
pm2 stop autoark

# 查看实时监控
pm2 monit

# 检查 Nginx
sudo nginx -t
sudo systemctl status nginx

# 查看 Nginx 日志
sudo tail -f /var/log/nginx/error.log
```

---

## 🐛 快速故障排查

### 问题1: 服务启动失败

```bash
pm2 logs autoark --lines 50
# 查看具体错误信息
```

### 问题2: 前端页面空白

```bash
# 检查前端文件
ls -la /root/autoark/autoark-frontend/dist/

# 重新构建前端
cd /root/autoark/autoark-frontend
npm run build
```

### 问题3: 无法连接数据库

```bash
# 检查 MongoDB
sudo systemctl status mongod

# 测试连接
mongosh "mongodb://localhost:27017/autoark"
```

### 问题4: 登录失败

```bash
# 重新初始化超级管理员
cd /root/autoark/autoark-backend
npm run init:super-admin
```

---

## 📞 获取帮助

完整文档：
- **快速开始**: [QUICK_START_AUTH.md](./QUICK_START_AUTH.md)
- **完整指南**: [AUTH_SYSTEM_README.md](./AUTH_SYSTEM_README.md)
- **详细部署**: [SERVER_DEPLOYMENT.md](./SERVER_DEPLOYMENT.md)

---

## ✅ 部署检查清单

部署完成后，确认以下项目：

- [ ] 服务器环境已准备（Node.js, MongoDB, Redis, Nginx）
- [ ] 代码已拉取到 `/root/autoark`
- [ ] `.env` 文件已配置（特别是 JWT_SECRET）
- [ ] 部署脚本执行成功
- [ ] PM2 显示服务在线（`pm2 status`）
- [ ] Nginx 配置正确（`sudo nginx -t`）
- [ ] 可以访问登录页面
- [ ] 可以使用超级管理员登录
- [ ] SSL 证书已配置（推荐）
- [ ] 防火墙已配置（开放 80/443 端口）
- [ ] 已设置定期备份

---

## 🎉 完成

恭喜！您的 AutoArk 系统已成功部署！

**现在可以：**
1. ✅ 登录系统
2. ✅ 创建第一个组织
3. ✅ 邀请团队成员
4. ✅ 开始使用广告管理功能

祝使用愉快！🚀
