#!/bin/bash
# Runs the job collector on this Mac and publishes the results to the `data` branch of
# job-hunt-data, the same thing the GitHub workflow does. A stand-in while GitHub Actions is
# unavailable; launchd starts it every 6 hours (see install.sh).
set -euo pipefail
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export LANG=en_US.UTF-8

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$HOME/Library/Caches/job-hunt-collector"
mkdir -p "$WORK"
echo "=== $(date) ==="

cd "$REPO"
git pull -q --ff-only origin main || echo "git pull failed; using the code already here"

if [ ! -f "$WORK/geo/cities1000.txt" ] || [ -n "$(find "$WORK/geo/cities1000.txt" -mtime +30)" ]; then
  mkdir -p "$WORK/geo"
  curl -sSfL -o "$WORK/geo/cities1000.zip" https://download.geonames.org/export/dump/cities1000.zip
  unzip -o -q "$WORK/geo/cities1000.zip" -d "$WORK/geo"
fi

rm -rf "$WORK/public"
node collector/collect.mjs --out "$WORK/public" --places "$WORK/geo/cities1000.txt"

# Publish: replace the data branch with this run's files.
ORIGIN="$(git remote get-url origin)"
cd "$WORK/public"
echo "Public job listings for the Job Hunt app, replaced every 6 hours. See v1/manifest.json." > README.md
git init -q -b data
git config user.name "job-hunt-collector"
git config user.email "actions@users.noreply.github.com"
git add -A
git commit -q -m "Jobs collected $(date -u +%Y-%m-%dT%H:%MZ) (Mac)"
git push -q --force "$ORIGIN" data
rm -rf .git
echo "Published."
