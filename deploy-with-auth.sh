#!/bin/bash

##############################################################################
# AutoArk 完整部署脚本（包含三级权限系统）
# 用途：部署带有认证系统的 AutoArk 到服务器
##############################################################################

set -e  # 遇到错误立即退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  AutoArk 部署脚本 (带认证系统)         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 配置项
PROJECT_ROOT="/root/autoark"
BACKEND_DIR="$PROJECT_ROOT/autoark-backend"
FRONTEND_DIR="$PROJECT_ROOT/autoark-frontend"
BACKUP_DIR="$PROJECT_ROOT/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 检查是否在服务器上
if [ ! -d "$PROJECT_ROOT" ]; then
    echo -e "${RED}错误: 项目目录 $PROJECT_ROOT 不存在${NC}"
    echo -e "${YELLOW}请确保在正确的服务器上运行此脚本${NC}"
    exit 1
fi

cd $PROJECT_ROOT

##############################################################################
# 步骤 1: 创建备份
##############################################################################
echo -e "${BLUE}[1/10] 创建备份...${NC}"
mkdir -p $BACKUP_DIR
if [ -d "$BACKEND_DIR/dist" ]; then
    tar -czf "$BACKUP_DIR/backend_$TIMESTAMP.tar.gz" -C "$BACKEND_DIR" dist/ 2>/dev/null || true
    echo -e "${GREEN}✓ 后端备份完成${NC}"
fi

if [ -d "$FRONTEND_DIR/dist" ]; then
    tar -czf "$BACKUP_DIR/frontend_$TIMESTAMP.tar.gz" -C "$FRONTEND_DIR" dist/ 2>/dev/null || true
    echo -e "${GREEN}✓ 前端备份完成${NC}"
fi

