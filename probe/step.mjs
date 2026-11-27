// Step 16: Walmart sitemap (robots.txt lists it) and job pages (not disallowed): count job links, check for JobPosting data, read terms.
import { writeFileSync } from 'node:fs';
const UA = 'Mozilla/5.0 (compatible; JobboCollector/1.0; +https://github.com/briane0717/job-hunt-data)';
const get = async (u) => { try { const r = await fetch(u, { headers: { 'user-agent': UA } }); return { s: r.status, t: await r.text(), u: r.url }; } catch (e) { return { s: 0, t: String(e) }; } };
const out = {};
out.robots = (await get('https://careers.walmart.com/robots.txt')).t;
const sm = await get('https://careers.walmart.com/sitemap.xml');
out.sitemapStatus = sm.s; out.sitemapHead = sm.t.slice(0, 1500);
const locs = [...sm.t.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
out.locs = locs.length; out.isIndex = /<sitemapindex/.test(sm.t);
out.lastmod = [...sm.t.matchAll(/<lastmod>([^<]+)</g)].slice(0, 3).map((m) => m[1]);
const pat = {}; for (const l of locs) { const k = l.replace(/R-\d+/, 'R-#').replace(/\/[^/]+$/, '/*'); pat[k] = (pat[k] || 0) + 1; }
out.patterns = Object.entries(pat).sort((a, b) => b[1] - a[1]).slice(0, 40);
const jobs = locs.filter((l) => /\/jobs\/R-\d+/.test(l));
out.jobLinks = jobs.length;
if (out.isIndex) { out.children = {}; for (const c of locs.slice(0, 10)) { const r = await get(c); out.children[c] = [r.s, [...r.t.matchAll(/<loc>/g)].length, r.t.slice(0, 400)]; } }
out.samples = [];
for (const u of jobs.slice(0, 3).concat(jobs.slice(-3))) {
  const r = await get(u);
  const ld = [...r.t.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1].slice(0, 2500));
  const nd = r.t.match(/<script id="?__NEXT_DATA__"?[^>]*>([\s\S]*?)<\/script>/);
  out.samples.push({ u, s: r.s, final: r.u, len: r.t.length, ld, nextData: nd ? nd[1].slice(0, 3000) : null, title: (r.t.match(/<title[^>]*>([^<]*)/) || [])[1] });
  await new Promise((z) => setTimeout(z, 1500));
}
for (const t of ['https://careers.walmart.com/us/en/terms-of-use', 'https://careers.walmart.com/terms', 'https://corporate.walmart.com/privacy-security/walmart-terms-of-use']) { const r = await get(t); out['terms ' + t] = [r.s, r.u, r.t.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200), (r.t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(/.{0,400}(robot|spider|scrap|crawl|automat).{0,400}/gi) || []).slice(0, 6)]; }
writeFileSync('probe/out/walmart_sitemap.json', JSON.stringify(out, null, 1));
