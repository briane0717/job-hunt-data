// Cloudflare Pages Function: GET /read?u=<url>
// The web version of the app can't read most hiring systems directly (browsers block pages from
// reading other sites unless the site allows it). This reads one job posting for it, only from
// known hiring systems, only with GET, and passes the answer back. Free on Cloudflare Pages.
const HOSTS = [
  /\.myworkdayjobs\.com$/,
  /\.myworkdaysite\.com$/,
  /\.oraclecloud\.com$/,
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

export async function onRequestGet({ request }) {
  const cors = { 'Access-Control-Allow-Origin': new URL(request.url).origin, Vary: 'Origin' };
  let target;
  try {
    target = new URL(new URL(request.url).searchParams.get('u') || '');
  } catch {
    return new Response('bad url', { status: 400, headers: cors });
  }
  if (target.protocol !== 'https:' || !HOSTS.some((h) => h.test(target.hostname))) {
    return new Response('not a hiring site', { status: 403, headers: cors });
  }
  const res = await fetch(target.toString(), {
    headers: { 'User-Agent': UA, Accept: 'application/json, text/html;q=0.9', 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  const type = res.headers.get('content-type') || 'text/plain';
  if (!/json|html|text|xml/.test(type)) return new Response('not a page', { status: 415, headers: cors });
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response('too big', { status: 413, headers: cors });
  return new Response(body, {
    status: res.status,
    headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'X-Final-Url': res.url },
  });
}
