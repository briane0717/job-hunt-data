// Step 8: find public job lists for big hourly employers still missing (Walmart, UPS, FedEx, Starbucks, …).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
const run = promisify(execFile);
mkdirSync('probe/out', { recursive: true });
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
async function curl(args) {
  try {
    const { stdout } = await run('curl', ['-sSL', '--compressed', '--max-time', '25', '-A', UA, '-w', '\n%{http_code} %{url_effective}', ...args], { maxBuffer: 80e6 });
    const cut = stdout.lastIndexOf('\n');
    const [st, eff] = stdout.slice(cut + 1).split(' ');
    return { status: Number(st), eff, body: stdout.slice(0, cut) };
  } catch (e) { return { status: 0, body: String(e.message).slice(0, 100) }; }
}
const out = { sites: {}, workday: {}, jibe: {}, eightfold: {}, radancy: {}, other: {} };
const SITES = {
  Walmart: ['https://careers.walmart.com/', 'https://careers.walmart.com/results?q=cashier'],
  "Sam's Club": ['https://careers.samsclub.com/'],
  UPS: ['https://www.jobs-ups.com/', 'https://www.jobs-ups.com/us/en/search-results'],
  FedEx: ['https://careers.fedex.com/', 'https://careers.fedex.com/jobs', 'https://careers.fedex.com/ground'],
  Starbucks: ['https://careers.starbucks.com/', 'https://apply.starbucks.com/careers'],
  "McDonald's": ['https://careers.mcdonalds.com/', 'https://jobs.mchire.com/'],
  Walgreens: ['https://jobs.walgreens.com/'],
  Publix: ['https://jobs.publix.com/', 'https://corporate.publix.com/careers'],
  'Best Buy': ['https://jobs.bestbuy.com/'],
  Hyatt: ['https://careers.hyatt.com/'],
  IHG: ['https://careers.ihg.com/'],
  Aldi: ['https://careers.aldi.us/'],
  '7-Eleven': ['https://careers.7-eleven.com/'],
  Wawa: ['https://jobs.wawa.com/', 'https://www.wawa.com/careers'],
  Sheetz: ['https://jobs.sheetz.com/'],
  'Circle K': ['https://careers.circlek.com/'],
  "Casey's": ['https://www.caseys.com/careers'],
  Ross: ['https://jobs.rossstores.com/'],
  'Taco Bell': ['https://jobs.tacobell.com/'],
  'Pizza Hut': ['https://jobs.pizzahut.com/'],
  "Domino's": ['https://jobs.dominos.com/'],
  Darden: ['https://www.darden.com/careers', 'https://jobs.olivegarden.com/'],
  Panera: ['https://www.panerabread.com/en-us/careers.html', 'https://careers.panerabread.com/'],
  "Wendy's": ['https://wendys-careers.com/'],
  'Burger King': ['https://careers.rbi.com/'],
  Dunkin: ['https://careers.dunkindonuts.com/', 'https://careers.inspirebrands.com/'],
  Disney: ['https://jobs.disneycareers.com/'],
  AMC: ['https://careers.amctheatres.com/'],
  Cinemark: ['https://careers.cinemark.com/'],
  'Six Flags': ['https://careers.sixflags.com/'],
  'Bath & Body Works': ['https://careers.bathandbodyworks.com/'],
  "Victoria's Secret": ['https://careers.victoriassecret.com/'],
  'American Eagle': ['https://jobs.ae.com/'],
  GameStop: ['https://careers.gamestop.com/'],
  'Foot Locker': ['https://jobs.footlocker.com/'],
  'Hobby Lobby': ['https://careers.hobbylobby.com/'],
  'Big Lots': ['https://jobs.biglots.com/'],
  'Office Depot': ['https://careers.odpcorp.com/'],
  DHL: ['https://careers.dhl.com/global/en', 'https://careers.dhl.com/us/en'],
  'Allied Universal': ['https://jobs.aus.com/'],
  Securitas: ['https://jobs.securitasinc.com/'],
  Aramark: ['https://careers.aramark.com/'],
  Sodexo: ['https://us.jobs.sodexo.com/'],
  'Compass Group': ['https://www.compassgroupcareers.com/'],
  'Whole Foods': ['https://careers.wholefoodsmarket.com/'],
  "Trader Joe's": ['https://www.traderjoes.com/home/careers'],
  Safeway: ['https://www.albertsonscompanies.com/careers/'],
  'Food Lion': ['https://careers.foodlion.com/'],
  'Stop & Shop': ['https://careers.stopandshop.com/'],
  'Rite Aid': ['https://careers.riteaid.com/'],
  'Dollar General': ['https://careers.dollargeneral.com/'],
  Lyft: ['https://www.lyft.com/careers'],
  Marriott: ['https://careers.marriott.com/'],
  'Hilton': ['https://jobs.hilton.com/'],
  Wyndham: ['https://careers.wyndhamhotels.com/'],
  'Choice Hotels': ['https://careers.choicehotels.com/'],
  'Spectrum': ['https://jobs.spectrum.com/'],
  'T-Mobile': ['https://careers.t-mobile.com/'],
  'Comcast': ['https://jobs.comcast.com/'],
  'HCA Healthcare': ['https://careers.hcahealthcare.com/'],
  'Kaiser Permanente': ['https://www.kaiserpermanentejobs.org/'],
  'Uline': ['https://www.uline.jobs/'],
};
const MARKERS = { workday: /([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/, icims: /([a-z0-9-]+)\.icims\.com/, taleo: /([a-z0-9-]+)\.taleo\.net/, successfactors: /successfactors|jobs\.sap\.com|rmkcdn/, eightfold: /eightfold\.ai|([a-z0-9-]+)\.eightfold/, phenom: /phenompeople|cdn\.phenompeople|"refNum":"([A-Z0-9]+)"/, radancy: /tbcdn\.talentbrew|talentbrew|radancy/, oracle: /([a-z0-9]+\.fa\.[a-z0-9]+\.oraclecloud\.com)/, avature: /([a-z0-9-]+\.avature\.net)/, brassring: /brassring/, jibe: /jibeapply|jibecdn|\/api\/jobs/, paradox: /paradox\.ai/i, greenhouse: /greenhouse\.io/, lever: /lever\.co/, smartrecruiters: /smartrecruiters/, ukg: /ultipro|ukg\.net|recruiting\.ultipro/, adp: /workforcenow\.adp|recruiting\.adp/, cornerstone: /csod\.com/, jobvite: /jobvite/ };
for (const [name, urls] of Object.entries(SITES)) {
  out.sites[name] = [];
  for (const url of urls) {
    const r = await curl([url]);
    const found = Object.entries(MARKERS).filter(([, re]) => re.test(r.body)).map(([k, re]) => { const m = r.body.match(re); return m[1] ? `${k}(${m.slice(1).filter(Boolean).join('|')})` : k; });
    out.sites[name].push(`${r.status} ${url} -> ${r.eff} len=${r.body.length} ${found.join(', ')}`);
  }
}
const WD = ['walmart|wd5|WalmartExternal', 'walmart|wd5|WalmartExternalHourly', 'hcmportal|wd5|Search', 'fedex|wd1|FXE-US_External', 'fedex|wd1|FDX_Ground', 'fedex|wd1|FedEx_Careers', 'starbucks|wd1|StarbucksExternal', 'publix|wd1|External', 'bestbuy|wd5|BestBuy', 'bestbuy|wd5|External', 'rossstores|wd5|Ross_External', 'mcdonalds|wd5|External', 'walgreens|wd1|External', 'ihg|wd1|External', 'hyatt|wd5|External', 'bathandbodyworks|wd1|BBW', 'circlek|wd3|CircleK', 'sheetz|wd1|Sheetz', 'wawa|wd1|Wawa_Careers', 'darden|wd1|External', 'dhl|wd3|DHL'];
for (const e of WD) {
  const [co, wd, site] = e.split('|');
  const base = `https://${co}.${wd}.myworkdayjobs.com`;
  const r = await curl(['-X', 'POST', '-H', 'Content-Type: application/json', '-H', 'Accept: application/json', '--data-raw', JSON.stringify({ appliedFacets: {}, limit: 3, offset: 0, searchText: '' }), `${base}/wday/cxs/${co}/${site}/jobs`]);
  let v; try { const d = JSON.parse(r.body); v = { total: d.total, sample: (d.jobPostings || []).map((j) => `${j.title} @ ${j.locationsText}`), facets: (d.facets || []).map((f) => f.facetParameter) }; } catch { v = `HTTP ${r.status}`; }
  out.workday[e] = v;
}
// UPS sample of locations from its Workday board, to see why so few land on the map.
{
  const base = 'https://hcmportal.wd5.myworkdayjobs.com';
  const r = await curl(['-X', 'POST', '-H', 'Content-Type: application/json', '-H', 'Accept: application/json', '--data-raw', JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }), `${base}/wday/cxs/hcmportal/Search/jobs`]);
  out.other.upsWorkday = r.body.slice(0, 6000);
}
for (const host of ['careers.fedex.com', 'careers.walmart.com', 'jobs.bestbuy.com', 'jobs.publix.com', 'careers.starbucks.com', 'jobs.wawa.com', 'jobs.dominos.com', 'careers.mcdonalds.com', 'jobs.sheetz.com', 'careers.7-eleven.com', 'careers.circlek.com', 'jobs.rossstores.com', 'careers.gamestop.com', 'careers.amctheatres.com', 'jobs.aus.com', 'careers.aramark.com', 'jobs.footlocker.com', 'careers.hyatt.com', 'jobs.walgreens.com', 'jobs.spectrum.com', 'careers.t-mobile.com', 'jobs.comcast.com']) {
  const r = await curl([`https://${host}/api/jobs?page=1&limit=2`]);
  let v; try { const d = JSON.parse(r.body); v = { total: d.totalCount ?? d.count, sample: (d.jobs || []).map((j) => JSON.stringify(j.data || j).slice(0, 300)) }; } catch { v = `HTTP ${r.status} ${r.body.slice(0, 80)}`; }
  out.jibe[host] = v;
}
for (const [host, domain] of [['starbucks.eightfold.ai', 'starbucks.com'], ['apply.starbucks.com', 'starbucks.com'], ['walmart.eightfold.ai', 'walmart.com'], ['bestbuy.eightfold.ai', 'bestbuy.com'], ['fedex.eightfold.ai', 'fedex.com'], ['ups.eightfold.ai', 'ups.com']]) {
  const r = await curl([`https://${host}/api/pcsx/search?domain=${domain}&query=&location=&start=0`]);
  let v; try { const d = JSON.parse(r.body); v = { count: d.data?.count, sample: (d.data?.positions || []).slice(0, 2).map((j) => `${j.name} @ ${(j.locations || [])[0]}`) }; } catch { v = `HTTP ${r.status} ${r.body.slice(0, 80)}`; }
  out.eightfold[host] = v;
  await new Promise((r) => setTimeout(r, 3000));
}
for (const host of ['www.jobs-ups.com', 'jobs.walgreens.com', 'jobs.disneycareers.com', 'careers.fedex.com', 'jobs.bestbuy.com', 'jobs.publix.com', 'careers.starbucks.com', 'jobs.hilton.com', 'careers.marriott.com']) {
  const r = await curl(['-H', 'X-Requested-With: XMLHttpRequest', `https://${host}/search-jobs/results?ActiveFacetID=0&CurrentPage=1&RecordsPerPage=15&Distance=50&RadiusUnitType=0&Keywords=&Location=&ShowRadius=False&IsPagination=False&FacetTerm=&FacetType=0&SearchResultsModuleName=Search+Results&SearchFiltersModuleName=Search+Filters&SortCriteria=0&SortDirection=0&SearchType=5&ResultsType=0`]);
  let v; try { const h = JSON.parse(r.body).results || ''; v = { pages: (h.match(/data-total-pages="(\d+)"/) || [])[1], total: (h.match(/data-total-results="(\d+)"/) || [])[1], ids: (h.match(/data-job-id="\d+"/g) || []).length }; } catch { v = `HTTP ${r.status} ${r.body.slice(0, 80)}`; }
  out.radancy[host] = v;
}
writeFileSync('probe/out/hourly1.json', JSON.stringify(out, null, 1));
