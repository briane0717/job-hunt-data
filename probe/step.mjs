// One-off: read the live AI's exact error.
import { writeFileSync } from 'node:fs';
const U = 'https://jobbo-app.pages.dev/interview';
const tests = [
  { mode: 'interview', job: 'Cashier at a grocery store', messages: [{ role: 'user', content: 'Hi, I am ready.' }], debug: true },
  { mode: 'coach', job: 'Cashier', messages: [{ role: 'user', content: 'How do I prepare for a cashier interview?' }], debug: true },
  { mode: 'interview', model: '@cf/google/gemma-3-12b-it', job: 'Cashier', messages: [{ role: 'user', content: 'Hi' }], debug: true },
];
const out = [];
for (const t of tests) {
  const s = Date.now();
  try {
    const r = await fetch(U, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) });
    out.push({ mode: t.mode, model: t.model, status: r.status, headers: Object.fromEntries(r.headers), ms: Date.now() - s, body: (await r.text()).slice(0, 3000) });
  } catch (e) { out.push({ mode: t.mode, error: String(e) }); }
}
out.push({ at: new Date().toISOString() });
writeFileSync('probe/out/ai-error.json', JSON.stringify(out, null, 1));
