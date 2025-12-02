# AutoArk 一键部署脚本使用指南

## 📋 功能说明

`deploy.sh` 是一个全自动部署脚本，可以帮你：

1. ✅ **自动提交代码**（可选）
2. ✅ **推送到 GitHub**
3. ✅ **SSH 连接到服务器**
4. ✅ **拉取最新代码**
5. ✅ **构建前端和后端**
6. ✅ **重启 PM2 服务**

## 🚀 快速开始

### 1. 配置服务器信息

编辑 `autoark-deploy.config.sh` 文件，修改以下配置：

```bash
# 服务器 SSH 配置
SSH_USER="root"                    # 服务器用户名
SSH_HOST="139.162.24.176"         # 服务器 IP 或域名
SSH_KEY=""                         # SSH 密钥路径（如果使用默认密钥，留空）

# 服务器路径配置（通常不需要修改）
SERVER_PROJECT_PATH="/root/autoark"
SERVER_BACKEND_PATH="/root/autoark/autoark-backend"
SERVER_FRONTEND_PATH="/root/autoark/autoark-frontend"

# PM2 服务名称（通常不需要修改）
PM2_APP_NAME="autoark"
```

### 2. 配置 SSH 免密登录

#### 方式 1: 使用 SSH 密钥（推荐）

如果你还没有 SSH 密钥，先生成一个：

```bash
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
```

将公钥复制到服务器：

```bash
ssh-copy-id root@139.162.24.176
```

或者手动复制：

```bash
cat ~/.ssh/id_rsa.pub | ssh root@139.162.24.176 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

测试 SSH 连接：

```bash
ssh root@139.162.24.176 "echo 'SSH connection successful'"
```

#### 方式 2: 使用密码（不推荐）

如果必须使用密码，需要安装 `sshpass`：

```bash
# macOS
brew install sshpass

# Ubuntu/Debian
sudo apt-get install sshpass
```

然后在 `autoark-deploy.config.sh` 中取消注释并填写密码：

```bash
SSH_PASSWORD="your_password"
```

### 3. 运行部署脚本

#### 基本用法

```bash
./deploy.sh
```

#### 高级用法

```bash
# 不自动提交代码，只推送已有提交
./deploy.sh --no-commit

# 跳过 Git 推送，直接部署服务器上的代码
./deploy.sh --skip-push
```

## 📝 配置选项说明

### `deploy.config.sh` 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `GITHUB_REPO` | GitHub 远程仓库名称 | `origin` |
| `GITHUB_BRANCH` | 要推送的分支 | `main` |
| `SSH_USER` | 服务器用户名 | `root` |
| `SSH_HOST` | 服务器 IP 或域名 | `139.162.24.176` |
| `SSH_KEY` | SSH 密钥路径（可选） | `""` |
| `AUTO_COMMIT` | 是否自动提交更改 | `false` |
| `BUILD_LOCAL` | 是否在部署前本地构建验证 | `false` |

**注意：** 所有脚本文件名都已改为 `autoark-` 前缀。

## 🔍 工作流程

脚本执行时会按以下步骤进行：

```
1. 检查 SSH 连接
   ↓
2. 检查 Git 状态
   ↓
3. 提交更改（如果启用 AUTO_COMMIT）
   ↓
4. 推送到 GitHub
   ↓
5. SSH 连接到服务器
   ↓
6. 在服务器上拉取最新代码
   ↓
7. 安装依赖（如果需要）
   ↓
8. 构建后端
   ↓
9. 构建前端
   ↓
10. 重启 PM2 服务
    ↓
11. 验证部署结果
```

## ⚠️ 注意事项

1. **首次使用前**，请确保：
   - ✅ SSH 免密登录已配置
   - ✅ 服务器上已克隆 GitHub 仓库
   - ✅ 服务器上已安装 Node.js、npm、PM2

2. **自动提交功能**：
   - 默认关闭（`AUTO_COMMIT=false`）
   - 启用后会自动提交所有更改，请谨慎使用

3. **构建失败处理**：
   - 如果构建失败，脚本会立即停止
   - 检查服务器日志：`ssh root@139.162.24.176 'pm2 logs autoark'`

4. **权限问题**：
   - 确保脚本有执行权限：`chmod +x deploy.sh`
   - 确保服务器用户有项目目录的读写权限

## 🐛 故障排查

### SSH 连接失败

```bash
# 测试 SSH 连接
ssh root@139.162.24.176 "echo 'test'"

# 检查 SSH 密钥权限
chmod 600 ~/.ssh/id_rsa
chmod 644 ~/.ssh/id_rsa.pub
```

### Git 推送失败

```bash
# 检查远程仓库配置
git remote -v

# 检查分支状态
git status
git log --oneline -5
```

### 服务器部署失败

```bash
# SSH 到服务器手动检查
ssh root@139.162.24.176

# 检查项目目录
cd /root/autoark
ls -la

# 检查 PM2 状态
pm2 status
pm2 logs autoark
```

### 前端构建失败

```bash
# 在服务器上手动构建
cd /root/autoark/autoark-frontend
npm install
npm run build
```

## 📞 获取帮助

如果遇到问题，可以：

1. 查看脚本输出的错误信息
2. 检查服务器日志：`pm2 logs autoark`
3. 手动 SSH 到服务器检查状态

## 🔄 更新脚本

脚本会定期更新，建议定期拉取最新版本：

```bash
git pull origin main
```

---

**祝部署顺利！** 🎉

