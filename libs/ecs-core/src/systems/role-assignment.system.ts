import { AccountLifecycle, Registration, Role, Roles } from '@core/components';
import { Result, type UserId, type UtcEpochMs } from '@core/primitives';
import { GovernanceError } from '@core/errors';
import type { User } from '@core/entities';

/**
 * An admitted roles change (security hardening S-WS-E): the target's
 * stored set, the set the call writes (deduplicated, dictionary order) and
 * whether the two differ — `false` writes nothing (the pipeline still
 * revokes, S-L-15).
 */
export type RoleAssignment = {
  readonly rolesFrom: readonly Role[];
  readonly rolesTo: readonly Role[];
  readonly rolesChanged: boolean;
};

/**
 * A requested set against the stored one ({@link RoleAssignmentSystem.changeOf}):
 * the requested set normalised (each role once, dictionary order), whether
 * it differs from the stored set as a SET, and whether it is empty.
 */
export type RoleChange = {
  readonly rolesTo: readonly Role[];
  readonly rolesChanged: boolean;
  readonly rolesEmpty: boolean;
};

/** Whether `value` is one of `list` — typed `string`, so a narrower list needs no cast. */
function holds(list: readonly string[], value: string): boolean {
  return list.includes(value);
}

/**
 * `held` normalised: the roles of the dictionary it holds, each once, in
 * dictionary order (`Roles.ALL`) — an unrecognised string is no role and is
 * dropped. One scan of the six-role dictionary.
 */
function normalised(held: readonly string[]): readonly Role[] {
  const out: Role[] = [];
  for (let i = 0; i < Roles.ALL.length; i++) {
    const role = Roles.ALL[i] as Role;
    if (holds(held, role)) out.push(role);
  }
  return out;
}

