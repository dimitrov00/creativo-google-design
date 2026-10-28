import type { Auth } from 'firebase-admin/auth';
import { Result } from '@core/primitives';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import { AttemptOutcome, Roles } from '@core/components';
import type { AuthEraserPorts, AuthRolesPorts } from '@core/ports';
import { TriggerAttemptSystem } from '@core/systems';

/**
 * The erasure's Admin-Auth bundles of `privacy.port.ts` over
 * `firebase-admin/auth` (audit-hardening Phase 3, WS-D; Law 9 — the factory
 * returns the `&` of the two bundles it serves): `AuthRolesPorts` — the Auth
 * user's custom-claim roles, read beside the stored roles so a missing
 * `users` document never lets an operator's Auth account be erased
 * (P3-L-16) — and `AuthEraserPorts` — the Auth user DELETED, not disabled
 * (P3-L-9: the phone and e-mail are freed, the refresh tokens die).
 *
 * `auth/user-not-found` is an answer, not a failure: no roles (`null`) for
 * the read, done for the delete (a resumed erasure deletes again). Any
 * other failure carries the SDK's CODE only (the `auth-claims.adapter.ts`
 * idiom) — never its message, which may quote the uid's phone or e-mail.
 */

/** `getUser` / `deleteUser` on a uid no Auth user holds. */
const USER_NOT_FOUND = 'auth/user-not-found';

/** The Admin SDK error's own code (`auth/…`), or `null`. */
function authCodeOf(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) {
    return null;
  }
  return typeof error.code === 'string' ? error.code : null;
}

/**
 * A call that failed for a reason the adapter does not answer as a value:
 * `unavailable` when a retry could help (the trigger-attempt vocabulary's
 * transient codes), `unknown` otherwise; the SDK's code rides as `refusal`.
 */
function authFailure(error: unknown): PipelineError {
  const canonical = TriggerAttemptSystem.failureCode(error);
  const code =
    TriggerAttemptSystem.attemptOutcome(canonical) === AttemptOutcome.Transient
      ? PipelineErrorCode.Unavailable
      : PipelineErrorCode.Unknown;
  return PipelineError.of(code, null, authCodeOf(error), null);
}

/** The roles a custom-claims bag lists (`roles`, the token's own key) — none when it lists none. */
function claimRolesOf(claims: unknown): Roles {
  if (claims === null || typeof claims !== 'object') return [];
  const roles = Object.getOwnPropertyDescriptor(claims, 'roles')?.value;
  return Array.isArray(roles) ? Roles.known(roles) : [];
}

export const authEraserPorts = (
  auth: Auth,
): AuthEraserPorts & AuthRolesPorts => ({
  loadAuthRoles: async (userId) => {
    try {
      const user = await auth.getUser(userId);
      return Result.ok(claimRolesOf(user.customClaims));
    } catch (error) {
      return authCodeOf(error) === USER_NOT_FOUND
        ? Result.ok(null)
        : Result.err(authFailure(error));
    }
  },

  deleteAuthUser: async (userId) => {
    try {
      await auth.deleteUser(userId);
      return Result.ok(undefined);
    } catch (error) {
      return authCodeOf(error) === USER_NOT_FOUND
        ? Result.ok(undefined)
        : Result.err(authFailure(error));
    }
  },
});
