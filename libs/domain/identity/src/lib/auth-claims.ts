import { Result, fail, ok } from '@creativo/domain/kernel';
import { EmptyRolesError } from './auth-claims.errors';
import { Role, roleFromPrimitive } from './role';

/**
 * Authorization facts carried by the Firebase ID token's custom claims — a
 * disciplined, slow-changing cache of the `users/{uid}` source of truth.
 *
 * A union so "active but roleless" is unrepresentable: roles exist iff the
 * account is active. Reachable only through `activeClaims()`, which
 * enforces the non-empty invariant at construction time (this repo's
 * kernel has no `NonEmptyArray<T>` brand yet — see final report — so the
 * invariant is a runtime check on `readonly Role[]` rather than a
 * type-level tuple).
 */
export type AuthClaims =
  | { readonly stage: 'onboarding' }
  | { readonly stage: 'active'; readonly roles: readonly Role[] };

export const ONBOARDING_CLAIMS: AuthClaims = { stage: 'onboarding' };

/** Validating factory — the only way to construct `active` claims; refuses an empty role set. */
export function activeClaims(
  roles: readonly Role[],
): Result<AuthClaims, EmptyRolesError> {
  if (roles.length === 0) {
    return fail(new EmptyRolesError());
  }
  return ok({ stage: 'active', roles });
}

/**
 * Parse the raw ID-token custom-claims bag into the typed union. The
 * adapter boundary: tolerate anything (missing, malformed, empty roles)
 * and degrade SAFELY to `onboarding` — an over-permissive parse would
 * route an un-onboarded user into the app.
 */
export function parseAuthClaims(raw: Record<string, unknown>): AuthClaims {
  if (raw['stage'] === 'active') {
    const rawRoles = raw['roles'];
    if (Array.isArray(rawRoles)) {
      const roles = rawRoles
        .filter((r): r is string => typeof r === 'string' && r.length > 0)
        .map(roleFromPrimitive);
      if (roles.length > 0) {
        return { stage: 'active', roles };
      }
    }
  }
  return ONBOARDING_CLAIMS;
}
