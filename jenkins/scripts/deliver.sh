#!/usr/bin/env sh
set -e  # Exit immediately if a command exits with a non-zero status

# echo '📦 Building the NestJS application...'
# set -x
# npm run build
# set +x

echo '🚀 Starting the production server with PM2...'
set -x

# Restart the app using PM2 ecosystem config
pm2 restart ecosystem.config.cjs

# Give PM2 some time to spin up
sleep 2

# Save the process list for startup
pm2 save
set +x

echo ''
echo '✅ The app is running at: http://localhost:6565'
