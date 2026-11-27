// One-off live test of the coach on this branch's preview site, with made-up people and jobs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const SITE = 'https://claude-project-thread-20803l.jobbo-app.pages.dev';
const URL = SITE + '/interview';
const RUN = 'compare-1';
let calls = 0;
async function call(mode, turns, model) {
  const t0 = Date.now();
  calls++;
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, model, debug: 1, messages: turns.map((content) => ({ content })) }), signal: AbortSignal.timeout(120000) });
      const j = await r.json().catch(() => ({}));
      return { ...j, ms: Date.now() - t0, status: r.status };
    } catch (e) { if (a) return { error: String(e), ms: Date.now() - t0 }; }
  }
}
// Wait until the preview site serves this very script, so the new code is live.
const me = readFileSync(new globalThis.URL(import.meta.url), 'utf8');
for (let i = 0; i < 60; i++) {
  const t = await fetch(SITE + '/probe/step.mjs?' + Date.now()).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  if (t.trim() === me.trim()) break;
  await new Promise((r) => setTimeout(r, 10000));
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
const D = { name: 'IT Help Desk Technician at Lakeside School District', posting: `Support staff and students across 12 schools.\n\nResponsibilities\n- Answer help desk tickets by phone, email and in person\n- Reset passwords and manage accounts in Active Directory and Google Admin\n- Set up and repair Chromebooks and Windows laptops\n- Document fixes in our ticketing system\n\nQualifications\n- 1 year of help desk or IT support experience, or a related degree\n- CompTIA A+ preferred\n- Clear communicator with non-technical people`, resume: `Alex Kim\nalex.kim@example.com\n\nEDUCATION\nA.A.S. Information Technology, Harbor Community College, May 2026\n\nEXPERIENCE\nStudent Tech Assistant | Harbor CC Computer Lab | 2024 – 2026\n- Helped about 25 students a day with printing, Wi-Fi and login problems\n- Re-imaged 40 lab computers each semester\n\nCashier | QuickStop Gas | 2022 – 2024\n- Ran the register and opened the store alone on weekends\n\nSKILLS\nWindows 10/11, Google Workspace, basic networking, customer service`, person: 'Alex Kim' };
const MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/openai/gpt-oss-120b'];
const CASES = [
  ['letter', C, 'My name is not given. Write the body of my cover letter for this job.'],
  ['letter', A, 'My name is Jordan Lee. Write the body of my cover letter for this job.'],
  ['letter', D, 'My name is Alex Kim. Write the body of my cover letter for this job.'],
  ['feedback', A, "Interview question: Tell me about yourself.\n\nMy answer:\nUm, I'm Jordan. I've worked retail for a while and I'm a hard worker and I like people."],
  ['feedback', A, "Interview question: Tell me about a time you dealt with an upset customer.\n\nMy answer:\nA customer was mad about a price on the shelf being different from the register. I explained the sale ended. He was still mad but he paid."],
  ['feedback', A, "Interview question: How do you make sure your cash drawer is accurate?\n\nMy answer:\nAt Corner Market I close three drawers every night. I count each one twice, check it against the register report, and if anything's off I go back through the receipts before I leave. In three years we haven't had a shortage."],
  ['coach', A, 'My question: How do I answer "Why did you leave your last job?"'],
  ['coach', A, 'My question: How do I explain a gap in my work history?'],
  ['coach', A, 'My question: Write a short thank-you note to send after my interview'],
];
const out = { run: RUN, results: [] };
for (const model of MODELS) for (const [mode, p, ask] of CASES) {
  const r = await call(mode, [ctx(p, ask)], model);
  out.results.push({ model, mode, job: p.name, ask: ask.slice(0, 120), r });
}
out.calls = calls;
mkdirSync('probe/out', { recursive: true });
writeFileSync(`probe/out/${RUN}.json`, JSON.stringify(out, null, 1));
console.log('calls', calls);
