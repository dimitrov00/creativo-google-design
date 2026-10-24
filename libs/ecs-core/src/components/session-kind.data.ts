/**
 * What the post-OTP path learned about the person — the field `sessionKind`
 * (§9 D22: a tag dictionary because it is on the wire). The
 * `verifyOtpChallenge` callable answers these values as they are
 * (`identity.wire.ts`). It replaced an `isNewUser` boolean, which let a
 * `false` session reach registration; the tag makes the auth machine's
 * guards exhaustive.
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
