// Step 7 (step 4 again with the second batch): read the new Fortune 500 entries with the collector itself (probe/test_big.json), as a test.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe/out', { recursive: true });
const t0 = Date.now();
let log = '';
try {
  log = execFileSync('node', ['collector/collect.mjs', '--only', 'bigworkday,oracle,jibe,rmk,phenom,radancy,eightfold', '--big', 'probe/test_big2.json', '--out', '/tmp/test-out', '--minutes', '45'], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
} catch (e) { log = String(e.stdout || '') + '\nERROR ' + String(e.stderr || e.message).slice(-3000); }
// Per-company counts from the written files.
let counts = '';
try { counts = execFileSync('bash', ['-c', `cat /tmp/test-out/v1/us/*.json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c={};for(const m of s.matchAll(/"c":"([^"]+)"/g))c[m[1]]=(c[m[1]]||0)+1;console.log(Object.entries(c).sort((a,b)=>b[1]-a[1]).map(x=>x.join(": ")).join("\\n"))})'; ls /tmp/test-out/v1 | head`]).toString(); } catch (e) { counts = 'count failed ' + e.message; }
writeFileSync('probe/out/test_run2.txt', `minutes: ${((Date.now() - t0) / 60000).toFixed(1)}\n\n${log.slice(-12000)}\n\nUS jobs by company:\n${counts}`);
