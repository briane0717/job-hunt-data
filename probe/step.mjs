// One-off: read the live AI's exact error from a preview of main's server code (debug on).
import { writeFileSync } from 'node:fs';
const U = 'https://claude-project-thread-3rv3wv.jobbo-app.pages.dev/interview';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const post = async (t) => {
  const s = Date.now();
  try {
    const r = await fetch(U, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) });
    return { mode: t.mode, model: t.model, status: r.status, ms: Date.now() - s, body: (await r.text()).slice(0, 3000) };
  } catch (e) { return { mode: t.mode, error: String(e) }; }
};
// wait for the preview to be up (GET on a POST-only function gives 405, not 404)
for (let i = 0; i < 40; i++) {
  const r = await fetch(U).catch(() => null);
  out.push({ wait: i, status: r && r.status });
  if (r && r.status !== 404 && r.status !== 522 && r.status !== 530) break;
  await sleep(15000);
}
for (const t of [
  { mode: 'interview', job: 'Cashier at a grocery store', messages: [{ role: 'user', content: 'Hi, I am ready.' }], debug: true },
  { mode: 'coach', job: 'Cashier', messages: [{ role: 'user', content: 'How do I prepare for a cashier interview?' }], debug: true },
]) out.push(await post(t));
out.push({ at: new Date().toISOString() });
writeFileSync('probe/out/ai-error2.json', JSON.stringify(out, null, 1));
