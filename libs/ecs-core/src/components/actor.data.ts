import type { ImpersonationSessionId } from '../entities/impersonation-session.entity';
import type { UserId } from '../entities/user.entity';
import { ImpersonationScope } from './impersonation-scope.data';
import { Role, isStaffRole, knownRoles } from './role.data';

/** Actor tags — the stored `actor.kind` strings of `serializeActor`, unchanged. */
export const ActorKind = {
  System: 'system',
  User: 'user',
  Staff: 'staff',
  Admin: 'admin',
  Impersonator: 'impersonator',
} as const;
export type ActorKind = (typeof ActorKind)[keyof typeof ActorKind];

/**
 * The processes that act with no person behind them — today's free-string
 * `source`s (accounts Q3 answered), closed so a typo is a compile error.
 * `unattributed_*` is what the profile trigger records when the write's auth
 * context named no uid-shaped caller: it says it could not tell rather than
 * naming somebody.
 */
export const SystemSource = {
  /** A callable, the seed or a backfill through the Admin SDK. */
  AdminSdk: 'admin_sdk',
  /** The platform itself (a TTL delete). */
  FirestoreSystem: 'firestore_system',
  ProfileTrigger: 'profile_trigger',
  LoyaltyEngine: 'loyalty_engine',
  UnattributedUnknown: 'unattributed_unknown',
  UnattributedApiKey: 'unattributed_api_key',
  UnattributedUnauthenticated: 'unattributed_unauthenticated',
  /** Test and seed fixtures. */
  Fixture: 'fixture',
} as const;
export type SystemSource = (typeof SystemSource)[keyof typeof SystemSource];

/**
 * Who initiated an audited act — the stored five-kind union of
 * `serializeActor` (`audit-log-document.ts:15-38`), kinds and keys
 * unchanged. A union, not a flat `{ userId?; adminUserId?; sessionId? }`,
 * so "no actor at all" and "admin AND user at once" are unrepresentable.
 */
export type Actor =
  Actor.System | Actor.User | Actor.Staff | Actor.Admin | Actor.Impersonator;

export const Actor = {
  system(source: SystemSource): Actor.System {
    return { kind: ActorKind.System, source };
  },
  user(userId: UserId): Actor.User {
    return { kind: ActorKind.User, userId };
  },
  /** Copies the roles, so a caller that later mutates its array cannot rewrite history. */
  staff(userId: UserId, roles: readonly Role[]): Actor.Staff {
    return { kind: ActorKind.Staff, userId, roles: [...roles] };
  },
  admin(adminUserId: UserId): Actor.Admin {
    return { kind: ActorKind.Admin, adminUserId };
  },
  impersonator(
    adminUserId: UserId,
    targetUserId: UserId,
    sessionId: ImpersonationSessionId,
    scope: ImpersonationScope,
  ): Actor.Impersonator {
    return {
      kind: ActorKind.Impersonator,
      adminUserId,
      targetUserId,
      sessionId,
      scope,
    };
  },

  /**
   * Who a VERIFIED caller is, for attribution (`actorForCaller`): the shop's
   * `admin` acts as `admin` whatever else they are — the log must tell an
   * owner's override from a barber's act; any other staff role acts as
   * `staff` with a snapshot of those roles (`sysadmin`, the vendor's support
   * role, included — never mistaken for the owner); everyone else is a
   * plain `user`. Attribution, not access. Takes unvalidated claims: an
   * unrecognised string grants nothing and is not written into the snapshot.
   */
  forCaller(uid: UserId, roles: readonly unknown[]): Actor {
    const known = knownRoles(roles);
    const staffRoles: Role[] = [];
    for (let i = 0; i < known.length; i++) {
      const role = known[i] as Role;
      if (role === Role.Admin) return Actor.admin(uid);
      if (isStaffRole(role)) staffRoles.push(role);
    }
    return staffRoles.length > 0
      ? { kind: ActorKind.Staff, userId: uid, roles: staffRoles }
      : Actor.user(uid);
  },

  /**
   * The uid the system "sees" acting — the target for an impersonator (the
   * minted token's `sub` IS the target), the obvious one otherwise, `null`
   * only for `system`.
   */
  apparentUserId(actor: Actor): UserId | null {
    switch (actor.kind) {
      case ActorKind.System:
        return null;
      case ActorKind.User:
      case ActorKind.Staff:
        return actor.userId;
      case ActorKind.Admin:
        return actor.adminUserId;
      case ActorKind.Impersonator:
        return actor.targetUserId;
    }
  },

  /** True iff the act is taken under an impersonation session. */
  isImpersonating(actor: Actor): actor is Actor.Impersonator {
    return actor.kind === ActorKind.Impersonator;
  },

  /** Whether mutations are allowed — false only for a `read`-scope impersonator. */
  canMutate(actor: Actor): boolean {
    return !(
      actor.kind === ActorKind.Impersonator &&
      actor.scope === ImpersonationScope.Read
    );
  },

  /**
   * The person themselves OR a system process — the only callers of a
   * consent-required mutation (registration, account deletion). An admin or
   * an impersonator (even `write`-scoped: that scope is for support, not for
   * filling in a person's consent) is refused; a `staff` actor is still the
   * person and may consent for himself, never for his client.
   */
  isSelfOrSystem(actor: Actor, expectedUserId: UserId): boolean {
    switch (actor.kind) {
      case ActorKind.System:
        return true;
      case ActorKind.User:
      case ActorKind.Staff:
        return actor.userId === expectedUserId;
      case ActorKind.Admin:
      case ActorKind.Impersonator:
        return false;
    }
  },
} as const;

export namespace Actor {
  export type System = {
    readonly kind: typeof ActorKind.System;
    readonly source: SystemSource;
  };
  export type User = {
    readonly kind: typeof ActorKind.User;
    readonly userId: UserId;
  };
  /**
   * A non-admin staff caller acting on the book; `roles` is the snapshot of
   * the caller's STAFF roles at the time of the act — the log must still say
   * "a receptionist did this" after a promotion.
   */
  export type Staff = {
    readonly kind: typeof ActorKind.Staff;
    readonly userId: UserId;
    readonly roles: readonly Role[];
  };
  /** An admin acting AS THEMSELVES on shared administrative state. */
  export type Admin = {
    readonly kind: typeof ActorKind.Admin;
    readonly adminUserId: UserId;
  };
  /**
   * An admin acting as a target user through a session — both ids, so
   * "who did this?" has one answer: the admin is the actor, the target the
   * apparent one, the session ties every write together.
   */
  export type Impersonator = {
    readonly kind: typeof ActorKind.Impersonator;
    readonly adminUserId: UserId;
    readonly targetUserId: UserId;
    readonly sessionId: ImpersonationSessionId;
    readonly scope: ImpersonationScope;
  };
}
