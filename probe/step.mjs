// Step 12: job sitemaps and server-rendered job pages (Paradox sites, Walmart).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
const run = promisify(execFile);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
async function curl(args) {
  try {
    const { stdout } = await run('curl', ['-sSL', '--compressed', '--max-time', '40', '-A', UA, '-w', '\n%{http_code}', ...args], { maxBuffer: 200e6 });
    const cut = stdout.lastIndexOf('\n');
    return { status: Number(stdout.slice(cut + 1)), body: stdout.slice(0, cut) };
  } catch (e) { return { status: 0, body: String(e.message).slice(0, 100) }; }
}
const out = {};
for (const base of ['https://careers.fedex.com', 'https://jobs.mchire.com', 'https://careers.wholefoods.com', 'https://careers.dunkindonuts.com', 'https://careers.walmart.com', 'https://jobs.olivegarden.com', 'https://careers.amctheatres.com']) {
  const res = {};
  const robots = await curl([`${base}/robots.txt`]);
  res.robots = `${robots.status} ${robots.body.slice(0, 700)}`;
  const sm = await curl([`${base}/sitemap.xml`]);
  const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  res.sitemap = `${sm.status} n=${locs.length} ${locs.slice(0, 12).join(' ')}`;
  const child = locs.find((l) => /job/i.test(l)) || locs[0];
  if (child) {
    const c = await curl([child]);
    const cl = [...c.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    res.child = `${child} ${c.status} n=${cl.length} ${cl.slice(0, 8).join(' ')}`;
    res.childSnippet = c.body.slice(0, 1200);
  }
  if (!base.includes('walmart')) {
    const p = await curl([`${base}/jobs/page/2`]);
    const i = p.body.search(/class="[^"]*job[-_]?(card|item|title|list-item|result)/i);
    res.card = i > 0 ? p.body.slice(i, i + 3000) : `no card ${p.status}`;
    const post = await curl(['-X', 'POST', '-H', 'Content-Type: application/json', '-H', 'Accept: application/json', '-H', `Origin: ${base}`, '-H', `Referer: ${base}/jobs`, '--data-raw', '{}', `${base}/api/get-jobs?page_number=2&page_size=100`]);
    res.post = `${post.status} ${post.body.slice(0, 1500)}`;
  }
  out[base] = res;
}
writeFileSync('probe/out/hourly5.json', JSON.stringify(out, null, 1));
