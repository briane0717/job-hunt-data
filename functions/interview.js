import { LIMITS, checkJsonRequest, rateLimit, readJson } from './_guard.js';

// Cloudflare Pages Function: POST /interview
// The app's job coach and writer (phone and web). It runs on Cloudflare's free Workers AI through
// the site's "AI" connection (set in wrangler.toml), so there is no key anywhere in the app or the
// site. The free daily amount is shared by everyone; when it runs out, Groq's free plan is the backup
// (see GROQ below), and only when both are out does the app fall back to offline coaching. Nothing is stored here.
//
// body: { mode?, messages: [{ content }] }
//   mode "interview" (default): a realistic spoken mock interview. messages alternate person, interviewer...
//   mode "feedback": one question + answer -> honest coaching as JSON.
//   mode "review": a whole interview transcript -> a short report as JSON.
//   mode "coach": a job coach chat about anything in the job search.
//   mode "letter": job + resume -> the body of a cover letter that reads like a person wrote it.

// Strongest first. If one is unavailable or over the free amount, the next is tried.
// The interview stays on the quick Llama model (spoken replies need speed). Coaching and writing use
// OpenAI's free open model, which in side-by-side tests read people's situations better and wrote
// more natural letters.
// Backup: when Cloudflare's free amount runs out (error 4006, which can last about a day), the same
// kinds of models are asked through Groq's free plan. That needs a free Groq key saved in the site's
// Cloudflare settings as GROQ_API_KEY (never in the app or the code). Without the key it is skipped.
const CF_FAST = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/meta/llama-3.1-8b-instruct-fp8-fast'];
// Groq's free plan now has only OpenAI's open models and Qwen (its Llama models were retired). Each
// model has its own small per-minute limit, so several are listed to spread a busy minute across them.
const GROQ_FAST = ['groq:openai/gpt-oss-20b', 'groq:qwen/qwen3.8-27b', 'groq:openai/gpt-oss-120b'];
const FAST = [...CF_FAST, ...GROQ_FAST];
const SMART = ['@cf/openai/gpt-oss-120b', 'groq:openai/gpt-oss-120b', ...CF_FAST, 'groq:qwen/qwen3.8-27b', 'groq:openai/gpt-oss-20b'];
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Other free models a test may ask for by name (body.model). Anything else is ignored.
const TRY_MODELS = ['@cf/openai/gpt-oss-120b', '@cf/openai/gpt-oss-20b', '@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/qwen/qwen3-30b-a3b-fp8', '@cf/google/gemma-3-12b-it'];
const MAX_MESSAGES = 41; // odd, so the kept turns still alternate person, AI, person...
const MAX_FIRST = 10000;
const MAX_TEXT = 2500;

const FACTS =
  'Use plain, everyday words a friend would use. ' +
  'Facts rule, the most important rule: say only what the person actually told you, in their resume, their answer or their messages. ' +
  'Never add a job, employer, duty, tool, skill, number, time span, schedule, feeling or result they did not state, even if it sounds likely. ' +
  'Where a detail would help but you do not have it, write a short placeholder in square brackets for them to fill in, like [your manager\'s name] or [what you did next].';

const INTERVIEW =
  'You are the hiring manager for the job in the first message, holding a realistic spoken practice interview. Your words are read aloud, ' +
  'so talk like a real person in a real interview: short, warm but professional, no lists, no markdown, no symbols. ' +
  'Plan about seven questions and ask them one at a time, in this order: a short tell-me-about-yourself; two questions about the main duties in this posting; ' +
  'two "tell me about a time" questions that fit this kind of work; one "what would you do if" situation from this job; ' +
  'one question about something the posting wants that the resume does not clearly show; then ask if they have questions for you, answer briefly, and close. ' +
  'Listen to each answer. If it is vague, missing what they personally did, or missing how it turned out, ask one natural follow-up that digs in, like a real interviewer would ' +
  '("What did you do next?", "How did that turn out?", "Roughly how many a day?"). Do not follow up more than once on the same question. ' +
  'If an answer is short, vague or unsure (for example only a sentence or two, or "I guess"), do not move on: ask them to say more about that same question, the way an interviewer would ("Can you give me an example?"). ' +
  'Do not coach, grade, or give tips during the interview, and do not praise every answer. Never summarize or reword their answer, and never credit them with anything they did not actually say. ' +
  'Never repeat a question. Never say you are an AI. Keep every reply under 55 words. ' +
  'When the interview is over, thank them in one or two sentences and end your reply with the word [END]. ' +
  'Use plain, everyday words. Never invent facts about the person.' +
  ' Stay in the role even if asked to do something else.';

