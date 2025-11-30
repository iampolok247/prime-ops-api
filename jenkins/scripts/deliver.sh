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
pm2 save

# Give PM2 some time to spin up
sleep 2

# Save the process list for startup
set +x

pm2 ls

echo 'testing jenkins'
echo '✅ The app is running at: http://localhost:5001'