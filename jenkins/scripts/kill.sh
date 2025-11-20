#!/usr/bin/env sh

echo 'Killing the Vite dev server (npm run dev)...'
set -x
kill $(cat .pidfile)
set +x
