import type { TenantId, UserId } from '../primitives/ids.primitive';
import { type AuthClaims, AuthStage } from './auth-claims.data';
import { type Role, isStaff } from './role.data';

/**
 * Principal tags — the ONLY source of these strings, the discriminator
 * `principalKind`, replacing the `principal.kind` literals of the route
 * guards and feature guards. `ONBOARDING` is kept beside the blueprint's
 * three because the guards branch on it (`active.guard.ts` sends an
 * onboarding principal to `/onboarding`, never to `/auth`).
 */
export const PrincipalKind = {
  /** No Firebase Auth session. */
  Anonymous: 'ANONYMOUS',
  /** Signed in; the claims have not flipped to active yet. */
  Onboarding: 'ONBOARDING',
  /** Active, holding no staff role. */
  Client: 'CLIENT',
  /** Active, holding at least one staff role (`isStaff`). */
  Staff: 'STAFF',
} as const;
export type PrincipalKind = (typeof PrincipalKind)[keyof typeof PrincipalKind];

/**
 * The routing principal of the CURRENT session — what guards branch on.
 * Derived from the token (signed in or not) and its claims, never from a
 * live `users/{uid}` read, so the verdict is reliable the instant the token
 * is restored. Live, revocable facts (a block) are deliberately not here:
 * that is the account's `AccountLifecycle`, read live. The signed-in
 * account is `userId` — always a `UserId`, never a customer (D29).
 */
export type Principal =
  | Principal.Anonymous
  | Principal.Onboarding
  | Principal.Client
  | Principal.Staff;

const ANONYMOUS: Principal.Anonymous = {
  principalKind: PrincipalKind.Anonymous,
};

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
   * Signed-in account + its token claims → the principal; `null` (no
   * session) → anonymous. Active claims with a tenant become `STAFF` when any
   * role is a staff role, `CLIENT` otherwise; anything less (onboarding
   * claims, or claims with no tenant) is `ONBOARDING` — the safe degrade.
   */
  fromClaims(
    session: { readonly userId: UserId; readonly claims: AuthClaims } | null,
  ): Principal {
    if (session === null) return ANONYMOUS;
    const { userId, claims } = session;
    if (
      claims.authStage === AuthStage.Active &&
      claims.roles.length > 0 &&
      claims.tenantId !== null
    ) {
      return {
        principalKind: isStaff(claims.roles)
          ? PrincipalKind.Staff
          : PrincipalKind.Client,
        userId,
        roles: claims.roles,
        tenantId: claims.tenantId,
      };
    }
    return {
      principalKind: PrincipalKind.Onboarding,
      userId,
      tenantId: claims.tenantId,
    };
  },

  /** Onboarded — the only principals with roles. */
  isActive(
    principal: Principal,
  ): principal is Principal.Client | Principal.Staff {
    return (
      principal.principalKind === PrincipalKind.Client ||
      principal.principalKind === PrincipalKind.Staff
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
    readonly principalKind: typeof PrincipalKind.Anonymous;
  };
  export type Onboarding = {
    readonly principalKind: typeof PrincipalKind.Onboarding;
    readonly userId: UserId;
    /** `null` only on a token this app did not mint. */
    readonly tenantId: TenantId | null;
  };
  export type Client = {
    readonly principalKind: typeof PrincipalKind.Client;
    readonly userId: UserId;
    readonly roles: readonly Role[];
    readonly tenantId: TenantId;
  };
  export type Staff = {
    readonly principalKind: typeof PrincipalKind.Staff;
    readonly userId: UserId;
    readonly roles: readonly Role[];
    readonly tenantId: TenantId;
  };
}
