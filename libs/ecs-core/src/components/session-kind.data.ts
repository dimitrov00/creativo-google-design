/**
 * What the post-OTP path learned about the person — the field `sessionKind`
 * (§9 D22: a tag dictionary because it is on the wire). The
 * `verifyOtpChallenge` wire stays lowercase `'new' | 'returning'` until
 * Phase 4 switches the web OTP client (F2-3): the callable's encoder
 * (`identity.wire.ts`) writes these values in that spelling. It replaced an
 * `isNewUser` boolean, which let a `false` session reach registration; the
 * tag makes the auth machine's guards exhaustive.
 *
 * Identity, not obligation: a session answers only "have we seen this person
 * before?". What a new person must still provide is the onboarding flow's
 * and the deployment `AuthStrategy.required` set's business.
 */
export const SessionKind = {
  New: 'NEW',
  Returning: 'RETURNING',
} as const;
export type SessionKind = (typeof SessionKind)[keyof typeof SessionKind];

/** Every session kind, dictionary order — derived, never a second source. */
export const SESSION_KINDS: readonly SessionKind[] = Object.values(SessionKind);

/** The edge guard for an untrusted value (an answer already converted from the wire). */
export function isSessionKind(value: unknown): value is SessionKind {
  for (let i = 0; i < SESSION_KINDS.length; i++) {
    if (SESSION_KINDS[i] === value) return true;
  }
  return false;
}
