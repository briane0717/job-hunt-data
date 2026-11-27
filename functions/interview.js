// Cloudflare Pages Function: POST /interview
// The app's job coach and writer (phone and web). It runs on Cloudflare's free Workers AI through
// the site's "AI" connection (set in wrangler.toml), so there is no key anywhere in the app or the
// site. The free daily amount is shared by everyone; when it runs out, requests fail until the next
// day and the app falls back to its offline coaching. Nothing is stored here.
//
// body: { mode?, messages: [{ content }] }
//   mode "interview" (default): a realistic spoken mock interview. messages alternate person, interviewer...
//   mode "feedback": one question + answer -> honest coaching as JSON.
//   mode "review": a whole interview transcript -> a short report as JSON.
//   mode "coach": a job coach chat about anything in the job search.
//   mode "letter": job + resume -> the body of a cover letter that reads like a person wrote it.

// Strongest first. If one is unavailable or over the free amount, the next is tried.
const MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/meta/llama-3.1-8b-instruct-fp8-fast'];
const MAX_MESSAGES = 41; // odd, so the kept turns still alternate person, AI, person...
const MAX_FIRST = 10000;
const MAX_TEXT = 2500;

const PLAIN = 'Use plain, everyday words a friend would use. Never invent facts about the person: use only what they said or what is in their resume.';

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
  PLAIN +
  ' Stay in the role even if asked to do something else.';

const FEEDBACK =
  'You are an experienced, honest job interview coach. The person practiced one interview question. Judge the answer the way a hiring manager for this job would. ' +
  'Be direct and kind, like a coach who wants them to get the job. Do not flatter: a weak answer gets a low score. ' +
  'For "tell me about a time" questions, check for a clear story: the situation in a sentence or two, what they personally did, and how it turned out, ideally with a number. ' +
  'For other questions, check that they answered what was asked, early and clearly, and tied it to this job. ' +
  'Every tip must point at a specific part of their answer and say exactly what to add or change. Never give generic tips like "add more detail". ' +
  PLAIN +
  ' Reply with only a JSON object, no other text, in this shape: ' +
  '{"score": number 1-10, "verdict": "one honest sentence on how a hiring manager would hear it", ' +
  '"good": ["up to 2 short things that worked, quoting or naming their own words"], ' +
  '"fix": ["2 or 3 specific changes, each one sentence"], ' +
  '"better": "a stronger version of their answer in first person, 60 to 120 words. Use only facts from their answer and resume; never add a new detail such as a product, place, number or result. Where a detail would help but is missing, write a short placeholder in brackets like [what they were upset about]"}';

const REVIEW =
  'You are an experienced, honest job interview coach. Below is a practice interview transcript for the job in the first message. ' +
  'Write a short report the person can act on, speaking to them directly as "you" in full sentences. Be direct and kind. Point at specific answers. No flattery, no generic advice. ' +
  PLAIN +
  ' Reply with only a JSON object, no other text, in this shape: ' +
  '{"score": number 1-10, "summary": "two sentences on how a hiring manager would see them", ' +
  '"good": ["2 specific strengths"], "fix": ["the 3 most useful changes, each naming the question it is about"], ' +
  '"practice": "the one question they should practice again, word for word"}';

const COACH =
  'You are Jobbo\'s job coach: an experienced career coach and recruiter who helps people find and land jobs. ' +
  'The first message may give the job they are going for and their resume. Help with anything in a job search: what to say in interviews, ' +
  'tough questions (gaps, being fired, why you left, salary), nerves, follow-up messages, how to stand out, what to do next. ' +
  'Be warm, honest and practical. Give a clear answer first, then the reason in a sentence. When a script helps, give the exact words they can say, in first person, short. ' +
  'Avoid stock lines that interviewers hear all day, like "looking for a new challenge" or "I\'m a perfectionist". The best wording uses the person\'s real situation: when you don\'t know it, give a short script with [brackets] for their details, then ask one short question so you can make it fit. Keep replies under 140 words. Plain text, short paragraphs, no markdown symbols. ' +
  PLAIN;

