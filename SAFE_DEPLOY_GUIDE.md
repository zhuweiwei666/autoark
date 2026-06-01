# Legacy Note

This document describes an old PM2 deployment path and is kept only for history.
Production now uses Docker Compose. Use `docs/deployment.md` or
`deploy/README.md` for the current deploy flow.

---

# 🛡️ 安全部署指南 - 永不删除 .env

## ⚠️ 重要说明

**.env 文件删除问题已永久解决！**

之前的问题原因：
- ❌ 使用了 `git clean -fd` 命令会删除未跟踪的文件
- ❌ .env 在 .gitignore 中，属于未跟踪文件
- ❌ 导致配置文件被误删

**现在已实施的保护措施：**
- ✅ .env 自动备份到独立目录
- ✅ 创建了快速恢复脚本
- ✅ 每天自动备份 .env
- ✅ 新的安全部署脚本（不会删除 .env）

---

## 🚀 正确的部署方式

### 方式 1: 使用安全部署脚本（推荐）

在服务器上运行：

```bash
cd /root
./safe-deploy.sh
```

**这个脚本会：**
1. ✅ 自动备份 .env
2. ✅ 安全地拉取代码
3. ✅ 自动恢复 .env
4. ✅ 编译并重启服务

**绝不会删除任何配置文件！**

---

### 方式 2: 手动部署（最安全）

```bash
cd /root/autoark

# 1. 手动备份 .env
cp autoark-backend/.env /root/.env.backup

# 2. 拉取代码
git pull origin main

# 3. 恢复 .env（如果被删除）
if [ ! -f autoark-backend/.env ]; then
  cp /root/.env.backup autoark-backend/.env
fi

# 4. 编译
cd autoark-backend && npm run build
cd ../autoark-frontend && npm run build

# 5. 重启
pm2 restart autoark --update-env
```

---

## 🆘 紧急恢复

### 如果 .env 被删除了

**立即执行（1秒恢复）：**

```bash
/root/restore-env.sh
```

这会自动从备份恢复 .env 并重启服务。

---

### 如果恢复脚本也不可用

**手动恢复：**

```bash
cd /root/autoark/autoark-backend

# 从备份目录恢复
cp /root/.autoark-config-backup/.env.production .env

# 重启服务
pm2 restart autoark --update-env
```

---

## 🔐 .env 备份位置

**主备份：** `/root/.autoark-config-backup/.env.production`
- 权限：600 (仅 root 可读写)
- 自动备份：每天凌晨 2 点

**查看备份：**
```bash
cat /root/.autoark-config-backup/.env.production
```

**查看备份时间：**
```bash
ls -lh /root/.autoark-config-backup/
```

---

## 📋 永远不要使用的命令

**危险命令（会删除 .env）：**

```bash
❌ git clean -fd              # 删除所有未跟踪文件
❌ git clean -fdx             # 删除所有未跟踪和忽略的文件
❌ git reset --hard && git clean -fd
```

**安全替代方案：**

```bash
✅ git stash                  # 暂存修改
✅ git pull origin main       # 拉取代码
✅ git stash pop              # 恢复修改
```

---

## 🎯 最佳实践

### 1. 部署前检查

```bash
# 确认 .env 存在
ls -la /root/autoark/autoark-backend/.env

# 查看备份
ls -la /root/.autoark-config-backup/
```

### 2. 部署后验证

```bash
# 检查 .env 是否仍然存在
cat /root/autoark/autoark-backend/.env | grep MONGO_URI

# 检查服务是否正常
pm2 status
pm2 logs autoark --lines 10
```

### 3. 定期检查备份

```bash
# 每周检查一次备份是否正常
ls -lh /root/.autoark-config-backup/.env.production

# 查看定时任务
crontab -l | grep autoark
```

---

## 📚 相关文件位置

```
/root/
├── .autoark-config-backup/          # 配置备份目录（受保护）
│   └── .env.production              # .env 备份
├── restore-env.sh                   # 一键恢复脚本
├── safe-deploy.sh                   # 安全部署脚本
└── autoark/
    └── autoark-backend/
        └── .env                     # 主配置文件
```

---

## 🔧 维护建议

### 每次部署时

```bash
# 使用安全脚本
cd /root && ./safe-deploy.sh
```

### 出现问题时

```bash
# 立即恢复
/root/restore-env.sh

# 或手动恢复
cp /root/.autoark-config-backup/.env.production /root/autoark/autoark-backend/.env
pm2 restart autoark --update-env
```

### 修改配置后

```bash
# 手动触发备份
cp /root/autoark/autoark-backend/.env /root/.autoark-config-backup/.env.production
```

---

## 💡 总结

**现在您有三重保护：**

1. **自动每日备份** - 每天凌晨 2 点自动备份
2. **部署前自动备份** - 使用 safe-deploy.sh 会自动备份
3. **一键恢复** - 随时运行 /root/restore-env.sh 恢复

**今后部署请使用：**
```bash
cd /root && ./safe-deploy.sh
```

**绝不会再删除 .env 文件！**

---

## 🙏 再次致歉

我为三次犯同样的错误深表歉意。现在已实施的保护措施确保：

- ✅ .env 有多重备份
- ✅ 可以一键快速恢复
- ✅ 新的部署脚本绝不会删除配置
- ✅ 每天自动备份

**这个问题不会再发生了。**
