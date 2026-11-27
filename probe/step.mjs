// Step 10: Walmart's and Paradox career sites (FedEx, McDonald's, Darden, …): where do their job lists come from?
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
const out = {};
const apiStrings = (t) => [...new Set([...t.matchAll(/["'`]((?:https?:\/\/[a-z0-9.-]+)?\/[a-zA-Z0-9_\-\/.{}$]*(?:api|search|graphql|jobs)[a-zA-Z0-9_\-\/.{}$?=&]*)["'`]/g)].map((m) => m[1]))].filter((u) => !/\.(png|jpe?g|svg|css|woff2?|webp|gif|mp4)(\?|$)/.test(u)).slice(0, 80);
async function deep(name, page) {
  const r = await curl([page]);
  const origin = new URL(page).origin;
  const scripts = [...r.body.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, '&'), origin).href);
  const res = { status: r.status, len: r.body.length, inline: apiStrings(r.body), scripts: scripts.length, fromScripts: {} };
  for (const s of scripts.slice(0, 40)) {
    const b = await curl([s]);
    const a = apiStrings(b.body).filter((x) => !/^\/_next\/static/.test(x));
    if (a.length) res.fromScripts[s.slice(-80)] = a.slice(0, 30);
  }
  res.jobLinks = [...new Set([...r.body.matchAll(/href="([^"]*\/(?:job|jobs)\/[^"]+)"/g)].map((m) => m[1]))].slice(0, 8);
  res.jsonld = (r.body.match(/application\/ld\+json[^>]*>([\s\S]{0,600})/) || [])[1];
  res.counts = (r.body.match(/.{0,80}(\d{1,3}(,\d{3})+|\d{3,6})\s+(jobs|results|openings).{0,40}/i) || [''])[0];
  out[name] = res;
}
await deep('Walmart results', 'https://careers.walmart.com/results?q=&page=1&sort=rank&expand=department,brand,type,rate&jobCareerArea=all');
await deep('FedEx jobs', 'https://careers.fedex.com/jobs');
await deep('McHire', 'https://jobs.mchire.com/jobs');
await deep('Whole Foods', 'https://careers.wholefoods.com/jobs');
// Paradox career sites: does /jobs?page=2 page, and is there a JSON list?
for (const [name, base] of [['FedEx', 'https://careers.fedex.com'], ['McHire', 'https://jobs.mchire.com'], ['Darden', 'https://jobs.olivegarden.com'], ['Aramark', 'https://careers.aramark.com'], ['Whole Foods', 'https://careers.wholefoods.com'], ['AMC', 'https://careers.amctheatres.com'], ['Dunkin', 'https://careers.dunkindonuts.com']]) {
  const res = {};
  for (const p of ['/jobs?page=2', '/api/jobs?page=1', '/jobs.json', '/sitemap.xml', '/jobs/sitemap.xml', '/feed', '/jobs/feed']) {
    const r = await curl([base + p]);
    res[p] = `${r.status} len=${r.body.length} jobLinks=${(r.body.match(/\/jobs?\/[a-z0-9-]+\/?[a-z0-9-]*-?\d{4,}/gi) || []).length} ${r.body.slice(0, 120).replace(/\s+/g, ' ')}`;
  }
  out['paradox ' + name] = res;
}
// FedEx Workday sites named on its pages.
{
  const r = await curl(['https://careers.fedex.com/jobs']);
  const sites = [...new Set([...r.body.matchAll(/fedex\.wd1\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/g)].map((m) => m[1]))];
  out.fedexSites = {};
  for (const site of [...sites, 'FXE-US_External_Career_Site', 'FXG_External_Career_Site', 'FXF-US_External_Career_Site', 'FDX_External_Career_Site', 'FXS_External_Career_Site']) {
    const x = await curl(['-X', 'POST', '-H', 'Content-Type: application/json', '-H', 'Accept: application/json', '--data-raw', JSON.stringify({ appliedFacets: {}, limit: 3, offset: 0, searchText: '' }), `https://fedex.wd1.myworkdayjobs.com/wday/cxs/fedex/${site}/jobs`]);
    const d = J(x);
    out.fedexSites[site] = d ? { total: d.total, sample: (d.jobPostings || []).map((j) => `${j.title} @ ${j.locationsText}`) } : `HTTP ${x.status}`;
  }
}
writeFileSync('probe/out/hourly3.json', JSON.stringify(out, null, 1));
