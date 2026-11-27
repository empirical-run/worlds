#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

upload() {
  local file=$1 type=application/octet-stream
  case $file in
    *.js) type=text/javascript ;;
    *.css) type=text/css ;;
    *.map | *.json) type=application/json ;;
    *.svg) type=image/svg+xml ;;
    *.woff2) type=font/woff2 ;;
  esac
  pnpm exec wrangler r2 object put "worlds-site-assets/${file#build/client/}" \
    --file "$file" --content-type "$type" --remote > /dev/null
}
export -f upload

find build/client/assets -type f -print0 | xargs -0 -P 8 -I{} bash -c 'upload "$1"' _ {}
