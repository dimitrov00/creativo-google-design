/**
 * What the session-ready loop does next — the discriminator
 * `sessionReadiness` of {@link SessionReadinessState}
 * (`SessionAccessSystem.readiness`).
 */
export const SessionReadiness = {
  /** Settled — answer the principal as it stands. */
  Ready: 'READY',
  /** Wait `delayMs`, refresh the token, observe the principal again. */
  Refresh: 'REFRESH',
  /** The schedule ran out — answer the principal as it stands (still onboarding). */
  Exhausted: 'EXHAUSTED',
} as const;
export type SessionReadiness =
  (typeof SessionReadiness)[keyof typeof SessionReadiness];

/**
 * One step of the session-ready loop (`ensureSessionReady`): settled,
 * refresh after `delayMs`, or the schedule spent.
 */
export type SessionReadinessState =
  | { readonly sessionReadiness: typeof SessionReadiness.Ready }
  | {
      readonly sessionReadiness: typeof SessionReadiness.Refresh;
      readonly delayMs: number;
    }
  | { readonly sessionReadiness: typeof SessionReadiness.Exhausted };
