// Step 9: test the job lists found in step 8, and look closer at Walmart, Best Buy, FedEx and Amazon.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
const run = promisify(execFile);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
async function curl(args) {
  try {
    const { stdout } = await run('curl', ['-sSL', '--compressed', '--max-time', '30', '-A', UA, '-w', '\n%{http_code}', ...args], { maxBuffer: 80e6 });
    const cut = stdout.lastIndexOf('\n');
    return { status: Number(stdout.slice(cut + 1)), body: stdout.slice(0, cut) };
  } catch (e) { return { status: 0, body: String(e.message).slice(0, 100) }; }
}
const J = (r) => { try { return JSON.parse(r.body); } catch { return null; } };
const out = { phenom: {}, radancy: {}, workday: {}, eightfold: {}, amazon: {}, pages: {}, names: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Phenom: find refNum on the home page, then ask the widgets search for a total.
for (const [name, home] of [['UPS', 'https://www.jobs-ups.com/us/en'], ['Wawa', 'https://careers.wawa.com/us/en'], ['Panera', 'https://careers.panerabread.com/global/en'], ['RBI', 'https://careers.rbi.com/global/en'], ['Disney', 'https://join.disneycareers.com/global/en'], ['DHL', 'https://careers.dhl.com/amer/en'], ['Best Buy', 'https://jobs.bestbuy.com/bby']]) {
  const h = await curl([home]);
  const ref = (h.body.match(/"refNum"\s*:\s*"([A-Z0-9]+)"/) || [])[1];
  const host = new URL(home).host;
  const path = new URL(home).pathname.replace(/^\/|\/$/g, '');
  let total = null, sample = [];
  if (ref) {
    const body = JSON.stringify({ lang: 'en_us', deviceType: 'desktop', country: 'us', pageName: 'search-results', ddoKey: 'refineSearch', sortBy: '', subsearch: '', from: 0, jobs: true, counts: true, all_fields: ['country'], size: 10, clearAll: false, jdsource: 'facets', isSliderEnable: false, pageId: 'page20', siteType: 'external', keywords: '', global: true, selected_fields: {}, locationData: {}, refNum: ref });
    const r = await curl(['-X', 'POST', '-H', 'Content-Type: application/json', '--data-raw', body, `https://${host}/widgets`]);
    const d = J(r);
    total = d?.refineSearch?.totalHits ?? `HTTP ${r.status} ${r.body.slice(0, 80)}`;
    sample = (d?.refineSearch?.data?.jobs || []).slice(0, 3).map((j) => `${j.title} @ ${j.city}, ${j.state}, ${j.country}`);
    out.phenom[name] = { host, path, ref, total, sample, countries: JSON.stringify(d?.refineSearch?.aggregations || '').slice(0, 600) };
  } else out.phenom[name] = { host, status: h.status, noRef: true, snippet: (h.body.match(/.{0,200}(api|search)[^"]{0,80}json.{0,100}/i) || [''])[0] };
}
for (const host of ['careers.aldi.us', 'careers.7-eleven.com', 'jobs.spectrum.com', 'jobs.aus.com', 'jobs.sixflags.com', 'jobs.comcast.com', 'www.kaiserpermanentejobs.org', 'jobs.walgreens.com']) {
  const r = await curl(['-H', 'X-Requested-With: XMLHttpRequest', `https://${host}/search-jobs/results?ActiveFacetID=0&CurrentPage=1&RecordsPerPage=100&Distance=50&RadiusUnitType=0&Keywords=&Location=&ShowRadius=False&IsPagination=False&FacetTerm=&FacetType=0&SearchResultsModuleName=Search+Results&SearchFiltersModuleName=Search+Filters&SortCriteria=0&SortDirection=0&SearchType=5&ResultsType=0`]);
  const h = J(r)?.results || '';
  out.radancy[host] = h ? { pages: (h.match(/data-total-pages="(\d+)"/) || [])[1], total: (h.match(/data-total-results="(\d+)"/) || [])[1], ids: (h.match(/data-job-id="\d+"/g) || []).length, locs: [...h.matchAll(/job-location[^>]*>([^<]+)</g)].slice(0, 4).map((m) => m[1].trim()) } : `HTTP ${r.status}`;
}
for (const e of ['cinemark|wd1|cinemark', 'choicehotels|wd5|HotelExternal', 'tmobile|wd1|External', 'comcast|wd115|Comcast_Careers', 'hcmportal|wd5|Search']) {
  const [co, wd, site] = e.split('|');
  const base = `https://${co}.${wd}.myworkdayjobs.com`;
  const r = await curl(['-X', 'POST', '-H', 'Content-Type: application/json', '-H', 'Accept: application/json', '--data-raw', JSON.stringify({ appliedFacets: {}, limit: 5, offset: 0, searchText: '' }), `${base}/wday/cxs/${co}/${site}/jobs`]);
  const d = J(r);
  out.workday[e] = d ? { total: d.total, sample: (d.jobPostings || []).map((j) => `${j.title} @ ${j.locationsText}`), facets: (d.facets || []).map((f) => `${f.facetParameter}:${(f.values || []).length}`) } : `HTTP ${r.status}`;
  if (d && co === 'hcmportal') {
    const loc = (d.facets || []).find((f) => /location/i.test(f.facetParameter));
    out.workday.upsLocFacets = JSON.stringify(d.facets).slice(0, 3000);
  }
}
// Starbucks: page size and a US filter.
for (const q of ['&num=100', '&location=United%20States', '&location=United%20States&num=50']) {
  const r = await curl([`https://apply.starbucks.com/api/pcsx/search?domain=starbucks.com&query=${q}&start=0&sort_by=timestamp`]);
  const d = J(r);
  out.eightfold[q] = d ? { count: d.data?.count, n: (d.data?.positions || []).length, loc: (d.data?.positions || []).slice(0, 3).map((j) => (j.standardizedLocations || j.locations || [])[0]) } : `HTTP ${r.status}`;
  await sleep(4000);
}
// Amazon: can a state filter get past the 10,000 limit?
for (const q of ['country=USA', 'country=USA&normalized_state_name[]=Texas', 'normalized_location[]=Texas, United States', 'country=USA&state[]=TX']) {
  const r = await curl([`https://www.amazon.jobs/en/search.json?${encodeURI(q)}&result_limit=1`]);
  out.amazon[q] = J(r)?.hits ?? `HTTP ${r.status}`;
}
{ const r = await curl(['https://www.amazon.jobs/en/search.json?country=USA&result_limit=1']); out.amazon.facetKeys = Object.keys(J(r) || {}).join(','); out.amazon.facets = JSON.stringify(J(r)?.facets || {}).slice(0, 800); }
// Walmart, Best Buy, FedEx, Publix, Ross, Hyatt, Taco Bell, Domino's, Wendy's, McHire: endpoints named in their pages.
for (const [name, url] of [['Walmart', 'https://careers.walmart.com/results?q=cashier'], ['WalmartHome', 'https://careers.walmart.com/us/en/home'], ['Best Buy', 'https://jobs.bestbuy.com/bby/jobs'], ['FedEx', 'https://careers.fedex.com/jobs'], ['Publix', 'https://jobs.publix.com/'], ['Ross', 'https://jobs.rossstores.com/'], ['Hyatt', 'https://careers.hyatt.com/'], ['Taco Bell', 'https://jobs.tacobell.com/'], ["Domino's", 'https://jobs.dominos.com/us/'], ["Wendy's", 'https://wendys-careers.com/'], ['McHire', 'https://jobs.mchire.com/'], ['Pizza Hut', 'https://jobs.pizzahut.com/']]) {
  const r = await curl([url]);
  const urls = [...new Set([...r.body.matchAll(/["'(](https?:\/\/[^"'()\s]*(?:api|search|jobs|graphql)[^"'()\s]*|\/[a-z0-9_\-\/]*(?:api|graphql)[a-z0-9_\-\/.?=&]*)["')]/gi)].map((m) => m[1]))].filter((u) => !/\.(png|jpg|svg|css|woff2?)(\?|$)/.test(u)).slice(0, 40);
  const next = (r.body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]{0,1500})/) || [])[1];
  out.pages[name] = { status: r.status, len: r.body.length, urls, next, title: (r.body.match(/<title>([^<]*)/) || [])[1] };
}
// Names: what Lever, Ashby and Workday pages say the company is called.
for (const s of ['swa', 'gehc', 'usc', 'tamus', 'nyuhs', 'tsmg', 'cgsfederal', 'mydpr', 'ghj', 'gfs']) {
  const res = {};
  for (const [k, u] of [['lever', `https://jobs.lever.co/${s}`], ['ashby', `https://jobs.ashbyhq.com/${s}`]]) {
    const r = await curl([u]);
    res[k] = `${r.status} ${(r.body.match(/<title>([^<]*)/) || [])[1] || ''} | og:${(r.body.match(/og:site_name" content="([^"]*)/) || r.body.match(/og:title" content="([^"]*)/) || [])[1] || ''}`;
  }
  out.names[s] = res;
}
// Workday tenant names: the site's own page title and a job's hiring organization.
const wdNames = (await import('node:fs')).readFileSync('collector/companies/workday_companies.json', 'utf8');
const wdList = JSON.parse(wdNames);
for (const co of ['gehc', 'usc', 'tamus', 'nyuhs', 'tsmg', 'albanymed', 'swbc', 'gfs']) {
  const e = wdList.find((x) => x.split('|')[0] === co);
  if (!e) { out.names['wd:' + co] = 'not in list'; continue; }
  const [, wd, site] = e.split('|');
  const base = `https://${co}.${wd}.myworkdayjobs.com`;
  const r = await curl(['-X', 'POST', '-H', 'Content-Type: application/json', '-H', 'Accept: application/json', '--data-raw', JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' }), `${base}/wday/cxs/${co}/${site}/jobs`]);
  const p = J(r)?.jobPostings?.[0]?.externalPath;
  let org = '';
  if (p) { const d = J(await curl(['-H', 'Accept: application/json', `${base}/wday/cxs/${co}/${site}${p}`])); org = JSON.stringify(d?.hiringOrganization || d?.jobPostingInfo?.company || '').slice(0, 200); }
  const page = await curl([`${base}/${site}`]);
  out.names['wd:' + co] = { e, org, title: (page.body.match(/<title>([^<]*)/) || [])[1], ogsite: (page.body.match(/og:(?:site_name|title)" content="([^"]*)/) || [])[1] };
}
writeFileSync('probe/out/hourly2.json', JSON.stringify(out, null, 1));
