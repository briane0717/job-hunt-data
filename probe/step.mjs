// Step 2: for each Fortune 500 company, find its website (from its fortune.com page), its careers page,
// and which hiring system the careers pages point to. Polite: 4 companies at a time, one request at a time each.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
mkdirSync('probe/out', { recursive: true });
const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
async function get(u) {
  try {
    const { stdout } = await run('curl', ['-sL', '-m', '25', '-A', ua, '-H', 'Accept-Language: en-US', '-w', '\n@@URL@@%{url_effective} %{http_code}', u], { maxBuffer: 1 << 27 });
    const i = stdout.lastIndexOf('\n@@URL@@');
    const [url, code] = stdout.slice(i + 8).split(' ');
    return { html: stdout.slice(0, i), url, code: Number(code) };
  } catch (e) { return { html: '', url: u, code: 0 }; }
}
const SIG = {
  workday: /([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/g,
  workdaysite: /myworkdaysite\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?recruiting\/([a-z0-9_-]+)\/([A-Za-z0-9_-]+)/g,
  oracle: /([a-z0-9]+\.fa\.[a-z0-9]+\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/[a-z-]+\/sites\/([A-Za-z0-9_]+)/g,
  taleo: /([a-z0-9]+)\.taleo\.net/g,
  icims: /([a-z0-9-]+)\.icims\.com/g,
  successfactors: /(career\d*\.successfactors\.(?:com|eu)|jobs2web|rmkcdn\.successfactors\.com|sapsf)/g,
  phenom: /(phenompeople|cdn\.phenom|phenom\.com)/g,
  eightfold: /([a-z0-9-]+)\.eightfold\.ai/g,
  avature: /([a-z0-9-]+)\.avature\.net/g,
  brassring: /(sjobs\.brassring\.com|krb-sjobs\.brassring\.com)[^"' ]*partnerid=(\d+)[^"' ]*siteid=(\d+)/gi,
  paradox: /(paradox\.ai|olivia\.paradox)/g,
  greenhouse: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/g,
  lever: /jobs\.lever\.co\/([a-z0-9_-]+)/g,
  smartrecruiters: /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/g,
  jibe: /(jibecdn|jibeapply|icims\.jibe)/g,
  radancy: /(tbcdn\.talentbrew\.com|radancy|talentbrew)/g,
  ukg: /recruiting\d*\.ultipro\.com\/([A-Z0-9]+)\/JobBoard\/([a-f0-9-]+)/g,
  dayforce: /jobs\.dayforcehcm\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([a-z0-9-]+)/g,
  adp: /(workforcenow\.adp\.com|myjobs\.adp\.com)/g,
  ashby: /jobs\.ashbyhq\.com\/([A-Za-z0-9_-]+)/g,
};
function detect(html) {
  const out = {};
  for (const [k, re] of Object.entries(SIG)) {
    const m = [...html.matchAll(re)].map((x) => x.slice(1).filter(Boolean).join('|').toLowerCase());
    if (m.length) out[k] = [...new Set(m)].slice(0, 4);
  }
  return out;
}
function careerLinks(html, base) {
  const links = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (/career|jobs|join (our|the) team|work (with|for) us/i.test(m[1] + ' ' + text)) {
      try { links.push(new URL(m[1].replace(/&amp;/g, '&'), base).href); } catch {}
    }
  }
  return [...new Set(links)].filter((u) => /^https?:/.test(u) && !/linkedin|facebook|twitter|instagram|youtube|glassdoor|indeed\./i.test(u)).slice(0, 6);
}
async function one(line) {
  const [rank, name, employees, industry, slug] = line.split('\t');
  const r = { rank: +rank, name, employees, industry };
  const fp = await get(`https://fortune.com${slug}`);
  const w = fp.html.match(/"Website","value":"([^"]+)"/) || fp.html.match(/Website[^<]{0,40}<\/[^>]+>\s*<[^>]+>\s*<a[^>]*href="([^"]+)"/) || fp.html.match(/"website":"([^"]+)"/i);
  r.website = w ? w[1].replace(/\\u002F/g, '/') : '';
  if (!r.website) { r.note = `no website on fortune page (${fp.code})`; return r; }
  const seen = new Set(); const found = {}; const visited = [];
  const queue = [r.website.replace(/\/$/, ''), r.website.replace(/\/$/, '') + '/careers'];
  for (let depth = 0; queue.length && visited.length < 7; depth++) {
    const u = queue.shift(); if (seen.has(u)) continue; seen.add(u);
    const p = await get(u); visited.push(`${p.code} ${p.url}`);
    const d = detect(p.url + ' ' + p.html);
    for (const [k, v] of Object.entries(d)) found[k] = [...new Set([...(found[k] || []), ...v])].slice(0, 4);
    if (Object.keys(found).some((k) => !['phenom', 'radancy', 'jibe', 'adp', 'paradox'].includes(k))) break;
    if (visited.length < 4) for (const l of careerLinks(p.html, p.url)) if (!seen.has(l)) queue.push(l);
  }
  r.found = found; r.visited = visited;
  return r;
}
const lines = readFileSync('probe/out/fortune500_2026.tsv', 'utf8').trim().split('\n');
const results = []; let i = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (i < lines.length) { const l = lines[i++]; results.push(await one(l)); } }));
results.sort((a, b) => a.rank - b.rank);
writeFileSync('probe/out/fortune_ats.json', JSON.stringify(results, null, 1));
const tally = {}; for (const r of results) for (const k of Object.keys(r.found || { none: 1 })) tally[k] = (tally[k] || 0) + 1;
console.log(tally);
