// Step 11: Paradox career sites' job list call (/api/get-jobs) and Walmart's search call.
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
const out = { paradox: {}, walmart: {} };
for (const base of ['https://careers.fedex.com', 'https://jobs.mchire.com', 'https://careers.wholefoods.com', 'https://careers.dunkindonuts.com']) {
  const r = await curl([`${base}/jobs/page/2`]);
  const i = r.body.search(/href="[^"]*\/jobs\/\d+/);
  const res = { page2: `${r.status} len=${r.body.length}`, card: i > 0 ? r.body.slice(i - 1500, i + 2500) : r.body.slice(0, 300) };
  const b = await curl([`https://${base.includes('mchire') ? 'cdn.sites.mchire.com/mchire' : base.includes('fedex') ? 'cdn.sites.fedex.paradox.ai/fedex' : 'cdn.sites.paradox.ai/paradox'}-prod-careersites/${base.includes('mchire') || base.includes('fedex') ? '9966f87f99' : 'dc13f5697d'}/jobs-list-only.bundle.js`]);
  const k = b.body.indexOf('/api/get-jobs');
  res.bundle = k > 0 ? b.body.slice(k - 1500, k + 800) : `no get-jobs ${b.status}`;
  for (const q of ['/api/get-jobs?page=1', '/api/get-jobs?page_number=1&page_size=100', '/api/get-jobs?page=1&per_page=100&location=&keyword=']) {
    const x = await curl(['-H', 'Accept: application/json', '-H', 'X-Requested-With: XMLHttpRequest', '-H', `Referer: ${base}/jobs`, base + q]);
    res[q] = `${x.status} ${x.body.slice(0, 1500)}`;
  }
  out.paradox[base] = res;
}
{
  const r = await curl(['https://careers.walmart.com/results?q=&page=1']);
  const scripts = [...r.body.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1], 'https://careers.walmart.com').href);
  for (const s of scripts) {
    const b = await curl([s]);
    for (const m of b.body.matchAll(/search-ai|\/api\/[a-z-]+\/(?:search|jobs?)[^"'`]*/g)) {
      (out.walmart[s.slice(-50)] ||= []).push(b.body.slice(Math.max(0, m.index - 400), m.index + 400));
      if (out.walmart[s.slice(-50)].length > 6) break;
    }
  }
  out.walmart.html = r.body.slice(0, 200) + ' ... ' + (r.body.match(/[\s\S]{0,300}(jobs found|results for|No results)[\s\S]{0,300}/i) || [''])[0];
  for (const q of ['/api/ai/search-ai/api/v1/job/search?q=&page=1', '/api/ai/search-ai/api/v1/job/popular-searches', '/api/search?q=&page=1', '/api/jobs?q=&page=1', '/api/ai/search-ai/api/v1/jobs?page=1']) {
    const x = await curl(['-H', 'Accept: application/json', `https://careers.walmart.com${q}`]);
    out.walmart[q] = `${x.status} ${x.body.slice(0, 800)}`;
  }
}
writeFileSync('probe/out/hourly4.json', JSON.stringify(out, null, 1));
