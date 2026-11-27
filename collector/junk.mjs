// Listings that aren't real jobs, decided from what the collected data showed (2026-11-26):
// - Paid surveys, polls, "research panels" and "paid studies" posted as jobs. One poster had 886
//   listings that all lead to a survey sign-up link, under titles like "Customer Service
//   Representative", in US cities and in places like Uppsala, Kraków and Kitchener.
// - Job reposting sites that copy other companies' jobs onto their own board (the same job then
//   shows twice, and applying goes through the middleman).
// The same rules are in the app (src/lib/listing-check.ts in Job_Hunt); keep the two in step.

/** Titles that sell surveys, polls or paid studies rather than a job. Land "survey" work is a real job, so "survey" alone isn't enough. */
export const JUNK_TITLE =
  /\b(paid (surveys?|polls?|stud(?:y|ies)|research|focus groups?)|(take|taking) (online |paid )?(surveys|polls)|research panel(ist)?s?|focus group panel|survey (takers?|panel(ist)?s?|participants?)|side income|earn (cash|money|extra (cash|income))|get paid to)\b/i;
/** "Study participant" is a paid study, unless the job is recruiting or looking after the participants. */
const STUDY = /\bstudy participants?\b/i;
const STAFF = /\b(representative|recruiter|coordinator|specialist|manager|assistant|associate|nurse|technician|supervisor|agent)\b/i;

export function isJunkTitle(title) {
  const t = String(title || '');
  return JUNK_TITLE.test(t) || (STUDY.test(t) && !STAFF.test(t));
}

/** Boards that repost other employers' jobs. */
export const REPOSTERS = new Set(['jobgether']);
const squash = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export const isReposter = (company) => REPOSTERS.has(squash(company));

/**
 * Posters whose listings are mostly survey or study sign-ups: then every listing of theirs goes,
 * including the ones titled like ordinary jobs. At least 3 such titles making up a fifth of their listings,
 * or at least 10 (one survey poster had 45 survey titles among 886 listings); a real employer with
 * an odd title or two keeps its jobs.
 */
export function junkPosters(jobs) {
  const count = new Map();
  for (const j of jobs) {
    const c = count.get(j.c) ?? { all: 0, junk: 0 };
    c.all++;
    if (isJunkTitle(j.t)) c.junk++;
    count.set(j.c, c);
  }
  const out = new Set();
  for (const [c, n] of count) if (n.junk >= 10 || (n.junk >= 3 && n.junk / n.all >= 0.2)) out.add(c);
  return out;
}
