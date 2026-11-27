// Job collector: reads the public job lists of tens of thousands of employers, the same kind of
// sources big job sites crawl, and writes compact files the app downloads.
//
//   node collector/collect.mjs [--limit N] [--out public]
//
// Sources (all public, no keys):
//   Greenhouse  GET  https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
//   Lever       GET  https://api.lever.co/v0/postings/{slug}?mode=json
//   Ashby       GET  https://api.ashbyhq.com/posting-api/job-board/{slug}
//   Workday     POST https://{co}.wd{n}.myworkdayjobs.com/wday/cxs/{co}/{site}/jobs
//   Workable    GET  https://www.workable.com/boards/workable.xml  (one feed with every Workable customer's jobs)
// Company lists come from github.com/Riley-Dorrington/job-board-aggregator (MIT, see companies/).
//
// Output (each run replaces everything, so filled jobs drop out):
//   {out}/v1/manifest.json       when it ran, counts per source and per state
//   {out}/v1/us/{ST}.json        jobs in each US state (a job with several places is in each)
//   {out}/v1/all/{0-7}.json      every US job once, in a compact form (for "any distance")
//   {out}/v1/words/{key}.json   jobs by title word / company start, for keyword searches (index.json lists sizes)
//   {out}/v1/remote.json         remote jobs open to US workers
// A job is {i: id, t: title, c: company, l: location, u: url, d: posted date or '', s: source, g?: [lat, lon]}.

