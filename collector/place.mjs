// Where a job is: which US states its location names, and whether it's remote for US workers.

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
};
const NAME_TO_ABBR = Object.fromEntries(Object.entries(STATES).map(([a, n]) => [n.toLowerCase(), a]));
// Big cities often written without a state.
const CITY_STATE = {
  'new york city': 'NY', nyc: 'NY', manhattan: 'NY', brooklyn: 'NY', queens: 'NY', bronx: 'NY', 'san francisco': 'CA',
  'los angeles': 'CA', 'san diego': 'CA', 'san jose': 'CA', chicago: 'IL', boston: 'MA', seattle: 'WA', austin: 'TX',
  dallas: 'TX', houston: 'TX', atlanta: 'GA', miami: 'FL', denver: 'CO', phoenix: 'AZ', philadelphia: 'PA',
  'washington dc': 'DC', 'washington, d.c.': 'DC', 'washington d.c.': 'DC', detroit: 'MI', minneapolis: 'MN',
  portland: 'OR', 'salt lake city': 'UT', nashville: 'TN', charlotte: 'NC', raleigh: 'NC', pittsburgh: 'PA',
  baltimore: 'MD', 'las vegas': 'NV', orlando: 'FL', tampa: 'FL', 'st. louis': 'MO', 'kansas city': 'MO',
  columbus: 'OH', cleveland: 'OH', cincinnati: 'OH', indianapolis: 'IN', milwaukee: 'WI', 'new orleans': 'LA',
  'san antonio': 'TX', sacramento: 'CA', 'jersey city': 'NJ', newark: 'NJ', hoboken: 'NJ', stamford: 'CT',
};
const NON_US = /\b(canada|united kingdom|uk|england|london|germany|berlin|france|paris|india|bangalore|bengaluru|mexico|brazil|spain|ireland|dublin|netherlands|amsterdam|australia|sydney|singapore|japan|tokyo|china|poland|philippines|israel|tel aviv|toronto|vancouver|montreal|emea|apac|latam|europe)\b/i;

/** Which US states a location text names, and whether it is remote for US workers. */
export function placeOf(location) {
  const text = String(location || '');
  const lower = text.toLowerCase();
  const states = new Set();
  for (const m of text.matchAll(/(?:,|\s|^)([A-Z]{2})(?=$|[\s,;)\-|/·]|\d)/g)) if (STATES[m[1]] && m[1] !== 'IN' && m[1] !== 'OR' && m[1] !== 'ME') states.add(m[1]);
  // IN, OR and ME are also English words; only trust them after a comma.
  for (const m of text.matchAll(/,\s*(IN|OR|ME)\b/g)) states.add(m[1]);
  for (const [name, abbr] of Object.entries(NAME_TO_ABBR)) if (lower.includes(name)) states.add(abbr);
  // "Washington" alone is usually the state, but "Washington, DC" is not.
  if (/washington,?\s*d\.?c\.?/i.test(text)) {
    states.delete('WA');
    states.add('DC');
  }
  if (!states.size) for (const [city, abbr] of Object.entries(CITY_STATE)) if (lower.includes(city)) states.add(abbr);
  const remote = /remote|work from home|anywhere|distributed/i.test(text);
  const foreign = NON_US.test(text) && !states.size && !/\b(us|usa|united states|americas|north america)\b/i.test(text);
  return { states: [...states].slice(0, 4), remote: remote && !foreign, foreign };
}


/**
 * City coordinates from the GeoNames cities file (cities1000.txt, CC BY 4.0), loaded once.
 * Lets each job carry rough map coordinates so the app can work out distances offline.
 */
export function loadGazetteer(text) {
  const byCityState = new Map();
  for (const line of text.split('\n')) {
    const f = line.split('\t');
    if (f[8] !== 'US') continue;
    const pop = Number(f[14]) || 0;
    const point = [Math.round(Number(f[4]) * 100) / 100, Math.round(Number(f[5]) * 100) / 100, pop];
    for (const name of new Set([f[1], f[2]])) {
      const key = `${name.toLowerCase()}|${f[10]}`;
      const prev = byCityState.get(key);
      if (!prev || prev[2] < pop) byCityState.set(key, point);
    }
  }
  return byCityState;
}

const CITY_ALIAS = { nyc: 'new york city', 'new york': 'new york city', sf: 'san francisco', 'washington dc': 'washington', 'washington d.c.': 'washington', 'st louis': 'st. louis', 'saint louis': 'st. louis' };

function lookupCity(gazetteer, city, st) {
  const c = city.replace(/^(remote|hybrid|on-?site|in-?office)\s*[-–:]?\s*/i, '').replace(/\s*\b(hq|office|area|metro|metropolitan|greater)\b\s*/gi, ' ').trim().toLowerCase();
  if (!c || !st) return null;
  return gazetteer.get(`${CITY_ALIAS[c] ?? c}|${st}`) ?? gazetteer.get(`${c}|${st}`) ?? null;
}

/**
 * Coordinates for the first place in a location that the city list knows. Tries every
 * "City, ST" / "City, State" in the text, then big cities written without a state
 * ("San Francisco or New York (Hybrid)"), then any phrase in the one state the text names.
 */
export function coordsOf(location, gazetteer) {
  if (!gazetteer) return null;
  const text = String(location || '').replace(/\bUnited States( of America)?\b|\bUSA\b|\bUS\b/g, '');
  for (const m of text.matchAll(/([A-Za-z .'-]{2,40}),\s*([A-Z]{2}|[A-Za-z ]{4,20})(?=$|[^A-Za-z])/g)) {
    const st = m[2].length === 2 ? (STATES[m[2]] ? m[2] : null) : NAME_TO_ABBR[m[2].trim().toLowerCase()];
    const p = lookupCity(gazetteer, m[1].split(/[;|·/()]|\s+or\s+|\s+and\s+/i).pop(), st);
    if (p) return [p[0], p[1]];
  }
  const lower = text.toLowerCase();
  let best = null;
  for (const [city, st] of Object.entries(CITY_STATE)) {
    const at = lower.indexOf(city);
    if (at >= 0 && (!best || at < best.at)) best = { at, city, st };
  }
  if (best) {
    const p = lookupCity(gazetteer, best.city, best.st);
    if (p) return [p[0], p[1]];
  }
  const { states } = placeOf(location);
  if (states.length === 1) {
    for (const part of text.split(/[,;|·/()]+|\s[-–]\s|\s+or\s+/i)) {
      const p = lookupCity(gazetteer, part, states[0]);
      if (p) return [p[0], p[1]];
    }
  }
  return null;
}
