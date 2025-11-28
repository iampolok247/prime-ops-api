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
# pm2 save

# # Give PM2 some time to spin up
# sleep 2

# # Save the process list for startup
# set +x

# pm2 ls

# echo ''
# echo '✅ The app is running at: http://localhost:5000'


#!/usr/bin/env bash
set -e  # Exit on error
set -u  # Treat unset variables as errors

APP_NAME="primeops-api"
CONTAINER_NAME="${APP_NAME}_app_1"  # Default docker-compose container name
HEALTH_CHECK_URL="http://localhost:5000/health"

echo "🚀 Starting Docker deployment for ${APP_NAME}"

# Verify environment variables are set
required_vars=("MONGO_URI" "JWT_SECRET")
for var in "${required_vars[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "❌ Required environment variable $var is not set"
    exit 1
  fi
done

# Build new image
echo "📦 Building Docker image..."
docker-compose build --no-cache --parallel app

# Pull new image (if built elsewhere)
# docker-compose pull app

# Graceful deployment with zero downtime
echo "🔄 Performing zero-downtime deployment..."

# Start new container
docker-compose up -d --no-deps --force-recreate --quiet-pull app

# Wait for health check
echo "⏳ Waiting for new container to become healthy..."
timeout=60
while ! curl -f -s "${HEALTH_CHECK_URL}" > /dev/null 2>&1; do
  sleep 2
  timeout=$((timeout-2))
  if [ $timeout -le 0 ]; then
    echo "❌ Health check failed after 60 seconds"
    docker-compose logs app
    exit 1
  fi
done

# Verify container is running
if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME")" != "true" ]; then
  echo "❌ New container failed to start properly"
  docker-compose logs app
  exit 1
fi

echo "✅ New container is healthy"

# Clean up old containers/images
echo "🧹 Cleaning up old resources..."
docker-compose stop $(docker ps -aq --filter "name=${APP_NAME}" --filter "status=exited")
docker image prune -f

# Show status
docker-compose ps

echo ""
echo "✅ Deployment successful! App is running at: http://localhost:5000"
echo "📊 Container status: $(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME")"