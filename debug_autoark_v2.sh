#!/bin/bash

echo "#################################################"
echo "        AutoArk Backend Debug Script v2         "
echo "#################################################"

# 1. 检查 PM2 进程状态
echo -e "\n>>> 1. PM2 Process Status:"
pm2 list

# 2. 检查端口占用 (使用 ss 替代 netstat)
echo -e "\n>>> 2. Checking Port 3001:"
ss -tlnp | grep :3001 || echo "⚠️  Port 3001 check (ss command may not show process)"

# 3. 测试本地访问
echo -e "\n>>> 3. Testing Localhost Endpoints:"
echo "--- Testing root /"
curl -s -o /dev/null -w "Status: %{http_code}\n" http://localhost:3001/ || echo "❌ Failed"

echo "--- Testing /dashboard"
curl -s -o /dev/null -w "Status: %{http_code}\n" http://localhost:3001/dashboard || echo "❌ Failed"

echo "--- Testing /api/health"
curl -s -o /dev/null -w "Status: %{http_code}\n" http://localhost:3001/api/health || echo "❌ Failed"

echo "--- Testing /api/dashboard/api/health"
curl -s -o /dev/null -w "Status: %{http_code}\n" http://localhost:3001/api/dashboard/api/health || echo "❌ Failed"

# 4. 检查 PM2 进程详细信息
echo -e "\n>>> 4. PM2 Process Info (autoark):"
pm2 info autoark

# 5. 检查最近的 PM2 错误日志（使用正确的进程名）
echo -e "\n>>> 5. Recent PM2 Error Logs (autoark):"
pm2 logs autoark --lines 50 --err --nostream

# 6. 检查 PM2 输出日志
echo -e "\n>>> 6. Recent PM2 Output Logs (autoark):"
pm2 logs autoark --lines 50 --out --nostream

# 7. 检查实际运行的代码路径
echo -e "\n>>> 7. PM2 Process Working Directory:"
pm2 describe autoark | grep -E "(script path|exec cwd|error log path|out log path)"

# 8. 检查代码目录结构
echo -e "\n>>> 8. Checking Code Directory:"
CODE_DIR="/root/autoark/autoark-backend"
if [ -d "$CODE_DIR" ]; then
    echo "✅ Code directory exists: $CODE_DIR"
    echo "--- Checking key files:"
    ls -la $CODE_DIR/src/routes/dashboard.routes.ts 2>/dev/null || echo "❌ dashboard.routes.ts not found"
    ls -la $CODE_DIR/src/app.ts 2>/dev/null || echo "❌ app.ts not found"
    ls -la $CODE_DIR/dist/ 2>/dev/null | head -n 5 || echo "⚠️  dist/ directory not found or empty"
else
    echo "❌ Code directory not found: $CODE_DIR"
fi

# 9. 检查日志目录（多个可能的位置）
echo -e "\n>>> 9. Checking Log Directories:"
for LOG_DIR in "/root/autoark/autoark-backend/logs" "/root/autoark/autoark-backend/src/logs" "/root/.pm2/logs"; do
    if [ -d "$LOG_DIR" ]; then
        echo "✅ Found: $LOG_DIR"
        ls -lt $LOG_DIR/*.log 2>/dev/null | head -n 3
    fi
done

# 10. 检查 Nginx 配置（如果使用）
echo -e "\n>>> 10. Checking Nginx Config (if exists):"
if command -v nginx &> /dev/null; then
    echo "Nginx is installed"
    nginx -t 2>&1 | head -n 5
    echo "--- Checking if nginx is running:"
    systemctl status nginx --no-pager -l | head -n 10
fi

echo -e "\n#################################################"
echo "                  End of Report                  "
echo "#################################################"
echo ""
echo "💡 To monitor logs in real-time, run:"
echo "   pm2 logs autoark --lines 100"

