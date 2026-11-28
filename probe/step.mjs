// One-off live test of the coach on this branch's preview site, with made-up people and jobs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const SITE = 'https://claude-project-thread-20803l.jobbo-app.pages.dev';
const URL = SITE + '/interview';
const RUN = 'full-4';
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

// ---- Mock interview: a scripted candidate answering whatever is asked.
function bankFor(p) {
  if (p === A) return {
    intro: "I've been in retail about five years. Right now I'm a shift lead at Corner Market, a small neighborhood grocery, where I run the register, train new cashiers and handle the morning deliveries. Before that I worked two years in a warehouse picking orders. I'm looking for a bigger store with more hours.",
    vague: "I'm pretty good with customers I guess.",
    stories: [
      "A guy came in really upset because we'd charged him twice for a case of water. I said sorry right away, checked the receipt, and saw the double scan. I refunded him on the spot and gave him a coupon. He calmed down and he still comes in every week.",
      "One night my drawer was twenty dollars short when I counted it. I recounted, then went back through the receipts and found a refund I'd keyed wrong. I fixed it in the system and wrote it up for my manager so it wouldn't happen again.",
      "When we got two new cashiers the same week before Thanksgiving, I made a one page cheat sheet for the register and stood next to each of them for their first few shifts.",
    ],
    duties: [
      "I count three drawers every night and they've balanced every time. I count twice and keep big bills under the tray.",
      "At Corner Market I take the deliveries before opening, check them against the invoice, and get everything on the shelves before we open at seven.",
      "I'd walk them to the aisle instead of pointing, and if I don't know, I'd find someone who does.",
    ],
    situation: "I'd stay calm, listen to the whole problem first, and fix what I can right there. If it's something I can't fix, like a big refund, I'd get the manager and stay with the customer.",
    physical: "Yes. I lift cases all day now, and in the warehouse I loaded trucks every shift.",
    followup: "It was probably about ten deliveries a week, and it took me around an hour each morning.",
    question: "What does a good first month look like for someone in this job? And how are shifts scheduled?",
  };
  return {
    intro: "I've worked with people for about four years. I was a server at Casa Verde for three years and then I worked at DesertLink's call center, answering billing and outage calls. I took medical office classes at Pima this year because I want to work in healthcare.",
    vague: "I'm organized, I think.",
    stories: [
      "At the call center a customer called furious because his internet had been out for three days and he works from home. I apologized, checked the outage map, and saw his area was fixed but his modem wasn't. I walked him through a reset and when that didn't work I booked a tech for the next morning. He thanked me at the end of the call.",
      "At Casa Verde we got slammed one Friday when two servers called out. I took two extra tables and asked the host to seat my section in waves so the kitchen wouldn't get buried. We got through the night without anyone walking out.",
      "When Salesforce changed at work, I made notes for myself and shared them with two new people.",
    ],
    duties: [
      "At the call center I scheduled technician visits every day, so I'm used to booking appointments while someone is on the line.",
      "I haven't verified dental insurance yet. In my classes we covered insurance basics, and at DesertLink I explained billing every day, so I'd learn your process fast.",
      "I answered about seventy calls a day, so a busy phone doesn't scare me.",
    ],
    situation: "I'd smile, tell the patient in the lobby I'll be right with them, put the caller on a short hold, and check the patient in. Then I'd go back to the phone.",
    physical: "Yes, that schedule works for me.",
    followup: "It was about seventy calls a day, and my satisfaction score was ninety two percent.",
    question: "What software do you use for scheduling, and is there training for it?",
  };
}
function answer(bank, q, n, used) {
  const s = q.toLowerCase();
  if (n === 2) return bank.vague; // second answer is deliberately weak
  if (/questions? for (me|us)|anything you'd like to ask|any questions/.test(s)) return bank.question;
  if (/how did (that|it) (turn out|end)|what happened next|what did you do next|result|how many|roughly|how often|how much/.test(s) && used.lastWasStory) return bank.followup;
  if (/yourself|walk me through|background/.test(s) && !used.intro) { used.intro = 1; return bank.intro; }
  if (/lift|physical|stand|schedule work|hours work|available/.test(s)) return bank.physical;
  if (/what would you do|how would you (handle|deal)|imagine|suppose|let's say|if a (customer|patient|caller)/.test(s)) return bank.situation;
  if (/time when|a time|an example|give me an example|describe a (situation|time)|tell me about a/.test(s) && bank.stories.length) { used.lastWasStory = 1; return bank.stories.shift(); }
  used.lastWasStory = 0;
  return bank.duties.length ? bank.duties.shift() : "I'd say I'm reliable. I show up on time and I don't leave work for the next shift.";
}
const START = 'Start the interview. Greet me by saying who you are in one short sentence (make up a first name and use the job title of the person I would report to), say it will take about fifteen minutes, then ask the first question.';
async function interview(p) {
  const bank = bankFor(p);
  const used = {};
  const turns = [ctx(p, START)];
  const times = [];
  let n = 0;
  while (turns.length < 33) {
    const r = await call('interview', turns);
    times.push(r.ms);
    if (!r.reply) { turns.push(`[ERROR ${JSON.stringify(r)}]`); break; }
    const end = /\s*\[END\]\s*$/i.test(r.reply);
    turns.push(r.reply.replace(/\s*\[END\]\s*$/i, '').trim());
    if (end || turns.length + 1 >= 33) break;
    n++;
    turns.push(answer(bank, r.reply, n, used));
  }
  const lines = turns.slice(1).map((t, i) => `${i % 2 === 0 ? 'Interviewer' : 'Me'}: ${t}`);
  const rev = await call('review', [ctx(p, `The interview:\n${lines.join('\n').slice(-9000)}`)]);
  return { job: p.name, transcript: lines, times, review: rev };
}

const FEEDBACK = [
  [A, 'Tell me about yourself.', "Um, I'm Jordan. I've worked retail for a while and I'm a hard worker and I like people."],
  [A, 'Tell me about a time you dealt with an upset customer.', "A customer was mad about a price on the shelf being different from the register. I explained the sale ended. He was still mad but he paid."],
  [A, 'How do you make sure your cash drawer is accurate?', "At Corner Market I close three drawers every night. I count each one twice, check it against the register report, and if anything's off I go back through the receipts before I leave. In three years we haven't had a shortage."],
  [A, 'Why do you want to work at Maple Grocers?', 'More hours.'],
  [B, 'Do you have experience with dental insurance?', "No, not really, but I can learn."],
  [D, 'A teacher says her Chromebook won\'t connect to Wi-Fi five minutes before class. What do you do?', "I'd go to the room, check if Wi-Fi is on, forget the network and reconnect, and if that doesn't work give her a loaner so class can start, then fix it after."],
];
const COACH = [
  [A, 'How do I answer "Why did you leave your last job?"'],
  [A, 'What do I say when they ask about pay?'],
  [A, 'How do I explain a gap in my work history?'],
  [A, 'Write a short thank-you note to send after my interview'],
  [A, 'I get nervous in interviews. What helps?'],
  [A, 'What should I ask at the end of the interview?'],
  [B, "How do I explain that I don't have dental office experience?"],
  [{ name: '', posting: '', resume: '' }, 'I got fired from my last job for being late too many times. How do I explain that?'],
];
const E = { name: 'Customer Service Representative at Pine Valley Bank', posting: `Help customers by phone and chat with accounts, cards and online banking.\n\n- Answer 50+ calls a day\n- Explain fees and fix simple account problems\n- 1 year of customer service experience`, resume: `Taylor Brooks\n\nEXPERIENCE\nCashier | Sunny Mart | 2015 – 2019\n- Ran the register and balanced the drawer every shift\n- Answered customer questions and handled returns\n\nSKILLS\nCash handling, customer service`, person: 'Taylor Brooks' };
COACH.push([E, 'How do I explain a gap in my work history?'], [E, 'Write a short thank-you note to send after my interview']);
const LETTERS = [A, A, B, C, C, D, E];

const out = { interviews: [], feedback: [], coach: [], letters: [] };
// interviews unchanged since full-2: for (const p of [A, B]) out.interviews.push(await interview(p));
for (const [p, q, a] of FEEDBACK) out.feedback.push({ job: p.name, q, a, r: await call('feedback', [ctx(p, `Interview question: ${q}\n\nMy answer:\n${a}`)]) });
for (const [p, q] of COACH) {
  const first = ctx(p, `My question: ${q}`);
  const r = await call('coach', [first]);
  const item = { job: p.name || '(any job, no resume)', q, r };
  if (p === A && /leave/.test(q) && r.reply) item.follow = { q: "I'm still working there. I just want more hours and a bigger store.", r: await call('coach', [first, r.reply, "I'm still working there. I just want more hours and a bigger store."]) };
  out.coach.push(item);
}
for (const p of LETTERS) out.letters.push({ job: p.name, r: await call('letter', [ctx(p, `My name is ${p.person || 'not given'}. Write the body of my cover letter for this job.`)]) });
out.calls = calls;
mkdirSync('probe/out', { recursive: true });
writeFileSync(`probe/out/${RUN}.json`, JSON.stringify(out, null, 1));
console.log('calls', calls);
