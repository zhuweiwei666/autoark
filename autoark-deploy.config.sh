#!/bin/bash
# 部署配置文件
# 请根据你的实际情况修改以下配置

# GitHub 仓库信息
GITHUB_REPO="origin"
GITHUB_BRANCH="main"

# 服务器 SSH 配置
# 方式1: 使用 SSH 密钥（推荐）
SSH_USER="root"
SSH_HOST="139.162.24.176"  # 请修改为你的服务器 IP 或域名
SSH_KEY=""  # 如果使用默认 SSH 密钥，留空；否则填写密钥路径，如: ~/.ssh/id_rsa

# 方式2: 使用密码（不推荐，需要安装 sshpass）
# SSH_PASSWORD=""  # 如果使用密码，取消注释并填写

# 服务器路径配置
SERVER_PROJECT_PATH="/root/autoark"
SERVER_BACKEND_PATH="/root/autoark/autoark-backend"
SERVER_FRONTEND_PATH="/root/autoark/autoark-frontend"

# PM2 服务名称
PM2_APP_NAME="autoark"

# 自动提交配置（设置为 true 会自动提交所有更改）
AUTO_COMMIT=false
COMMIT_MESSAGE="Auto deploy: $(date '+%Y-%m-%d %H:%M:%S')"

# 是否在部署前构建本地代码（用于验证）
BUILD_LOCAL=false