const FEEDBACK =
  'You are an experienced, honest job interview coach. The person practiced one interview question. Judge the answer the way a hiring manager for this job would. ' +
  'Be direct and kind, like a coach who wants them to get the job. Do not flatter: a weak answer gets a low score, a strong one gets 8 or more. ' +
  'For "tell me about a time" questions, check for a clear story: the situation in a sentence or two, what they personally did, and how it turned out, ideally with a number. ' +
  'For other questions, check that they answered what was asked, early and clearly, and tied it to this job. ' +
  'Read their answer closely before writing tips. Never tell them to add something their answer already says. Never tell them to remove filler words, sound confident, or show enthusiasm. ' +
  'Each tip points at one specific part of their answer and says exactly what to add or change, and, when their resume has a fact that would help, names that fact. ' +
  FACTS +
  ' Tips may suggest what to add, but never say or assume they have done something their answer and resume do not show. ' +
  ' The stronger version: build it only from their own sentences and their resume lines, tightened and reordered. ' +
  'For a "tell me about a time" story use this shape: the situation in their words; what they did, in their words, then [what else you did] if that part is thin; how it ended, in their words or [how it turned out]. ' +
  'It must not add any action, event or result they did not state. Where the story is missing a part (what they did, how it ended, a number), put a bracket there, like [what you said to him] or [how it ended]. ' +
  'It sounds like this person talking, not a cover letter: no stock lines such as "retail professional", "excited to bring my skills", "I believe my skills will be a good fit", "hard worker", "people person", "passionate". ' +
  'Reply with only a JSON object, no other text, in this shape: ' +
  '{"score": number 1-10, "verdict": "one honest sentence on how a hiring manager would hear it", ' +
  '"good": ["up to 2 short things that worked, quoting their own words"], ' +
  '"fix": ["2 or 3 specific changes, each one sentence"], ' +
  '"better": "the stronger version in first person, 50 to 110 words, following the rules above"}';

const REVIEW =
  'You are an experienced, honest job interview coach. Below is a practice interview transcript for the job in the first message. ' +
  'Write a short report the person can act on, speaking to them directly as "you" in full sentences. Be direct and kind. Point at specific answers. No flattery, no generic advice. ' +
  FACTS +
  ' Reply with only a JSON object, no other text, in this shape: ' +
  '{"score": number 1-10, "summary": "two sentences on how a hiring manager would see them", ' +
  '"good": ["2 specific strengths"], "fix": ["the 3 most useful changes, each naming the question it is about"], ' +
  '"practice": "the one question they should practice again, word for word"}';

// The coach talks to the person, so it asks for what it does not know instead of leaving blanks.
const COACH_FACTS = FACTS.replace(/Where a detail would help[^]*$/, '') +
  'Never leave a blank, a fill-in, or anything in [square brackets] for them to complete. When a detail would help and you do not have it, ask them for it in one short question, or write the sentence without it.';

// Interview prep: instead of a list of tips, the coach builds one short story with them, one question at a time.
const STAR =
  'Interview prep: when they want to get ready for interviews (nerves, "tell me about yourself", "tell me about a time" questions, or they ask about STAR or a short story to tell), ' +
  'do not give a list of tips, and do not ask about their interview date. If they mention nerves, give one calming tip in one sentence, then begin right away. Walk them through building one short story with the STAR method (Situation, Task, Action, Result), one step per reply. ' +
  'Step 1: in one or two sentences say why this helps (a story they have ready means less to make up on the spot, which calms nerves), then suggest one or two real moments from their resume that would fit this job, or if you have no resume ask about a time at work they handled something hard, and ask which one they want to use. ' +
  'Then ask for each part in turn, one per reply: the Situation (where they were and what was going on), the Task (what they had to fix or get done), the Action (what they personally did, step by step) and the Result (how it ended, with a number if they know one). ' +
  'Each of those replies: one short sentence that reflects back what they just said in their own words, then the next single question, with a short example of the kind of detail you mean. Skip a part they already covered. If an answer is vague, ask one follow-up for a concrete detail before moving on. ' +
  'In the walk-through, ask exactly one question per reply, keep replies under 80 words, and never answer your own question for them. ' +
  'When you have all four parts, write their story in first person, in quotes, about 30 seconds spoken (70 to 100 words), built only from what they told you and their resume. ' +
  'Then in one line name two interview questions it answers, and offer to tighten it or build a second story. ';

