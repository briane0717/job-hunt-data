// Looks up the real company name behind each board's short name ("insomniacookies" -> "Insomnia Cookies")
// from the board's own public page, and saves them to companies/board_names.json for the collector.
// Run now and then (it is not part of each collection):  node collector/tools/names.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const run = promisify(execFile);
const HERE = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'companies');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
async function curl(args) {
  try {
    const { stdout } = await run('curl', ['-sSL', '--compressed', '--max-time', '20', '-A', UA, '-w', '\n%{http_code}', ...args], { maxBuffer: 30e6 });
    const cut = stdout.lastIndexOf('\n');
    return { status: Number(stdout.slice(cut + 1)), body: stdout.slice(0, cut) };
  } catch { return { status: 0, body: '' }; }
}
const unescape = (t) => t.replace(/&amp;/g, '&').replace(/&#0?39;|&#x27;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const compact = (t) => t.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
const GENERIC = /^(careers?( home| site| page| portal| opportunities)?|jobs?|job search|search jobs|external( career)?( site)?|home|career opportunities|current openings|join (us|our team)|workday|not found.*|404.*)$/i;
/** "Careers at Albany Medical Center" -> "Albany Medical Center"; null when it's a slogan or not this company. */
export function cleanName(raw, slug) {
  let n = unescape(String(raw || ''))
    .replace(/^(careers?|jobs?|job openings|current openings|opportunities)\s+(at|with|@)\s+/i, '')
    .replace(/\s*[|–—:-]\s*(careers?|jobs?|job board|workday|careers? site|external careers?( site)?)$/i, '')
    .replace(/\s+(careers?|jobs|job board|career site|careers? portal|external careers?( site)?)$/i, '')
    .replace(/^(careers?|jobs?)\s*[|–—:-]\s*/i, '')
    .replace(/,?\s+(inc\.?|llc|l\.l\.c\.|ltd\.?|co\.)$/i, '')
    .trim();
  if (!n || GENERIC.test(n) || n.length > 60 || n.split(' ').length > 7 || /[.!?]$/.test(n)) return null;
  // Must plausibly be this board's company: the name starts like the short name, contains it, or its initials match.
  const c = compact(n);
  const s = compact(slug);
  const initials = n.split(/[\s&-]+/).filter(Boolean).map((w) => w[0].toLowerCase()).join('');
  const ok = c.includes(s) || s.includes(c) || (s.length >= 3 && c.startsWith(s.slice(0, 3))) || (initials.length >= 2 && s.startsWith(initials));
  return ok ? n : null;
}
async function pool(items, worker, n = 12) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await worker(items[i++]); }));
}
const names = { lever: {}, ashby: {}, workday: {} };
const lever = JSON.parse(await readFile(path.join(HERE, 'lever_companies.json'), 'utf8'));
await pool(lever, async (slug) => {
  const r = await curl([`https://jobs.lever.co/${encodeURIComponent(slug)}`]);
  if (r.status !== 200) return;
  const n = cleanName((r.body.match(/<title>([^<]*)/) || [])[1], slug);
  if (n) names.lever[slug] = n;
});
console.log(`Lever: ${Object.keys(names.lever).length} of ${lever.length}`);
const ashby = JSON.parse(await readFile(path.join(HERE, 'ashby_companies.json'), 'utf8'));
const Q = 'query ApiOrganizationFromHostedJobsPageName($organizationHostedJobsPageName: String!) { organization: organizationFromHostedJobsPageName(organizationHostedJobsPageName: $organizationHostedJobsPageName) { name } }';
await pool(ashby, async (slug) => {
  const r = await curl(['-X', 'POST', '-H', 'Content-Type: application/json', '--data-raw', JSON.stringify({ operationName: 'ApiOrganizationFromHostedJobsPageName', variables: { organizationHostedJobsPageName: slug }, query: Q }), 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiOrganizationFromHostedJobsPageName']);
  let raw = '';
  try { raw = JSON.parse(r.body).data?.organization?.name || ''; } catch {}
  const n = cleanName(raw, slug);
  if (n) names.ashby[slug] = n;
});
console.log(`Ashby: ${Object.keys(names.ashby).length} of ${ashby.length}`);
const wd = JSON.parse(await readFile(path.join(HERE, 'workday_companies.json'), 'utf8'));
const firstBoard = new Map();
for (const e of wd) { const [co] = e.split('|'); if (!firstBoard.has(co)) firstBoard.set(co, []); firstBoard.get(co).push(e); }
await pool([...firstBoard.keys()], async (co) => {
  for (const e of firstBoard.get(co).slice(0, 3)) {
    const [, w, site] = e.split('|');
    const base = w.startsWith('site-') ? `https://${w.slice(5)}.myworkdaysite.com/recruiting/${co}/${site}` : `https://${co}.${w}.myworkdayjobs.com/${site}`;
    const r = await curl([base]);
    if (r.status !== 200) continue;
    const raw = (r.body.match(/property="og:site_name" content="([^"]*)/) || r.body.match(/property="og:title" content="([^"]*)/) || [])[1];
    const n = cleanName(raw, co);
    if (n) { names.workday[co] = n; return; }
  }
});
console.log(`Workday: ${Object.keys(names.workday).length} of ${firstBoard.size}`);
const sort = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(path.join(HERE, 'board_names.json'), JSON.stringify({ _about: `Real company names for boards with short names, from each board's own public page (collector/tools/names.mjs, ${new Date().toISOString().slice(0, 10)}).`, lever: sort(names.lever), ashby: sort(names.ashby), workday: sort(names.workday) }, null, 1) + '\n');
