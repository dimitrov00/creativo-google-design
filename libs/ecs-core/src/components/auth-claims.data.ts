import { IdentityError } from './identity-errors.data';
import { Result } from './result.data';
import { type Role, knownRoles } from './role.data';
import { TenantId } from './tenant-id.data';

/**
 * The account's stage on the token — the stored `stage` claim strings,
 * unchanged. The ONLY source of these strings.
 */
export const AuthStage = {
  /** Signed in, registration not finished — no roles yet. */
  Onboarding: 'onboarding',
  /** Registered; carries the role set the role gates check. */
  Active: 'active',
} as const;
export type AuthStage = (typeof AuthStage)[keyof typeof AuthStage];

/**
 * The authorization facts on the Firebase ID token's custom claims: a
 * disciplined, slow-changing cache of `users/{uid}`. In memory a flat
 * struct, every key present — an onboarding account holds `roles: []`, a
 * token this app did not mint `tenantId: null`. The claim key is `stage` —
 * kept, because renaming a claim on live tokens would read every signed-in
 * person as onboarding until they signed in again.
 *
 * **The bag stored on the token** is spelled once, by
 * {@link AuthClaims.toToken} (and read back by {@link AuthClaims.fromToken}),
 * unchanged from today (`firebase-auth-token-adapter.ts:12-19`):
 * `{ tenantId, stage: 'active', roles }` when active and
 * `{ tenantId, stage: 'onboarding' }` — NO `roles` key — while onboarding,
 * which the rules' `'roles' in request.auth.token ? … : []` read as no
 * roles; a `null` tenant is left out rather than stored.
 *
 * Invariant (enforced by the factories, degraded to by `fromToken`): roles
 * exist iff the stage is active — "active but roleless" is unrepresentable
 * through this companion. `tenantId` is `null` only on a token this app did
 * not mint.
 */
export type AuthClaims = {
  readonly tenantId: TenantId | null;
  readonly stage: AuthStage;
  readonly roles: readonly Role[];
};

/** Linear scan of a short list — no allocation. */
function hasEntry(values: readonly unknown[], value: unknown): boolean {
  for (let i = 0; i < values.length; i++) {
    if (values[i] === value) return true;
  }
  return false;
}

export const AuthClaims = {
  onboarding(tenantId: TenantId): AuthClaims {
    return { tenantId, stage: AuthStage.Onboarding, roles: [] };
  },

  /** The only way to build active claims: refuses an empty role set (`identity.auth_claims.empty_roles`). */
  active(
    tenantId: TenantId,
    roles: readonly Role[],
  ): Result<AuthClaims, IdentityError> {
    if (roles.length === 0) {
      return Result.err(IdentityError.authClaimsEmptyRoles());
    }
    return Result.ok({ tenantId, stage: AuthStage.Active, roles: [...roles] });
  },

  /**
   * The raw custom-claims bag off a decoded token → the typed claims. The
   * adapter boundary: tolerate anything and degrade SAFELY to onboarding —
   * an over-permissive parse would route an un-onboarded person into the
   * app. Active needs the `active` stage AND at least one KNOWN role (an
   * unrecognised string grants nothing).
   */
  fromToken(raw: { readonly [claim: string]: unknown }): AuthClaims {
    const rawTenant = raw['tenantId'];
    const tenantId =
      typeof rawTenant === 'string' ? TenantId.parse(rawTenant) : null;
    const rawRoles = raw['roles'];
    if (raw['stage'] === AuthStage.Active && Array.isArray(rawRoles)) {
      const roles = knownRoles(rawRoles);
      if (roles.length > 0) {
        return { tenantId, stage: AuthStage.Active, roles };
      }
    }
    return { tenantId, stage: AuthStage.Onboarding, roles: [] };
  },

  /**
   * The custom-claims bag as it is STORED on the token — the one place
   * that shape is spelled, the inverse of {@link AuthClaims.fromToken}
   * (`fromToken(toToken(c))` is `c`). Active: `{ tenantId, stage, roles }`;
   * onboarding: `{ tenantId, stage }` with no `roles` key; a `null` tenant is
   * left out. Today's shape byte for byte, so live tokens and
   * `firestore.rules` read every token minted through it as they always have.
   */
  toToken(claims: AuthClaims): { readonly [claim: string]: unknown } {
    const tenant =
      claims.tenantId === null ? {} : { tenantId: claims.tenantId };
    return claims.stage === AuthStage.Active
      ? { ...tenant, stage: claims.stage, roles: [...claims.roles] }
      : { ...tenant, stage: claims.stage };
  },

  isActive(claims: AuthClaims): boolean {
    return claims.stage === AuthStage.Active && claims.roles.length > 0;
  },

  /** Whether the claims hold `role` — only active claims hold any. */
  hasRole(claims: AuthClaims, role: Role): boolean {
    return AuthClaims.isActive(claims) && hasEntry(claims.roles, role);
  },
} as const;
