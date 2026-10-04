#!/bin/sh
set -eu
for url in http://localhost:3001/health http://localhost:3002/health http://localhost:3003/health; do
  curl --fail --silent --show-error "$url" >/dev/null
  echo "OK $url"
done
