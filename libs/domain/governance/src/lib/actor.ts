import {
  type UserRole,
  UserId,
  isStaffRole,
  isUserRole,
} from '@creativo/domain/accounts';
import { ImpersonationSessionId } from './ids';
import { ImpersonationScope } from './impersonation-scope';

/**
 * Who initiated an audited action. Discriminated union over the five
 * real cases (v2's four, plus `staff`) — a flat `{ userId?; adminUserId?;
 * sessionId? }` shape could encode impossible states (no actor at all,
 * admin AND user set at once); the union makes exactly the representable
 * shapes constructible. No TS `namespace` (per this repo's flat-union
 * precedent, see `AccountStatus`) — `ActorSystem`/`ActorUser`/etc. are
 * plain top-level interfaces.
 *
 * Pure factories/predicates, no `Result` — by the time an `Actor` is
 * constructed, its `UserId`s/`ImpersonationSessionId` are already-validated
 * domain values (same rationale as `AccountStatus`: this is a value used
 * INSIDE an aggregate — here, `AuditEntry.actor` — not a standalone
 * entity with its own persistence-rebuild story). The one real gate —
 * "may this admin even start an impersonation" — lives on
 * `ImpersonationSession.start`, not here.
 */
export type Actor =
  ActorSystem | ActorUser | ActorStaff | ActorAdmin | ActorImpersonator;

export interface ActorSystem {
  readonly kind: 'system';
  /**
   * Free-text source — `'deadline_cron'`, `'migration_v3_to_v4'`. Not
   * branded: cardinality is bounded by deploy-time code paths, not
   * request-time input.
   */
  readonly source: string;
}

export interface ActorUser {
  readonly kind: 'user';
  readonly userId: UserId;
}

/**
 * A non-admin staff caller (barber, receptionist, content manager, or the
 * vendor's sysadmin) acting on the shop's book. `roles` is a snapshot of the caller's STAFF roles at the
 * time of the act — the log must still say "a receptionist did this" after
 * the person has been promoted or let go, and `users/{uid}.roles` only knows
 * the present.
 */
export interface ActorStaff {
  readonly kind: 'staff';
  readonly userId: UserId;
  readonly roles: readonly UserRole[];
}

/** An admin acting AS THEMSELVES on shared administrative state — not impersonating anyone. */
export interface ActorAdmin {
  readonly kind: 'admin';
  readonly adminUserId: UserId;
}

/**
 * An admin acting as a specific target user via an `ImpersonationSession`.
 * Carries BOTH ids so "who did this?" has one unambiguous answer: the
 * admin is the actual actor, the target is the apparent actor, the
 * session is the audit handle tying every write together.
 */
export interface ActorImpersonator {
  readonly kind: 'impersonator';
  readonly adminUserId: UserId;
  readonly targetUserId: UserId;
  readonly sessionId: ImpersonationSessionId;
  readonly scope: ImpersonationScope;
}

export const Actor = {
  system: (source: string): ActorSystem => ({ kind: 'system', source }),
  user: (userId: UserId): ActorUser => ({ kind: 'user', userId }),
  // Copied, so a caller that later mutates its array cannot rewrite history.
  staff: (userId: UserId, roles: readonly UserRole[]): ActorStaff => ({
    kind: 'staff',
    userId,
    roles: [...roles],
  }),
  admin: (adminUserId: UserId): ActorAdmin => ({ kind: 'admin', adminUserId }),
  impersonator: (input: {
    adminUserId: UserId;
    targetUserId: UserId;
    sessionId: ImpersonationSessionId;
    scope: ImpersonationScope;
  }): ActorImpersonator => ({ kind: 'impersonator', ...input }),

  /**
   * The uid the system "sees" as the actor for the write — for
   * impersonation that's the target user (the minted token's `sub` IS
   * the target); everywhere else it's the obvious choice. `null` only
   * for `system`.
   */
  apparentUserId(actor: Actor): UserId | null {
    switch (actor.kind) {
      case 'system':
        return null;
      case 'user':
      case 'staff':
        return actor.userId;
      case 'admin':
        return actor.adminUserId;
      case 'impersonator':
        return actor.targetUserId;
    }
  },

  /** True iff this action is being taken under an active impersonation session. */
  isImpersonating(actor: Actor): actor is ActorImpersonator {
    return actor.kind === 'impersonator';
  },

  /** Whether mutations are allowed under this actor — false only for a `read`-scope impersonator. */
  canMutate(actor: Actor): boolean {
    return !(actor.kind === 'impersonator' && actor.scope === 'read');
  },

  /**
   * Whether the actor is the user themselves OR a system process — the
   * only callers permitted for "consent-required" mutations where an
   * admin acting on behalf is semantically wrong (registration, account
   * deletion, email change, ...). Rejects `admin` and `impersonator`
   * (even with `write` scope — that scope is for support tasks, not
   * filling out a user's own consent-gated forms). A `staff` actor is still
   * the person: a barber may consent for himself, never for his client.
   */
  isSelfOrSystem(actor: Actor, expectedUserId: UserId): boolean {
    switch (actor.kind) {
      case 'system':
        return true;
      case 'user':
      case 'staff':
        return actor.userId.equals(expectedUserId);
      case 'admin':
      case 'impersonator':
        return false;
    }
  },
} as const;

/**
 * Who a VERIFIED caller is, for attribution (spine §5, model.ts): the shop's
 * `admin` acts as `admin` — whatever else they also are, since a shop owner
 * is commonly `barber` AND `admin` and the log must be able to tell an
 * owner's override from a barber's act; any other staff role acts as `staff`
 * with a snapshot of those roles; everyone else is a plain `user`.
 *
 * ATTRIBUTION, not access. `sysadmin` is the VENDOR's support role, which
 * the rules' `isAdmin()` admits but which is not the shop's owner: it is
 * recorded as `staff` with `['sysadmin']` in its snapshot, so an owner
 * override (T4) and a vendor's act never share a row shape, and the log
 * still says a sysadmin did it after the role is gone.
 *
 * Takes `readonly string[]` for the reason `worksTheBook` does: callers hold
 * unvalidated claims off an ID token. An unrecognised string is not a role,
 * grants nothing, and is not written into the snapshot.
 */
export function actorForCaller(uid: UserId, roles: readonly string[]): Actor {
  const known = roles.filter(isUserRole);
  if (known.includes('admin')) return Actor.admin(uid);
  const staffRoles = known.filter(isStaffRole);
  return staffRoles.length > 0 ? Actor.staff(uid, staffRoles) : Actor.user(uid);
}
