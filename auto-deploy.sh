#!/bin/bash

echo ">>> Auto Deploy Started..."

cd /root/autoark/autoark-backend || exit 1

# Pull latest code
if [ -d ".git" ]; then
    echo ">>> Repo exists, pulling latest..."
    git pull origin main
else
    echo ">>> No git repo found, skipping pull..."
fi

# Install dependencies
echo ">>> Installing backend dependencies..."
npm install

# Build TypeScript
echo ">>> Building TypeScript..."
npm run build

# Restart PM2
echo ">>> Restarting backend with PM2..."
pm2 restart autoark

# Save PM2 process list
pm2 save

echo ">>> DEPLOY FINISHED at $(date)"

