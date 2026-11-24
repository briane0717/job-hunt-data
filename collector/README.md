# Job collector

Reads the public job lists of tens of thousands of employers (Greenhouse, Lever, Ashby and Workday
boards, plus Workable's public feed of all its customers' jobs) and writes compact files by US
state for the Job Hunt app. It runs every 6 hours on GitHub Actions in the public
`job-hunt-data` repository and publishes to the `data` branch.

- Run locally: `node collector/collect.mjs --limit 50 --out /tmp/jobs` (Node 22, no packages).
- Each run replaces all files, so jobs a company takes down disappear on the next run.
- Company lists: `companies/*.json`, from
  [Riley-Dorrington/job-board-aggregator](https://github.com/Riley-Dorrington/job-board-aggregator)
  (MIT, commit 135ed20, 2026-11-23). See `companies/LICENSE-job-board-aggregator`.
- Only public job information is collected. Nothing about app users is ever stored here.
