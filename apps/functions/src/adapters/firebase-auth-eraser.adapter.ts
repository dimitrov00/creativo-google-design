import type { Auth } from 'firebase-admin/auth';
import { Result } from '@core/primitives';
import { Roles } from '@core/components';
import type { AuthEraserPorts, AuthRolesPorts } from '@core/ports';
import { authCodeOf, authFailure } from './auth-claims.adapter';

/**
 * The erasure's Admin-Auth bundles of `privacy.port.ts` over
 * `firebase-admin/auth` (audit-hardening Phase 3, WS-D; Law 9 — the factory
 * returns the `&` of the two bundles it serves): `AuthRolesPorts` — whether
 * the uid holds an Auth user (`null` when none) and that user's custom-claim
 * roles; the staff-account refusal reads it beside the stored roles
 * (P3-L-16) and refuses a missing `users` document while an Auth user
 * exists (P3-DEP-29) — no production path sets custom claims (roles ride
 * the minted custom token, Phase 4a 4A-14), so the claim roles are defence
 * in depth — and `AuthEraserPorts` — the Auth user DELETED, not disabled
 * (P3-L-9: the phone and e-mail are freed, the refresh tokens die).
 *
 * `auth/user-not-found` is an answer, not a failure: no roles (`null`) for
 * the read, done for the delete (a resumed erasure deletes again). Any
 * other failure carries the SDK's CODE only — never its message, which may
 * quote the uid's phone or e-mail — through the Admin-Auth error helpers'
 * one home (`authCodeOf`, `authFailure` of `auth-claims.adapter.ts`).
 */

/** `getUser` / `deleteUser` on a uid no Auth user holds. */
const USER_NOT_FOUND = 'auth/user-not-found';

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
