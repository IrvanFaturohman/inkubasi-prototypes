#!/usr/bin/env bash
# Build every game in games/ and gather them into site/ (one sub-folder per game) plus the hub page.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf site
mkdir -p site
cp index.html site/
touch site/.nojekyll

for dir in games/*/; do
  slug="$(basename "$dir")"
  echo "== $slug"
  (
    cd "$dir"
    if [ -f package-lock.json ]; then npm ci --no-audit --no-fund >/dev/null; else npm install --no-audit --no-fund >/dev/null; fi
    npm run build >/dev/null
  )
  cp -R "$dir/dist" "site/$slug"
done

# Single-file prototypes (original Claude artifacts) are copied as-is.
for dir in artifacts/*/; do
  slug="$(basename "$dir")"
  cp -R "$dir" "site/$slug"
done

echo "site/ ready: $(ls site | wc -l | tr -d ' ') entries"
