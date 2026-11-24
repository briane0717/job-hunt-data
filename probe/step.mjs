// Step 6: small samples of Phenom, Radancy and Eightfold job lists (to write readers), and the Workday boards behind Phenom sites.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
mkdirSync('probe/out', { recursive: true });
const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
async function get(u, extra = []) {
  try { const { stdout } = await run('curl', ['-sL', '-m', '25', '-A', ua, ...extra, u], { maxBuffer: 1 << 27 }); return stdout; } catch { return ''; }
}
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
const S = {};
const body = (ref, from, size) => JSON.stringify({ lang: 'en_us', deviceType: 'desktop', country: 'us', pageName: 'search-results', ddoKey: 'refineSearch', sortBy: '', subsearch: '', from, jobs: true, counts: true, all_fields: ['country'], size, clearAll: false, jdsource: 'facets', isSliderEnable: false, pageId: 'page20', siteType: 'external', keywords: '', global: true, selected_fields: {}, locationData: {}, refNum: ref });
const ph = json(await get('https://careers.corning.com/widgets', ['-X', 'POST', '-H', 'Content-Type: application/json', '-d', body('CUWCUPUS', 0, 100)]));
S.phenom = { n: ph?.refineSearch?.data?.jobs?.length, hits: ph?.refineSearch?.totalHits, job: ph?.refineSearch?.data?.jobs?.[0], countries: ph?.refineSearch?.data?.aggregations?.find?.((a) => a.field === 'country')?.value };
const ph2 = json(await get('https://jobs.thermofisher.com/widgets', ['-X', 'POST', '-H', 'Content-Type: application/json', '-d', body('TFSCGLOBAL', 9990, 100)]));
S.phenomDeep = { n: ph2?.refineSearch?.data?.jobs?.length, hits: ph2?.refineSearch?.totalHits };
const rd = json(await get('https://jobs.chipotle.com/search-jobs/results?ActiveFacetID=0&CurrentPage=3&RecordsPerPage=100&Distance=50&RadiusUnitType=0&Keywords=&Location=&ShowRadius=False&IsPagination=False&FacetTerm=&FacetType=0&SearchResultsModuleName=Search+Results&SearchFiltersModuleName=Search+Filters&SortCriteria=0&SortDirection=0&SearchType=5&ResultsType=0', ['-H', 'X-Requested-With: XMLHttpRequest']));
S.radancy = (rd?.results || '').slice(0, 5000); S.radancyLinks = ((rd?.results || '').match(/href="\/job\//g) || []).length;
const rd2 = json(await get('https://careers.mckesson.com/search-jobs/results?ActiveFacetID=0&CurrentPage=1&RecordsPerPage=15&Distance=50&RadiusUnitType=0&Keywords=&Location=&ShowRadius=False&IsPagination=False&FacetTerm=&FacetType=0&SearchResultsModuleName=Search+Results&SearchFiltersModuleName=Search+Filters&SortCriteria=0&SortDirection=0&SearchType=5&ResultsType=0', ['-H', 'X-Requested-With: XMLHttpRequest']));
S.radancyNoLinks = (rd2?.results || '').slice(0, 4000);
const ef = json(await get('https://micron.eightfold.ai/api/pcsx/search?domain=micron.com&query=&location=&start=0'));
S.eightfold = { keys: Object.keys(ef?.data || {}), pos: ef?.data?.positions?.[0] };
const ef2 = json(await get('https://careers.qualcomm.com/api/pcsx/search?domain=qualcomm.com&query=&location=&start=100'));
S.eightfold2 = { n: ef2?.data?.positions?.length, count: ef2?.data?.count, pos: ef2?.data?.positions?.[0] };
const gen = JSON.parse(readFileSync('collector/companies/workday_companies.json', 'utf8'));
const tenants = ['myhrabc', 'humana', 'truist', 'republic', 'itw', 'pvh', 'trinzic', 'hpe', 'autonation', 'ppg', 'fiserv', 'regions', 'adobe', 'masco', 'conagrabrands', 'dollartree', 'oreillyauto', 'advanceauto'];
S.wd = [];
for (const t of tenants) for (const g of gen.filter((x) => x.startsWith(t + '|'))) {
  const [co, wd, site] = g.split('|'); const base = `https://${co}.${wd}.myworkdayjobs.com`;
  const d = json(await get(`${base}/wday/cxs/${co}/${site}/jobs`, ['-X', 'POST', '-H', 'Content-Type: application/json', '-H', `Origin: ${base}`, '-d', '{"appliedFacets":{},"limit":1,"offset":0,"searchText":""}']));
  S.wd.push(`${g} ${d?.total ?? '-'}`);
}
writeFileSync('probe/out/samples6.json', JSON.stringify(S, null, 1));
