// One-off: exercise the Coach (live /interview endpoint) end to end with made-up people and jobs.
// Same requests the app sends (src/lib/coach.ts, mock-interview.tsx, chat.tsx, writer.ts).
import { writeFileSync, mkdirSync } from 'node:fs';
const URL = 'https://claude-project-thread-n6j5dp.jobbo-app.pages.dev/interview';
const log = [];
let calls = 0;
async function call(mode, turns) {
  const t0 = Date.now();
  calls++;
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, messages: turns.map((content) => ({ content })), debug: true }), signal: AbortSignal.timeout(90000) });
      const j = r.ok ? await r.json() : { status: r.status };
      return { ...j, ms: Date.now() - t0, status: r.status };
    } catch (e) { if (a) return { error: String(e), ms: Date.now() - t0 }; }
  }
}
function ctx(t, ask) {
  const p = [t.name ? `The job: ${t.name}.` : 'The job: not chosen yet, any job.'];
  if (t.posting) p.push('', 'The job posting:', t.posting);
  if (t.resume) p.push('', 'My resume:', t.resume);
  p.push('', ask);
  return p.join('\n');
}
const A = {
  name: 'Store Associate at Maple Grocers',
  posting: `About the job\nOur store team keeps shelves full and customers happy.\n\nResponsibilities\n- Greet customers and answer questions about products\n- Operate the cash register and handle cash accurately\n- Receive deliveries and stock shelves\n- Keep the store clean and organized\n\nRequirements\n- 1+ years of retail experience\n- Cash handling experience\n- Able to lift 40 lbs`,
  resume: `Jordan Lee\nDenver, CO · 555-201-3344 · jordan@example.com\n\nSUMMARY\nRetail and warehouse worker with 5 years of experience.\n\nEXPERIENCE\nShift Lead | Corner Market | 2021 – Present\n- Trained 6 new cashiers on the register and store rules\n- Counted and balanced 3 cash drawers every night with no shortages\n- Handled deliveries and stocked shelves before opening\n\nWarehouse Associate | FastShip Logistics | 2019 – 2021\n- Picked and packed 150+ orders per shift using a handheld scanner\n- Loaded and unloaded trucks safely\n\nSKILLS\nCash handling, inventory, forklift, Microsoft Excel`,
  person: 'Jordan Lee',
};
const B = {
  name: 'Front Desk Receptionist at Bright Smile Dental',
  posting: `Bright Smile Dental is a busy family dental office with 4 dentists.\n\nWhat you'll do\n- Greet patients and check them in and out\n- Answer a multi-line phone and schedule appointments\n- Verify dental insurance and collect co-pays\n- Keep patient records accurate and private (HIPAA)\n- Send appointment reminders\n\nWhat we're looking for\n- 1+ year front desk or customer service experience\n- Dental or medical office experience preferred\n- Experience with Dentrix or similar scheduling software a plus\n- Friendly, calm, and organized\n\nPay: $19-$22/hour. Monday to Friday, 8am-5pm.`,
  resume: `Sam Rivera\nTucson, AZ · sam.rivera@example.com\n\nEXPERIENCE\nServer | Casa Verde Restaurant | 2021 – 2024\n- Served 40-60 guests per shift in a 120-seat restaurant\n- Handled cash and card payments and closed out my own checks\n- Trained 3 new servers\n\nCustomer Service Rep | DesertLink Internet (call center) | 2024 – 2025\n- Answered about 70 calls a day about billing and service outages\n- Scheduled technician visits in Salesforce\n- Kept a 92% customer satisfaction score\n\nEDUCATION\nPima Community College, coursework in Medical Office Administration (2025)\n\nSKILLS\nSpanish (fluent), Salesforce, Microsoft Word, typing 55 wpm`,
  person: 'Sam Rivera',
};
const C = { name: 'Warehouse Associate at Northline Distribution', posting: `Join our night shift team.\n\nDuties\n- Pick and pack orders using RF scanners\n- Load and unload trailers\n- Keep work areas clean and safe\n\nRequirements\n- Able to lift 50 lbs and stand for 10 hours\n- Forklift certification a plus\n- Reliable attendance\n\n$18.50/hour, 4x10 night shifts`, resume: '', person: '' };
const BLANK = /\[[^\]\n]{2,80}\]/;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function chat(label, t, ask, answers) {
  const turns = [ctx(t, `My question: ${ask}`)];
  const convo = [{ me: ask }];
  for (let i = 0; i <= answers.length; i++) {
    const r = await call('coach', turns);
    const reply = r.reply || '';
    convo.push({ coach: reply, status: r.status, model: r.model, before: r.before, after: r.after, edits: r.edits, ms: r.ms, errors: r.errors, blank: BLANK.test(reply), questions: (reply.match(/\?/g) || []).length, words: reply.split(/\s+/).filter(Boolean).length });
    if (!reply || i === answers.length) break;
    turns.push(reply, answers[i]);
    convo.push({ me: answers[i] });
    await wait(10000);
  }
  log.push({ label, convo });
  writeFileSync('probe/out/star-results.json', JSON.stringify({ calls, log }, null, 1));
}
mkdirSync('probe/out', { recursive: true });
let seen = '';
for (let i = 0; i < 60; i++) { // wait until the preview site runs this build (round 5)
  seen = await fetch(URL.replace('/interview', '/functions-build.txt')).then((x) => x.status + ' ' + x.headers.get('content-type') + ' ' + (x.ok ? 'x' : '')).catch((e) => String(e));
  const t = await fetch(URL.replace('/interview', '/functions-build.txt')).then((x) => x.text()).catch(() => '');
  if (t.trim() === 'star4') { seen += ' ok after ' + i; break; }
  seen += ' got ' + t.slice(0, 30);
  await wait(15000);
}
log.push({ seen });
writeFileSync('probe/out/star-results.json', JSON.stringify({ calls, log }, null, 1));
if (!seen.includes(' ok after ')) process.exit(0);
await chat('A nervous', A, 'I get nervous in interviews. What helps?', ['The cash drawer one sounds good.']);
await wait(10000);
await chat('C no resume, nervous', C, 'I get nervous in interviews. What helps?', []);
await wait(10000);
await chat('A 30s story ask', A, 'Help me build a 30-second story for my interview', []);
await wait(10000);
await chat('B why this job', B, 'What do I say when they ask why I want to work here?', []);
await wait(10000);
await chat('B thank you', B, 'Write a short thank-you note to send after my interview', []);
await wait(10000);
await chat('B why leave', B, 'How do I answer "Why did you leave your last job?"', []);
writeFileSync('probe/out/star-results.json', JSON.stringify({ calls, log }, null, 1));
