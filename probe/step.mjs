// Step 3: how many jobs each Fortune 500 company's public job list holds, and a second look
// for companies whose hiring system wasn't found on their main site (careers./jobs. addresses).
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
mkdirSync('probe/out', { recursive: true });
const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
async function get(u, extra = []) {
  try {
    const { stdout } = await run('curl', ['-sL', '-m', '25', '-A', ua, '-H', 'Accept-Language: en-US', ...extra, '-w', '\n@@URL@@%{url_effective} %{http_code}', u], { maxBuffer: 1 << 27 });
    const i = stdout.lastIndexOf('\n@@URL@@');
    const [url, code] = stdout.slice(i + 8).split(' ');
    return { html: stdout.slice(0, i), url, code: Number(code) };
  } catch (e) { return { html: '', url: u, code: 0 }; }
}
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function pool(items, fn, n = 4) { let i = 0; const out = []; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); await pause(300); } })); return out; }

const ats = JSON.parse(readFileSync('probe/out/fortune_ats.json', 'utf8'));
const gen = JSON.parse(readFileSync('collector/companies/workday_companies.json', 'utf8'));
// A. Workday: every board found, plus every board of the same tenant in the general list.
const boards = new Set();
for (const r of ats) for (const b of r.found?.workday || []) {
  const t = b.split('|')[0]; boards.add(b);
  for (const g of gen) if (g.startsWith(t + '|')) boards.add(g);
}
async function wdTotal(b) {
  const [t, wd, site] = b.split('|'); const base = `https://${t}.${wd}.myworkdayjobs.com`;
  const p = await get(`${base}/wday/cxs/${t}/${site}/jobs`, ['-X', 'POST', '-H', 'Content-Type: application/json', '-H', `Origin: ${base}`, '-d', '{"appliedFacets":{},"limit":1,"offset":0,"searchText":""}']);
  const d = json(p.html);
  return { board: b, code: p.code, total: d?.total ?? null };
}
const wd = await pool([...boards], wdTotal);
writeFileSync('probe/out/workday_totals.json', JSON.stringify(wd, null, 1));
console.log('workday boards', wd.length);

// B. Oracle and Eightfold totals.
const other = [];
for (const r of ats) {
  for (const o of r.found?.oracle || []) { const [host, site] = o.split('|'); other.push({ name: r.name, kind: 'oracle', host, site }); }
  for (const e of r.found?.eightfold || []) other.push({ name: r.name, kind: 'eightfold', host: `${e}.eightfold.ai`, domain: r.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*/, '') });
  for (const s of r.found?.smartrecruiters || []) other.push({ name: r.name, kind: 'smartrecruiters', id: s });
  for (const g of r.found?.greenhouse || []) other.push({ name: r.name, kind: 'greenhouse', id: g });
}
const oth = await pool(other, async (o) => {
  if (o.kind === 'oracle') {
    const p = await get(`https://${o.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=${o.site},limit=1`);
    return { ...o, code: p.code, total: json(p.html)?.items?.[0]?.TotalJobsCount ?? null };
  }
  if (o.kind === 'eightfold') {
    const p = await get(`https://${o.host}/api/apply/v2/jobs?domain=${o.domain}&start=0&num=10`);
    const d = json(p.html); return { ...o, code: p.code, total: d?.count ?? null, sample: d?.positions?.[0]?.location };
  }
  if (o.kind === 'smartrecruiters') {
    const p = await get(`https://api.smartrecruiters.com/v1/companies/${o.id}/postings?limit=1`);
    return { ...o, code: p.code, total: json(p.html)?.totalFound ?? null };
  }
  if (o.kind === 'greenhouse') {
    const p = await get(`https://boards-api.greenhouse.io/v1/boards/${o.id}/jobs`);
    return { ...o, code: p.code, total: json(p.html)?.jobs?.length ?? null };
  }
});
writeFileSync('probe/out/other_totals.json', JSON.stringify(oth, null, 1));

// C. Second look for companies with nothing found: careers./jobs. sub-sites.
const SIG = /myworkdayjobs\.com|myworkdaysite\.com|oraclecloud\.com\/hcmUI|taleo\.net|icims\.com|successfactors|jobs2web|phenompeople|eightfold\.ai|avature\.net|brassring\.com|paradox\.ai|greenhouse\.io|lever\.co|smartrecruiters\.com|jibe|talentbrew|ultipro\.com|dayforcehcm\.com|adp\.com|ashbyhq\.com/gi;
const none = ats.filter((r) => !Object.keys(r.found || {}).length && r.website);
const second = await pool(none, async (r) => {
  const dom = r.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*/, '');
  const tried = [];
  for (const u of [`https://careers.${dom}`, `https://jobs.${dom}`, `https://www.${dom}/careers`, `https://www.${dom}/en/careers`, `https://www.${dom}/us/en/careers`]) {
    const p = await get(u); tried.push(`${p.code} ${p.url}`);
    const sig = [...new Set([...(p.url + ' ' + p.html).matchAll(SIG)].map((m) => m[0].toLowerCase()))];
    const wdb = [...new Set([...p.html.matchAll(/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/g)].map((m) => `${m[1]}|${m[2]}|${m[3]}`.toLowerCase()))];
    if (sig.length) return { rank: r.rank, name: r.name, at: p.url, sig, workday: wdb, tried };
  }
  return { rank: r.rank, name: r.name, tried };
});
writeFileSync('probe/out/second_look.json', JSON.stringify(second, null, 1));
console.log('second look found', second.filter((x) => x.sig).length, 'of', none.length);
