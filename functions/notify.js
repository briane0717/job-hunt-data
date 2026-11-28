import { LIMITS, checkJsonRequest, rateLimit, readJson } from './_guard.js';

// Cloudflare Pages Function: POST /notify
// Sends the person a short email confirming a job they applied for: the job, the employer and the date.
// It only ever goes to the address in the person's own Profile, and only when they turned it on.
//
// Free: it sends through Brevo's free plan (300 emails a day, no card). That needs a free Brevo key
// saved in the site's Cloudflare settings as BREVO_API_KEY, and the sender address verified in Brevo
// saved as MAIL_FROM (never in the app or the code). Without them this answers 503 "not_set_up" and
// the app offers to open the person's own mail app instead.
//
// Privacy: nothing is stored or logged here. The address is only counted by a one-way hash, so no one
// can use this to flood an inbox. The email has fixed wording and no links, so it is useless for spam.
//
// body: { to, title, company, date }   date is already written out in the person's own time zone.

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
// Web links are refused in the job and employer, so this can't carry one. (Names like "Booking.com" are fine.)
const LINKISH = /(https?:|www\.|:\/\/|@)/i;
const DATE = /^[A-Za-z0-9 ,.]{6,40}$/;

function cors(request) {
  return {
    'Access-Control-Allow-Origin': new URL(request.url).origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

/** One line of plain text: no line breaks, no control characters, trimmed to `max`. */
function line(value, max) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const html = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function hash(text) {
  const data = new TextEncoder().encode('jobbo-notify:' + text);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...bytes.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The email itself: fixed wording, only the job, employer and date filled in. */
export function confirmation({ title, company, date }) {
  const job = company ? `${title} at ${company}` : title;
  const subject = `You applied: ${job}`.slice(0, 150);
  const text = [
    `You applied for ${job} on ${date}.`,
    '',
    `Job: ${title}`,
    company ? `Employer: ${company}` : '',
    `Date applied: ${date}`,
    '',
    "It's saved as Applied in your Jobbo tracker. A good time to follow up is about a week from now.",
    '',
    'You get this email because you turned on apply confirmations in Jobbo. You can turn them off in Profile.',
  ]
    .filter((x, i, all) => x || all[i - 1])
    .join('\n');
  const row = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><b>${html(v)}</b></td></tr>`;
  const body =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:520px">` +
    `<p>You applied for <b>${html(job)}</b> on ${html(date)}.</p>` +
    `<table style="border-collapse:collapse;margin:8px 0 16px">${row('Job', title)}${company ? row('Employer', company) : ''}${row('Date applied', date)}</table>` +
    `<p>It's saved as Applied in your Jobbo tracker. A good time to follow up is about a week from now.</p>` +
    `<p style="color:#888;font-size:12px;margin-top:24px">You get this email because you turned on apply confirmations in Jobbo. You can turn them off in Profile.</p></div>`;
  return { subject, text, html: body };
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: cors(request) });
}

export async function onRequestPost({ request, env, waitUntil }) {
  const headers = { ...cors(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const say = (status, error) => new Response(JSON.stringify(error ? { error } : { ok: true }), { status, headers });
  const refused = checkJsonRequest(request, headers) || (await rateLimit(request, { name: 'notify', limits: LIMITS.notify, headers, waitUntil }));
  if (refused) return refused;
  let body;
  try {
    body = await readJson(request);
  } catch {
    return say(400, 'bad_request');
  }
  const to = String((body && body.to) || '').trim().toLowerCase();
  const title = line(body && body.title, 120);
  const company = line(body && body.company, 100);
  const rawDate = String((body && body.date) || '').trim();
  const date = DATE.test(rawDate) ? rawDate : '';
  if (to.length > 254 || !EMAIL.test(to)) return say(400, 'bad_email');
  if (!title || LINKISH.test(title) || LINKISH.test(company) || !date) return say(400, 'bad_request');
  if (!env.BREVO_API_KEY || !env.MAIL_FROM) return say(503, 'not_set_up');
  const perAddress = await rateLimit(request, { name: 'notifyTo', id: await hash(to), limits: LIMITS.notifyTo, headers, waitUntil });
  if (perAddress) return perAddress;

  const mail = confirmation({ title, company, date });
  try {
    const r = await fetch(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: env.MAIL_FROM_NAME || 'Jobbo', email: env.MAIL_FROM },
        to: [{ email: to }],
        subject: mail.subject,
        htmlContent: mail.html,
        tags: ['apply-confirmation'],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return say(502, r.status === 401 || r.status === 403 ? 'not_set_up' : 'send_failed');
    return say(200);
  } catch {
    return say(502, 'send_failed');
  }
}
