#!/bin/bash
# 在服务器上执行：诊断端口冲突和路由问题

cd /root/autoark/autoark-backend

echo "=== 1. 检查所有监听 3001 端口的进程 ==="
echo "使用 ss 命令:"
ss -tlnp | grep 3001

echo -e "\n使用 netstat 命令（如果可用）:"
netstat -tlnp 2>/dev/null | grep 3001 || echo "netstat 不可用"

echo -e "\n=== 2. 检查 PM2 进程 ==="
pm2 list

echo -e "\n=== 3. 检查 PM2 进程的详细信息 ==="
pm2 describe autoark | grep -E "script|pid|status"

echo -e "\n=== 4. 检查进程 PID ==="
PM2_PID=$(pm2 jlist | grep -A 5 '"name":"autoark"' | grep '"pid"' | head -1 | cut -d: -f2 | tr -d ' ,"')
if [ -n "$PM2_PID" ]; then
  echo "PM2 进程 PID: $PM2_PID"
  echo "进程命令行:"
  ps -p $PM2_PID -o cmd --no-headers 2>/dev/null || echo "进程不存在"
  
  echo -e "\n进程监听的端口:"
  ss -tlnp | grep "pid=$PM2_PID" || lsof -p $PM2_PID 2>/dev/null | grep LISTEN || echo "无法获取端口信息"
else
  echo "无法获取 PM2 进程 PID"
fi

echo -e "\n=== 5. 测试不同方式访问 ==="
echo "测试 localhost:3001:"
curl -s -o /dev/null -w "HTTP: %{http_code}\n" http://localhost:3001/dashboard

echo -e "\n测试 127.0.0.1:3001:"
curl -s -o /dev/null -w "HTTP: %{http_code}\n" http://127.0.0.1:3001/dashboard

echo -e "\n测试 [::1]:3001 (IPv6):"
curl -s -o /dev/null -w "HTTP: %{http_code}\n" http://[::1]:3001/dashboard 2>/dev/null || echo "IPv6 不可用"

echo -e "\n=== 6. 检查最近的 PM2 日志（看是否有请求记录） ==="
echo "查找包含 'GET /dashboard' 的日志:"
pm2 logs autoark --out --lines 100 --nostream | grep -i "GET /dashboard" | tail -n 5

echo -e "\n所有 GET 请求:"
pm2 logs autoark --out --lines 100 --nostream | grep -E "\[GET" | tail -n 10

echo -e "\n=== 7. 直接连接到进程并测试 ==="
echo "使用 telnet 测试连接（如果可用）:"
timeout 2 bash -c "echo 'GET /dashboard HTTP/1.1\nHost: localhost\n\n' | nc localhost 3001" 2>/dev/null | head -n 10 || echo "nc 不可用或连接失败"

echo -e "\n=== 8. 检查是否有多个 Node 进程 ==="
echo "所有 Node 进程:"
ps aux | grep node | grep -v grep

echo -e "\n=== 9. 检查编译后的代码是否最新 ==="
echo "编译文件时间:"
ls -lh dist/app.js dist/server.js | awk '{print $6, $7, $8, $9}'

echo -e "\n源代码时间:"
ls -lh src/app.ts | awk '{print $6, $7, $8, $9}'

echo -e "\n=== 10. 强制重启并测试 ==="
echo "停止 PM2:"
pm2 stop autoark
sleep 2

echo -e "\n删除 PM2 进程:"
pm2 delete autoark 2>/dev/null || true

echo -e "\n重新启动:"
pm2 start ecosystem.config.js

echo -e "\n等待 5 秒..."
sleep 5

echo -e "\n测试路由:"
curl -s -o /dev/null -w "HTTP: %{http_code}\n" http://localhost:3001/dashboard

if [ $? -eq 0 ]; then
  echo "✅ curl 测试成功"
  echo "响应内容:"
  curl -s http://localhost:3001/dashboard | head -n 20
else
  echo "❌ curl 测试失败"
fi

