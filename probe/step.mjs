// One-off: real calls to the preview with the Groq backup (run 4).
import { readFileSync, writeFileSync } from 'node:fs';
const SITE = 'https://claude-project-thread-3rv3wv.jobbo-app.pages.dev';
const U = SITE + '/interview';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const me = readFileSync(new URL(import.meta.url), 'utf8');
const out = [];
for (let i = 0; i < 40; i++) {
  const t = await fetch(SITE + '/probe/step.mjs?' + Date.now()).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  if (t.trim() === me.trim()) { out.push({ liveAfter: i }); break; }
  await sleep(10000);
}
const job = 'The job: Cashier at Maple Grocers.\n\nMy resume:\nShift lead at Corner Market, 3 years. Run the register, train new cashiers, count drawers nightly.';
for (const t of [
  { mode: 'interview', messages: [{ content: job + '\n\nStart the interview.' }] },
  { mode: 'interview', model: 'groq:qwen/qwen3.8-27b', messages: [{ content: job + '\n\nStart the interview.' }] },
  { mode: 'coach', model: 'groq:qwen/qwen3.8-27b', messages: [{ content: job + '\n\nHow should I prepare for this interview?' }] },
  { mode: 'feedback', model: 'groq:qwen/qwen3.8-27b', messages: [{ content: job + '\n\nQuestion: Tell me about handling cash.\nMy answer: I count three drawers every night and they always balance.' }] },
  { mode: 'coach', model: 'groq:openai/gpt-oss-20b', messages: [{ content: job + '\n\nHow should I prepare for this interview?' }] },
]) {
  const s = Date.now();
  try {
    const r = await fetch(U, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...t, debug: 1 }), signal: AbortSignal.timeout(120000) });
    out.push({ mode: t.mode, status: r.status, ms: Date.now() - s, body: (await r.text()).slice(0, 2500) });
  } catch (e) { out.push({ mode: t.mode, error: String(e) }); }
}
out.push({ at: new Date().toISOString() });
writeFileSync('probe/out/groq-2.json', JSON.stringify(out, null, 1));
