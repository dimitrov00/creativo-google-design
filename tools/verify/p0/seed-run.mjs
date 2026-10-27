/**
 * The seed runs of `verify:p0` (a) share ONE instant (audit-hardening
 * Phase 3, P3-DEP-2): each run used to read its own clock, so a today-visit
 * ending, or the shop's midnight passing, between the two runs made the
 * second write differ from the first. The proof now captures one instant —
 * the caller's `SEED_NOW` when set (the late-shop-time proof), else the
 * clock once — and hands it to both runs as `SEED_NOW`.
 *
 * Pure and plain Node, so `node --test` proves it (`seed-run.spec.mjs`);
 * `verify-p0.mjs` itself refuses to load outside the emulators. The text
 * grammar is the SEED's own (`seedNowOf`, `tools/seed/calendar.mjs`, handed
 * in from the seed's bundle): never a second copy of the parser.
 */

/** The variable the seed reads its instant from (`SEED_NOW_ENV` of `tools/seed/calendar.mjs`). */
export const SEED_NOW = 'SEED_NOW';

/** The env a seed run gets: the caller's, with `SEED_NOW` set to the one instant of this proof. */
export function seedRunEnv(baseEnv, seedNowMs) {
  return { ...baseEnv, [SEED_NOW]: String(seedNowMs) };
}

/**
 * The proof's instant: `SEED_NOW` from the caller's env when set (any form
 * the seed reads — epoch ms, a shop wall time, an ISO instant), else
 * `nowMs`. `seedNowOf` is the seed's own reader (`seed.book.seedNowOf`),
 * asked with no argv, so the proof and the seed agree on every text; a
 * malformed `SEED_NOW` throws here, before the first run.
 */
export function proofInstantOf(baseEnv, nowMs, seedNowOf) {
  return seedNowOf({ argv: [], env: baseEnv, realNowMs: nowMs });
}
