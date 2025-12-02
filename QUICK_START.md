# 🚀 快速部署指南

## 一键部署脚本已就绪！

### 📁 文件说明

- **`autoark-deploy.sh`** - 主部署脚本（完整功能）
- **`autoark-deploy.config.sh`** - 配置文件（需要根据实际情况修改）
- **`autoark-quick-deploy.sh`** - 快速部署脚本（简化版）
- **`DEPLOY_README.md`** - 详细使用文档

### ⚡ 快速开始（3 步）

#### 1️⃣ 配置 SSH 免密登录

```bash
# 如果还没有 SSH 密钥，先生成一个
ssh-keygen -t rsa -b 4096

# 将公钥复制到服务器
ssh-copy-id root@139.162.24.176

# 测试连接
ssh root@139.162.24.176 "echo '连接成功'"
```

#### 2️⃣ 检查配置文件

编辑 `autoark-deploy.config.sh`，确认服务器信息正确：

```bash
SSH_USER="root"
SSH_HOST="139.162.24.176"  # 你的服务器 IP
```

#### 3️⃣ 执行部署

```bash
# 方式 1: 完整部署（推荐）
./autoark-deploy.sh

# 方式 2: 快速部署（不询问确认）
./autoark-quick-deploy.sh
```

### 🎯 使用场景

#### 场景 1: 正常部署（有未提交的代码）

```bash
# 1. 先手动提交代码
git add .
git commit -m "你的提交信息"

# 2. 执行部署
./deploy.sh
```

#### 场景 2: 自动提交并部署

编辑 `autoark-deploy.config.sh`：

```bash
AUTO_COMMIT=true  # 改为 true
```

然后直接运行：

```bash
./autoark-deploy.sh
```

#### 场景 3: 只部署，不推送代码

```bash
./deploy.sh --skip-push
```

### 📋 部署流程

脚本会自动执行以下步骤：

```
✅ 检查 SSH 连接
✅ 检查 Git 状态
✅ 提交代码（如果启用）
✅ 推送到 GitHub
✅ SSH 连接到服务器
✅ 拉取最新代码
✅ 安装依赖
✅ 构建后端
✅ 构建前端
✅ 重启 PM2 服务
✅ 验证部署
```

### ⚠️ 常见问题

#### Q: SSH 连接失败？

```bash
# 检查 SSH 配置
ssh -v root@139.162.24.176

# 检查密钥权限
chmod 600 ~/.ssh/id_rsa
```

#### Q: Git 推送失败？

```bash
# 检查远程仓库
git remote -v

# 检查分支
git branch -a
```

#### Q: 服务器部署失败？

```bash
# SSH 到服务器检查
ssh root@139.162.24.176
cd /root/autoark
pm2 logs autoark
```

### 📞 需要帮助？

查看详细文档：`DEPLOY_README.md`

---

**现在就开始部署吧！** 🎉

```bash
./autoark-deploy.sh
```

