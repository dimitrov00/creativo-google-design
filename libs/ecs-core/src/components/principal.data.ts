import type { UserId } from '../entities/user.entity';
import { type AuthClaims, AuthStage } from './auth-claims.data';
import { type Role, isStaff } from './role.data';
import type { TenantId } from './tenant-id.data';

/**
 * Principal tags — the ONLY source of these strings, replacing the
 * `principal.kind` literals of the route guards and feature guards.
 * `onboarding` is kept beside the blueprint's three because the guards
 * branch on it (`active.guard.ts` sends an onboarding principal to
 * `/onboarding`, never to `/auth`).
 */
export const PrincipalKind = {
  /** No Firebase Auth session. */
  Anonymous: 'anonymous',
  /** Signed in; the claims have not flipped to active yet. */
  Onboarding: 'onboarding',
  /** Active, holding no staff role. */
  Client: 'client',
  /** Active, holding at least one staff role (`isStaff`). */
  Staff: 'staff',
} as const;
export type PrincipalKind = (typeof PrincipalKind)[keyof typeof PrincipalKind];

/**
 * The routing principal of the CURRENT session — what guards branch on.
 * Derived from the token (signed in or not) and its claims, never from a
 * live `users/{uid}` read, so the verdict is reliable the instant the token
 * is restored. Live, revocable facts (a block) are deliberately not here:
 * that is `AccountStatus`, read live.
 */
export type Principal =
  | Principal.Anonymous
  | Principal.Onboarding
  | Principal.Client
  | Principal.Staff;

const ANONYMOUS: Principal.Anonymous = { kind: PrincipalKind.Anonymous };

/** Linear scan of a short list — no allocation. */
function hasEntry(values: readonly Role[], value: Role): boolean {
  for (let i = 0; i < values.length; i++) {
    if (values[i] === value) return true;
  }
  return false;
}

export const Principal = {
  anonymous(): Principal.Anonymous {
    return ANONYMOUS;
  },

  /**
   * Signed-in uid + its token claims → the principal; `null` (no session) →
   * anonymous. Active claims with a tenant become `staff` when any role is a
   * staff role, `client` otherwise; anything less (onboarding claims, or
   * claims with no tenant) is `onboarding` — the safe degrade.
   */
  fromClaims(
    session: { readonly uid: UserId; readonly claims: AuthClaims } | null,
  ): Principal {
    if (session === null) return ANONYMOUS;
    const { uid, claims } = session;
    if (
      claims.stage === AuthStage.Active &&
      claims.roles.length > 0 &&
      claims.tenantId !== null
    ) {
      return {
        kind: isStaff(claims.roles)
          ? PrincipalKind.Staff
          : PrincipalKind.Client,
        uid,
        roles: claims.roles,
        tenantId: claims.tenantId,
      };
    }
    return { kind: PrincipalKind.Onboarding, uid, tenantId: claims.tenantId };
  },

  /** Onboarded — the only principals with roles. */
  isActive(
    principal: Principal,
  ): principal is Principal.Client | Principal.Staff {
    return (
      principal.kind === PrincipalKind.Client ||
      principal.kind === PrincipalKind.Staff
    );
  },

  /** Onboarded AND holding `role`. */
  hasRole(principal: Principal, role: Role): boolean {
    return Principal.isActive(principal) && hasEntry(principal.roles, role);
  },

  /** Onboarded AND holding any of `roles` — the roles guard. */
  hasAnyRole(principal: Principal, roles: readonly Role[]): boolean {
    if (!Principal.isActive(principal)) return false;
    for (let i = 0; i < roles.length; i++) {
      if (hasEntry(principal.roles, roles[i] as Role)) return true;
    }
    return false;
  },
} as const;

export namespace Principal {
  export type Anonymous = {
    readonly kind: typeof PrincipalKind.Anonymous;
  };
  export type Onboarding = {
    readonly kind: typeof PrincipalKind.Onboarding;
    readonly uid: UserId;
    /** `null` only on a token this app did not mint. */
    readonly tenantId: TenantId | null;
  };
  export type Client = {
    readonly kind: typeof PrincipalKind.Client;
    readonly uid: UserId;
    readonly roles: readonly Role[];
    readonly tenantId: TenantId;
  };
  export type Staff = {
    readonly kind: typeof PrincipalKind.Staff;
    readonly uid: UserId;
    readonly roles: readonly Role[];
    readonly tenantId: TenantId;
  };
}
