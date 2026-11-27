// Step 14: read the new hourly employers with the collector itself (probe/test_hourly.json), and look up board names.
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync, copyFileSync } from 'node:fs';
const t0 = Date.now();
const runPart = (only) => new Promise((resolve) => {
  const p = spawn('node', ['collector/collect.mjs', '--only', only, '--big', 'probe/test_hourly.json', '--out', `/tmp/t-${only.replace(/,/g, '-')}`, '--minutes', '50']);
  let log = '';
  p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
  p.on('close', () => resolve(`### ${only} (${((Date.now() - t0) / 60000).toFixed(1)} min)\n${log.slice(-5000)}`));
});
const names = new Promise((resolve) => {
  const p = spawn('node', ['collector/tools/names.mjs']);
  let log = '';
  p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
  p.on('close', () => resolve(`### names (${((Date.now() - t0) / 60000).toFixed(1)} min)\n${log.slice(-3000)}`));
});
const logs = await Promise.all([runPart('bigworkday,jibe'), runPart('phenom,radancy'), runPart('eightfold'), runPart('paradox'), runPart('amazon'), names]);
try { copyFileSync('collector/companies/board_names.json', 'probe/out/board_names.json'); } catch {}
let counts = '';
try { counts = execFileSync('bash', ['-c', `cat /tmp/t-*/v1/us/*.json /tmp/t-*/v1/remote.json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c={};for(const m of s.matchAll(/"c":"([^"]+)"/g))c[m[1]]=(c[m[1]]||0)+1;console.log(Object.entries(c).sort((a,b)=>b[1]-a[1]).map(x=>x.join(": ")).join("\\n"))})'; for d in /tmp/t-*; do echo $d; node -e 'const m=require(process.argv[1]+"/v1/manifest.json");console.log(m.totalJobs, JSON.stringify(m.skipped), JSON.stringify(m.sources))' $d; done; head -c 1500 /tmp/t-paradox/v1/us/TX.json; echo; head -c 800 /tmp/t-eightfold/v1/us/TX.json`]).toString(); } catch (e) { counts = 'count failed ' + e.message; }
writeFileSync('probe/out/test_hourly.txt', `minutes: ${((Date.now() - t0) / 60000).toFixed(1)}\n\nUS jobs by company (incl. remote):\n${counts}\n\n${logs.join('\n\n')}`);
