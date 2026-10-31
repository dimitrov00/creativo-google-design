/**
 * What App Check made of one callable request (security hardening S-WS-A,
 * S-RU-17) — the field `appCheckOutcome` of the edge's outcome line and of
 * an App Check refusal, the ONLY source of these strings. A tag, never the
 * token: the edge reads only whether a header arrived and what the
 * platform's verification said (`AppCheckSystem.outcomeOf`).
 */
export const AppCheckOutcome = {
  /** The platform verified the token. */
  Valid: 'VALID',
  /** No `X-Firebase-AppCheck` header arrived. */
  Missing: 'MISSING',
  /** A header arrived that the platform could not verify. */
  Invalid: 'INVALID',
  /** A verified limited-use token the platform had consumed before — a replay. */
  Replayed: 'REPLAYED',
} as const;
export type AppCheckOutcome =
  (typeof AppCheckOutcome)[keyof typeof AppCheckOutcome];
