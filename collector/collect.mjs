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
//   {out}/v1/remote.json         remote jobs open to US workers
// A job is {i: id, t: title, c: company, l: location, u: url, d: posted date or '', s: source, g?: [lat, lon]}.

import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { coordsOf, loadGazetteer, placeOf } from './place.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const LIMIT = Number(arg('--limit', '0')) || Infinity; // companies per system, for quick tests
const OUT = path.resolve(arg('--out', 'public'));
const ONLY = arg('--only', ''); // e.g. "greenhouse,lever"
const CONCURRENCY = Number(arg('--concurrency', '24'));
const PLACES = arg('--places', ''); // path to GeoNames cities1000.txt, for job coordinates
const UA = 'JobHuntCollector/1.0 (+https://github.com/; open-source job search app)';

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
  const argv = ['-sS', '--max-time', '25', '-X', method, '-w', '\n%{http_code}', '-A', UA, '-H', 'Accept: application/json'];
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

async function greenhouse(slug) {
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`);
  return (data.jobs || []).map((j) => ({
    i: `gh:${slug}:${j.id}`,
    t: j.title,
    c: j.company_name || pretty(slug),
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
    c: pretty(slug),
    l: [j.categories?.location, j.workplaceType === 'remote' ? 'Remote' : ''].filter(Boolean).join(' · '),
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
    c: pretty(slug),
    l: [j.location, j.isRemote ? 'Remote' : ''].filter(Boolean).join(' · '),
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

async function workday(entry) {
  const [co, wd, site] = entry.split('|');
  const base = `https://${co}.${wd}.myworkdayjobs.com`;
  const api = `${base}/wday/cxs/${co}/${site}/jobs`;
  const out = [];
  for (let offset = 0; offset < 400; offset += 20) {
    const data = await curlJson(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base, Referer: `${base}/${site}` },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' }),
    });
    const posts = data.jobPostings || [];
    for (const j of posts) {
      out.push({
        i: `wd:${co}:${j.externalPath}`,
        t: j.title,
        c: pretty(co),
        l: j.locationsText || '',
        u: `${base}/${site}${j.externalPath}`,
        d: workdayDate(j.postedOn),
        s: 'workday',
      });
    }
    if (posts.length < 20 || offset + 20 >= (data.total || 0)) break;
  }
  return out;
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
      const company = tag(block, 'company');
      if (!url.startsWith('https://') || !title || !company) continue;
      const country = tag(block, 'country').toLowerCase().replace(/[^a-z]/g, '');
      if (country && !['us', 'usa', 'unitedstates', 'unitedstatesofamerica'].includes(country)) continue;
      const place = [tag(block, 'city'), tag(block, 'state')].filter(Boolean).join(', ');
      const remote = tag(block, 'remote').toLowerCase() === 'true';
      const loc = [place, remote ? 'Remote' : ''].filter(Boolean).join(' · ') || (remote ? 'Remote' : 'United States');
      const prev = byUrl.get(url);
      if (prev) {
        if (place && !prev.l.includes(place)) prev.l = `${prev.l}; ${loc}`;
        continue;
      }
      const date = tag(block, 'date');
      byUrl.set(url, {
        i: `wk:${url.split('/').slice(-2).join(':')}`,
        t: title,
        c: company,
        l: loc,
        u: url,
        d: date ? new Date(date).toISOString() : '',
        s: 'workable',
      });
    }
  }
  const code = await exited;
  if (code !== 0 && byUrl.size === 0) throw new Error(`curl exit ${code}: ${stderr.trim().slice(0, 200)}`);
  return [...byUrl.values()];
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

const want = (name) => !ONLY || ONLY.split(',').includes(name);
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
if (want('workday')) {
  const r = await pool(await companies('workday_companies.json'), workday, 'Workday');
  sources.workday = r.stats;
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

// Map coordinates for each job's first place, so the app can measure distance without lookups.
const gazetteer = PLACES ? loadGazetteer(await readFile(PLACES, 'utf8')) : null;
let located = 0;

// Sort into state files and a remote file.
const byState = {};
const remote = [];
let foreign = 0;
let unplaced = 0;
const seen = new Set();
for (const j of all) {
  if (!j.t || !j.u || seen.has(j.i)) continue;
  seen.add(j.i);
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
const newestFirst = (a, b) => String(b.d).localeCompare(String(a.d));
const stateCounts = {};
for (const [st, jobs] of Object.entries(byState)) {
  jobs.sort(newestFirst);
  stateCounts[st] = jobs.length;
  await writeFile(path.join(OUT, 'v1', 'us', `${st}.json`), JSON.stringify(jobs));
}
remote.sort(newestFirst);
await writeFile(path.join(OUT, 'v1', 'remote.json'), JSON.stringify(remote));
const manifest = {
  generatedAt: new Date().toISOString(),
  totalJobs: seen.size,
  remoteJobs: remote.length,
  skipped: { outsideUS: foreign, noPlace: unplaced },
  withCoordinates: located,
  states: stateCounts,
  sources,
};
await writeFile(path.join(OUT, 'v1', 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Done: ${seen.size} jobs, ${remote.length} remote, ${Object.keys(stateCounts).length} states, ${foreign} outside the US, ${unplaced} with no place.`);
