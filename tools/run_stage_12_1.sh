#!/usr/bin/env bash
set -euo pipefail

mkdir -p build
python3 tools/build_stage_12_1.py --project-root .
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

git add -A -- \
  README.md index.html styles.css \
  src/config.js src/data.js src/map.js src/app.js \
  tests/12.1-contract.mjs tests/12.1-smoke.mjs \
  tools/build_stage_12_1.py tools/run_stage_12_1.sh \
  data/mountains/mountain_points.geojson \
  data/mountains/mountain_icon_bindings.json \
  data/mountains/mountain_icon_catalog.json \
  data/mountains/mountain_icon_manifest.json \
  data/mountains/selection_report.json

if ! git diff --cached --quiet; then
  git config user.name github-actions[bot]
  git config user.email 41898282+github-actions[bot]@users.noreply.github.com
  git commit -m "Scale mountain artwork geographically"
  git push origin HEAD:12.1
fi

rm -rf build/package
mkdir -p build/package
rsync -a --exclude='.git' --exclude='build' --exclude='node_modules' --exclude='package-lock.json' ./ build/package/
(cd build/package && zip -qr ../alan-map-12.1-geographic-mountains.zip .)
find build/package -type f -printf '%P\t%s bytes\n' | sort > build/12.1-file-sizes.txt
