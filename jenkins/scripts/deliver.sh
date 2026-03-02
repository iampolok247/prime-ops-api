#!/usr/bin/env sh
set -e  # Exit immediately if a command exits with a non-zero status

echo '� Deploying to production server...'
set -x

# SSH into production and deploy
ssh -o StrictHostKeyChecking=no root@31.97.228.226 << 'ENDSSH'
  cd /root/prime-ops-api
  echo '� Pulling latest code...'
  git pull origin main
  
  echo '📦 Installing dependencies...'
  npm install
  
  echo '🔄 Restarting PM2 process...'
  pm2 restart prime.server
  pm2 save
  
  echo '✅ Deployment completed!'
  pm2 ls
ENDSSH

set +x

echo '✅ The app is deployed and running at: http://31.97.228.226:5000'