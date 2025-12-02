#!/bin/bash
# 在服务器上执行这个命令来查看完整的错误信息
echo "=== 完整错误信息 ==="
pm2 logs autoark --err --nostream | grep -B 2 "MODULE_NOT_FOUND" | head -n 30
