// Shared abuse protection for the site's small server functions (interview.js, read.js).
// It exports no onRequest handler, so Cloudflare Pages makes no web address for this file.
//
// Why: the AI and the posting reader are free for everyone, but Cloudflare's free AI amount is one
// daily pot shared by every visitor. Without limits one script could use it all up for everyone.
//
// How (all within Cloudflare's free plan, no keys, nothing personal kept):
//  - Each visitor is counted by a one-way hash of their internet address (CF-Connecting-IP), never the address itself.
//  - Counts live in two places: this server's memory (instant, always works) and Cloudflare's
//    cache in the visitor's region (survives restarts). Both are per region and best effort, which
//    is enough to stop one visitor or script from draining the free amount. They are not billing-grade.
//  - Over the limit, the visitor gets 429 with Retry-After, and nothing reaches the AI.

/** Requests per visitor: a short burst window and a whole-day cap. */
export const LIMITS = {
  interview: { perMinute: 12, perDay: 150 },
  read: { perMinute: 30, perDay: 600 },
  // Apply confirmation emails: a person applies a few times a day at most.
  notify: { perMinute: 3, perDay: 25 },
  // The same address can only get so many a day, whoever asks for them.
  notifyTo: { perMinute: 3, perDay: 15 },
};

/** Biggest request body accepted (the app sends a job, a resume and a short chat: well under this). */
export const MAX_BODY_BYTES = 64 * 1024;

const memory = new Map(); // key -> { count, resetAt }
const MAX_MEMORY_KEYS = 5000;

async function visitorId(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const data = new TextEncoder().encode('jobbo-visitor:' + ip.split(',')[0].trim());
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...hash.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bumpMemory(key, windowMs, now) {
  let entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    if (memory.size >= MAX_MEMORY_KEYS) {
      for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
      if (memory.size >= MAX_MEMORY_KEYS) memory.clear();
    }
    entry = { count: 0, resetAt: now + windowMs };
    memory.set(key, entry);
  }
  entry.count += 1;
  return entry;
}

/** Adds one to the regional cache count and returns the new total (0 when the cache isn't available). */
async function bumpCache(cache, key, windowMs, now, waitUntil) {
  if (!cache) return 0;
  const url = `https://jobbo-limit.invalid/${key}`;
  try {
    const hit = await cache.match(url);
    const count = (hit ? parseInt(await hit.text(), 10) || 0 : 0) + 1;
    const resetAt = hit ? Number(hit.headers.get('X-Reset-At')) || now + windowMs : now + windowMs;
    const ttl = Math.max(1, Math.ceil((resetAt - now) / 1000));
    const put = cache.put(
      url,
      new Response(String(count), { headers: { 'Cache-Control': `max-age=${ttl}`, 'X-Reset-At': String(resetAt) } }),
    );
    if (waitUntil) waitUntil(put);
    else await put;
    return count;
  } catch {
    return 0;
  }
}

/**
 * Counts this request and says whether it may go ahead.
 * Returns null when it may, or a ready 429 Response when the visitor is over the limit.
 * options: { name, limits, headers, cache, now, waitUntil, id }; cache defaults to Cloudflare's caches.default.
 * id counts something other than the visitor (already hashed, never raw personal data).
 */
export async function rateLimit(request, options) {
  const { name, limits, headers = {}, waitUntil } = options;
  const now = options.now ?? Date.now();
  const cache = 'cache' in options ? options.cache : globalThis.caches && globalThis.caches.default;
  const id = options.id || (await visitorId(request));
  const windows = [
    { key: `${name}:m:${id}`, ms: 60_000, max: limits.perMinute },
    { key: `${name}:d:${id}`, ms: 86_400_000, max: limits.perDay },
  ];
  for (const w of windows) {
    const local = bumpMemory(w.key, w.ms, now);
    const shared = await bumpCache(cache, w.key, w.ms, now, waitUntil);
    if (Math.max(local.count, shared) > w.max) {
      const retry = Math.max(1, Math.ceil((local.resetAt - now) / 1000));
      return new Response(JSON.stringify({ error: 'busy', retryAfter: retry }), {
        status: 429,
        headers: { ...headers, 'Content-Type': 'application/json', 'Retry-After': String(retry), 'Cache-Control': 'no-store' },
      });
    }
  }
  return null;
}

/**
 * Basic checks before reading a JSON body: only this site's own pages (or the phone app, which
 * sends no Origin) may call, the body must say it is JSON, and it must be small.
 * Returns null when fine, or a ready error Response.
 */
export function checkJsonRequest(request, headers = {}) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('{}', { status: 403, headers });
  const type = request.headers.get('Content-Type') || '';
  if (!/^application\/json\b/i.test(type)) return new Response('{}', { status: 415, headers });
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY_BYTES) return new Response('{}', { status: 413, headers });
  return null;
}

/** Reads a JSON body, refusing anything over MAX_BODY_BYTES even when Content-Length was missing or wrong. */
export async function readJson(request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new Error('too big');
  return JSON.parse(text);
}

/** Resets the in-memory counts (tests only). */
export function _resetForTests() {
  memory.clear();
}
