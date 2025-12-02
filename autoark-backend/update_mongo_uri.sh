#!/bin/bash
# 在服务器上执行：更新 MONGO_URI 并重启服务

cd /root/autoark/autoark-backend

# 新的 MONGO_URI
NEW_MONGO_URI="mongodb+srv://autoark:kt2pWZZwadjJhXNZ@cluster0.wudbhtl.mongodb.net/?appName=Cluster0"

echo "=== 更新 MONGO_URI ==="

# 1. 备份现有的 .env 文件
if [ -f ".env" ]; then
  echo "✅ 备份现有的 .env 文件..."
  cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
  echo "✅ 备份完成"
else
  echo "⚠️  .env 文件不存在，将创建新文件"
fi

# 2. 更新或添加 MONGO_URI
if [ -f ".env" ]; then
  # 如果 MONGO_URI 已存在，替换它
  if grep -q "^MONGO_URI=" .env; then
    echo "✅ 找到现有的 MONGO_URI，正在更新..."
    # 使用 sed 替换（兼容不同格式）
    sed -i "s|^MONGO_URI=.*|MONGO_URI=${NEW_MONGO_URI}|" .env
    echo "✅ MONGO_URI 已更新"
  else
    # 如果不存在，添加到文件末尾
    echo "✅ MONGO_URI 不存在，正在添加..."
    echo "" >> .env
    echo "MONGO_URI=${NEW_MONGO_URI}" >> .env
    echo "✅ MONGO_URI 已添加"
  fi
else
  # 创建新的 .env 文件
  echo "✅ 创建新的 .env 文件..."
  cat > .env << EOF
MONGO_URI=${NEW_MONGO_URI}
PORT=3001
NODE_ENV=production
EOF
  echo "✅ .env 文件已创建"
fi

# 3. 验证更新
echo -e "\n=== 验证更新 ==="
if grep -q "^MONGO_URI=${NEW_MONGO_URI}$" .env || grep -q "^MONGO_URI=${NEW_MONGO_URI}" .env; then
  echo "✅ MONGO_URI 更新成功"
  echo "当前 MONGO_URI:"
  grep "^MONGO_URI=" .env | sed 's/MONGO_URI=.*@/MONGO_URI=***@/' # 隐藏密码部分
else
  echo "❌ MONGO_URI 更新失败，请手动检查"
  exit 1
fi

# 4. 重启 PM2 服务
echo -e "\n=== 重启 PM2 服务 ==="
pm2 restart autoark

# 5. 等待服务启动
echo "等待服务启动（5秒）..."
sleep 5

# 6. 检查服务状态
echo -e "\n=== 检查服务状态 ==="
pm2 status autoark

# 7. 检查 MongoDB 连接
echo -e "\n=== 检查 MongoDB 连接 ==="
echo "等待 3 秒后检查连接日志..."
sleep 3
pm2 logs autoark --out --lines 20 --nostream | grep -i "mongo\|connected\|error" | tail -n 10

echo -e "\n=== 完成 ==="
echo "如果看到 'MongoDB Connected' 消息，说明连接成功！"
echo "如果看到错误，请检查 MONGO_URI 是否正确"

