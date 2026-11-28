// One-off: check the live site's AI after publishing a5ab1c9 (run 5).
import { writeFileSync } from 'node:fs';
const U = 'https://jobbo-app.pages.dev/interview';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const job = 'The job: Cashier at Maple Grocers.\n\nMy resume:\nShift lead at Corner Market, 3 years. Run the register, train new cashiers, count drawers nightly.';
const out = [];
const call = async (mode, content) => {
  const s = Date.now();
  const r = await fetch(U, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, debug: 1, messages: [{ content }] }), signal: AbortSignal.timeout(120000) }).catch((e) => ({ status: 0, text: async () => String(e) }));
  return { mode, status: r.status, ms: Date.now() - s, body: (await r.text()).slice(0, 1200) };
};
for (let i = 0; i < 20; i++) {
  const x = await call('interview', job + '\n\nStart the interview.');
  out.push({ try: i, ...x });
  if (x.status === 200) break;
  await sleep(20000);
}
await sleep(5000);
out.push(await call('coach', job + '\n\nWhat should I wear to the interview?'));
out.push({ at: new Date().toISOString() });
writeFileSync('probe/out/live-1.json', JSON.stringify(out, null, 1));