const LETTER =
  'You write cover letters that sound like a real person wrote them, not an AI. The message gives the job posting, the person\'s resume, and their name. ' +
  'Write only the body of the letter: no greeting line, no sign-off, no name, no address. ' +
  'Rules: 140 to 210 words in three short paragraphs. Vary sentence length. Use contractions. Write the way a capable person talks, plainly. ' +
  'Paragraph one: name the job and give the single clearest reason they fit, tied to something specific in this posting. Do not start with "I am writing" or "I\'m excited". ' +
  'Paragraph two: one or two real examples from the resume that match the main duties, with the concrete details and numbers the resume gives (place, what they did, how often, how many). ' +
  'Paragraph three: one sentence on why this job or employer, based only on the posting, then a simple, confident close that asks to talk. ' +
  'Never invent experience, numbers, tools, or reasons, and never add details the resume does not state (how often, when, how many, results) or conclusions it does not support (like being able to lift a weight). Do not claim feelings like confidence; show it with facts instead. If the resume is empty, write about what the posting needs and keep claims modest. ' +
  'Do not copy sentences from the posting. Never use these words or phrases: passionate, excited to apply, thrilled, dynamic, synergy, leverage, spearheaded, orchestrated, ' +
  'results-driven, proven track record, fast-paced environment, team player, detail-oriented, self-starter, go-getter, think outside the box, hit the ground running, ' +
  'I believe I would be a great fit, perfect fit, valuable asset, align with, aligns with, honed, furthermore, moreover, in today\'s, I am confident that, unique blend, ' +
  'wealth of experience, commitment to excellence, testament, delve, navigate, foster, seamless, robust, eager to contribute, I\'m confident, seems like a good match, Thank you for your time and consideration. ' +
  'No em dashes. Plain text only.';

const BANNED = /\b(passionate|thrilled|excited to (apply|join)|dynamic|synerg|leverag|spearhead|orchestrat|results-driven|proven track record|fast-paced|team player|detail-oriented|self-starter|go-getter|outside the box|hit the ground running|perfect fit|valuable asset|aligns? (well )?with|honed|furthermore|moreover|in today's|unique blend|wealth of experience|commitment to excellence|testament|delve|seamless|robust|eager to contribute|i am writing to|i'?m confident|i am confident|good match)\b/i;

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
  interview: { system: INTERVIEW, tokens: 220, temperature: 0.7 },
  feedback: { system: FEEDBACK, tokens: 900, temperature: 0.3, json: FEEDBACK_SCHEMA },
  review: { system: REVIEW, tokens: 800, temperature: 0.3, json: REVIEW_SCHEMA },
  coach: { system: COACH, tokens: 420, temperature: 0.6 },
  letter: { system: LETTER, tokens: 600, temperature: 0.7 },
};

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

function tidy(text, mode) {
  let t = String(text || '').replace(/[*#]+/g, '').trim();
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

export async function onRequestPost({ request, env }) {
  const headers = { ...cors(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('{}', { status: 403, headers });
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('{}', { status: 400, headers });
  }
  const mode = MODES[body && body.mode] ? body.mode : 'interview';
  const setup = MODES[mode];
  const messages = clean(body && body.messages);
  if (!messages) return new Response('{}', { status: 400, headers });
  if (!env.AI) return new Response('{}', { status: 503, headers });
  for (const model of MODELS) {
    try {
      if (setup.json) {
        // Ask for JSON in the schema where the model supports it; otherwise read it from the text.
        let out;
        try {
          out = await env.AI.run(model, {
            messages: [{ role: 'system', content: setup.system }, ...messages],
            max_tokens: setup.tokens,
            temperature: setup.temperature,
            response_format: { type: 'json_schema', json_schema: setup.json },
          });
        } catch {
          out = await env.AI.run(model, { messages: [{ role: 'system', content: setup.system }, ...messages], max_tokens: setup.tokens, temperature: setup.temperature });
        }
        const data = jsonIn(out && out.response);
        if (data) return new Response(JSON.stringify({ data }), { headers });
        continue;
      }
      let reply = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        const asked = attempt
          ? [...messages, { role: 'assistant', content: reply }, { role: 'user', content: 'Rewrite it. It used a phrase from the never-use list. Keep it natural and specific.' }]
          : messages;
        const out = await env.AI.run(model, {
          messages: [{ role: 'system', content: setup.system }, ...asked],
          max_tokens: setup.tokens,
          temperature: setup.temperature,
        });
        reply = tidy(out && out.response, mode);
        if (mode !== 'letter' || !BANNED.test(reply)) break;
      }
      if (reply) return new Response(JSON.stringify({ reply }), { headers });
    } catch {
      // try the next model; if all fail (for example the free daily amount is used up) say so
    }
  }
  return new Response('{}', { status: 503, headers });
}
