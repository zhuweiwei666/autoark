#!/bin/bash
# 快速部署脚本（简化版）
# 直接执行部署，不询问确认

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 加载配置
source "$SCRIPT_DIR/autoark-deploy.config.sh"

echo "🚀 快速部署 AutoArk..."
echo ""

# 执行主部署脚本，跳过确认
bash "$SCRIPT_DIR/autoark-deploy.sh" --no-commit