import { execFile, spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { coordsOf, loadGazetteer, placeOf } from './place.mjs';
import { isJunkTitle, isReposter, junkPosters } from './junk.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const LIMIT = Number(arg('--limit', '0')) || Infinity; // companies per system, for quick tests
const OUT = path.resolve(arg('--out', 'public'));
const ONLY = arg('--only', ''); // e.g. "greenhouse,lever"
// Split runs: each part saves what it gathered (--raw-out), and a last step merges them (--raw-in).
const RAW_OUT = arg('--raw-out', '');
// Stop reading big boards after this many minutes and keep what was read (GitHub stops jobs at a hard limit).
const DEADLINE = Date.now() + Number(arg('--minutes', '0') || 1e9) * 60000;
const RAW_IN = arg('--raw-in', '');
const BIG = arg('--big', ''); // another big-employer list, for testing new entries
const CONCURRENCY = Number(arg('--concurrency', '24'));
const PLACES = arg('--places', ''); // path to GeoNames cities1000.txt, for job coordinates
const UA = 'JobHuntCollector/1.0 (+https://github.com/; open-source job search app)';

/** "Austin, TX" plus " · Remote" when a job is remote, unless the place already says remote. */
function withRemote(place, remote) {
  const p = String(place || '').trim();
  if (!remote || /\bremote\b/i.test(p)) return p || (remote ? 'Remote' : '');
  return p ? `${p} · Remote` : 'Remote';
}

// Real names for boards whose short name isn't readable ("insomniacookies" -> "Insomnia Cookies"); see tools/names.mjs.
const BOARD_NAMES = await readFile(path.join(HERE, 'companies', 'board_names.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => ({}));

/** "Acme, Inc." -> "Acme". */
/** "Acme, Inc." -> "Acme"; Amazon's "Amazon Data Services, Inc. - A19" -> "Amazon Data Services". */
const plainName = (n) =>
  String(n || '')
    .replace(/\s+-\s+[A-Z]\d{2}$/, '')
    .replace(/,?\s+(Inc\.?|LLC|L\.L\.C\.|Ltd\.?)$/i, '')
    .trim();

function pretty(slug) {
  return String(slug)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

async function getJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Workday turns away Node's built-in fetch (it answers 429 with a block page) but answers curl,
 * so Workday requests go through curl.
 */
const run = promisify(execFile);
async function curlJson(url, { method = 'GET', headers = {}, body } = {}) {
  const argv = ['-sSL', '--max-time', '25', '-X', method, '-w', '\n%{http_code}', '-A', UA, '-H', 'Accept: application/json'];
  for (const [k, v] of Object.entries(headers)) argv.push('-H', `${k}: ${v}`);
  if (body) argv.push('--data-raw', body);
  argv.push(url);
  const { stdout } = await run('curl', argv, { maxBuffer: 64 * 1024 * 1024 });
  const cut = stdout.lastIndexOf('\n');
  const status = Number(stdout.slice(cut + 1));
  if (status < 200 || status >= 300) {
    const err = new Error(`HTTP ${status}`);
    err.status = status;
    throw err;
  }
  return JSON.parse(stdout.slice(0, cut));
}

/** A web page's HTML through curl (some career sites answer browsers only). */
async function curlText(url) {
  const { stdout } = await run('curl', ['-sSL', '--compressed', '--max-time', '25', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 64 * 1024 * 1024 });
  const cut = stdout.lastIndexOf('\n');
  const status = Number(stdout.slice(cut + 1));
  if (status < 200 || status >= 300) {
    const err = new Error(`HTTP ${status}`);
    err.status = status;
    throw err;
  }
  return stdout.slice(0, cut);
}

const unescapeHtml = (t) =>
  t.replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** Job rows on a SuccessFactors search page: each title link with the location that follows it. */
export function parseRmkRows(html) {
  const links = [...html.matchAll(/<a[^>]*class="[^"]*jobTitle-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  return links.map((m, k) => {
    const end = k + 1 < links.length ? links[k + 1].index : html.length;
    const loc = html.slice(m.index, end).match(/<span[^>]*class="[^"]*jobLocation[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const href = unescapeHtml(m[1]);
    let place = loc ? unescapeHtml(loc[1].replace(/<[^>]+>/g, '')) : '';
    // Some layouts show no location next to the title, but the link ends in "City-…-ST-ZIP/ID/".
    if (!place) {
      const slug = href.match(/\/job\/([^/]+)\/\d+\/?$/)?.[1] || '';
      const st = decodeURIComponent(slug).match(/-([A-Z]{2})-(\d{5})$/);
      if (st) place = `${decodeURIComponent(slug).split('-')[0]}, ${st[1]}, US, ${st[2]}`;
    }
    return { href, title: unescapeHtml(m[2].replace(/<[^>]+>/g, '')), place };
  });
}

/**
 * SuccessFactors career sites (SAP "RMK" pages: Tractor Supply, Sephora, Stater Bros, …).
 * There is no public JSON, so this reads the search pages, which robots.txt allows
 * (GET /search/?q=&startrow=N, 20 to 25 jobs each; rows show title, link and "City, ST, US, ZIP").
 */
async function rmk({ name, host }) {
  const out = new Map();
  let total = Infinity;
  const seenFirst = new Set();
  for (let start = 0; start < Math.min(total, 20000); ) {
    // Retry a page a couple of times, and keep what was read if the site stops answering part way.
    let html = null;
    for (let attempt = 0; attempt < 3 && html === null; attempt++) {
      html = await curlText(`https://${host}/search/?q=&startrow=${start}`).catch(async (e) => {
        if (attempt === 2) console.log(`  ${name}: stopped at row ${start} of ${total} (${e.message})`);
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        return null;
      });
    }
    if (html === null) {
      if (!out.size) throw new Error(`${name}: search page did not answer`);
      break;
    }
    const t = html.match(/of\s*<b>\s*([\d,]+)\s*<\/b>/i) || html.match(/of\s+([\d,]+)\s+Jobs/i);
    if (t) total = Number(t[1].replace(/,/g, ''));
    const rows = parseRmkRows(html);
    // Past the end some sites show page 1 again: stop when a page starts with a link already read.
    if (rows.length && start > 0 && seenFirst.has(rows[0].href)) break;
    if (rows.length) seenFirst.add(rows[0].href);
    for (const { href, title, place } of rows) {
      if (out.has(href)) continue;
      const parts = place.split(',').map((x) => x.trim());
      if (parts.length >= 3 && parts[2] && parts[2] !== 'US') continue; // keep US jobs only
      out.set(href, {
        i: `sf:${host}:${href.match(/\/(\d+)\/?$/)?.[1] || href}`,
        t: title,
        c: name,
        l: parts.length >= 2 ? `${parts[0]}, ${parts[1]}` : place,
        u: new URL(href, `https://${host}`).href,
        d: '',
        s: 'successfactors',
      });
    }
    // Each row appears twice (desktop and phone layouts), so step by the number of distinct links.
    const step = new Set(rows.map((r) => r.href)).size;
    if (!step) break;
    start += step;
  }
  return [...out.values()];
}

const pauseMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Phenom career sites (Thermo Fisher, Cisco, PNC, Corning, …): the site's own search widget,
 * POST https://{host}/widgets (ddoKey refineSearch), 100 jobs at a time. `ref` is the site's
 * Phenom id (phApp.refNum on its pages) and `path` its language path, such as "us/en".
 */
async function phenom({ name, host, ref, path = 'us/en' }) {
  const out = new Map();
  let total = Infinity;
  for (let from = 0; from < Math.min(total, 10000); from += 100) {
    const body = JSON.stringify({
      lang: 'en_us', deviceType: 'desktop', country: 'us', pageName: 'search-results', ddoKey: 'refineSearch',
      sortBy: '', subsearch: '', from, jobs: true, counts: false, all_fields: [], size: 100, clearAll: false,
      jdsource: 'facets', isSliderEnable: false, pageId: 'page20', siteType: 'external', keywords: '', global: true,
      selected_fields: {}, locationData: {}, refNum: ref,
    });
    let data;
    try {
      data = await curlJson(`https://${host}/widgets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    } catch (e) {
      if (!out.size) throw e;
      console.log(`  ${name}: stopped at ${from} of ${total} (${e.message})`);
      break;
    }
    const rs = data.refineSearch || {};
    total = rs.totalHits || 0;
    const list = rs.data?.jobs || [];
    if (!list.length) break;
    for (const j of list) {
      if (j.country && !/^(United States( of America)?|USA?|U\.S\.A?\.?)$/i.test(j.country)) continue;
      out.set(j.jobId, {
        i: `ph:${host}:${j.jobId}`,
        t: j.title,
        c: name,
        l: j.city && j.state ? `${j.city}, ${j.state}` : j.cityState || j.location || '',
        u: `https://${host}/${path}/job/${encodeURIComponent(j.jobId)}`,
        d: String(j.postedDate || '').slice(0, 10),
        s: 'phenom',
      });
    }
    await pauseMs(300);
  }
  return [...out.values()];
}

/**
 * Radancy (TalentBrew) career sites (Chipotle, Citi, McKesson, …): the search page's own results
 * call, GET /search-jobs/results?CurrentPage=N&RecordsPerPage=100, which returns the list as HTML.
 */
async function radancy({ name, host }) {
  const out = new Map();
  let pages = Infinity;
  for (let page = 1; page <= Math.min(pages, 300); page++) {
    const url =
      `https://${host}/search-jobs/results?ActiveFacetID=0&CurrentPage=${page}&RecordsPerPage=100&Distance=50&RadiusUnitType=0` +
      `&Keywords=&Location=&ShowRadius=False&IsPagination=False&FacetTerm=&FacetType=0&SearchResultsModuleName=Search+Results` +
      `&SearchFiltersModuleName=Search+Filters&SortCriteria=0&SortDirection=0&SearchType=5&ResultsType=0`;
    let html;
    try {
      html = (await curlJson(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).results || '';
    } catch (e) {
      if (!out.size) throw e;
      console.log(`  ${name}: stopped at page ${page} (${e.message})`);
      break;
    }
    const tp = html.match(/data-total-pages="(\d+)"/);
    if (tp) pages = Number(tp[1]);
    let added = 0;
    for (const li of html.split(/<li[\s>]/i).slice(1)) {
      const a = li.match(/href="([^"]*\/job\/[^"]+)"[^>]*data-job-id="(\d+)"/) || li.match(/data-job-id="(\d+)"[^>]*href="([^"]*\/job\/[^"]+)"/);
      if (!a) continue;
      const [href, id] = a[1].includes('/job/') ? [a[1], a[2]] : [a[2], a[1]];
      if (out.has(id)) continue;
      const title = (li.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/) || li.match(/data-job-id="\d+"[^>]*>([^<]+)</) || [])[1] || '';
      const place = (li.match(/class="[^"]*job-location[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '';
      const date = (li.match(/class="[^"]*date-posted[^"]*"[^>]*>([^<]+)</) || [])[1] || '';
      const clean = (t) => unescapeHtml(t.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      const md = date.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      out.set(id, {
        i: `rd:${host}:${id}`,
        t: clean(title),
        c: name,
        // Some sites add work details after the place ("Seattle, WA, Onsite, Regular, Day shift"): keep the place.
        l: clean(place).replace(/,\s*(Onsite|On-site|Remote|Hybrid)\b.*$/i, (m) => (/remote/i.test(m) ? ' · Remote' : '')),
        u: new URL(href.replace(/&amp;/g, '&'), `https://${host}`).href,
        d: md ? `${md[3]}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}` : '',
        s: 'radancy',
      });
      added++;
    }
    if (!added) break;
    await pauseMs(300);
  }
  return [...out.values()];
}

/**
 * Eightfold career sites (Lockheed Martin, Micron, Qualcomm, …): GET /api/pcsx/search?domain=…&start=N,
 * 10 jobs at a time, read slowly because these sites limit how fast they answer.
 */
async function eightfold({ name, host, domain, location = '', max = 10000, pause = 1500 }) {
  const out = new Map();
  let total = Infinity;
  for (let start = 0; start < Math.min(total, max) && Date.now() < DEADLINE; ) {
    let data;
    for (let attempt = 0; attempt < 5 && !data; attempt++) {
      data = await curlJson(`https://${host}/api/pcsx/search?domain=${domain}&query=&location=${encodeURIComponent(location)}&start=${start}&sort_by=timestamp`).catch(async (e) => {
        await pauseMs(15000 * 2 ** attempt); // "too many requests": wait 15 s, 30 s, 1 min, 2 min, 4 min
        if (attempt === 4) console.log(`  ${name}: stopped at ${start} of ${total} (${e.message})`);
        return null;
      });
    }
    if (!data) {
      if (!out.size) throw new Error(`${name}: job list did not answer`);
      break;
    }
    total = data.data?.count ?? 0;
    const list = data.data?.positions || [];
    if (!list.length) break;
    for (const j of list) {
      const loc = (j.standardizedLocations || [])[0] || (j.locations || [])[0] || '';
      out.set(j.id, {
        i: `ef:${host}:${j.id}`,
        t: j.name,
        c: name,
        l: loc.replace(/,\s*(US|United States( of America)?)$/, ''),
        u: new URL(j.positionUrl || `/careers/job/${j.id}`, `https://${host}`).href,
        d: j.postedTs ? new Date(j.postedTs * 1000).toISOString().slice(0, 10) : '',
        s: 'eightfold',
      });
    }
    start += list.length;
    await pauseMs(pause); // these sites refuse fast readers part way
  }
  return [...out.values()];
}

/** "3251 Berlin Drive, La Crosse, WI, US" -> "La Crosse, WI"; places in other countries keep their country. */
export function paradoxPlace(text) {
  const parts = String(text || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 3 && /^[A-Z]{2}$/.test(parts.at(-1)) && /^[A-Z]{2}$/.test(parts.at(-2))) {
    if (parts.at(-1) !== 'US') return parts.slice(-3).join(', ');
    parts.pop();
  }
  return parts.slice(-2).join(', ');
}

/**
 * Paradox career sites (FedEx, Whole Foods, Dunkin', …): the job list pages /jobs/page/N, which the
 * site renders as plain HTML with each job's title, link and place.
 */
async function paradox({ name, host, max = 3000 }) {
  const out = new Map();
  let last = 1;
  for (let page = 1; page <= Math.min(last, max) && Date.now() < DEADLINE; page++) {
    let html;
    for (let attempt = 0; attempt < 3 && html === undefined; attempt++) {
      html = await curlText(`https://${host}/jobs/page/${page}`).catch(async (e) => {
        if (attempt === 2) {
          if (!out.size) throw e;
          console.log(`  ${name}: stopped at page ${page} of ${last} (${e.message})`);
          return null;
        }
        await pauseMs(10000 * (attempt + 1));
        return undefined;
      });
    }
    if (!html) break;
    for (const m of html.matchAll(/\/jobs\/page\/(\d+)/g)) last = Math.max(last, Number(m[1]));
    let added = 0;
    for (const li of html.split(/<li class="results-list__item"/).slice(1)) {
      const a = li.match(/class="results-list__item-title--link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!a) continue;
      const url = new URL(unescapeHtml(a[1]), `https://${host}`).href;
      if (out.has(url)) continue;
      const place = (li.match(/class="results-list__item-street--label"[^>]*>([^<]*)</) || [])[1] || '';
      out.set(url, {
        i: `px:${host}:${url.split('/job/')[1] || url}`,
        t: unescapeHtml(a[2].replace(/<[^>]+>/g, ' ')),
        c: name,
        l: paradoxPlace(unescapeHtml(place)),
        u: url,
        d: '',
        s: 'paradox',
      });
      added++;
    }
    if (!added) break;
    await pauseMs(250);
  }
  return [...out.values()];
}

async function greenhouse(slug) {
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`);
  return (data.jobs || []).map((j) => ({
    i: `gh:${slug}:${j.id}`,
    t: j.title,
    c: plainName(j.company_name) || pretty(slug),
    l: j.location?.name || '',
    u: j.absolute_url,
    d: j.first_published || j.updated_at || '',
    s: 'greenhouse',
  }));
}

async function lever(slug) {
  const data = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
  return (Array.isArray(data) ? data : []).map((j) => ({
    i: `lv:${slug}:${j.id}`,
    t: j.text,
    c: BOARD_NAMES.lever?.[slug] || pretty(slug),
    l: withRemote(j.categories?.location, j.workplaceType === 'remote'),
    u: j.hostedUrl,
    d: j.createdAt ? new Date(j.createdAt).toISOString() : '',
    s: 'lever',
  }));
}

async function ashby(slug) {
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`);
  return (data.jobs || []).map((j) => ({
    i: `ab:${slug}:${j.id}`,
    t: j.title,
    c: BOARD_NAMES.ashby?.[slug] || pretty(slug),
    l: withRemote(j.location, j.isRemote),
    u: j.jobUrl,
    d: j.publishedAt || '',
    s: 'ashby',
  }));
}

function workdayDate(postedOn) {
  // "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago"
  const t = String(postedOn || '').toLowerCase();
  const day = 86_400_000;
  let ago = null;
  if (t.includes('today')) ago = 0;
  else if (t.includes('yesterday')) ago = 1;
  else if (/(\d+)\+?\s+days?/.test(t)) ago = Number(t.match(/(\d+)/)[1]);
  return ago === null ? '' : new Date(Date.now() - ago * day).toISOString().slice(0, 10);
}

/** One page of a Workday job list. */
function workdayPage(co, base, site, offset, appliedFacets = {}) {
  return curlJson(`${base}/wday/cxs/${co}/${site}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, Referer: `${base}/${site}` },
    body: JSON.stringify({ appliedFacets, limit: 20, offset, searchText: '' }),
  });
}

/**
 * The location filter Workday offers on a board, flattened to [{param, id, count}].
 * Workday shows at most 2,000 jobs per search, so big boards are read one location at a time.
 */
function workdayLocationSlices(facets = []) {
  const flat = [];
  const walk = (list, param) => {
    for (const v of list || []) {
      if (Array.isArray(v.values)) walk(v.values, v.facetParameter || param);
      else if (v.id && typeof v.count === 'number') flat.push({ param, id: v.id, count: v.count, name: v.descriptor || '' });
    }
  };
  for (const f of facets) {
    if (!/location/i.test(f.facetParameter || '') || /country/i.test(f.facetParameter || '')) continue;
    const before = flat.length;
    walk(f.values, f.facetParameter);
    if (flat.length > before) break; // use the first location facet that has values
  }
  return flat;
}

/** A Workday board's jobs, up to `max`. */
/** Site codes like UPS's "US - MATTOON (ILMAT)" read as "Mattoon, IL"; other places pass through. */
export function workdayPlace(text) {
  const m = String(text || '').match(/^US\s*-\s*(.+?)\s*\(([A-Z]{2})[A-Z0-9]{1,5}\)\s*$/);
  if (!m || !US_STATE.test(m[2])) return text;
  const city = m[1].toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return `${city}, ${m[2]}`;
}

async function workday(entry, max = 400) {
  // "tenant|wdN|site", optionally followed by "|Company name" when the tenant's short name isn't the company's.
  const [co, wd, site, label] = entry.split('|');
  // "site-wd5" means the board lives at wd5.myworkdaysite.com/recruiting/{tenant}/{site} (Sysco, Mondelez).
  const onSite = wd.startsWith('site-');
  const base = onSite ? `https://${wd.slice(5)}.myworkdaysite.com` : `https://${co}.${wd}.myworkdayjobs.com`;
  const jobBase = onSite ? `${base}/recruiting/${co}/${site}` : `${base}/${site}`;
  const out = new Map();
  // A job open in several places only says "3 Locations"; when reading one location at a time,
  // that location's name stands in, so the job still lands on the map.
  const add = (posts, sliceName = '') => {
    for (const j of posts || []) {
      if (out.has(j.externalPath)) continue;
      const text = j.locationsText || '';
      out.set(j.externalPath, {
        i: `wd:${co}:${j.externalPath}`,
        t: j.title,
        c: label || WORKDAY_NAMES[co] || BOARD_NAMES.workday?.[co] || pretty(co),
        l: workdayPlace(/^\d+ Locations?$/i.test(text) && sliceName ? sliceName : text),
        u: `${jobBase}${j.externalPath}`,
        d: workdayDate(j.postedOn),
        s: 'workday',
      });
    }
  };
  const readAll = async (facets, limit, first, sliceName = '') => {
    let data = first;
    for (let offset = 0; offset < limit; offset += 20) {
      if (!data) data = await workdayPage(co, base, site, offset, facets);
      add(data.jobPostings, sliceName);
      const n = (data.jobPostings || []).length;
      if (n < 20 || offset + 20 >= (data.total || 0) || out.size >= max || Date.now() > DEADLINE) break;
      data = null;
    }
  };
  const first = await workdayPage(co, base, site, 0);
  const total = first.total || 0;
  const slices = total >= 2000 && max > 2000 ? workdayLocationSlices(first.facets) : [];
  if (!slices.length) {
    await readAll({}, Math.min(max, 2000), first);
  } else {
    for (const sl of slices) {
      if (out.size >= max || Date.now() > DEADLINE) break;
      await readAll({ [sl.param]: [sl.id] }, Math.min(sl.count, 2000), null, sl.name);
    }
  }
  return [...out.values()];
}

const US_STATE = /^(A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|PR|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])$/;

const US_STATE_ABBRS = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
const US_STATE_NAMES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia',
  'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
  'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
  'Pennsylvania', 'Puerto Rico', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
];

/**
 * Career sites built on Jibe (iCIMS and others): GET https://{host}/api/jobs?page=N&limit=100
 * Some sites stop paging after about 5,100 results (later pages repeat the last one); those are
 * then read one state at a time (&location=Texas).
 */
async function jibe({ name, host }) {
  const out = new Map();
  const read = async (filter) => {
    let total = 0;
    let lastPage = '';
    for (let page = 1; page <= 400; page++) {
      const data = await curlJson(`https://${host}/api/jobs?page=${page}&limit=100${filter}`);
      const jobs = data.jobs || [];
      total = data.totalCount || data.count || 0;
      // Past its limit the API sends the same page again: stop there.
      const thisPage = jobs.map((j) => j.data?.req_id || j.data?.slug || '').join(',');
      if (thisPage && thisPage === lastPage) break;
      lastPage = thisPage;
      for (const { data: d = {} } of jobs) {
        const country = String(d.country_code || d.country || '').toLowerCase();
        if (country && !['us', 'usa', 'united states', 'united states of america'].includes(country)) continue;
        const place = [d.city, d.state].filter(Boolean).join(', ') || d.full_location || d.location_name || '';
        const id = d.req_id || d.slug || d.id;
        if (!d.title || !id) continue;
        out.set(`${id}@${place.toLowerCase()}`, {
          i: `jb:${host}:${id}@${place.toLowerCase()}`,
          t: d.title,
          c: name,
          l: place,
          u: `https://${host}/jobs/${d.slug || id}`,
          d: d.posted_date || d.create_date || d.update_date || '',
          s: 'jibe',
        });
      }
      if (!jobs.length || page * 100 >= total) break;
    }
    return total;
  };
  const total = await read('');
  // &location= matches the state whether a site stores it as "Texas" or "TX" (&state= doesn't).
  if (total > out.size + 100) for (const st of US_STATE_NAMES) await read(`&location=${encodeURIComponent(st)}`);
  return [...out.values()];
}

/**
 * Oracle Recruiting Cloud career sites: the public requisitions API behind the job search.
 * A search stops at 10,000 results, so bigger sites are read one state at a time: the site's place
 * lookup (findByLoc with the state's abbreviation) gives the state's ID for locationId=.
 */
async function oracle({ name, host, site }) {
  const out = new Map();
  const read = async (facet) => {
    let step = 200;
    let total = 0;
    for (let offset = 0; offset < 10000; ) {
      const url =
        `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList` +
        `&finder=findReqs;siteNumber=${site},limit=${step},offset=${offset},sortBy=POSTING_DATES_DESC` +
        (facet ? `,locationId=${facet}` : '');
      const data = await curlJson(url);
      const item = (data.items || [])[0] || {};
      const list = item.requisitionList || [];
      total = item.TotalJobsCount || total;
      for (const j of list) {
        out.set(j.Id, {
          i: `or:${host}:${j.Id}`,
          t: j.Title,
          c: name,
          l: String(j.PrimaryLocation || '').replace(/,\s*United States$/, ''),
          u: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${j.Id}`,
          d: j.PostedDate || '',
          s: 'oracle',
        });
      }
      if (!list.length) break;
      if (list.length < step) step = list.length; // the site allows smaller pages than asked for
      offset += list.length;
      if (offset >= total) break;
    }
    return { total };
  };
  const { total } = await read(null);
  if (total > out.size) {
    // The site's own place lookup gives each state's location ID ("TX" -> "TX > United States").
    let read_states = 0;
    for (const ab of US_STATE_ABBRS) {
      const sug = await curlJson(
        `https://${host}/hcmRestApi/resources/latest/recruitingCESearchAutoSuggestions?expand=all&onlyData=true&finder=findByLoc;string=${ab}&limit=20`,
      ).catch(() => ({}));
      const hit = (sug.items || []).flatMap((i) => i.locations || i.items || [i]).find((l) => l && l.Level == 2 && l.State === ab);
      if (!hit) continue;
      read_states++;
      await read(hit.Id);
    }
    console.log(`  ${name}: ${total} jobs, read ${read_states} states one at a time, kept ${out.size}`);
  }
  return [...out.values()];
}

/**
 * Amazon's own job search (amazon.jobs), newest first. It shows at most 10,000 results, so when
 * there are more, it is read again one state at a time (&normalized_state_name[]=Texas).
 */
async function amazon() {
  const out = new Map();
  const read = async (filter) => {
    let hits = 0;
    for (let offset = 0; offset < 10000; offset += 100) {
      const data = await curlJson(`https://www.amazon.jobs/en/search.json?country=USA&result_limit=100&offset=${offset}&sort=recent${filter}`);
      const jobs = data.jobs || [];
      hits = data.hits || 0;
      for (const j of jobs) add(j);
      if (jobs.length < 100 || offset + 100 >= hits || Date.now() > DEADLINE) break;
    }
    return hits;
  };
  const add = (j) => {
      const st = String(j.state || '').trim();
      out.set(`az:${j.id_icims || j.id}`, {
        i: `az:${j.id_icims || j.id}`,
        t: j.title,
        c: /^Amazon\.com\b/.test(j.company_name || '') ? 'Amazon' : plainName(j.company_name) || 'Amazon',
        l: j.city && US_STATE.test(st) ? `${j.city}, ${st}` : j.normalized_location || j.location || '',
        u: `https://www.amazon.jobs${j.job_path || ''}`,
        d: j.posted_date ? new Date(j.posted_date).toISOString() : '',
        s: 'amazon',
      });
  };
  const hits = await read('');
  if (hits >= 10000) {
    for (const st of US_STATE_NAMES) await read(`&normalized_state_name%5B%5D=${encodeURIComponent(st)}`);
    console.log(`  Amazon: ${hits}+ jobs, read state by state, kept ${out.size}`);
  }
  return [...out.values()];
}

/**
 * Workable's public feed of every customer's jobs: one big XML file, read as it streams in.
 * The feed only answers compressed downloads, and (like Workday) turns away Node's fetch, so curl reads it.
 */
async function workableFeed() {
  const curl = spawn('curl', ['-sS', '--fail', '--compressed', '--max-time', '1200', '-A', UA, 'https://www.workable.com/boards/workable.xml']);
  let stderr = '';
  curl.stderr.on('data', (d) => (stderr += d));
  const exited = new Promise((resolve) => curl.on('close', resolve));
  // Every tag sits on its own lines with its value wrapped in CDATA, so allow space around both.
  const tag = (block, name) => {
    const m = block.match(new RegExp(`<${name}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${name}>`));
    return m ? m[1].trim() : '';
  };
  const byUrl = new Map();
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of curl.stdout) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('</job>')) >= 0) {
      const start = buffer.lastIndexOf('<job>', end);
      const block = buffer.slice(start, end);
      buffer = buffer.slice(end + 6);
      const url = tag(block, 'url');
      const title = tag(block, 'title');
      const company = plainName(tag(block, 'company'));
      if (!url.startsWith('https://') || !title || !company) continue;
      const country = tag(block, 'country').toLowerCase().replace(/[^a-z]/g, '');
      if (country && !['us', 'usa', 'unitedstates', 'unitedstatesofamerica'].includes(country)) continue;
      const place = [tag(block, 'city'), tag(block, 'state')].filter(Boolean).join(', ');
      const remote = tag(block, 'remote').toLowerCase() === 'true';
      const prev = byUrl.get(url);
      if (prev) {
        // The same job in more places: list the places once, and say "Remote" once at the end.
        if (place && !prev.places.includes(place)) prev.places.push(place);
        prev.remote ||= remote;
        continue;
      }
      const date = tag(block, 'date');
      byUrl.set(url, {
        i: `wk:${url.split('/').slice(-2).join(':')}`,
        t: title,
        c: company,
        places: place ? [place] : [],
        remote,
        u: url,
        d: date ? new Date(date).toISOString() : '',
        s: 'workable',
      });
    }
  }
  const code = await exited;
  if (code !== 0 && byUrl.size === 0) throw new Error(`curl exit ${code}: ${stderr.trim().slice(0, 200)}`);
  return [...byUrl.values()].map(({ places, remote, ...j }) => ({ ...j, l: withRemote(places.join('; '), remote) || 'United States' }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Asks each company's board, a few at a time. A board that says "too many requests" (429)
 * or times out is asked again after a pause, up to 3 more times. Failures are counted by
 * reason so the manifest shows dead boards (404) apart from throttling (429).
 */
async function pool(items, worker, label, concurrency = CONCURRENCY) {
  const stats = { companies: items.length, answered: 0, failed: 0, jobs: 0, failures: {} };
  let next = 0;
  const results = [];
  const started = Date.now();
  async function run() {
    while (next < items.length) {
      const item = items[next++];
      for (let attempt = 0; ; attempt++) {
        try {
          const jobs = await worker(item);
          stats.answered++;
          stats.jobs += jobs.length;
          for (const j of jobs) results.push(j);
          break;
        } catch (e) {
          const why = e.status ? String(e.status) : e.name === 'TimeoutError' ? 'timeout' : 'error';
          if ((why === '429' || why === 'timeout' || why.startsWith('5')) && attempt < 3) {
            await sleep(3000 * 2 ** attempt + Math.random() * 1000);
            continue;
          }
          stats.failed++;
          stats.failures[why] = (stats.failures[why] || 0) + 1;
          break;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  console.log(
    `${label}: ${stats.answered}/${stats.companies} boards answered, ${stats.jobs} jobs, ${Math.round((Date.now() - started) / 1000)}s, failures ${JSON.stringify(stats.failures)}`,
  );
  return { results, stats };
}

async function companies(file) {
  const list = JSON.parse(await readFile(path.join(HERE, 'companies', file), 'utf8'));
  return [...new Set(list)].slice(0, LIMIT);
}

const want = (name) => !RAW_IN && (!ONLY || ONLY.split(',').some((t) => t.split('@')[0] === name));
// "bigworkday@1/3" reads every third board starting at the second, so a big list can run in parallel parts.
const shardOf = (name) => {
  const t = ONLY.split(',').find((x) => x.split('@')[0] === name && x.includes('@'));
  if (!t) return (list) => list;
  const [k, n] = t.split('@')[1].split('/').map(Number);
  return (list) => list.filter((_, i) => i % n === k);
};
const sources = {};
const all = [];
const add = (jobs) => {
  for (const j of jobs) all.push(j);
};

if (want('greenhouse')) {
  const r = await pool(await companies('greenhouse_companies.json'), greenhouse, 'Greenhouse', 8);
  sources.greenhouse = r.stats;
  add(r.results);
}
if (want('lever')) {
  const r = await pool(await companies('lever_companies.json'), lever, 'Lever');
  sources.lever = r.stats;
  add(r.results);
}
if (want('ashby')) {
  const r = await pool(await companies('ashby_companies.json'), ashby, 'Ashby');
  sources.ashby = r.stats;
  add(r.results);
}
// Proper names for Workday tenants whose short name isn't the company's ("oreillyauto" -> "O'Reilly Auto Parts").
const WORKDAY_NAMES = JSON.parse(await readFile(path.join(HERE, 'companies', 'workday_names.json'), 'utf8'));
const big = JSON.parse(await readFile(BIG ? path.resolve(BIG) : path.join(HERE, 'companies', 'big_employers.json'), 'utf8'));
// Workday boards read in full as big employers are left out of the general list (read at most 400 there).
const boardKey = (e) => e.split('|').slice(0, 3).join('|').toLowerCase();
const bigBoards = new Set((big.workday || []).map(boardKey));
if (want('workday')) {
  const list = (await companies('workday_companies.json')).filter((e) => !bigBoards.has(boardKey(e)));
  const r = await pool(list, workday, 'Workday');
  sources.workday = r.stats;
  add(r.results);
}
if (want('bigworkday')) {
  const r = await pool(shardOf('bigworkday')(big.workday), (e) => workday(e, 40000), 'Big employers on Workday', 4);
  sources.bigworkday = r.stats;
  add(r.results);
}
if (want('jibe')) {
  const r = await pool(big.jibe, jibe, 'Jibe career sites (Costco, JCPenney, …)', 4);
  sources.jibe = r.stats;
  add(r.results);
}
if (want('oracle')) {
  const r = await pool(big.oracle, oracle, 'Oracle career sites (Kroger, …)', 2);
  sources.oracle = r.stats;
  add(r.results);
}
if (want('rmk') && big.rmk?.length) {
  const r = await pool(big.rmk, rmk, 'SuccessFactors career sites (Tractor Supply, …)', 3);
  sources.rmk = r.stats;
  add(r.results);
}
if (want('phenom') && big.phenom?.length) {
  const r = await pool(big.phenom, phenom, 'Phenom career sites (Thermo Fisher, …)', 3);
  sources.phenom = r.stats;
  add(r.results);
}
if (want('radancy') && big.radancy?.length) {
  const r = await pool(big.radancy, radancy, 'Radancy career sites (Chipotle, …)', 3);
  sources.radancy = r.stats;
  add(r.results);
}
if (want('eightfold') && big.eightfold?.length) {
  const r = await pool(big.eightfold, eightfold, 'Eightfold career sites (Lockheed Martin, …)', 2);
  sources.eightfold = r.stats;
  add(r.results);
}
if (want('paradox') && big.paradox?.length) {
  const r = await pool(big.paradox, paradox, "Paradox career sites (FedEx, Dunkin', …)", 2);
  sources.paradox = r.stats;
  add(r.results);
}
if (want('amazon') && big.amazon) {
  const r = await pool(['amazon'], amazon, 'Amazon', 1);
  sources.amazon = r.stats;
  add(r.results);
}
if (want('workable')) {
  try {
    const started = Date.now();
    const jobs = await workableFeed();
    sources.workable = { companies: null, answered: 1, failed: 0, jobs: jobs.length };
    console.log(`Workable feed: ${jobs.length} US jobs, ${Math.round((Date.now() - started) / 1000)}s`);
    add(jobs);
  } catch (e) {
    sources.workable = { companies: null, answered: 0, failed: 1, jobs: 0, error: String(e.message || e) };
    console.log(`Workable feed failed: ${e.message || e}`);
  }
}

if (RAW_OUT) {
  await writeFile(RAW_OUT, JSON.stringify({ sources, jobs: all }));
  console.log(`Saved ${all.length} jobs to ${RAW_OUT}`);
  process.exit(0);
}
if (RAW_IN) {
  for (const f of (await readdir(RAW_IN)).filter((n) => n.endsWith('.json')).sort()) {
    const part = JSON.parse(await readFile(path.join(RAW_IN, f), 'utf8'));
    Object.assign(sources, part.sources);
    add(part.jobs);
    console.log(`Merged ${f}: ${part.jobs.length} jobs`);
  }
  // Never replace the live data with a nearly empty set because most parts failed.
  const min = Number(arg('--min-jobs', '100000'));
  if (all.length < min) {
    console.log(`Only ${all.length} jobs gathered (fewer than ${min}); not publishing.`);
    process.exit(1);
  }
}

// Map coordinates for each job's first place, so the app can measure distance without lookups.
const gazetteer = PLACES ? loadGazetteer(await readFile(PLACES, 'utf8')) : null;
let located = 0;

// Sort into state files and a remote file.
const byState = {};
const remote = [];
let foreign = 0;
let unplaced = 0;
let junk = 0;
const seen = new Set();
// Survey sign-ups and reposts aren't jobs (see junk.mjs). Posters are judged on all their listings, abroad too.
const badPosters = junkPosters(all);
// Employers read from their own career sites are real employers (McDonald's franchise posts say "earn extra cash").
const trusted = new Set(['workday', 'jibe', 'oracle', 'rmk', 'phenom', 'radancy', 'eightfold', 'paradox', 'amazon'].flatMap((k) => (Array.isArray(big[k]) ? big[k] : []).map((e) => (typeof e === 'string' ? e.split('|')[3] : e.name)).filter(Boolean)));
for (const c of trusted) badPosters.delete(c);
console.log(`Not jobs: ${[...badPosters].join(', ') || 'no posters'}`);
for (const j of all) {
  if (!j.t || !j.u || seen.has(j.i)) continue;
  seen.add(j.i);
  if (badPosters.has(j.c) || (isJunkTitle(j.t) && !trusted.has(j.c)) || isReposter(j.c)) {
    junk++;
    continue;
  }
  const p = placeOf(j.l);
  if (p.foreign) {
    foreign++;
    continue;
  }
  const g = coordsOf(j.l, gazetteer);
  if (g) {
    j.g = g;
    located++;
  }
  if (p.remote) remote.push(j);
  for (const st of p.states) (byState[st] ||= []).push(j);
  if (!p.remote && !p.states.length) unplaced++;
}

await mkdir(path.join(OUT, 'v1', 'us'), { recursive: true });
await mkdir(path.join(OUT, 'v1', 'cells'), { recursive: true });
await mkdir(path.join(OUT, 'v1', 'unmapped'), { recursive: true });
const newestFirst = (a, b) => String(b.d).localeCompare(String(a.d));
const stateCounts = {};
// Whole-state files (for "any distance" searches), plus small files the phone needs for a
// distance search: map squares of 1 degree (about 69 by 50 miles) for jobs with coordinates,
// and one file per state for jobs whose city couldn't be put on the map.
const cells = {};
for (const [st, jobs] of Object.entries(byState)) {
  jobs.sort(newestFirst);
  stateCounts[st] = jobs.length;
  await writeFile(path.join(OUT, 'v1', 'us', `${st}.json`), JSON.stringify(jobs));
  const unmapped = jobs.filter((j) => !j.g);
  await writeFile(path.join(OUT, 'v1', 'unmapped', `${st}.json`), JSON.stringify(unmapped));
  for (const j of jobs) if (j.g) (cells[`${Math.floor(j.g[0])}_${Math.floor(j.g[1])}`] ||= new Map()).set(j.i, j);
}
const cellCounts = {};
for (const [key, map] of Object.entries(cells)) {
  const jobs = [...map.values()].sort(newestFirst);
  cellCounts[key] = jobs.length;
  await writeFile(path.join(OUT, 'v1', 'cells', `${key}.json`), JSON.stringify(jobs));
}
// The whole country in a few compact files, for "any distance" searches: each row is
// [title, company number, place, day, rest of link, rest of id, lat, lon], and each company
// entry is [name, source, start of its links, start of its ids], so repeated text is stored once.
const ALL_PARTS = 8;
await mkdir(path.join(OUT, 'v1', 'all'), { recursive: true });
const everyJob = new Map();
for (const jobs of Object.values(byState)) for (const j of jobs) everyJob.set(j.i, j);
const nationwide = [...everyJob.values()].sort(newestFirst);
const commonStart = (list) => {
  let p = list[0];
  for (const x of list) while (!x.startsWith(p)) p = p.slice(0, -1);
  return p;
};
// sameId: write 1 when a job's id rest equals its link rest (word files only; the all/ files keep
// the older form that phones already installed read).
const compact = (list, sameId = false) => {
  const groups = new Map();
  for (const j of list) {
    const key = `${j.c}\u0000${j.s}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(j);
  }
  const c = [];
  const r = [];
  for (const jobs of groups.values()) {
    const pu = commonStart(jobs.map((j) => j.u));
    const pi = commonStart(jobs.map((j) => j.i));
    const n = c.length;
    c.push([jobs[0].c, jobs[0].s, pu, pi]);
    for (const j of jobs) {
      const t = Date.parse(j.d);
      const u = j.u.slice(pu.length);
      const i = j.i.slice(pi.length);
      const row = [j.t, n, j.l.slice(0, 80), Number.isFinite(t) ? Math.floor(t / 864e5) : 0, u, sameId && i === u ? 1 : i];
      if (j.g) row.push(j.g[0], j.g[1]);
      r.push(row);
    }
  }
  return JSON.stringify({ c, r });
};
const per = Math.ceil(nationwide.length / ALL_PARTS);
for (let k = 0; k < ALL_PARTS; k++) {
  await writeFile(path.join(OUT, 'v1', 'all', `${k}.json`), compact(nationwide.slice(k * per, (k + 1) * per)));
}
// Search files, so a keyword search with "any distance" downloads only the jobs that could match
// instead of the whole country: words/{key}.json holds every job with a title word starting with
// those 3 letters (2-letter words get their own file), and words/@{key}.json every job whose
// company name (letters and digits only) starts with those 3. A job is in one file per word.
// words/index.json lists how many jobs each file has, so the phone picks the smallest file.
const WORD_SKIP = ['and', 'the', 'for', 'with', 'of', 'in', 'at', 'to', 'a', 'an', 'i', 'ii', 'iii', 'sr', 'jr', 'or', 'on', 'as', 'by', 'is', 'per', 'our', 'you', 'your', 'from'];
const skipWord = new Set(WORD_SKIP);
const wordKeys = (j) => {
  const keys = new Set();
  for (const w of j.t.toLowerCase().split(/[^a-z0-9]+/)) if (w.length > 1 && !skipWord.has(w)) keys.add(w.slice(0, 3));
  const co = String(j.c || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (co.length >= 3) keys.add(`@${co.slice(0, 3)}`);
  return keys;
};
const byWord = new Map();
for (const j of nationwide) for (const key of wordKeys(j)) (byWord.get(key) || byWord.set(key, []).get(key)).push(j);
await mkdir(path.join(OUT, 'v1', 'words'), { recursive: true });
const wordCounts = {};
for (const [key, list] of byWord) {
  wordCounts[key] = list.length;
  await writeFile(path.join(OUT, 'v1', 'words', `${key}.json`), compact(list, true));
}
await writeFile(
  path.join(OUT, 'v1', 'words', 'index.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), jobs: nationwide.length, skip: WORD_SKIP, n: wordCounts }),
);
remote.sort(newestFirst);
await writeFile(path.join(OUT, 'v1', 'remote.json'), JSON.stringify(remote));
// The newest remote jobs only, so a phone search doesn't download every remote job each time.
await writeFile(path.join(OUT, 'v1', 'remote-recent.json'), JSON.stringify(remote.slice(0, 8000)));
const manifest = {
  generatedAt: new Date().toISOString(),
  totalJobs: seen.size,
  remoteJobs: remote.length,
  skipped: { outsideUS: foreign, noPlace: unplaced, notJobs: junk },
  withCoordinates: located,
  states: stateCounts,
  cells: cellCounts,
  nationwideParts: ALL_PARTS,
  sources,
};
await writeFile(path.join(OUT, 'v1', 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Done: ${seen.size} jobs, ${remote.length} remote, ${Object.keys(stateCounts).length} states, ${foreign} outside the US, ${unplaced} with no place, ${junk} not real jobs.`);
