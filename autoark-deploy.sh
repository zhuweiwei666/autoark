#!/bin/bash

###############################################################################
# AutoArk 一键部署脚本
# 
# 功能：
# 1. 检查并提交本地代码更改（可选）
# 2. 推送到 GitHub
# 3. SSH 连接到服务器
# 4. 在服务器上拉取最新代码
# 5. 构建前端和后端
# 6. 重启 PM2 服务
#
# 使用方法：
#   ./deploy.sh              # 使用默认配置
#   ./deploy.sh --no-commit  # 不自动提交，只推送已有提交
#   ./deploy.sh --skip-push  # 跳过推送，直接部署服务器上的代码
###############################################################################

set -e  # 遇到错误立即退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 脚本目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 加载配置
CONFIG_FILE="$SCRIPT_DIR/autoark-deploy.config.sh"
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}❌ 错误: 配置文件不存在: $CONFIG_FILE${NC}"
    echo "请先创建配置文件或检查文件路径"
    exit 1
fi

source "$CONFIG_FILE"

# 解析命令行参数
AUTO_COMMIT_FLAG=true
SKIP_PUSH=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --no-commit)
            AUTO_COMMIT_FLAG=false
            shift
            ;;
        --skip-push)
            SKIP_PUSH=true
            shift
            ;;
        *)
            echo -e "${YELLOW}未知参数: $1${NC}"
            shift
            ;;
    esac
done

# 打印配置信息
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}AutoArk 一键部署脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "服务器: ${GREEN}${SSH_USER}@${SSH_HOST}${NC}"
echo -e "项目路径: ${GREEN}${SERVER_PROJECT_PATH}${NC}"
echo -e "PM2 服务: ${GREEN}${PM2_APP_NAME}${NC}"
echo ""

# 检查必要的命令
check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}❌ 错误: 未找到命令 '$1'${NC}"
        echo "请先安装: $2"
        exit 1
    fi
}

check_command "git" "Git"
check_command "ssh" "OpenSSH"

# 构建 SSH 命令
if [ -n "$SSH_KEY" ] && [ -f "$SSH_KEY" ]; then
    SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no"
else
    SSH_CMD="ssh -o StrictHostKeyChecking=no"
fi

SSH_TARGET="${SSH_USER}@${SSH_HOST}"

# 测试 SSH 连接
echo -e "${YELLOW}测试 SSH 连接...${NC}"
if ! $SSH_CMD -o ConnectTimeout=5 "$SSH_TARGET" "echo 'SSH connection successful'" &> /dev/null; then
    echo -e "${RED}❌ SSH 连接失败！${NC}"
    echo "请检查："
    echo "  1. 服务器地址是否正确: $SSH_HOST"
    echo "  2. SSH 密钥是否正确配置"
    echo "  3. 服务器是否可访问"
    exit 1
fi
echo -e "${GREEN}✅ SSH 连接成功${NC}"
echo ""

###############################################################################
# 步骤 1: Git 操作
###############################################################################
if [ "$SKIP_PUSH" = false ]; then
    echo -e "${BLUE}【步骤 1】Git 操作${NC}"
    echo "----------------------------------------"
    
    # 检查是否有未提交的更改
    if [ -n "$(git status --porcelain)" ]; then
        echo -e "${YELLOW}检测到未提交的更改:${NC}"
        git status --short
        
        if [ "$AUTO_COMMIT" = true ] && [ "$AUTO_COMMIT_FLAG" = true ]; then
            echo ""
            echo -e "${YELLOW}自动提交更改...${NC}"
            git add -A
            git commit -m "$COMMIT_MESSAGE"
            echo -e "${GREEN}✅ 已提交更改${NC}"
        else
            echo ""
            echo -e "${YELLOW}⚠️  有未提交的更改，但未启用自动提交${NC}"
            echo "使用 --no-commit 参数跳过自动提交，或手动提交后再运行"
            read -p "是否继续部署？(y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                echo "部署已取消"
                exit 0
            fi
        fi
    else
        echo -e "${GREEN}✅ 工作区干净，无未提交更改${NC}"
    fi
    
    # 检查是否有未推送的提交
    LOCAL_COMMITS=$(git log ${GITHUB_BRANCH}..${GITHUB_REPO}/${GITHUB_BRANCH} 2>/dev/null | wc -l || echo "0")
    if [ "$LOCAL_COMMITS" -gt 0 ] || [ -n "$(git status --porcelain)" ]; then
        echo ""
        echo -e "${YELLOW}推送到 GitHub (${GITHUB_REPO}/${GITHUB_BRANCH})...${NC}"
        git push ${GITHUB_REPO} ${GITHUB_BRANCH}
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ 代码已推送到 GitHub${NC}"
        else
            echo -e "${RED}❌ 推送失败！${NC}"
            exit 1
        fi
    else
        echo -e "${GREEN}✅ 本地代码已是最新，无需推送${NC}"
    fi
    echo ""
else
    echo -e "${YELLOW}⏭️  跳过 Git 推送（使用 --skip-push 参数）${NC}"
    echo ""
fi

