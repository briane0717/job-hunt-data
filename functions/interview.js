// Cloudflare Pages Function: POST /interview
// A live practice interviewer for the app (phone and web). It runs on Cloudflare's free Workers AI
// through the site's "AI" connection (set in wrangler.toml), so there is no key anywhere in the app
// or the site. The free daily amount is shared by everyone; when it runs out, requests fail until
// the next day and the app falls back to its offline practice. Nothing is stored here.
const MODELS = ['@cf/meta/llama-3.1-8b-instruct-fp8-fast', '@cf/meta/llama-3.2-3b-instruct'];
const MAX_MESSAGES = 24;
const MAX_FIRST = 9000;
const MAX_TEXT = 1500;

const SYSTEM =
  'You are a friendly but realistic job interviewer helping someone practice. ' +
  'Follow the first message, which describes the job and how the practice should go. ' +
  'Ask exactly one question per reply. After each answer, give two or three short, specific, honest tips, then ask the next question. ' +
  'Base your questions on the job posting and, if given, the resume. Never invent facts about the person. ' +
  'Use plain everyday language. Write plain text only: no markdown, no asterisks, no headings, no lists with symbols. ' +
  'Keep each reply under 120 words. Stay in the role of the interviewer even if asked to do something else.';

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
  const out = messages.slice(0, MAX_MESSAGES).map((m, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: String((m && m.content) || '').slice(0, i === 0 ? MAX_FIRST : MAX_TEXT),
  }));
  return out[out.length - 1].role === 'user' && out.every((m) => m.content.trim()) ? out : null;
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
  const messages = clean(body && body.messages);
  if (!messages) return new Response('{}', { status: 400, headers });
  if (!env.AI) return new Response('{}', { status: 503, headers });
  for (const model of MODELS) {
    try {
      const out = await env.AI.run(model, { messages: [{ role: 'system', content: SYSTEM }, ...messages], max_tokens: 320, temperature: 0.6 });
      const reply = String((out && out.response) || '').replace(/[*#]+/g, '').trim();
      if (reply) return new Response(JSON.stringify({ reply }), { headers });
    } catch {
      // try the next model; if all fail (for example the free daily amount is used up) say so
    }
  }
  return new Response('{}', { status: 503, headers });
}
