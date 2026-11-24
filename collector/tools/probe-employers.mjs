// One-off check: which hiring system big US employers use, and how many jobs their public lists show.
//   node collector/tools/probe-employers.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
async function curl(args) {
  try {
    const { stdout } = await run('curl', ['-sSL', '--compressed', '--max-time', '25', '-A', UA, '-w', '\n%{http_code}', ...args], { maxBuffer: 50e6 });
    const cut = stdout.lastIndexOf('\n');
    return { status: Number(stdout.slice(cut + 1)), body: stdout.slice(0, cut) };
  } catch (e) {
    return { status: 0, body: String(e.message).slice(0, 100) };
  }
}
const SITES = {
  "Macy's": 'https://www.macysjobs.com/', 'Best Buy': 'https://jobs.bestbuy.com/', UPS: 'https://www.jobs-ups.com/', FedEx: 'https://careers.fedex.com/',
  Amazon: 'https://www.amazon.jobs/', Walmart: 'https://careers.walmart.com/', Target: 'https://corporate.target.com/careers', Costco: 'https://www.costco.com/jobs.html',
  "Kohl's": 'https://careers.kohls.com/', 'Home Depot': 'https://careers.homedepot.com/', "Lowe's": 'https://talent.lowes.com/', Starbucks: 'https://careers.starbucks.com/',
  Walgreens: 'https://jobs.walgreens.com/', Kroger: 'https://www.krogerfamilycareers.com/', JCPenney: 'https://jobs.jcp.com/', 'Dollar General': 'https://careers.dollargeneral.com/',
  Ulta: 'https://careers.ulta.com/', Burlington: 'https://burlingtonstores.jobs/', Ross: 'https://jobs.rossstores.com/', PetSmart: 'https://careers.petsmart.com/',
  Staples: 'https://careers.staples.com/', TJX: 'https://jobs.tjx.com/', "Dick's": 'https://www.dickssportinggoods.jobs/', CVS: 'https://jobs.cvshealth.com/',
  USPS: 'https://about.usps.com/careers/', DHL: 'https://careers.dhl.com/', Nordstrom: 'https://careers.nordstrom.com/', Gap: 'https://www.gapinc.com/en-us/careers',
};
const MARKERS = { workday: /([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/, icims: /[a-z0-9-]+\.icims\.com/, taleo: /[a-z0-9-]+\.taleo\.net/, successfactors: /successfactors|jobs\.sap\.com|career\d*\.successfactors/, eightfold: /eightfold\.ai/, phenom: /phenompeople|phenom\.com|cdn-bot\.phenompeople/, radancy: /radancy|tbcdn\.talentbrew|talentbrew/, oracle: /oraclecloud\.com\/hcmUI/, avature: /avature\.net/, brassring: /brassring/, jibe: /jibeapply|jibecdn/, paradox: /paradox\.ai|olivia/i, greenhouse: /greenhouse\.io/, lever: /lever\.co/, smartrecruiters: /smartrecruiters/ };
for (const [name, url] of Object.entries(SITES)) {
  const r = await curl([url]);
  const found = Object.entries(MARKERS).filter(([, re]) => re.test(r.body)).map(([k, re]) => (k === 'workday' ? `workday(${r.body.match(re).slice(1).join('|')})` : k));
  console.log(`${name.padEnd(15)} ${String(r.status).padEnd(4)} ${found.join(', ') || '-'}`);
}
console.log('\nWorkday totals (all jobs / "seasonal"):');
const WD = ['target|wd5|targetcareers', 'kohls|wd1|kohlscareers', 'homedepot|wd5|careerdepot', 'lowes|wd5|lws_external_cs', 'tjx|wd1|tjx_external', 'dickssportinggoods|wd1|dsg', 'gapinc|wd1|gapinc', 'nordstrom|wd501|nordstrom_careers', 'dollartree|wd5|dollartreeus', 'cvshealth|wd1|cvs_health_careers', 'michaels|wd5|external', 'fedex|wd1|fcc_external', 'walmart|wd5|walmartexternal', 'wd5|wd1|wholefoods'];
for (const e of WD) {
  const [co, wd, site] = e.split('|');
  const base = `https://${co}.${wd}.myworkdayjobs.com`;
  const post = async (q) => {
    const r = await curl(['-X', 'POST', '-H', 'Content-Type: application/json', '-H', 'Accept: application/json', '-H', `Origin: ${base}`, '-H', `Referer: ${base}/${site}`, '--data-raw', JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: q }), `${base}/wday/cxs/${co}/${site}/jobs`]);
    try { return JSON.parse(r.body).total; } catch { return `HTTP ${r.status}`; }
  };
  console.log(`${e.padEnd(36)} ${await post('')} / ${await post('seasonal')}`);
}
const az = await curl(['https://www.amazon.jobs/en/search.json?base_query=&loc_query=&country=USA&result_limit=1']);
let azTotal; try { azTotal = JSON.parse(az.body).hits; } catch { azTotal = `HTTP ${az.status}`; }
const azS = await curl(['https://www.amazon.jobs/en/search.json?base_query=seasonal&country=USA&result_limit=1']);
let azSeasonal; try { azSeasonal = JSON.parse(azS.body).hits; } catch { azSeasonal = `HTTP ${azS.status}`; }
console.log(`\nAmazon (amazon.jobs search.json): ${azTotal} US jobs / ${azSeasonal} "seasonal"`);
