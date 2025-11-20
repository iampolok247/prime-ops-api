# #!/usr/bin/env sh
# set -e  # Exit immediately if a command exits with a non-zero status

# # echo '📦 Building the NestJS application...'
# # set -x
# # npm run build
# # set +x

# echo '🚀 Starting the production server with PM2...'
# set -x

# # Restart the app using PM2 ecosystem config
# pm2 restart ecosystem.config.cjs

# # Give PM2 some time to spin up
# sleep 2

# # Save the process list for startup
# pm2 save
# set +x

# pm2 ls

# echo ''
# echo '✅ The app is running at: http://localhost:6565'


#!/usr/bin/env sh
set -e

echo '🚀 Starting the production server with PM2...'
set -x
pm2 restart ecosystem.config.cjs

# Wait and verify the application is actually running
sleep 3
if ! pm2 describe prime.server | grep -q "online"; then
  echo "❌ Application failed to start properly"
  pm2 logs prime.server --lines 50
  exit 1
fi

pm2 save
set +x

pm2 ls
echo ''
echo '✅ The app is running at: http://localhost:5000'