#!/usr/bin/env bash
# Merges the newest saved results of every collector part and publishes them to the `data` branch.
# Each part comes from this run if it has finished, otherwise from the last run that published,
# so a part that finishes early shows up in the app right away without dropping the others.
# Skips publishing when any part has no saved results at all.
#   collector/publish.sh <number of parts> [final]
# With "final", a part with no saved results anywhere is left out instead of stopping (the
# collector still refuses to publish fewer than 100,000 jobs).
# Needs GH_TOKEN, GITHUB_REPOSITORY and GITHUB_RUN_ID (set by GitHub Actions).
set -euo pipefail
PARTS="$1"
FINAL="${2:-}"
rm -rf raw rawnow rawprev public
mkdir -p raw

gh run download "$GITHUB_RUN_ID" -R "$GITHUB_REPOSITORY" -p 'raw-*' -D rawnow 2>/dev/null || true
PREV=$(gh run list -R "$GITHUB_REPOSITORY" -w collect.yml -s success -L 1 --json databaseId -q '.[0].databaseId' || true)
if [ -n "$PREV" ]; then gh run download "$PREV" -R "$GITHUB_REPOSITORY" -p 'raw-*' -D rawprev 2>/dev/null || true; fi

for i in $(seq 0 $((PARTS - 1))); do
  if [ -f "rawnow/raw-$i/raw-$i.json" ]; then
    cp "rawnow/raw-$i/raw-$i.json" raw/
    echo "Part $i: this run"
  elif [ -f "rawprev/raw-$i/raw-$i.json" ]; then
    cp "rawprev/raw-$i/raw-$i.json" raw/
    echo "Part $i: last published run ($PREV)"
  elif [ "$FINAL" = final ]; then
    echo "Part $i: no saved results; publishing without it"
  else
    echo "Part $i: no saved results yet; not publishing, so the app keeps the current jobs."
    exit 0
  fi
done

[ -f cities1000.txt ] || { curl -sSfL -o cities1000.zip https://download.geonames.org/export/dump/cities1000.zip && unzip -o -q cities1000.zip; }
node --max-old-space-size=6144 collector/collect.mjs --raw-in raw --out public --places cities1000.txt

cd public
echo "Public job listings for the Job Hunt app, replaced every 6 hours. See v1/manifest.json." > README.md
git init -q -b data
git config user.name "job-hunt-collector"
git config user.email "actions@users.noreply.github.com"
git add -A
git commit -q -m "Jobs collected $(date -u +%Y-%m-%dT%H:%MZ)"
for attempt in 1 2 3; do
  git push -q --force "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" data && exit 0
  sleep $((attempt * 10))
done
exit 1
