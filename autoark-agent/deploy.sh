#!/bin/bash
set -e

echo "=========================================="
echo "AutoArk Agent - Deploy"
echo "=========================================="

PROJECT="/root/autoark/autoark-agent"
cd "$PROJECT"

echo "[1/5] Pull latest code..."
cd /root/autoark && git pull origin main
cd "$PROJECT"

echo "[2/5] Install backend dependencies..."
npm install --production=false 2>&1 | tail -3

echo "[3/5] Build backend..."
npm run build

echo "[4/5] Build frontend..."
cd web && npm install 2>&1 | tail -3 && npm run build && cd ..

echo "[5/5] Restart PM2..."
pm2 restart autoark-agent 2>/dev/null || pm2 start ecosystem.config.js
pm2 save

echo ""
echo "Deploy complete!"
pm2 status autoark-agent