###############################################################################
# 步骤 2: 本地构建验证（可选）
###############################################################################
if [ "$BUILD_LOCAL" = true ]; then
    echo -e "${BLUE}【步骤 2】本地构建验证${NC}"
    echo "----------------------------------------"
    
    # 构建后端
    echo -e "${YELLOW}构建后端...${NC}"
    cd "$SCRIPT_DIR/autoark-backend"
    npm run build
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ 后端构建成功${NC}"
    else
        echo -e "${RED}❌ 后端构建失败！${NC}"
        exit 1
    fi
    
    # 构建前端
    echo -e "${YELLOW}构建前端...${NC}"
    cd "$SCRIPT_DIR/autoark-frontend"
    npm run build
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ 前端构建成功${NC}"
    else
        echo -e "${RED}❌ 前端构建失败！${NC}"
        exit 1
    fi
    
    cd "$SCRIPT_DIR"
    echo ""
fi

###############################################################################
# 步骤 3: 服务器部署
###############################################################################
echo -e "${BLUE}【步骤 3】服务器部署${NC}"
echo "----------------------------------------"

# 创建服务器端部署脚本
DEPLOY_SCRIPT=$(cat <<'EOF'
#!/bin/bash
set -e

echo "=========================================="
echo "开始服务器端部署"
echo "=========================================="
echo ""

# 项目路径
PROJECT_PATH="__PROJECT_PATH__"
BACKEND_PATH="__BACKEND_PATH__"
FRONTEND_PATH="__FRONTEND_PATH__"
PM2_APP="__PM2_APP__"

# 检查目录是否存在
if [ ! -d "$PROJECT_PATH" ]; then
    echo "❌ 错误: 项目目录不存在: $PROJECT_PATH"
    exit 1
fi

# 1. 拉取最新代码
echo "【1/5】拉取最新代码..."
cd "$PROJECT_PATH"
if [ -d ".git" ]; then
    git fetch origin
    git reset --hard origin/main
    echo "✅ 代码已更新"
else
    echo "⚠️  警告: 未找到 .git 目录，跳过代码拉取"
fi
echo ""

# 2. 部署后端
echo "【2/5】部署后端..."
cd "$BACKEND_PATH"
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
    echo "安装后端依赖..."
    npm install --production=false
fi

echo "构建后端..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ 后端构建失败！"
    exit 1
fi
echo "✅ 后端部署完成"
echo ""

# 3. 部署前端
echo "【3/5】部署前端..."
cd "$FRONTEND_PATH"
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
    echo "安装前端依赖..."
    npm install
fi

echo "构建前端..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ 前端构建失败！"
    exit 1
fi

# 验证前端构建
if [ ! -f "dist/index.html" ]; then
    echo "❌ 错误: 前端构建失败，dist/index.html 不存在！"
    exit 1
fi
echo "✅ 前端部署完成"
echo ""

# 4. 重启 PM2 服务
echo "【4/5】重启 PM2 服务..."
cd "$BACKEND_PATH"
pm2 restart "$PM2_APP" || {
    echo "⚠️  PM2 重启失败，尝试重新启动..."
    pm2 delete "$PM2_APP" 2>/dev/null || true
    pm2 start ecosystem.config.js
}
pm2 save
echo "✅ PM2 服务已重启"
echo ""

# 5. 等待服务启动
echo "【5/5】等待服务启动..."
sleep 5

# 检查服务状态
echo "服务状态:"
pm2 status "$PM2_APP"

echo ""
echo "=========================================="
echo "部署完成！"
echo "=========================================="
EOF
)

# 替换占位符
DEPLOY_SCRIPT=$(echo "$DEPLOY_SCRIPT" | \
    sed "s|__PROJECT_PATH__|$SERVER_PROJECT_PATH|g" | \
    sed "s|__BACKEND_PATH__|$SERVER_BACKEND_PATH|g" | \
    sed "s|__FRONTEND_PATH__|$SERVER_FRONTEND_PATH|g" | \
    sed "s|__PM2_APP__|$PM2_APP_NAME|g")

# 在服务器上执行部署脚本
echo -e "${YELLOW}连接到服务器并执行部署...${NC}"
echo ""

# 使用 heredoc 传递脚本到服务器
$SSH_CMD "$SSH_TARGET" bash <<DEPLOY_EOF
$DEPLOY_SCRIPT
DEPLOY_EOF

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}✅ 部署成功完成！${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "访问地址:"
    echo -e "  - Dashboard: ${BLUE}http://app.autoark.work/dashboard${NC}"
    echo -e "  - Token 管理: ${BLUE}http://app.autoark.work/fb-token${NC}"
    echo -e "  - 账户管理: ${BLUE}http://app.autoark.work/fb-accounts${NC}"
    echo -e "  - 广告系列: ${BLUE}http://app.autoark.work/fb-campaigns${NC}"
    echo ""
    echo -e "查看服务日志: ${YELLOW}ssh ${SSH_TARGET} 'pm2 logs ${PM2_APP_NAME}'${NC}"
    echo ""
else
    echo ""
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}❌ 部署失败！${NC}"
    echo -e "${RED}========================================${NC}"
    echo ""
    echo "请检查服务器日志以获取更多信息"
    exit 1
fi

