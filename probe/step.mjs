// Step 1: get the current Fortune 500 list from fortune.com.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const get = (u) => { try { return execFileSync('curl', ['-sL', '-m', '40', '-A', ua, u], { maxBuffer: 1 << 28 }).toString(); } catch (e) { return 'ERR ' + e.message; } };
const log = [];
for (const u of ['https://fortune.com/ranking/fortune500/2025/', 'https://fortune.com/ranking/fortune500/', 'https://fortune.com/ranking/fortune500/2025/search/']) {
  const h = get(u);
  const nd = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  log.push(`${u} len=${h.length} next=${nd ? nd[1].length : 0} title=${(h.match(/<title>([^<]*)/) || [])[1]}`);
  if (nd) writeFileSync(`probe/out/fortune_${log.length}.json`, nd[1]);
  else writeFileSync(`probe/out/fortune_${log.length}.html`, h.slice(0, 400000));
}
writeFileSync('probe/out/log.txt', log.join('\n') + '\n');
