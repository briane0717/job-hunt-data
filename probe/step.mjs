// Step 5: which other kinds of career sites answer with a readable public job list, and how many jobs each holds.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
mkdirSync('probe/out', { recursive: true });
const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
async function get(u, extra = []) {
  try {
    const { stdout } = await run('curl', ['-sL', '-m', '25', '-A', ua, '-H', 'Accept-Language: en-US', ...extra, '-w', '\n@@URL@@%{url_effective} %{http_code}', u], { maxBuffer: 1 << 27 });
    const i = stdout.lastIndexOf('\n@@URL@@'); const [url, code] = stdout.slice(i + 8).split(' ');
    return { html: stdout.slice(0, i), url, code: Number(code) };
  } catch (e) { return { html: '', url: u, code: 0 }; }
}
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function pool(items, fn, n = 4) { let i = 0; const out = []; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = { item: items[k], err: e.message }; } await pause(300); } })); return out; }
const T = JSON.parse(readFileSync('probe/targets.json', 'utf8'));
const R = {};
R.rmk = await pool(T.rmk, async ([name, h]) => {
  const p = await get(`https://${h}/search/?q=&startrow=0`);
  const t = p.html.match(/of\s*<b>\s*([\d,]+)\s*<\/b>/i) || p.html.match(/of\s+([\d,]+)\s+Jobs/i);
  return { name, h, code: p.code, final: p.url, total: t ? t[1] : null, rows: (p.html.match(/class="jobTitle-link/g) || []).length };
});
R.jibe = await pool(T.jibe, async ([name, h]) => {
  const p = await get(`https://${h}/api/jobs?page=1&limit=1`);
  const d = json(p.html); return { name, h, code: p.code, total: d?.totalCount ?? null, loc: d?.jobs?.[0]?.data?.full_location };
});
R.phenom = await pool(T.phenom, async ([name, h]) => {
  const p = await get(`https://${h}/us/en/search-results`);
  const ref = p.html.match(/"refNum"\s*:\s*"([^"]+)"/)?.[1];
  const hits = p.html.match(/"totalHits"\s*:\s*(\d+)/)?.[1];
  let api = null;
  if (ref) {
    const body = JSON.stringify({ lang: 'en_us', deviceType: 'desktop', country: 'us', pageName: 'search-results', ddoKey: 'refineSearch', sortBy: '', subsearch: '', from: 10, jobs: true, counts: true, all_fields: ['country', 'state', 'city', 'category'], size: 10, clearAll: false, jdsource: 'facets', isSliderEnable: false, pageId: 'page20', siteType: 'external', keywords: '', global: true, selected_fields: {}, locationData: {}, refNum: ref });
    const a = await get(`https://${h}/widgets`, ['-X', 'POST', '-H', 'Content-Type: application/json', '-d', body]);
    const d = json(a.html); api = { code: a.code, hits: d?.refineSearch?.totalHits ?? null, n: d?.refineSearch?.data?.jobs?.length ?? null, sample: d?.refineSearch?.data?.jobs?.[0] ? Object.keys(d.refineSearch.data.jobs[0]).slice(0, 30).join(',') : (a.html || '').slice(0, 120) };
  }
  return { name, h, code: p.code, final: p.url, ref, hits, api, wd: [...new Set([...p.html.matchAll(/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com/gi)].map((m) => m[0]))].slice(0, 2) };
});
R.radancy = await pool(T.radancy, async ([name, h]) => {
  const p = await get(`https://${h}/search-jobs/results?ActiveFacetID=0&CurrentPage=1&RecordsPerPage=15&Distance=50&RadiusUnitType=0&Keywords=&Location=&ShowRadius=False&IsPagination=False&FacetTerm=&FacetType=0&SearchResultsModuleName=Search+Results&SearchFiltersModuleName=Search+Filters&SortCriteria=0&SortDirection=0&SearchType=5&ResultsType=0`, ['-H', 'X-Requested-With: XMLHttpRequest']);
  const d = json(p.html); const html = d?.results || '';
  return { name, h, code: p.code, total: html.match(/data-total-results="(\d+)"/)?.[1] ?? html.match(/data-total-job-results="(\d+)"/)?.[1] ?? null, pages: html.match(/data-total-pages="(\d+)"/)?.[1], links: (html.match(/href="\/job\//g) || []).length, len: p.html.length };
});
R.icims = await pool(T.icims, async ([name, subs]) => {
  const out = [];
  for (const s of subs.slice(0, 2)) {
    const p = await get(`https://${s}.icims.com/jobs/search?pr=0&schemaId=&o=&in_iframe=1`);
    out.push({ s, code: p.code, final: p.url.slice(0, 80), links: (p.html.match(/iCIMS_JobsTable|class="iCIMS_Anchor"/g) || []).length, pages: p.html.match(/Page\s*\d+\s*of\s*(\d+)/i)?.[1] || p.html.match(/of\s+(\d+)\s*<\/span>/)?.[1] });
  }
  return { name, out };
});
R.eightfold = await pool(T.eightfold, async ([name, t, site]) => {
  const dom = site.replace(/^https?:\/\/(www\.|careers\.|jobs\.)?/, '').replace(/[/:].*/, '');
  const hosts = t && t !== 'app' ? [`${t}.eightfold.ai`] : [];
  hosts.push(new URL(site).host);
  const out = [];
  for (const h of hosts) for (const path of [`/api/pcsx/search?domain=${dom}&query=&location=&start=0`, `/api/apply/v2/jobs?domain=${dom}&start=0&num=10`]) {
    const p = await get(`https://${h}${path}`); const d = json(p.html);
    out.push(`${p.code} ${h}${path.split('?')[0]} count=${d?.data?.count ?? d?.count ?? '-'} n=${d?.data?.positions?.length ?? d?.positions?.length ?? '-'}`);
  }
  return { name, dom, out };
});
R.wd = await pool(T.wd, async ([name, b]) => {
  const [t, wd, site] = b.split('|'); const base = `https://${t}.${wd}.myworkdayjobs.com`;
  const p = await get(`${base}/wday/cxs/${t}/${site}/jobs`, ['-X', 'POST', '-H', 'Content-Type: application/json', '-H', `Origin: ${base}`, '-d', '{"appliedFacets":{},"limit":1,"offset":0,"searchText":""}']);
  return { name, b, code: p.code, total: json(p.html)?.total ?? null };
});
R.wdsite = await pool(T.wdsite, async ([name, ts]) => {
  const [t, site] = ts.split('|'); const out = [];
  for (const wd of ['wd1', 'wd3', 'wd5', 'wd12', 'wd103', 'wd501', 'wd503']) {
    const base = `https://${wd}.myworkdaysite.com`;
    const p = await get(`${base}/wday/cxs/${t}/${site}/jobs`, ['-X', 'POST', '-H', 'Content-Type: application/json', '-H', `Origin: ${base}`, '-d', '{"appliedFacets":{},"limit":1,"offset":0,"searchText":""}']);
    const tot = json(p.html)?.total; if (tot != null) { out.push(`${wd} ${tot}`); break; } else out.push(`${wd} ${p.code}`);
  }
  return { name, ts, out };
});
R.oraclefind = await pool(T.oraclefind, async ([name, at]) => {
  const p = await get(at);
  return { name, hits: [...new Set([...p.html.matchAll(/([a-z0-9-]+\.fa\.[a-z0-9]+\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/[a-zA-Z-]+\/sites\/([A-Za-z0-9_]+)/g)].map((m) => m[1] + '|' + m[2]))] };
});
writeFileSync('probe/out/explore5.json', JSON.stringify(R, null, 1));
