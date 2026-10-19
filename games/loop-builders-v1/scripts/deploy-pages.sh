#!/usr/bin/env bash
# Build game lalu publikasikan isi dist/ ke branch gh-pages (GitHub Pages).
# Pemakaian: npm run deploy   (butuh remote "origin" ke GitHub; autentikasi via gh CLI bila ada)
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE_URL="$(git remote get-url origin)"
npm run build

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R dist/. "$TMP"
touch "$TMP/.nojekyll"

cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name || echo deploy)" \
    -c user.email="$(git -C "$OLDPWD" config user.email || echo deploy@localhost)" \
    commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if command -v gh >/dev/null 2>&1; then
  git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push -f "$REMOTE_URL" gh-pages
else
  git push -f "$REMOTE_URL" gh-pages
fi
echo "Selesai: branch gh-pages diperbarui."
