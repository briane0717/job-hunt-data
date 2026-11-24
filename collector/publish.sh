#!/usr/bin/env bash
# Merges the newest saved results of every collector part and publishes them to the `data` branch.
# Each part comes from this run if it has finished, otherwise from the last run that published,
# so a part that finishes early shows up in the app right away without dropping the others.
# Skips publishing when any part has no saved results at all.
#   collector/publish.sh [final]      (parts are listed in collector/parts.txt)
# With "final", a part with no saved results anywhere is left out instead of stopping (the
# collector still refuses to publish fewer than 100,000 jobs).
# Needs GH_TOKEN, GITHUB_REPOSITORY and GITHUB_RUN_ID (set by GitHub Actions); SOURCE_RUN_ID picks another run.
set -euo pipefail
FINAL="${1:-}"
rm -rf raw rawnow rawprev public
mkdir -p raw

gh run download "${SOURCE_RUN_ID:-$GITHUB_RUN_ID}" -R "$GITHUB_REPOSITORY" -p 'raw-*' -D rawnow || echo "No finished parts in this run yet"
PREV=$(gh run list -R "$GITHUB_REPOSITORY" -w collect.yml -s success -L 1 --json databaseId -q '.[0].databaseId' || true)
if [ -n "$PREV" ]; then gh run download "$PREV" -R "$GITHUB_REPOSITORY" -p 'raw-*' -D rawprev || echo "No saved parts in run $PREV"; fi

while read -r part; do
  case "$part" in ''|'#'*) continue ;; esac
  n="raw-$(echo "$part" | tr ',@/' '---')"
  if [ -f "rawnow/$n/$n.json" ]; then
    cp "rawnow/$n/$n.json" raw/
    echo "$part: this run"
  elif [ -f "rawprev/$n/$n.json" ]; then
    cp "rawprev/$n/$n.json" raw/
    echo "$part: last published run ($PREV)"
  elif [ "$FINAL" = final ]; then
    echo "$part: no saved results; publishing without it"
  else
    echo "$part: no saved results yet; not publishing, so the app keeps the current jobs."
    exit 0
  fi
done < collector/parts.txt
# Results saved under older part names (before collector/parts.txt changed) still count;
# the collector drops repeated jobs when it merges.
for f in rawnow/*/*.json; do
  [ -f "$f" ] && [ ! -f "raw/$(basename "$f")" ] && cp "$f" raw/ && echo "$(basename "$f"): this run (older part name)" || true
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
