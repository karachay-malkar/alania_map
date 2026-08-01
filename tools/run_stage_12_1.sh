#!/usr/bin/env bash
set -euo pipefail

if [ -f tools/update_payload.part-000 ]; then
  cat tools/update_payload.part-000 \
      tools/update_payload.part-001 \
      tools/update_payload.part-002 \
      tools/update_payload.part-003 \
      tools/update_payload.part-004 \
    | tr -d '\n\r' | base64 --decode > /tmp/update_payload.tar.gz
  echo "01a5082c491938b30eb99fc10b22e9b502e15eb2e8850cba09b7650528beaacd  /tmp/update_payload.tar.gz" | sha256sum --check
  tar -xzf /tmp/update_payload.tar.gz
fi

# The transport package contains the first smoke-test revision. Keep the corrected
# test committed on the branch after extracting all other source files.
git checkout HEAD -- tests/12.1-smoke.mjs
chmod +x tools/build_stage_12_1.py

if [ ! -f assets/mountains/mountain-atlas.png ] || [ ! -f data/mountains/mountain_icon_manifest.json ]; then
  git fetch origin 10.0-mountain-base --depth=1
  git checkout FETCH_HEAD -- assets/mountains/mountain-atlas.png data/mountains/mountain_icon_manifest.json
fi

mkdir -p data/archive build
if [ ! -f data/archive/mountain_points_full.geojson ]; then
  node - <<'NODE'
const fs = require('fs');
const data = require('./src/data.js');
const boundary = data.normalizeBoundary(JSON.parse(fs.readFileSync('data/map-frame.geojson', 'utf8')));
const source = JSON.parse(fs.readFileSync('data/mountains/mountain_points.geojson', 'utf8'));
const normalized = data.normalizeMountainPoints(source, boundary);
if (normalized.collection.features.length !== 3797) {
  throw new Error(`Expected 3797 source points, got ${normalized.collection.features.length}`);
}
fs.writeFileSync('data/archive/mountain_points_full.geojson', JSON.stringify(normalized.collection));
NODE
fi

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

rm -f tools/update_payload.tar.gz \
  tools/update_payload.part-000 \
  tools/update_payload.part-001 \
  tools/update_payload.part-002 \
  tools/update_payload.part-003 \
  tools/update_payload.part-004

git add -A -- \
  README.md \
  index.html \
  src/config.js \
  src/data.js \
  src/map.js \
  tests/12.1-contract.mjs \
  tests/12.1-smoke.mjs \
  tools/build_stage_12_1.py \
  tools/update_payload.tar.gz \
  tools/update_payload.part-000 \
  tools/update_payload.part-001 \
  tools/update_payload.part-002 \
  tools/update_payload.part-003 \
  tools/update_payload.part-004 \
  assets/mountains/mountain-atlas.png \
  data/archive/mountain_points_full.geojson \
  data/mountains/mountain_points.geojson \
  data/mountains/mountain_icon_bindings.json \
  data/mountains/mountain_icon_catalog.json \
  data/mountains/mountain_icon_manifest.json \
  data/mountains/selection_report.json

if ! git diff --cached --quiet; then
  git config user.name github-actions[bot]
  git config user.email 41898282+github-actions[bot]@users.noreply.github.com
  git commit -m "Reduce mountain points to 1000 and bind project icons"
  git push origin HEAD:12.1
fi

mkdir -p build/package
rsync -a --exclude='.git' --exclude='build' --exclude='node_modules' --exclude='package-lock.json' ./ build/package/
(cd build/package && zip -r ../alan-map-12.1-1000-points-icons.zip .)
find build/package -type f -printf '%P\t%s bytes\n' | sort > build/12.1-file-sizes.txt
