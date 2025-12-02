#!/bin/bash

echo "#################################################"
echo "     AutoArk Dependency Fix Script              "
echo "#################################################"

cd /root/autoark/autoark-backend || exit 1

echo -e "\n>>> 1. Checking if winston is installed:"
if [ -d "node_modules/winston" ]; then
    echo "✅ winston found"
    ls -la node_modules/winston/package.json | head -n 1
else
    echo "❌ winston NOT found"
fi

echo -e "\n>>> 2. Checking if winston-daily-rotate-file is installed:"
if [ -d "node_modules/winston-daily-rotate-file" ]; then
    echo "✅ winston-daily-rotate-file found"
    ls -la node_modules/winston-daily-rotate-file/package.json | head -n 1
else
    echo "❌ winston-daily-rotate-file NOT found"
fi

echo -e "\n>>> 3. Checking package.json:"
grep -E "(winston|winston-daily)" package.json

echo -e "\n>>> 4. Reinstalling dependencies:"
npm install --force

echo -e "\n>>> 5. Verifying installation:"
if [ -d "node_modules/winston" ] && [ -d "node_modules/winston-daily-rotate-file" ]; then
    echo "✅ Both packages are now installed"
else
    echo "❌ Still missing packages"
    exit 1
fi

echo -e "\n>>> 6. Cleaning dist directory:"
rm -rf dist

echo -e "\n>>> 7. Rebuilding:"
npm run build

echo -e "\n>>> 8. Restarting PM2:"
pm2 restart autoark

echo -e "\n>>> 9. Waiting 3 seconds for startup..."
sleep 3

echo -e "\n>>> 10. Testing routes:"
echo "--- Testing /dashboard"
curl -s -o /dev/null -w "Status: %{http_code}\n" http://localhost:3001/dashboard

echo "--- Testing /api/dashboard/api/health"
curl -s -o /dev/null -w "Status: %{http_code}\n" http://localhost:3001/api/dashboard/api/health

echo -e "\n>>> 11. Checking for errors:"
pm2 logs autoark --err --lines 5 --nostream

echo -e "\n#################################################"
echo "                  Fix Complete                   "
echo "#################################################"

