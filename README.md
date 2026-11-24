# Job Hunt data

Public job listings for the Job Hunt app. Every 6 hours a GitHub Action reads the public job lists
of tens of thousands of employers and publishes them by US state:

- `https://raw.githubusercontent.com/briane0717/job-hunt-data/data/v1/manifest.json`: when it last ran, with counts
- `https://raw.githubusercontent.com/briane0717/job-hunt-data/data/v1/us/{ST}.json`: jobs in each state
- `https://raw.githubusercontent.com/briane0717/job-hunt-data/data/v1/remote.json`: remote jobs open to US workers

Only public job information is collected. Nothing about app users is stored here.
See `collector/README.md` for sources and licenses. City coordinates: GeoNames (CC BY 4.0).
