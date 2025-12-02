#!/bin/bash

echo "#################################################"
echo "     Server Diagnosis Script                    "
echo "#################################################"

cd /root/autoark/autoark-backend || exit 1

echo -e "\n>>> 1. Checking installed packages:"
echo "--- winston:"
if [ -d "node_modules/winston" ]; then
    echo "✅ winston installed"
    cat node_modules/winston/package.json | grep '"version"' | head -n 1
else
    echo "❌ winston NOT installed"
fi

echo "--- winston-daily-rotate-file:"
if [ -d "node_modules/winston-daily-rotate-file" ]; then
    echo "✅ winston-daily-rotate-file installed"
    cat node_modules/winston-daily-rotate-file/package.json | grep '"version"' | head -n 1
else
    echo "❌ winston-daily-rotate-file NOT installed"
fi

echo -e "\n>>> 2. Checking compiled logger.js:"
if [ -f "dist/utils/logger.js" ]; then
    echo "✅ logger.js exists"
    echo "--- First 10 lines:"
    head -n 10 dist/utils/logger.js
    echo "--- Checking for winston-daily-rotate-file import:"
    grep -n "winston-daily-rotate-file" dist/utils/logger.js || echo "❌ Not found in compiled code"
else
    echo "❌ logger.js NOT found"
fi

echo -e "\n>>> 3. Full error log (last 30 lines):"
pm2 logs autoark --err --lines 30 --nostream | tail -n 30

echo -e "\n>>> 4. Testing module resolution:"
cd /root/autoark/autoark-backend
node -e "try { require('winston'); console.log('✅ winston can be required'); } catch(e) { console.log('❌ winston error:', e.message); }"
node -e "try { require('winston-daily-rotate-file'); console.log('✅ winston-daily-rotate-file can be required'); } catch(e) { console.log('❌ winston-daily-rotate-file error:', e.message); }"

echo -e "\n>>> 5. Checking PM2 process:"
pm2 describe autoark | grep -E "(script path|exec cwd|status)"

echo -e "\n#################################################"
echo "                  End of Report                  "
echo "#################################################"

