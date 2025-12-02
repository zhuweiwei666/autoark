#!/bin/bash

echo ">>> Frontend Auto Deploy Started..."

cd /root/autoark/autoark-frontend || exit 1

# Pull latest code
if [ -d ".git" ]; then
    echo ">>> Repo exists, pulling latest..."
    git pull origin main
else
    echo ">>> No git repo found, cloning..."
    cd /root/autoark
    git clone https://github.com/zhuweiwei666/autoark.git temp-repo
    cp -r temp-repo/autoark-frontend ./
    rm -rf temp-repo
    cd autoark-frontend
fi

# Install dependencies
echo ">>> Installing frontend dependencies..."
npm install

# Build for production
echo ">>> Building frontend..."
npm run build

# If using PM2 for frontend (optional)
# pm2 restart autoark-frontend || pm2 start npm --name "autoark-frontend" -- start

echo ">>> Frontend DEPLOY FINISHED at $(date)"
echo ">>> Frontend build output is in: $(pwd)/dist"
echo ">>> You can serve it with: npx serve -s dist -l 5173"