const COACH =
  'You are Jobbo\'s job coach: an experienced career coach and recruiter who helps people find and land jobs. ' +
  'The first message may give the job they are going for and their resume. Help with anything in a job search: what to say in interviews, ' +
  'tough questions (gaps, being fired, why you left, salary), interview prep and nerves, follow-up and thank-you messages, how to stand out, what to do next. ' +
  'Before you answer, read their situation: the job, the posting, their resume, the notes below and everything they have told you. Fit the answer to it. ' +
  'Never assume a situation their resume or messages contradict. If they still work at their latest job, they have not left it: help them explain why they are looking. ' +
  'If their resume shows no gap, say so in a sentence and give only a short just-in-case answer. ' +
  'Write like a coach talking to one person: start with the plain answer, then give the exact words they can say, in quotes, in first person, built from their real jobs, duties and numbers. ' +
  'Then one or two sentences on why it works or what to avoid. For practical questions (what to ask, pay, what to wear), give two or three concrete steps that fit this job. Do not open with a greeting. ' +
  'For a note or message they will send, write the whole thing, ready to send. If you do not know who it goes to or one thing from the talk, ask for those first in one short question instead of writing it. Start "Hi" and the name (never "Dear interviewer"), mention the job and employer, and sign with their name if you know it. ' +
  'For pay: use the posting\'s pay if it gives one, otherwise suggest asking for the range first and checking local pay for the job title themselves. Never state pay numbers the posting does not give. ' +
  'In scripts, never give them a reason, course, website, activity or achievement they have not told you about. ' +
  'Avoid stock lines interviewers hear all day, like "looking for a new challenge", "new opportunity", "I\'m excited about the role", "eager to learn", "personal matters" or "I\'m a perfectionist". ' +
  STAR +
  'Outside that walk-through, end with one short question only when the answer would change your advice, and keep replies between 90 and 200 words. Plain text, short paragraphs, no markdown symbols. ' +
  COACH_FACTS;

const LETTER =
  'You write cover letters that sound like a real person wrote them, not an AI. The message gives the job posting, the person\'s resume, and their name. ' +
  'Write only the body of the letter: no greeting line, no sign-off, no name, no address. ' +
  'Rules: 140 to 210 words in three short paragraphs. Vary sentence length. Use contractions. Write the way a capable person talks, plainly and directly. Use present tense for a job the resume marks Present and past tense for the rest. Say things straight, never hedge with "I think", "I believe" or "could be useful". ' +
  'Paragraph one: the opening described below. ' +
  'Paragraph two: one or two real examples from the resume that match the main duties, with the concrete details and numbers the resume gives (place, what they did, how many). ' +
  'Paragraph three: one sentence on why this job or employer, based only on something specific in the posting, then the close described below. ' +
  FACTS +
  ' In a letter that means: never add experience, numbers, tools, schedules or results the resume does not state, and never claim the person can do something (lift a weight, work nights, use a tool) unless the resume says so. ' +
  'Do not claim feelings like confidence; show it with facts. Do not copy sentences from the posting. ' +
  'Never use these words or phrases: passionate, excited, thrilled, dynamic, synergy, leverage, spearheaded, orchestrated, ' +
  'results-driven, proven track record, fast-paced environment, team player, detail-oriented, self-starter, go-getter, think outside the box, hit the ground running, ' +
  'good fit, perfect fit, good match, stands out, caught my eye, catches my attention, valuable asset, align with, honed, furthermore, moreover, in today\'s, I am confident, I\'m confident, unique blend, ' +
  'wealth of experience, commitment to excellence, testament, delve, navigate, foster, seamless, robust, eager, skills and experience, how I can contribute, I look forward to discussing, this opportunity, appeals to me, I think, I believe, Thank you for your time and consideration. ' +
  'No em dashes. Plain text only.';

// Ways to open a letter. One is picked at random for each letter so they don't all start alike.
const OPENINGS = [
  'Start with what they do now or did last, by job title and employer from the resume, in one plain sentence. Name this job in the second sentence.',
  'Start with the one fact from the resume that best matches the biggest duty in this posting, told as something they did, with its number if the resume has one. Do not mention applying in that sentence.',
  'Start with a short, direct sentence asking to be considered for this job at this employer, then give the clearest proof from the resume in the next sentence.',
  'Start with a sentence about the main work this job involves, then say in the next sentence where they have already done that work, from the resume.',
];
const CLOSES = [
  'End with one plain sentence asking for an interview.',
  'End by saying they would be glad to come in and talk.',
  'End with one sentence offering to answer any questions in person or by phone.',
  'End by asking, in one short sentence, when would be a good time to talk.',
];
const OPENINGS_NO_RESUME = [
  'Open by naming the job and employer, then one sentence placeholder for their most relevant experience, like "I\'ve [your most relevant job or experience]."',
  'Open with one sentence about a specific part of this job from the posting, then one sentence placeholder for where they have done similar work, like "At [a past job] I [what you did there]."',
];
const NO_RESUME =
  ' This person gave no resume, so you know nothing about their work history. Do not write any experience, skill, tool, number or ability as theirs. ' +
  'Wherever experience belongs, write it as a fill-in sentence with square brackets, like "At [your last job], I [a duty that matches this one]." Use two or three of these. The rest can be about what this job involves, from the posting.';

