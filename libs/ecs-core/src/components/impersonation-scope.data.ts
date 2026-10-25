/**
 * What an impersonator may DO inside a session — the session's field
 * `impersonationScope`, stored as these SCREAMING_SNAKE values at the root
 * of `impersonationSessions/{id}` (the identity flip retired the lowercase
 * `scope` key and its converting shims). Closed, not a boolean:
 * `Actor.canMutate` and the session start switch on it exhaustively. The
 * edge guard is `ImpersonationLifecycle.parseScope`.
 */
export const ImpersonationScope = {
  /** Observation only — a write-authorizing caller refuses mutations. */
  Read: 'READ',
  /** Full target-user authority for the session's lifetime. */
  Write: 'WRITE',
} as const;
export type ImpersonationScope =
  (typeof ImpersonationScope)[keyof typeof ImpersonationScope];
