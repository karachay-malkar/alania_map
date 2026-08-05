#!/usr/bin/env bash
set -euo pipefail

mkdir -p build
python3 tools/build_stage_12_1.py
node tests/12.1-contract.mjs

npm install --no-save playwright@1.55.0
npx playwright install --with-deps chromium
python3 -m http.server 8000 > build/http-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
node tests/12.1-smoke.mjs
kill "$SERVER_PID" 2>/dev/null || true
trap - EXIT

rm -rf node_modules package-lock.json package.json

# Validation is read-only: generated files must already be committed in the candidate branch.
if ! git diff --quiet -- \
  data/mountains/mountain_icon_bindings.json \
  data/mountains/mountain_icon_catalog.json \
  data/mountains/selection_report.json \
  data/hydrography/river_mountain_report.json; then
  echo 'Generated stage data differs from the committed candidate.' >&2
  git diff -- \
    data/mountains/mountain_icon_bindings.json \
    data/mountains/mountain_icon_catalog.json \
    data/mountains/selection_report.json \
    data/hydrography/river_mountain_report.json >&2
  exit 1
fi

rm -rf build/package
mkdir -p build/package
rsync -a --exclude='.git' --exclude='.build' --exclude='build' --exclude='node_modules' --exclude='package-lock.json' ./ build/package/
(cd build/package && zip -qr ../alan-map-12.1-mountain-river-chains.zip .)
find build/package -type f -printf '%P\t%s bytes\n' | sort > build/12.1-file-sizes.txt