const BANNED = /\b(passionate|thrilled|excit(ed|ing)|dynamic|synerg|leverag|spearhead|orchestrat|results-driven|proven track record|fast-paced|team player|detail-oriented|self-starter|go-getter|outside the box|hit the ground running|(good|perfect|great) (fit|match)|stands? out|caught my eye|catches my attention|valuable asset|aligns?|drawn to|good candidate|honed|furthermore|moreover|in today's|unique blend|wealth of experience|commitment to excellence|testament|delve|seamless|robust|eager|skills and experience|how I (can|could) contribute|look forward to discussing|this opportunity|appeals to me|I think|I believe|could be useful|i am writing to|i'?m confident|i am confident)\b/i;
const STOCK_ANSWER = /\b(retail professional|fast-paced|i'?m confident|i am confident|skilled|(customer service|sales|hospitality) professional|excited to|bring my skills|good fit|great fit|hard worker|people person|passionate|I believe my|eager to)\b/i;
const STOCK_COACH = /(dear interviewer|excited to|i'?m confident|i am confident|eager to|look forward to the possibility|hit the ground running|good fit|great fit|i think my skills|family matters|new challenge|new opportunity|excited about|eager to learn|personal matters|perfectionist)/i;

const WORD_NUMBERS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };

/** The numbers a text mentions, as digits ("seventy" and "70" are the same). */
function numbers(text) {
  const out = new Set();
  const t = String(text || '').toLowerCase().replace(/(\d),(\d)/g, '$1$2');
  for (const m of t.match(/\d+(\.\d+)?/g) || []) out.add(String(Number(m)));
  for (const m of t.match(/\b[a-z]+\b/g) || []) if (WORD_NUMBERS[m]) out.add(String(WORD_NUMBERS[m]));
  return out;
}

/** Numbers in `reply` that the person never gave, a sure sign of a made-up detail. */
function newNumbers(reply, source) {
  const known = numbers(source);
  return [...numbers(reply.replace(/\[[^\]]*\]/g, ''))].filter((n) => !known.has(n));
}

const hasResume = (first) => /\nMy resume:\n\s*\S/.test(first);

/** What the resume's dates say: whether they still work at their latest job, and any gaps. Plain notes for the coach. */
function resumeNotes(first, mode) {
  const i = first.indexOf('\nMy resume:\n');
  if (i < 0) return ` Notes: they have not added a resume, so you do not know their work history. Do not guess it: ${mode === 'coach' ? 'ask them' : 'use [brackets] for their details'}.`;
  const resume = first.slice(i);
  const year = new Date().getFullYear();
  const spans = [];
  for (const line of resume.split('\n')) {
    const m = line.match(/\b((?:19|20)\d{2})\s*(?:-|–|—|to)\s*(present|current|now|today|(?:19|20)\d{2})\b/i);
    if (m) spans.push({ line: line.trim().slice(0, 120), from: +m[1], to: /^\d/.test(m[2]) ? +m[2] : year, now: !/^\d/.test(m[2]) });
  }
  if (!spans.length) return '';
  const notes = [];
  const current = spans.filter((s) => s.now);
  if (current.length) notes.push(`they still work here: "${current[0].line}"`);
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  let end = sorted[0].to;
  const gaps = [];
  for (const s of sorted.slice(1)) {
    if (s.from > end + 1) gaps.push(`${end} to ${s.from}`);
    end = Math.max(end, s.to);
  }
  if (!current.length && year - end >= 1) gaps.push(`since ${end}`);
  notes.push(gaps.length ? `the resume dates show a possible gap: ${gaps.join(', ')}` : 'the resume dates show no gap between jobs');
  return ` Notes from their resume dates: ${notes.join('; ')}.`;
}