# 只保留最近5个备份
ls -t $BACKUP_DIR/*.tar.gz 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true

##############################################################################
# 步骤 2: 拉取最新代码
##############################################################################
echo ""
echo -e "${BLUE}[2/10] 拉取最新代码...${NC}"
git fetch origin
git pull origin main
echo -e "${GREEN}✓ 代码更新完成${NC}"

##############################################################################
# 步骤 3: 检查环境变量
##############################################################################
echo ""
echo -e "${BLUE}[3/10] 检查环境变量配置...${NC}"
cd $BACKEND_DIR

if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠ .env 文件不存在，从模板创建...${NC}"
    cp .env.example .env
    echo -e "${RED}❌ 请配置 .env 文件后重新运行脚本${NC}"
    echo -e "${YELLOW}必须配置项：${NC}"
    echo "  - MONGO_URI"
    echo "  - JWT_SECRET (建议使用随机字符串)"
    echo "  - SUPER_ADMIN_USERNAME (可选，默认: admin)"
    echo "  - SUPER_ADMIN_PASSWORD (可选，默认: admin123456)"
    exit 1
fi

# 检查关键配置项
if ! grep -q "JWT_SECRET=" .env || grep -q "JWT_SECRET=your-super-secret-key" .env; then
    echo -e "${RED}❌ JWT_SECRET 未配置或使用默认值${NC}"
    echo -e "${YELLOW}请在 .env 中设置安全的 JWT_SECRET${NC}"
    echo -e "${YELLOW}生成方法: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"${NC}"
    exit 1
fi

echo -e "${GREEN}✓ 环境变量检查通过${NC}"

##############################################################################
# 步骤 4: 安装后端依赖
##############################################################################
echo ""
echo -e "${BLUE}[4/10] 安装后端依赖...${NC}"
cd $BACKEND_DIR
npm install
echo -e "${GREEN}✓ 后端依赖安装完成${NC}"

##############################################################################
# 步骤 5: 编译后端
##############################################################################
echo ""
echo -e "${BLUE}[5/10] 编译后端 TypeScript...${NC}"
npm run build
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ 后端编译成功${NC}"
else
    echo -e "${RED}❌ 后端编译失败${NC}"
    exit 1
fi

##############################################################################
# 步骤 6: 初始化超级管理员（如果需要）
##############################################################################
echo ""
echo -e "${BLUE}[6/10] 检查超级管理员账号...${NC}"

# 检查是否已存在超级管理员
MONGO_URI=$(grep MONGO_URI .env | cut -d '=' -f2-)
if command -v mongosh &> /dev/null; then
    ADMIN_EXISTS=$(mongosh "$MONGO_URI" --quiet --eval "db.users.countDocuments({role: 'super_admin'})")
elif command -v mongo &> /dev/null; then
    ADMIN_EXISTS=$(mongo "$MONGO_URI" --quiet --eval "db.users.countDocuments({role: 'super_admin'})")
else
    ADMIN_EXISTS=0
    echo -e "${YELLOW}⚠ MongoDB 客户端未安装，跳过检查${NC}"
fi

if [ "$ADMIN_EXISTS" = "0" ] || [ -z "$ADMIN_EXISTS" ]; then
    echo -e "${YELLOW}超级管理员不存在，正在创建...${NC}"
    npm run init:super-admin
    echo -e "${GREEN}✓ 超级管理员创建完成${NC}"
    echo -e "${YELLOW}═════════════════════════════════════${NC}"
    echo -e "${YELLOW}请记录超级管理员登录信息：${NC}"
    echo -e "${YELLOW}  用户名: $(grep SUPER_ADMIN_USERNAME .env | cut -d '=' -f2- || echo 'admin')${NC}"
    echo -e "${YELLOW}  密码: $(grep SUPER_ADMIN_PASSWORD .env | cut -d '=' -f2- || echo 'admin123456')${NC}"
    echo -e "${YELLOW}═════════════════════════════════════${NC}"
else
    echo -e "${GREEN}✓ 超级管理员已存在，跳过创建${NC}"
fi

##############################################################################
# 步骤 7: 安装前端依赖
##############################################################################
echo ""
echo -e "${BLUE}[7/10] 安装前端依赖...${NC}"
cd $FRONTEND_DIR
npm install
echo -e "${GREEN}✓ 前端依赖安装完成${NC}"

##############################################################################
# 步骤 8: 编译前端
##############################################################################
echo ""
echo -e "${BLUE}[8/10] 编译前端...${NC}"
npm run build
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ 前端编译成功${NC}"
else
    echo -e "${RED}❌ 前端编译失败${NC}"
    exit 1
fi

##############################################################################
# 步骤 9: 重启服务
##############################################################################
echo ""
echo -e "${BLUE}[9/10] 重启服务...${NC}"

# 检查 PM2 是否安装
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ PM2 未安装${NC}"
    echo -e "${YELLOW}安装 PM2: npm install -g pm2${NC}"
    exit 1
fi

cd $BACKEND_DIR

# 检查是否已有进程
if pm2 list | grep -q "autoark"; then
    echo "正在重启 autoark 进程..."
    pm2 restart autoark
else
    echo "首次启动，创建 PM2 进程..."
    pm2 start dist/server.js --name autoark --node-args="--max-old-space-size=2048"
    pm2 save
fi

echo -e "${GREEN}✓ 服务重启完成${NC}"

##############################################################################
# 步骤 10: 验证部署
##############################################################################
echo ""
echo -e "${BLUE}[10/10] 验证部署...${NC}"

# 等待服务启动
sleep 3

# 检查 PM2 状态
if pm2 list | grep -q "online.*autoark"; then
    echo -e "${GREEN}✓ 后端服务运行正常${NC}"
else
    echo -e "${RED}❌ 后端服务未正常启动${NC}"
    pm2 logs autoark --lines 20
    exit 1
fi

# 检查前端文件
if [ -f "$FRONTEND_DIR/dist/index.html" ]; then
    echo -e "${GREEN}✓ 前端文件存在${NC}"
else
    echo -e "${RED}❌ 前端文件不存在${NC}"
    exit 1
fi

# 测试登录接口
echo ""
echo "测试认证接口..."
HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/auth/login -X POST -H "Content-Type: application/json" -d '{"username":"test","password":"test"}' || echo "000")

if [ "$HEALTH_CHECK" = "401" ] || [ "$HEALTH_CHECK" = "400" ]; then
    echo -e "${GREEN}✓ 认证接口响应正常${NC}"
elif [ "$HEALTH_CHECK" = "200" ]; then
    echo -e "${GREEN}✓ 认证接口响应正常${NC}"
else
    echo -e "${YELLOW}⚠ 认证接口返回状态码: $HEALTH_CHECK${NC}"
fi

##############################################################################
# 部署完成
##############################################################################
echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║        🎉 部署成功完成！                ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}部署信息${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "• 部署时间: $(date)"
echo "• 项目路径: $PROJECT_ROOT"
echo "• PM2 状态: $(pm2 list | grep autoark | awk '{print $10}')"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}访问地址${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "• 应用地址: http://your-domain.com"
echo "• 登录页面: http://your-domain.com/login"
echo "• API 地址: http://your-domain.com/api"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}管理命令${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "• 查看日志: pm2 logs autoark"
echo "• 查看状态: pm2 status"
echo "• 重启服务: pm2 restart autoark"
echo "• 停止服务: pm2 stop autoark"
echo ""
echo -e "${YELLOW}⚠️  重要提示：${NC}"
echo "1. 首次登录后请立即修改超级管理员密码"
echo "2. 定期备份数据库"
echo "3. 监控服务器资源使用情况"
echo ""

exit 0
