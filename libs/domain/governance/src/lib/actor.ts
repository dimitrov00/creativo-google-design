import { UserId } from '@creativo/domain/accounts';
import { ImpersonationSessionId } from './ids';
import { ImpersonationScope } from './impersonation-scope';

/**
 * Who initiated an audited action. Discriminated union over the four
 * real cases (ported from v2's `Actor`) — a flat `{ userId?; adminUserId?;
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
export type Actor = ActorSystem | ActorUser | ActorAdmin | ActorImpersonator;

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
   * filling out a user's own consent-gated forms).
   */
  isSelfOrSystem(actor: Actor, expectedUserId: UserId): boolean {
    switch (actor.kind) {
      case 'system':
        return true;
      case 'user':
        return actor.userId.equals(expectedUserId);
      case 'admin':
      case 'impersonator':
        return false;
    }
  },
} as const;