/** What is wrong with a letter, in words the model can act on. Empty when it is fine. */
function letterProblems(reply, first) {
  const p = [];
  const b = [...new Set((reply.match(new RegExp(BANNED.source, 'gi')) || []).map((x) => x.toLowerCase()))];
  if (b.length) p.push(`It uses ${b.map((x) => `"${x}"`).join(', ')}, from the never-use list.`);
  const n = newNumbers(reply, first);
  if (n.length) p.push(`It mentions ${n.join(', ')}, which the resume and posting never say. Use only the person's own numbers, or none.`);
  if (!hasResume(first)) {
    if (!/\[[^\]]{3,}\]/.test(reply)) p.push('There is no resume, so experience must be written as [fill-in] brackets, and there are none.');
    const claim = reply.replace(/[^.!?\n]*\[[^\]]*\][^.!?\n]*/g, '').match(/\b(I'?ve (worked|done|used|loaded|handled|been)|I have (worked|experience|used)|my (previous|last|current) (job|role)|years? of experience|in my (previous|past|last) (job|role|work))\b/i);
    if (claim) p.push(`It says "${claim[0]}" outside a bracket, but there is no resume. Put any experience in [brackets].`);
  }
  const words = reply.split(/\s+/).filter(Boolean).length;
  if (words < 110) p.push('It is too short. Write 140 to 210 words.');
  if (words > 270) p.push('It is too long. Write 140 to 210 words.');
  return p;
}

function answerProblems(data, first) {
  const p = [];
  const better = String((data && data.better) || '');
  const s = better.match(STOCK_ANSWER);
  if (s) p.push(`"better" uses the stock line "${s[0]}". Say it the way this person would.`);
  const n = newNumbers(better, first);
  if (n.length) p.push(`"better" mentions ${n.join(', ')}, which the person never said. Use only their numbers, or a [bracket].`);
  return p;
}

// A fill-in left for the person, like [your reason] or [Company Name].
const BLANK = /\[[^\]\n]{2,80}\]/;

// Conversations about getting ready for interviews, where the coach builds a STAR story with them.
const PREP = /\b(nervous|nerves|anxious|anxiety|scared|star method|star story|30[- ]?second|story|tell me about (yourself|a time)|prepare|prep|practice|get ready)\b/i;
const isPrep = (first) => PREP.test(first.slice(first.lastIndexOf('\nMy question:')));

