#!/bin/bash
# 在服务器上执行这个脚本来修复模块解析问题

cd /root/autoark/autoark-backend

echo "=== 1. 测试直接运行 Node 是否能找到模块 ==="
node -e "
process.chdir('/root/autoark/autoark-backend');
try {
  require('winston-daily-rotate-file');
  console.log('✅ winston-daily-rotate-file can be required');
} catch(e) {
  console.log('❌ ERROR:', e.message);
  console.log('Module path:', require.resolve.paths('winston-daily-rotate-file'));
}
"

echo -e "\n=== 2. 检查 PM2 进程的工作目录 ==="
pm2 describe autoark | grep -E "(exec cwd|script path)"

echo -e "\n=== 3. 检查 node_modules 路径 ==="
ls -la node_modules/winston-daily-rotate-file/package.json

echo -e "\n=== 4. 测试从 dist 目录运行 ==="
cd dist
node -e "
process.chdir('/root/autoark/autoark-backend');
try {
  require('winston-daily-rotate-file');
  console.log('✅ winston-daily-rotate-file can be required from dist');
} catch(e) {
  console.log('❌ ERROR from dist:', e.message);
}
"

echo -e "\n=== 5. 重新启动 PM2（使用正确的工作目录）==="
cd /root/autoark/autoark-backend
pm2 delete autoark
pm2 start dist/server.js --name autoark --cwd /root/autoark/autoark-backend
pm2 save

echo -e "\n=== 6. 等待并检查 ==="
sleep 5
pm2 logs autoark --err --lines 10 --nostream
