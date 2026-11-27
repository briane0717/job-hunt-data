// Step 15: McDonald's (first 400 pages) and Starbucks (first 6,000 jobs, read slower) after the fixes.
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const t0 = Date.now();
const runPart = (only) => new Promise((resolve) => {
  const p = spawn('node', ['collector/collect.mjs', '--only', only, '--big', 'probe/test_hourly2.json', '--out', `/tmp/t-${only}`, '--minutes', '50']);
  let log = '';
  p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
  p.on('close', () => resolve(`### ${only} (${((Date.now() - t0) / 60000).toFixed(1)} min)\n${log.slice(-3000)}`));
});
const logs = await Promise.all([runPart('paradox'), runPart('eightfold')]);
let counts = '';
try { counts = execFileSync('bash', ['-c', `for d in /tmp/t-*; do echo $d; node -e 'const m=require(process.argv[1]+"/v1/manifest.json");console.log(m.totalJobs, JSON.stringify(m.skipped))' $d; done; cat /tmp/t-paradox/v1/us/*.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c={};for(const m of s.matchAll(/"t":"([^"]+)"/g))c[m[1]]=(c[m[1]]||0)+1;console.log(Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,25).map(x=>x.join(": ")).join("\\n"))})'; head -c 1200 /tmp/t-paradox/v1/us/TX.json`]).toString(); } catch (e) { counts = 'count failed ' + e.message; }
writeFileSync('probe/out/test_hourly2.txt', `minutes: ${((Date.now() - t0) / 60000).toFixed(1)}\n\n${counts}\n\n${logs.join('\n\n')}`);