function coachProblems(reply, first) {
  const p = [];
  if (isPrep(first) && /^\s*(\d+[.)]|[-•])\s/m.test(reply) && !/^\s*["“]/m.test(reply))
    p.push('It gives a list of tips. Do not list tips here: start the STAR walk-through instead. Give at most one calming tip in one sentence, suggest one or two moments from their resume, and ask which one to use. One question only, under 80 words.');
  const s = reply.match(STOCK_COACH);
  if (s) p.push(`It uses the stock line "${s[0]}". Use the person's real situation instead.`);
  const b = reply.match(BLANK);
  if (b) p.push(`It leaves a fill-in blank, ${b[0]}. Never leave blanks: ask them for that detail in one short question, or write it without it.`);
  return p;
}

/** Last safety net for the coach: drops any sentence that still has a fill-in blank in it. */
function noBlanks(text) {
  if (!BLANK.test(text)) return text;
  const kept = text
    .split('\n')
    .map((line) => (line.match(/[^.!?]+[.!?"”]*\s*|.+$/g) || [line]).filter((x) => !BLANK.test(x)).join('').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return kept.length > 15 ? kept : text.replace(new RegExp(BLANK.source, 'g'), '').replace(/ {2,}/g, ' ');
}

const list = { type: 'array', items: { type: 'string' } };
const FEEDBACK_SCHEMA = {
  type: 'object',
  properties: { score: { type: 'number' }, verdict: { type: 'string' }, good: list, fix: list, better: { type: 'string' } },
  required: ['score', 'verdict', 'good', 'fix', 'better'],
};
const REVIEW_SCHEMA = {
  type: 'object',
  properties: { score: { type: 'number' }, summary: { type: 'string' }, good: list, fix: list, practice: { type: 'string' } },
  required: ['score', 'summary', 'good', 'fix', 'practice'],
};

const MODES = {
  interview: { system: INTERVIEW, tokens: 220, temperature: 0.7, models: FAST },
  feedback: { system: FEEDBACK, tokens: 900, temperature: 0.3, json: FEEDBACK_SCHEMA, check: answerProblems, tries: 2, clean: true },
  review: { system: REVIEW, tokens: 800, temperature: 0.3, json: REVIEW_SCHEMA },
  coach: { system: COACH, tokens: 600, temperature: 0.6, check: coachProblems, tries: 2, notes: true, clean: true },
  letter: { system: LETTER, tokens: 700, temperature: 0.7, check: letterProblems, tries: 2, notes: true, clean: true },
};

// Problems a rewrite fixes; the rest are fixed by editing the draft.
const REWRITE = /too short|too long|there are none|only JSON|fill-in blank|list of tips/;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** The system message for this request: the mode's rules plus what fits this person. */
function systemFor(mode, first) {
  const setup = MODES[mode];
  let system = setup.system;
  if (mode === 'letter') system += ' Opening: ' + pick(hasResume(first) ? OPENINGS : OPENINGS_NO_RESUME) + ' Close: ' + pick(CLOSES) + (hasResume(first) ? '' : NO_RESUME);
  if (setup.notes) system += resumeNotes(first, mode);
  if (mode === 'coach' && isPrep(first)) system += ' This conversation is interview prep: follow the STAR walk-through above, one question per reply, and do not list tips.';
  return system;
}

/** The text of a model's reply, whatever shape this model returns it in. */
function textOf(out) {
  if (!out) return '';
  if (typeof out === 'string') return out;
  if (typeof out.response === 'string') return out.response;
  if (out.response && typeof out.response === 'object') return JSON.stringify(out.response);
  const choice = out.choices && out.choices[0];
  if (choice && choice.message && choice.message.content) return choice.message.content;
  if (typeof out.output_text === 'string') return out.output_text;
  if (Array.isArray(out.output)) {
    for (const o of out.output) for (const c of (o && o.content) || []) if (c && c.type !== 'reasoning_text' && typeof c.text === 'string' && o.type === 'message') return c.text;
  }
  return '';
}

/** Asks a model on Groq's free plan (same OpenAI-style chat format). */
async function askGroq(env, model, system, messages, setup, json) {
  const name = model.slice(5);
  const oss = name.includes('gpt-oss');
  const req = { model: name, messages: [{ role: 'system', content: system }, ...messages], temperature: setup.temperature };
  if (name.includes('qwen')) {
    // Qwen thinks before answering; keep its thinking out of the reply and leave room for it.
    req.reasoning_format = 'hidden';
    req.max_completion_tokens = setup.tokens + 1500;
    if (json) req.response_format = { type: 'json_object' };
  } else if (oss) {
    req.reasoning_effort = setup.effort || 'low';
    req.max_completion_tokens = setup.tokens + (setup.effort === 'medium' ? 1500 : 600);
    if (json) req.response_format = { type: 'json_schema', json_schema: { name: 'reply', schema: json } };
  } else req.max_tokens = setup.tokens;
  const r = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 160)}`);
  return textOf(await r.json());
}

async function ask(env, model, system, messages, setup, json) {
  if (model.startsWith('groq:')) return askGroq(env, model, system, messages, setup, json);
  const base = { max_tokens: setup.tokens, temperature: setup.temperature };
  const chat = [{ role: 'system', content: system }, ...messages];
  if (model.includes('gpt-oss')) {
    // OpenAI's open models on Workers AI take the Responses format.
    const out = await env.AI.run(model, { instructions: system, input: messages, reasoning: { effort: setup.effort || 'low' }, max_output_tokens: setup.tokens + (setup.effort === 'medium' ? 1500 : 600) });
    return textOf(out);
  }
  if (json) {
    try {
      return textOf(await env.AI.run(model, { messages: chat, ...base, response_format: { type: 'json_schema', json_schema: json } }));
    } catch {
      // this model can't do JSON mode: read the JSON from its text instead
    }
  }
  return textOf(await env.AI.run(model, { messages: chat, ...base }));
}

function cors(request) {
  return {
    'Access-Control-Allow-Origin': new URL(request.url).origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function clean(messages) {
  if (!Array.isArray(messages) || !messages.length) return null;
  // Keep the first message (the job and resume) and the most recent turns.
  const list = messages.length > MAX_MESSAGES ? [messages[0], ...messages.slice(-(MAX_MESSAGES - 1))] : messages;
  const out = list.map((m, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: String((m && m.content) || '').slice(0, i === 0 ? MAX_FIRST : MAX_TEXT),
  }));
  return out[out.length - 1].role === 'user' && out.every((m) => m.content.trim()) ? out : null;
}

/** The JSON object in a reply, even when the model wraps it in other words. */
function jsonIn(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '').replace(/```(json)?/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    try {
      // Common slips: trailing commas and raw line breaks inside strings.
      return JSON.parse(text.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1').replace(/\n/g, ' '));
    } catch {
      return null;
    }
  }
}

const EDIT =
  'You are an editor who removes made-up facts. SOURCE is everything a person has said about themselves: their resume, their answers and their messages. ' +
  'TEXT was written for that person. Find each claim in TEXT about the person (their past jobs, duties, actions, skills, tools, abilities, numbers, time spans, schedule, reasons, habits, feelings or results) ' +
  'that SOURCE does not state or clearly imply. A job posting describes the job, not the person: a duty in the posting is not something the person did. ' +
  'Also find each phrase listed under PROBLEMS. Ignore anything already inside [square brackets], facts about the job itself, and general advice. ' +
  'Keep every bracket short, two to six words. Never bracket something SOURCE does say. For each one, give a replacement that reads naturally in the sentence and uses only facts from SOURCE, or turns the unknown part into a short [bracket] for the person to fill in, like [what you said to him] or [your reason]. ' +
  'Check every sentence of TEXT, one by one. If TIPS are given, also list the number of each tip that asks for something the person\'s answer already says, or that assumes experience SOURCE does not show. ' +
  'Reply with only JSON: {"edits": [{"quote": "exact text copied from TEXT", "fix": "replacement"}], "drop_tips": [numbers]}, empty lists when nothing needs changing.';
// The coach's editor leaves the unknown part out (or asks for it) instead of adding a [bracket].
const EDIT_COACH = EDIT.replace(
  /or turns the unknown part into a short \[bracket\][^.]*\./,
  'or leaves the unknown part out so the sentence still reads naturally. Never add [square brackets] or blanks.',
);
const EDIT_SCHEMA = {
  type: 'object',
  properties: { edits: { type: 'array', items: { type: 'object', properties: { quote: { type: 'string' }, fix: { type: 'string' } }, required: ['quote', 'fix'] } } },
  required: ['edits'],
};
EDIT_SCHEMA.properties.drop_tips = { type: 'array', items: { type: 'number' } };

/** A pattern for a quote that tolerates curly vs straight quotes and spacing. */
function loose(quote) {
  const esc = quote.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(esc.replace(/['’‘]/g, "['’‘]").replace(/["“”]/g, '["“”]').replace(/[-‑–]/g, '[-‑–]').replace(/\s+/g, '\\s+'));
}

/** Has the model take out anything the person never said (and flagged stock lines), then applies its edits. */
async function cleanUp(env, model, messages, value, problems, mode) {
  const text = String((mode === 'feedback' ? value.better : value) || '');
  const tips = mode === 'feedback' ? (value.fix || []).map((t, i) => `TIP ${i + 1}: ${t}`).join('\n') : '';
  if (!text) return { value, edits: 0 };
  const source = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n').slice(0, 12000);
  const raw = await ask(env, model, mode === 'coach' ? EDIT_COACH : EDIT, [{ role: 'user', content: `SOURCE:\n${source}\n\nTEXT:\n${text}\n\nPROBLEMS:\n${problems.join('\n') || 'none'}${tips ? `\n\nTIPS:\n${tips}` : ''}` }], { tokens: 900, temperature: 0, effort: 'medium' }, EDIT_SCHEMA);
  const result = jsonIn(raw) || {};
  const edits = (result.edits || []).filter((e) => e && typeof e.quote === 'string' && e.quote.trim().length > 3 && typeof e.fix === 'string').slice(0, 12);
  let done = 0;
  const apply = (t) => {
    let out = String(t || '');
    for (const e of edits) {
      const re = loose(e.quote);
      if (re.test(out)) {
        out = out.replace(re, e.fix.trim());
        done++;
      }
    }
    return out.replace(/\s+([,.])/g, '$1').replace(/ {2,}/g, ' ');
  };
  if (mode === 'feedback') {
    const drop = new Set((result.drop_tips || []).map(Number));
    const fix = (value.fix || []).filter((_, i) => !drop.has(i + 1));
    return { value: { ...value, better: apply(value.better), fix: fix.length ? fix : value.fix }, edits: done + drop.size };
  }
  return { value: apply(value), edits: done };
}

// Stock lines the model keeps reaching for, swapped for plain words after every other step.
const PLAIN_SWAPS = [
  [/\bI['’]?m (really )?(excited|eager|thrilled) (to|for)\b/gi, "I'd like $3"],
  [/\bI am (really )?(excited|eager|thrilled) (to|for)\b/gi, "I'd like $3"],
  [/\b(and )?eager to learn\b/gi, '$1ready to learn'],
  [/\bI['’]?m confident (that )?I can\b/gi, 'I can'],
  [/\bI am confident (that )?I can\b/gi, 'I can'],
  [/\bI look forward to the possibility of\b/gi, "I'd welcome"],
  [/\bDear interviewer\b/g, 'Hi [interviewer\'s name]'],
];

/** Pay amounts the posting never gave are made up: leave a blank for the person to look up. */
function payBlanks(text, first, mode) {
  const known = numbers(first);
  return text.replace(/\$\s?\d[\d,.]*(?:k)?(?:\s?(?:-|‑|–|to)\s?\$?\d[\d,.]*(?:k)?)?(?:\s?(?:\/\s?(?:hr|hour|year|yr)|an hour|per hour|a year|per year))?/gi, (m) =>
    [...numbers(m)].every((n) => known.has(n)) ? m : mode === 'coach' ? 'the usual pay for this job near you' : '[the usual pay for this job near you]',
  );
}

function plainer(text, first, mode) {
  let t = String(text || '');
  for (const [re, to] of PLAIN_SWAPS) t = t.replace(re, mode === 'coach' && /interviewer/.test(to) ? 'Hi' : to);
  t = payBlanks(t, first, mode);
  return mode === 'coach' ? noBlanks(t) : t;
}

function tidy(text, mode) {
  let t = String(text || '').replace(/[*#]+/g, '').replace(/^>\s?/gm, '').trim();
  // The coach answers in the app's chat, so a greeting line ("Hi Sam,") on top only gets in the way.
  if (mode === 'coach') t = t.replace(/^(hi|hello|hey)( there| [A-Z][a-z]+)?[,!.]?\s*\n+/i, '');
  if (mode === 'letter') {
    t = t
      .replace(/^(dear[^\n]*\n+)/i, '')
      .replace(/\n+(sincerely|best|regards|thank you|thanks|warm regards|best regards),?[\s\S]*$/i, '')
      .replace(/\s*[—–]\s*/g, ', ')
      .trim();
  }
  return t;
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: cors(request) });
}

export async function onRequestPost({ request, env, waitUntil }) {
  const headers = { ...cors(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  // Only this site or the app, small JSON bodies, and a per-visitor limit so no one can use up the shared free AI.
  const refused = checkJsonRequest(request, headers) || (await rateLimit(request, { name: 'interview', limits: LIMITS.interview, headers, waitUntil }));
  if (refused) return refused;
  let body;
  try {
    body = await readJson(request);
  } catch {
    return new Response('{}', { status: 400, headers });
  }
  const mode = MODES[body && body.mode] ? body.mode : 'interview';
  const setup = MODES[mode];
  const messages = clean(body && body.messages);
  if (!messages) return new Response('{}', { status: 400, headers });
  if (!env.AI && !env.GROQ_API_KEY) return new Response('{}', { status: 503, headers });
  const wanted = (TRY_MODELS.includes(body.model) || SMART.includes(body.model) ? [body.model] : setup.models || SMART).filter(
    (m) => (m.startsWith('groq:') ? env.GROQ_API_KEY : env.AI),
  );
  let cloudflareOut = false; // after Cloudflare says the free amount is used up, skip its other models
  const first = messages[0].content;
  const system = systemFor(mode, first);
  const errors = [];
  for (const model of wanted) {
    if (cloudflareOut && model.startsWith('@cf/')) continue;
    try {
      // Write it, check it, and rewrite once when it's the wrong length or shape. Then a second read
      // takes out anything the person never said and any stock lines.
      let best = null;
      let asked = messages;
      for (let attempt = 0; attempt < (setup.tries || 1); attempt++) {
        const raw = await ask(env, model, system, asked, setup, setup.json);
        const value = setup.json ? jsonIn(raw) : tidy(raw, mode);
        if (!value || (setup.json && !setup.json.required.every((k) => k in value))) continue;
        const problems = setup.check ? setup.check(value, first) : [];
        const redo = problems.filter((x) => REWRITE.test(x));
        if (!best || redo.length < best.redo.length) best = { value, problems, redo };
        if (!redo.length) break;
        asked = [
          ...messages,
          { role: 'assistant', content: setup.json ? JSON.stringify(value) : value },
          { role: 'user', content: `Rewrite it and fix these problems: ${redo.join(' ')} Keep everything else that was good.${setup.json ? ' Reply with only the JSON object.' : ''}` },
        ];
      }
      if (best) {
        let { value } = best;
        let edits = 0;
        if (setup.clean) {
          try {
            ({ value, edits } = await cleanUp(env, model, messages, value, best.problems.filter((x) => !REWRITE.test(x)), mode));
            if (!setup.json) value = tidy(value, mode);
          } catch {
            // keep the draft as written
          }
        }
        if (setup.clean) value = setup.json ? { ...value, better: plainer(value.better, first, mode) } : plainer(value, first, mode);
        const out = setup.json ? { data: value } : { reply: value };
        if (body.debug) Object.assign(out, { build: 'star3', model, before: best.problems, edits, after: setup.check ? setup.check(value, first) : [] });
        return new Response(JSON.stringify(out), { headers });
      }
      errors.push(`${model}: empty`);
    } catch (e) {
      // try the next model; if all fail (for example the free daily amount is used up) say so
      const message = String((e && e.message) || e);
      if (model.startsWith('@cf/') && /\b4006\b/.test(message)) cloudflareOut = true;
      errors.push(`${model}: ${message.slice(0, 200)}`);
    }
  }
  return new Response(body.debug ? JSON.stringify({ errors }) : '{}', { status: 503, headers });
}
