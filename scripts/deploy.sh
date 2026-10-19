#!/usr/bin/env bash
# Build the site and force-push it to the gh-pages branch (GitHub Pages serves that branch).
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/build-site.sh

remote="$(git remote get-url origin)"
cd site
git init -q
git checkout -q -b gh-pages
git add -A
git -c user.name="irvan" -c user.email="irvanfaturohman825@gmail.com" commit -q -m "Deploy"
git push -q -f "$remote" gh-pages
echo "Deployed to gh-pages."
