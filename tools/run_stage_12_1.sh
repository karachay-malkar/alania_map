#!/usr/bin/env bash
set -euo pipefail

mkdir -p build

if ! python3 - <<'PY'
import shapely
assert shapely.__version__ == '2.1.2'
PY
then
  python3 -m pip install --disable-pip-version-check --no-cache-dir shapely==2.1.2
fi

python3 tools/build_stage_12_1.py

GENERATED=(
  data/mountains/mountain_points.geojson
  data/mountains/mountain_icon_bindings.json
  data/mountains/mountain_icon_catalog.json
  data/mountains/mountain_icon_manifest.json
  data/mountains/mountain_render.geojson
  data/mountains/selection_report.json
  data/hydrography/rivers.geojson
  data/hydrography/river_source_report.json
  data/hydrography/river_mountain_report.json
  assets/app-12.1.5.js
  assets/maplibre-12.1.5.js
  assets/maplibre-12.1.5.css
  styles-12.1.5.css
  assets/mountains/mountain-atlas-12.1.5.png
  data/map-frame-12.1.5.geojson
  data/mountains/mountain-render-12.1.5.geojson
  data/mountains/mountain-icon-manifest-12.1.5.json
  data/hydrography/rivers-12.1.5.geojson
)
if ! git diff --quiet -- "${GENERATED[@]}"; then
  echo 'Generated 12.1.5 data differs from the committed candidate.' >&2
  git diff -- "${GENERATED[@]}" >&2
  exit 1
fi

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
rm -rf build/package
mkdir -p build/package
rsync -a --exclude='.git' --exclude='.build' --exclude='build' --exclude='node_modules' --exclude='package-lock.json' ./ build/package/
(cd build/package && zip -qr ../alan-map-12.1-mountain-river-chains.zip .)
find build/package -type f -printf '%P\t%s bytes\n' | sort > build/12.1-file-sizes.txt
