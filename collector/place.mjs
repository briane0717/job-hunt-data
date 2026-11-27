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
const NON_US = /\b(canada|united kingdom|uk|england|london|germany|berlin|france|paris|india|bangalore|bengaluru|mexico|brazil|spain|ireland|dublin|netherlands|amsterdam|australia|sydney|singapore|japan|tokyo|china|poland|philippines|israel|tel aviv|toronto|vancouver|montreal|emea|apac|latam|europe|queensland|new south wales|brisbane|melbourne|new zealand|auckland|south africa|cape town|johannesburg|nigeria|lagos|kenya|nairobi|egypt|cairo|pakistan|karachi|lahore|vietnam|indonesia|jakarta|malaysia|kuala lumpur|thailand|bangkok|korea|seoul|hong kong|taiwan|taipei|hyderabad|pune|chennai|mumbai|delhi|gurgaon|gurugram|noida|manila|cebu|argentina|buenos aires|colombia|bogota|chile|santiago de chile|peru|lima, peru|sao paulo|são paulo|portugal|lisbon|italy|milan|madrid|barcelona|munich|zurich|switzerland|austria|vienna|belgium|brussels|sweden|stockholm|norway|oslo|denmark|copenhagen|finland|helsinki|czech|prague|romania|bucharest|ukraine|kyiv|turkey|istanbul|uae|dubai|abu dhabi|saudi|riyadh|scotland|edinburgh|glasgow|wales|manchester|costa rica|guatemala|el salvador|honduras|dominican republic)\b/i;

// Countries, provinces and regions that end a place outside the US ("Milano, MI, Italy", "Perth, WA,
// Australia", "Kitchener, Ontario"). Only the last part of a place counts, so "Ontario, CA",
// "Peru, IN" and "New Mexico" stay in the US. Georgia is left out (a US state too).
const COUNTRY = new RegExp(
  '^(' +
    [
      'afghanistan', 'albania', 'algeria', 'andorra', 'angola', 'argentina', 'armenia', 'australia', 'austria', 'azerbaijan',
      'bahrain', 'bangladesh', 'belarus', 'belgium', 'belize', 'bolivia', 'bosnia and herzegovina', 'botswana', 'brasil', 'brazil',
      'bulgaria', 'cambodia', 'cameroon', 'canada', 'chile', 'china', 'colombia', 'costa rica', 'croatia', 'cyprus', 'czechia',
      'czech republic', 'denmark', 'deutschland', 'dominican republic', 'ecuador', 'egypt', 'el salvador', 'estonia', 'ethiopia',
      'finland', 'france', 'germany', 'ghana', 'greece', 'guatemala', 'honduras', 'hong kong', 'hungary', 'iceland', 'india',
      'indonesia', 'iraq', 'ireland', 'israel', 'italy', 'jamaica', 'japan', 'jordan', 'kazakhstan', 'kenya', 'korea',
      'south korea', 'republic of korea', 'kosovo', 'kuwait', 'latvia', 'lebanon', 'lithuania', 'luxembourg', 'macau', 'malaysia',
      'malta', 'mauritius', 'mexico', 'méxico', 'moldova', 'mongolia', 'montenegro', 'morocco', 'nepal', 'netherlands',
      'the netherlands', 'new zealand', 'nicaragua', 'nigeria', 'north macedonia', 'norway', 'oman', 'pakistan', 'panama',
      'paraguay', 'peru', 'philippines', 'poland', 'portugal', 'qatar', 'romania', 'russia', 'rwanda', 'saudi arabia', 'serbia',
      'singapore', 'slovakia', 'slovenia', 'south africa', 'spain', 'españa', 'sri lanka', 'sweden', 'switzerland', 'taiwan',
      'tanzania', 'thailand', 'tunisia', 'turkey', 'türkiye', 'uganda', 'ukraine', 'united arab emirates', 'uae', 'united kingdom',
      'uk', 'great britain', 'england', 'scotland', 'wales', 'northern ireland', 'uruguay', 'uzbekistan', 'venezuela', 'vietnam',
      'viet nam', 'zambia', 'zimbabwe',
      'ontario', 'quebec', 'québec', 'british columbia', 'alberta', 'manitoba', 'saskatchewan', 'nova scotia', 'new brunswick',
      'newfoundland and labrador', 'prince edward island', 'on', 'qc', 'bc', 'ab',
      'new south wales', 'nsw', 'queensland', 'qld', 'victoria', 'vic', 'western australia', 'south australia', 'tasmania',
      'australian capital territory', 'act', 'northern territory',
      'europe', 'emea', 'apac', 'latam', 'asia', 'africa', 'middle east', 'european union', 'eu',
    ].join('|') +
    ')$',
  'i',
);
const CANADA = /^(on|qc|bc|ab|mb|sk|ns|nb|nl|pe|ontario|quebec|québec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick)$/;
const IN_US = /\b(us|usa|u\.s\.a?\.?|united states( of america)?|americas|north america)\b/i;

/** True when every place a location names is outside the US. */
export function abroad(location) {
  const text = String(location || '');
  if (!text.trim() || IN_US.test(text)) return false;
  const places = text
    .split(/;|\||\s\/\s|\s(?:or|and)\s|\s[-–]\s/)
    .map((p) => p.replace(/\((?:remote|hybrid|on-?site)\)|·\s*(remote|hybrid|on-?site)|\b(remote|hybrid|on-?site)\b\s*[-–:,]?/gi, ' ').replace(/[()]/g, ' ').trim())
    .filter((p) => p && /[a-z]/i.test(p));
  if (!places.length) return false;
  return places.every((p) => {
    const parts = p.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    // "Montreal, QC, CA": CA after a Canadian province is Canada, not California.
    if (parts.length >= 3 && parts[parts.length - 1] === 'ca' && CANADA.test(parts[parts.length - 2])) return true;
    if (!COUNTRY.test(parts[parts.length - 1] || '')) return false;
    // "PA, Lebanon" is Lebanon, Pennsylvania; "New York City, London, Singapore" includes New York.
    const usPart = (x) => NAME_TO_ABBR[x] || CITY_STATE[x] || (parts.length === 2 && STATES[x.toUpperCase()]);
    return !parts.slice(0, -1).some(usPart);
  });
}

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
  // Whole words only: "Queensland" (Australia) must not count as Queens, NY.
  const foreignPlace = NON_US.test(text);
  if (!states.size && !foreignPlace) for (const [city, abbr] of Object.entries(CITY_STATE)) if (new RegExp(`(^|[^a-z])${city.replace(/\./g, '\\.')}($|[^a-z])`).test(lower)) states.add(abbr);
  const remote = /remote|work from home|anywhere|distributed/i.test(text);
  const foreign = (foreignPlace && !states.size && !/\b(us|usa|united states|americas|north america)\b/i.test(text)) || abroad(text);
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
    const m = new RegExp(`(^|[^a-z])${city.replace(/\./g, '\\.')}($|[^a-z])`).exec(lower);
    const at = m ? m.index : -1;
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
