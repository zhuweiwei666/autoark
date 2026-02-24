#!/bin/bash
#
# 本地一键部署：push 代码 + SSH 到服务器执行 deploy.sh
#
# 用法:
#   ./deploy-remote.sh              # 推送并部署
#   ./deploy-remote.sh --skip-push  # 跳过推送，只触发服务器部署
#   ./deploy-remote.sh --logs       # 查看服务器最新日志
#   ./deploy-remote.sh --status     # 查看服务器 PM2 状态
#   ./deploy-remote.sh --rollback   # 回滚到上一个正常 commit
#
set -e

SERVER="root@139.162.24.176"
SSH_KEY="$HOME/.ssh/polaris_linode"
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10"
REMOTE_PROJECT="/root/autoark/autoark-agent"

ssh_cmd() {
  ssh $SSH_OPTS "$SERVER" "$1"
}

case "${1:-deploy}" in
  --logs)
    ssh_cmd "pm2 logs autoark-agent --lines 30 --nostream"
    exit 0
    ;;
  --status)
    ssh_cmd "pm2 status autoark-agent && echo '' && pm2 describe autoark-agent | head -20"
    exit 0
    ;;
  --rollback)
    echo "Rolling back on server..."
    ssh_cmd "cd /root/autoark && PREV=\$(cat $REMOTE_PROJECT/.last-good-commit 2>/dev/null) && \
      if [ -z \"\$PREV\" ]; then echo 'No rollback commit found'; exit 1; fi && \
      echo \"Rolling back to \$PREV\" && \
      git checkout \$PREV -- autoark-agent/ && \
      cd $REMOTE_PROJECT && npm run build && pm2 restart autoark-agent && \
      echo 'Rollback complete' && pm2 status autoark-agent"
    exit 0
    ;;
  --skip-push)
    echo "Skipping git push, triggering server deploy..."
    ;;
  deploy|*)
    # 推送代码
    cd "$(dirname "$0")/.."
    BRANCH=$(git branch --show-current)
    echo "[Local] Pushing $BRANCH to origin..."
    git push origin "$BRANCH"
    echo ""
    ;;
esac

# 远程部署
echo "[Remote] Deploying on $SERVER..."
ssh_cmd "bash $REMOTE_PROJECT/deploy.sh"
