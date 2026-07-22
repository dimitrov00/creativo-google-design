import { Result, fail, ok } from '@creativo/domain/kernel';
import { InvalidImpersonationScopeError } from './impersonation-scope.errors';

/**
 * What an impersonator may DO inside a session (ported from v2's
 * `ImpersonationSession.Scope`):
 *
 *   - `read`  — observation only. A caller enforcing write authorization
 *               (a Cloud Functions callable, a client-side guard) refuses
 *               mutations when the active session's scope is `read`.
 *   - `write` — full target-user authority for the session's lifetime.
 *
 * Closed enum, not a boolean — `Actor.canMutate` and
 * `ImpersonationSession.start` both switch on it exhaustively.
 */
export type ImpersonationScope = 'read' | 'write';

export const IMPERSONATION_SCOPES: readonly ImpersonationScope[] = [
  'read',
  'write',
];

export function isImpersonationScope(
  value: unknown,
): value is ImpersonationScope {
  return (
    typeof value === 'string' &&
    (IMPERSONATION_SCOPES as readonly string[]).includes(value)
  );
}

/** Validating factory — the door a raw string (e.g. an admin's dropdown pick) uses to become an ImpersonationScope. */
export function parseImpersonationScope(
  raw: string,
): Result<ImpersonationScope, InvalidImpersonationScopeError> {
  return isImpersonationScope(raw)
    ? ok(raw)
    : fail(new InvalidImpersonationScopeError(raw));
}
