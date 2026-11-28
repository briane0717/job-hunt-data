import { LIMITS, rateLimit } from './_guard.js';

// Cloudflare Pages Function: GET /read?u=<url>
// The web version of the app can't read most hiring systems directly (browsers block pages from
// reading other sites unless the site allows it). This reads one job posting for it, only from
// known hiring systems, only with GET, and passes the answer back. Free on Cloudflare Pages.
// The answer goes back as plain text or JSON data, never as a web page, so nothing in it can run
// on the Jobbo site (where web users' resume and details are saved).
const HOSTS = [
  /\.myworkdayjobs\.com$/,
  /\.myworkdaysite\.com$/,
  // Only Oracle's hiring system (<company>.fa.<region>.oraclecloud.com). The rest of
  // oraclecloud.com includes public file storage that anyone can put pages on.
  /^[a-z0-9-]+\.fa\.[a-z0-9-]+\.oraclecloud\.com$/,
  /(^|\.)greenhouse\.io$/,
  /(^|\.)lever\.co$/,
  /(^|\.)workable\.com$/,
  /(^|\.)ashbyhq\.com$/,
  /(^|\.)amazon\.jobs$/,
  /\.successfactors\.(com|eu)$/,
  /(^|\.)sapsf\.(com|eu)$/,
  /(^|\.)jibeapply\.com$/,
  /(^|\.)icims\.com$/,
  /(^|\.)smartrecruiters\.com$/,
];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 5;

/** True only for an https address on one of the known hiring systems above. */
export function allowedTarget(url) {
  return url.protocol === 'https:' && !url.username && !url.password && (url.port === '' || url.port === '443') && HOSTS.some((h) => h.test(url.hostname));
}

/**
 * Headers that stop a browser from ever treating the answer as a page: it is labelled as data
 * (JSON or plain text), the browser may not guess otherwise, and even if opened directly it is
 * walled off with no scripts, no plugins and no access to the site's saved data.
 */
export function safeHeaders(upstreamType) {
  return {
    'Content-Type': /json/i.test(upstreamType || '') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox; frame-ancestors 'none'",
    'Content-Disposition': 'attachment; filename="posting.txt"',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
  };
}

export async function onRequestGet({ request, waitUntil }) {
  const cors = { 'Access-Control-Allow-Origin': new URL(request.url).origin, Vary: 'Origin' };
  let target;
  try {
    target = new URL(new URL(request.url).searchParams.get('u') || '');
  } catch {
    return new Response('bad url', { status: 400, headers: cors });
  }
  if (!allowedTarget(target)) return new Response('not a hiring site', { status: 403, headers: cors });
  const refused = await rateLimit(request, { name: 'read', limits: LIMITS.read, headers: cors, waitUntil });
  if (refused) return refused;
  // Follow redirects one at a time and check every new address, so a hiring site can't send the
  // reader on to some other site.
  let res;
  for (let hop = 0; ; hop++) {
    res = await fetch(target.toString(), {
      headers: { 'User-Agent': UA, Accept: 'application/json, text/html;q=0.9', 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'manual',
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (res.status < 300 || res.status >= 400 || res.status === 304) break;
    const next = res.headers.get('Location');
    if (!next || hop >= MAX_REDIRECTS) return new Response('too many redirects', { status: 508, headers: cors });
    try {
      target = new URL(next, target);
    } catch {
      return new Response('bad redirect', { status: 502, headers: cors });
    }
    if (!allowedTarget(target)) return new Response('not a hiring site', { status: 403, headers: cors });
  }
  const type = res.headers.get('content-type') || 'text/plain';
  if (!/json|html|text|xml/.test(type)) return new Response('not a page', { status: 415, headers: cors });
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response('too big', { status: 413, headers: cors });
  return new Response(body, {
    status: res.status,
    headers: { ...cors, ...safeHeaders(type), 'Cache-Control': 'public, max-age=3600', 'X-Final-Url': target.toString() },
  });
}
