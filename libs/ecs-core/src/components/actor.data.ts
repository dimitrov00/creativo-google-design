import type { ImpersonationSessionId, UserId } from '@core/primitives';
import { ImpersonationScope } from './impersonation-scope.data';
import { Role } from './role.data';
import { Roles } from './roles.data';

/**
 * Actor tags — the ONLY source of these strings, the discriminator
 * `actorRole` of {@link Actor} (flatten-spec §3.7).
 */
export const ActorRole = {
  System: 'SYSTEM',
  User: 'USER',
  Staff: 'STAFF',
  Admin: 'ADMIN',
  Impersonator: 'IMPERSONATOR',
} as const;
export type ActorRole = (typeof ActorRole)[keyof typeof ActorRole];

/**
 * The processes that act with no person behind them — today's free-string
 * `source`s (accounts Q3 answered), closed so a typo is a compile error.
 * `UNATTRIBUTED_*` is what the profile trigger records when the write's auth
 * context named no uid-shaped caller: it says it could not tell rather than
 * naming somebody. The field is `actorSystemSource` (a slice-prefixed
 * reference, N15).
 */
export const SystemSource = {
  /** A callable, the seed or a backfill through the Admin SDK. */
  AdminSdk: 'ADMIN_SDK',
  /** The platform itself (a TTL delete). */
  FirestoreSystem: 'FIRESTORE_SYSTEM',
  ProfileTrigger: 'PROFILE_TRIGGER',
  LoyaltyEngine: 'LOYALTY_ENGINE',
  UnattributedUnknown: 'UNATTRIBUTED_UNKNOWN',
  UnattributedApiKey: 'UNATTRIBUTED_API_KEY',
  UnattributedUnauthenticated: 'UNATTRIBUTED_UNAUTHENTICATED',
  /** Test and seed fixtures. */
  Fixture: 'FIXTURE',
} as const;
export type SystemSource = (typeof SystemSource)[keyof typeof SystemSource];

/**
 * Who initiated an audited act — a union of five FLAT variant slices
 * (Law 6), intersected at the root of `AuditEntry` and `JournalEntry`: every
 * field carries the `actor` prefix, so the slice never collides with the
 * entity's own fields. A union, not a flat `{ userId?; adminUserId?; … }`,
 * so "no actor at all" and "admin AND user at once" are unrepresentable.
 * An actor is always an ACCOUNT (`UserId`), never a customer (D29).
 */
export type Actor =
  Actor.System | Actor.User | Actor.Staff | Actor.Admin | Actor.Impersonator;

