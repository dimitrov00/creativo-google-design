import { Result, fail, ok } from '@creativo/domain/kernel';
import { AuthClaims } from './auth-claims';
import { EmptyRolesError } from './auth-claims.errors';
import { PrincipalId } from './ids';
import { Role } from './role';

/**
 * The routing principal for the CURRENT session — what route guards branch
 * on. Derived from the auth token (anonymous vs authed) + its custom
 * claims (onboarding vs active + roles), NOT from a live Firestore read —
 * the verdict is reliable the instant the token is restored on load, with
 * no `users/{uid}` snapshot to lag behind.
 *
 *   - `anonymous`  — no Firebase Auth session.
 *   - `onboarding` — authed, but the claim hasn't flipped to `active` yet.
 *   - `active`     — onboarded; carries the role set the role gates check.
 *
 * Live, revocable facts (e.g. a blocked account) are deliberately NOT
 * here — those belong on a live-read account-status concept, not a
 * token-derived snapshot.
 */
export type Principal =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'onboarding'; readonly uid: PrincipalId }
  | {
      readonly kind: 'active';
      readonly uid: PrincipalId;
      readonly roles: readonly Role[];
    };

export const ANONYMOUS_PRINCIPAL: Principal = { kind: 'anonymous' };

export function onboardingPrincipal(uid: PrincipalId): Principal {
  return { kind: 'onboarding', uid };
}

/** Validating factory — refuses an empty role set (mirrors `activeClaims`'s invariant). */
export function activePrincipal(
  uid: PrincipalId,
  roles: readonly Role[],
): Result<Principal, EmptyRolesError> {
  if (roles.length === 0) {
    return fail(new EmptyRolesError());
  }
  return ok({ kind: 'active', uid, roles });
}

/**
 * Pure derivation: authenticated uid + its token claims → Principal.
 * `null` input (no session) → anonymous.
 */
export function principalFrom(
  input: { readonly uid: PrincipalId; readonly claims: AuthClaims } | null,
): Principal {
  if (input === null) return ANONYMOUS_PRINCIPAL;
  if (input.claims.stage === 'active') {
    return { kind: 'active', uid: input.uid, roles: input.claims.roles };
  }
  return { kind: 'onboarding', uid: input.uid };
}

/** Narrow to the onboarded `active` principal — the only one with roles. */
export function isActivePrincipal(
  principal: Principal,
): principal is Extract<Principal, { kind: 'active' }> {
  return principal.kind === 'active';
}

/** Whether the principal is onboarded AND holds the given role. */
export function principalHasRole(principal: Principal, role: Role): boolean {
  return principal.kind === 'active' && principal.roles.includes(role);
}
