// Step 13: what a Paradox career site's job list page holds for each job (title, place, link).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
const run = promisify(execFile);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
async function curl(url) {
  try {
    const { stdout } = await run('curl', ['-sSL', '--compressed', '--max-time', '40', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 200e6 });
    const cut = stdout.lastIndexOf('\n');
    return { status: Number(stdout.slice(cut + 1)), body: stdout.slice(0, cut) };
  } catch (e) { return { status: 0, body: String(e.message).slice(0, 100) }; }
}
const out = {};
for (const base of ['https://careers.fedex.com', 'https://jobs.mchire.com', 'https://careers.wholefoods.com', 'https://careers.dunkindonuts.com', 'https://careers.amctheatres.com', 'https://careers.aramark.com']) {
  const t0 = Date.now();
  const p = await curl(`${base}/jobs/page/2`);
  const ms = Date.now() - t0;
  const hrefs = [...p.body.matchAll(/href="([^"]*\/job\/[^"]+)"/g)];
  const i = hrefs[0]?.index ?? -1;
  const last = [...p.body.matchAll(/\/jobs\/page\/(\d+)/g)].map((m) => +m[1]);
  out[base] = { status: p.status, ms, len: p.body.length, jobLinks: new Set(hrefs.map((m) => m[1])).size, lastPage: Math.max(0, ...last), snippet: i >= 0 ? p.body.slice(Math.max(0, i - 2500), i + 3500) : p.body.slice(0, 400), ld: (p.body.match(/application\/ld\+json[^>]*>([\s\S]{0,1500})/) || [])[1] };
}
writeFileSync('probe/out/hourly6.json', JSON.stringify(out, null, 1));