/** Whether two normalised sets are equal (same dictionary order, so index by index). */
function sameSet(a: readonly Role[], b: readonly Role[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * The subject guards `decide` and `offerOf` share: a stored account, not
 * erased, registered, holding no `sysadmin` — asked in that order (the
 * impersonation target's order, S-RU-5), the first failing answer alone.
 * Answers the stored account itself, never a copy.
 */
function admitTarget(
  target: User | null,
  targetUserId: UserId,
): Result<User, GovernanceError> {
  if (target === null) {
    return Result.err(GovernanceError.rolesTargetNotFound(targetUserId));
  }
  if (AccountLifecycle.isErased(target)) {
    return Result.err(GovernanceError.rolesTargetErased(targetUserId));
  }
  if (!Registration.isRegistered(target)) {
    return Result.err(GovernanceError.rolesTargetNotRegistered(targetUserId));
  }
  if (holds(target.roles, Role.Sysadmin)) {
    return Result.err(GovernanceError.rolesTargetSysadmin(targetUserId));
  }
  return Result.ok(target);
}

/**
 * The admin's roles change, decided (security hardening S-WS-E: S-RU-11,
 * S-RU-14, S-L-15, S-L-18). Pure: the pipeline reads `users/{caller}` and
 * `users/{target}` inside its commit and asks; the card asks
 * {@link RoleAssignmentSystem.offerOf} / `changeOf` / `saveOf` inside
 * `computed()`. The caller's block is a T2 row (an expiry compared in
 * elapsed real time, `AccountLifecycle.isBlockedAt`): `nowUtcMs`, never the
 * shop clock — an account has no location.
 *
 * THE LAST-ADMIN INVARIANT (S-RU-11) holds by construction: only a caller
 * whose STORED roles hold `Roles.ASSIGN` (`admin`) and who is not blocked
 * at `nowUtcMs` is admitted, and never on their own account — so after
 * every admitted plan the caller is still an admin, and the shop can never
 * lose its last admin through `setRoles` (the property spec proves it over
 * every caller × target × requested set). Should `ASSIGN` ever widen beyond
 * the admin, this invariant becomes a coded refusal in `decide`.
 */
export const RoleAssignmentSystem = {
  /**
   * The roles change one admin may make: the caller's STORED roles hold
   * `Roles.ASSIGN` and the caller is not blocked at `nowUtcMs` (an erased
   * account included) — else `GOVERNANCE_ROLES_FORBIDDEN`; the target is not
   * the caller (`GOVERNANCE_ROLES_SELF`), exists, is not `ERASED`, is
   * `REGISTERED` and holds no `sysadmin` (the four target codes, in that
   * order); the requested set is non-empty and inside `Roles.ASSIGNABLE`
   * (else `GOVERNANCE_ROLES_INVALID` — an unknown string or the sysadmin
   * alike), normalised to dictionary order. The same set as stored is
   * admitted with `rolesChanged: false`.
   */
  decide(input: {
    readonly callerUserId: UserId;
    readonly caller: User | null;
    readonly target: User | null;
    readonly targetUserId: UserId;
    readonly requestedRoles: readonly Role[];
    readonly nowUtcMs: UtcEpochMs;
  }): Result<RoleAssignment, GovernanceError> {
    const caller = input.caller;
    if (
      caller === null ||
      !Roles.assignsRoles(caller.roles) ||
      AccountLifecycle.isBlockedAt(caller, input.nowUtcMs)
    ) {
      return Result.err(GovernanceError.rolesForbidden(input.callerUserId));
    }
    if (input.targetUserId === input.callerUserId) {
      return Result.err(GovernanceError.rolesSelf(input.callerUserId));
    }
    const target = admitTarget(input.target, input.targetUserId);
    if (!target.ok) return target;
    const requested = input.requestedRoles;
    if (requested.length === 0) {
      return Result.err(GovernanceError.rolesInvalid());
    }
    for (let i = 0; i < requested.length; i++) {
      if (!holds(Roles.ASSIGNABLE, requested[i] as string)) {
        return Result.err(GovernanceError.rolesInvalid());
      }
    }
    const change = RoleAssignmentSystem.changeOf(target.value.roles, requested);
    return Result.ok({
      rolesFrom: target.value.roles,
      rolesTo: change.rolesTo,
      rolesChanged: change.rolesChanged,
    });
  },

  /**
   * Whether the card may OFFER the «Роли» block (S-L-18): the viewer
   * assigns roles (`Roles.assignsRoles` on the viewer's claims), and the
   * subject is a stored, `REGISTERED`, not `ERASED` account that is not the
   * viewer and holds no `sysadmin` — the subject guards `decide` shares.
   * The server stays the authority: this only hides a block it would refuse.
   */
  offerOf(
    viewerUserId: UserId,
    viewerRoles: readonly Role[],
    subject: User | null,
  ): boolean {
    return (
      Roles.assignsRoles(viewerRoles) &&
      subject !== null &&
      subject.id !== viewerUserId &&
      admitTarget(subject, subject.id).ok
    );
  },

  /**
   * The requested set against the stored one: the requested roles each
   * once, in dictionary order; changed iff the two differ as SETS (the
   * stored order is not a change); empty iff nothing is requested. `decide`
   * uses it; the card reads it for its Save.
   */
  changeOf(stored: readonly Role[], requested: readonly Role[]): RoleChange {
    const rolesTo = normalised(requested);
    return {
      rolesTo,
      rolesChanged: !sameSet(normalised(stored), rolesTo),
      rolesEmpty: rolesTo.length === 0,
    };
  },

  /**
   * May the card send: a non-empty set that is changed — or, while the
   * last answer for this subject was a failed revoke
   * (`GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED`), the unchanged stored set,
   * re-sent so the server re-revokes (S-RU-10, S-L-18). Never an empty set.
   */
  saveOf(change: RoleChange, revokePending: boolean): boolean {
    return !change.rolesEmpty && (change.rolesChanged || revokePending);
  },
} as const;
