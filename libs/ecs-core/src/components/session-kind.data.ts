/**
 * What the post-OTP path learned about the person — the `sessionKind` wire
 * value `verifyOtp` returns (`'new' | 'returning'`, §9 D22: a tag dictionary
 * because it is on the wire). It replaced an `isNewUser` boolean, which let
 * a `false` session reach registration; the tag makes the auth machine's
 * guards exhaustive.
 *
 * Identity, not obligation: a session answers only "have we seen this person
 * before?". What a new person must still provide is the onboarding flow's
 * and the deployment `AuthStrategy.required` set's business.
 */
export const SessionKind = {
  New: 'new',
  Returning: 'returning',
} as const;
export type SessionKind = (typeof SessionKind)[keyof typeof SessionKind];

/** Every session kind, dictionary order — derived, never a second source. */
export const SESSION_KINDS: readonly SessionKind[] = Object.values(SessionKind);

/** The edge guard for the wire value (the `verifyOtp` callable's answer). */
export function isSessionKind(value: unknown): value is SessionKind {
  for (let i = 0; i < SESSION_KINDS.length; i++) {
    if (SESSION_KINDS[i] === value) return true;
  }
  return false;
}
