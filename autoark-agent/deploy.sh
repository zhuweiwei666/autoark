#!/bin/bash
set -e

PROJECT="/root/autoark/autoark-agent"
LOG_DIR="$PROJECT/logs"
DEPLOY_LOG="$LOG_DIR/deploy.log"
HEALTH_URL="http://localhost:3002/api/health"
ROLLBACK_FILE="$PROJECT/.last-good-commit"

mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$DEPLOY_LOG"; }

echo "==========================================" | tee -a "$DEPLOY_LOG"
echo " AutoArk Agent - Deploy $(date '+%Y-%m-%d %H:%M:%S')" | tee -a "$DEPLOY_LOG"
echo "==========================================" | tee -a "$DEPLOY_LOG"

cd /root/autoark

# 记录当前 commit，用于回滚
PREV_COMMIT=$(git rev-parse HEAD)
log "Current commit: $PREV_COMMIT"

# 1. 拉取代码
log "[1/6] Pull latest code..."
git pull origin main 2>&1 | tee -a "$DEPLOY_LOG"
NEW_COMMIT=$(git rev-parse HEAD)
log "New commit: $NEW_COMMIT"

if [ "$PREV_COMMIT" = "$NEW_COMMIT" ]; then
  log "No changes. Re-deploying anyway."
fi

cd "$PROJECT"

# 2. 安装依赖
log "[2/6] Install backend dependencies..."
npm install --production=false 2>&1 | tail -5 | tee -a "$DEPLOY_LOG"

# 3. 编译后端
log "[3/6] Build backend..."
npm run build 2>&1 | tee -a "$DEPLOY_LOG"

# 4. 编译前端
log "[4/6] Build frontend..."
cd web && npm install 2>&1 | tail -3 && npm run build 2>&1 | tail -5 && cd ..
log "Frontend build done"

# 5. 重启服务（--update-env 确保新环境变量和代码生效）
log "[5/6] Restart PM2..."
pm2 delete autoark-agent 2>/dev/null; pm2 start ecosystem.config.js
pm2 save --force 2>/dev/null

# 6. 健康检查
log "[6/6] Health check..."
sleep 3
HEALTHY=false
for i in 1 2 3; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    HEALTHY=true
    break
  fi
  log "  Attempt $i: HTTP $STATUS, retrying..."
  sleep 2
done

if [ "$HEALTHY" = true ]; then
  echo "$NEW_COMMIT" > "$ROLLBACK_FILE"
  log "Deploy SUCCESS - commit $NEW_COMMIT"
  pm2 status autoark-agent
else
  log "WARN: Health check failed (HTTP $STATUS), service may still be starting"
  log "Check logs: pm2 logs autoark-agent --lines 30"
  pm2 status autoark-agent
fi

echo ""
log "Done in $SECONDS seconds"