export const Actor = {
  system(actorSystemSource: SystemSource): Actor.System {
    return { actorRole: ActorRole.System, actorSystemSource };
  },
  user(actorUserId: UserId): Actor.User {
    return { actorRole: ActorRole.User, actorUserId };
  },
  /** Copies the roles, so a caller that later mutates its array cannot rewrite history. */
  staff(actorUserId: UserId, actorRoles: readonly Role[]): Actor.Staff {
    return {
      actorRole: ActorRole.Staff,
      actorUserId,
      actorRoles: [...actorRoles],
    };
  },
  admin(actorAdminUserId: UserId): Actor.Admin {
    return { actorRole: ActorRole.Admin, actorAdminUserId };
  },
  impersonator(
    actorAdminUserId: UserId,
    actorTargetUserId: UserId,
    actorSessionId: ImpersonationSessionId,
    actorScope: ImpersonationScope,
  ): Actor.Impersonator {
    return {
      actorRole: ActorRole.Impersonator,
      actorAdminUserId,
      actorTargetUserId,
      actorSessionId,
      actorScope,
    };
  },

  /**
   * Who a VERIFIED caller is, for attribution (`actorForCaller`): the shop's
   * `admin` acts as `ADMIN` whatever else they are — the log must tell an
   * owner's override from a barber's act; any other staff role acts as
   * `STAFF` with a snapshot of those roles (`sysadmin`, the vendor's support
   * role, included — never mistaken for the owner); everyone else is a
   * plain `USER`. Attribution, not access. Takes unvalidated claims: an
   * unrecognised string grants nothing and is not written into the snapshot.
   */
  forCaller(userId: UserId, roles: readonly unknown[]): Actor {
    const known = Roles.known(roles);
    const staffRoles: Role[] = [];
    for (let i = 0; i < known.length; i++) {
      const role = known[i] as Role;
      if (role === Role.Admin) return Actor.admin(userId);
      if (Roles.isStaffRole(role)) staffRoles.push(role);
    }
    return staffRoles.length > 0
      ? {
          actorRole: ActorRole.Staff,
          actorUserId: userId,
          actorRoles: staffRoles,
        }
      : Actor.user(userId);
  },

  /**
   * The account the system "sees" acting — the target for an impersonator
   * (the minted token's `sub` IS the target), the obvious one otherwise,
   * `null` only for `SYSTEM`.
   */
  apparentUserId(actor: Actor): UserId | null {
    switch (actor.actorRole) {
      case ActorRole.System:
        return null;
      case ActorRole.User:
      case ActorRole.Staff:
        return actor.actorUserId;
      case ActorRole.Admin:
        return actor.actorAdminUserId;
      case ActorRole.Impersonator:
        return actor.actorTargetUserId;
    }
  },

  /** True iff the act is taken under an impersonation session. */
  isImpersonating(actor: Actor): actor is Actor.Impersonator {
    return actor.actorRole === ActorRole.Impersonator;
  },

  /** Whether mutations are allowed — false only for a `READ`-scope impersonator. */
  canMutate(actor: Actor): boolean {
    return !(
      actor.actorRole === ActorRole.Impersonator &&
      actor.actorScope === ImpersonationScope.Read
    );
  },

  /**
   * The person themselves OR a system process — the only callers of a
   * consent-required mutation (registration, account deletion). An admin or
   * an impersonator (even `WRITE`-scoped: that scope is for support, not for
   * filling in a person's consent) is refused; a `STAFF` actor is still the
   * person and may consent for himself, never for his client.
   */
  isSelfOrSystem(actor: Actor, expectedUserId: UserId): boolean {
    switch (actor.actorRole) {
      case ActorRole.System:
        return true;
      case ActorRole.User:
      case ActorRole.Staff:
        return actor.actorUserId === expectedUserId;
      case ActorRole.Admin:
      case ActorRole.Impersonator:
        return false;
    }
  },
} as const;

export namespace Actor {
  export type System = {
    readonly actorRole: typeof ActorRole.System;
    readonly actorSystemSource: SystemSource;
  };
  export type User = {
    readonly actorRole: typeof ActorRole.User;
    readonly actorUserId: UserId;
  };
  /**
   * A non-admin staff caller acting on the book; `actorRoles` is the
   * snapshot of the caller's STAFF roles at the time of the act — the log
   * must still say "a receptionist did this" after a promotion.
   */
  export type Staff = {
    readonly actorRole: typeof ActorRole.Staff;
    readonly actorUserId: UserId;
    readonly actorRoles: readonly Role[];
  };
  /** An admin acting AS THEMSELVES on shared administrative state. */
  export type Admin = {
    readonly actorRole: typeof ActorRole.Admin;
    readonly actorAdminUserId: UserId;
  };
  /**
   * An admin acting as a target user through a session — both ids, so
   * "who did this?" has one answer: the admin is the actor, the target the
   * apparent one, the session ties every write together.
   */
  export type Impersonator = {
    readonly actorRole: typeof ActorRole.Impersonator;
    readonly actorAdminUserId: UserId;
    readonly actorTargetUserId: UserId;
    readonly actorSessionId: ImpersonationSessionId;
    readonly actorScope: ImpersonationScope;
  };
}
