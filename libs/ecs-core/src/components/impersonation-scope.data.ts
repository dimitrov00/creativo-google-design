import { GovernanceError } from './governance-errors.data';
import { Result } from './result.data';

/**
 * What an impersonator may DO inside a session — the stored
 * `impersonationSessions.scope` strings (`impersonation-session.ts:12-13`),
 * unchanged. Closed, not a boolean: `Actor.canMutate` and the session start
 * switch on it exhaustively.
 */
export const ImpersonationScope = {
  /** Observation only — a write-authorizing caller refuses mutations. */
  Read: 'read',
  /** Full target-user authority for the session's lifetime. */
  Write: 'write',
} as const;
export type ImpersonationScope =
  (typeof ImpersonationScope)[keyof typeof ImpersonationScope];

/** Every scope, dictionary order — derived, never a second source. */
export const IMPERSONATION_SCOPES: readonly ImpersonationScope[] =
  Object.values(ImpersonationScope);

/** The edge guard for an untrusted value (a stored field, a callable payload). */
export function isImpersonationScope(
  value: unknown,
): value is ImpersonationScope {
  for (let i = 0; i < IMPERSONATION_SCOPES.length; i++) {
    if (IMPERSONATION_SCOPES[i] === value) return true;
  }
  return false;
}

/** The edge guard with a refusal: a known scope, or `governance.impersonation_scope.invalid`. */
export function parseImpersonationScope(
  raw: string,
): Result<ImpersonationScope, GovernanceError> {
  return isImpersonationScope(raw)
    ? Result.ok(raw)
    : Result.err(GovernanceError.impersonationScopeInvalid(raw));
}
