import {
  AccountLifecycle,
  BarberLinkChange,
  BarberLinkRequest,
  Registration,
  Role,
  Roles,
  StaffLink,
} from '@core/components';
import {
  type BarberId,
  Result,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { GovernanceError } from '@core/errors';
import type { BarberLink, User } from '@core/entities';

/**
 * An admitted roles change (security hardening S-WS-E): the target's
 * stored set's known roles (`rolesFrom` — `Roles.known`: each once, stored
 * order, an unknown string dropped, as `AuditSystem.profileTagDelta` reads
 * a side), the set the call writes (deduplicated, dictionary order) and
 * whether the two differ, and the barber link it leaves
 * ({@link BarberLinkAssignment}). Neither changed writes nothing (the
 * pipeline still revokes, S-L-15).
 */
export type RoleAssignment = {
  readonly rolesFrom: readonly Role[];
  readonly rolesTo: readonly Role[];
  readonly rolesChanged: boolean;
} & BarberLinkAssignment;

/**
 * The barber-link half of an admitted roles change (staff analytics,
 * "Which barber the caller is"): the account's stored link
 * (`StaffLink.of` — an absent field is `null`), the link after the call,
 * whether the two differ, and the lock writes that follow — `lockReleased`
 * the record whose lock (`barbers/{id}/restricted/link`) is deleted (only a
 * lock that names this account: another account's lock is never touched),
 * `lockTaken` the record whose lock is written naming this account. Both
 * `null` when the link is unchanged.
 */
export type BarberLinkAssignment = {
  readonly linkedBarberIdFrom: BarberId | null;
  readonly linkedBarberIdTo: BarberId | null;
  readonly linkChanged: boolean;
  readonly lockReleased: BarberId | null;
  readonly lockTaken: BarberId | null;
};

/**
 * What `setRoles`' transaction read for the link (staff analytics): whether
 * the barber record a `SET` names exists (`barbers/{id}`; `false` without
 * a `SET`), that record's lock, and the lock of the record the account is
 * linked to today (`null` when absent or unlinked; the same document as
 * `requestedLock` when the two records are one).
 */
export type BarberLinkFacts = {
  readonly requestedBarberExists: boolean;
  readonly requestedLock: BarberLink | null;
  readonly currentLock: BarberLink | null;
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

/**
 * The barber link the staff client card's picker asks for, against the
 * stored link and the set Save would send ({@link RoleAssignmentSystem.cardLinkOf}).
 */
export type CardLinkChange = {
  /** What `setRoles` is sent for the link. */
  readonly linkRequest: BarberLinkRequest;
  /** The request changes the stored link. */
  readonly linkChanged: boolean;
  /** The barber role is being granted with no barber record picked — Save waits for one. */
  readonly linkMissing: boolean;
  /** The set Save would send holds the barber role, so the picker shows. */
  readonly linkOffered: boolean;
};

/** No link asked for and none missing — a card that does not touch the link. */
const NO_LINK_CHANGE: CardLinkChange = {
  linkRequest: BarberLinkRequest.KEEP,
  linkChanged: false,
  linkMissing: false,
  linkOffered: false,
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
 * at `nowUtcMs` is admitted, and on their own account only with a set
 * that still holds a `Roles.ASSIGN` role (staff permissions P9: an owner
 * who cuts hair adds `barber` and a link to their own account) — so after
 * every admitted plan the caller is still an admin, and the shop can never
 * lose its last admin through `setRoles` (the property spec proves it over
 * every caller × target × requested set). Should `ASSIGN` ever widen beyond
 * the admin, this invariant becomes a coded refusal in `decide`.
 */
export const RoleAssignmentSystem = {
  /**
   * The roles change one admin may make: the caller's STORED roles hold
   * `Roles.ASSIGN` and the caller is not blocked at `nowUtcMs` (an erased
   * account included) — else `GOVERNANCE_ROLES_FORBIDDEN`; the target
   * exists, is not `ERASED`, is `REGISTERED` and holds no `sysadmin` (the
   * four target codes, in that order); the requested set is non-empty and
   * inside `Roles.ASSIGNABLE` (else `GOVERNANCE_ROLES_INVALID` — an unknown
   * string or the sysadmin alike), normalised to dictionary order; and a
   * caller's OWN account takes only a set that still holds a
   * `Roles.ASSIGN` role (else `GOVERNANCE_ROLES_SELF`: nobody takes the
   * admin role from themself — staff permissions P9). The same set as
   * stored is admitted with `rolesChanged: false`. The barber link is then
   * decided on the admitted set ({@link RoleAssignmentSystem.linkOf}: its
   * four refusals come after every rule above). `rolesFrom` is the stored
   * set's known roles (`Roles.known`: each once, stored order, an unknown
   * string dropped) — `users` has no read guard, so a console-written array
   * is read raw, and the audit row's closed `Role[]` tags must not carry it.
   */
  decide(input: {
    readonly callerUserId: UserId;
    readonly caller: User | null;
    readonly target: User | null;
    readonly targetUserId: UserId;
    readonly requestedRoles: readonly Role[];
    readonly linkRequest: BarberLinkRequest;
    readonly linkFacts: BarberLinkFacts;
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
    // One's own account: only a set that still assigns roles — the caller
    // is an admin after every admitted plan (the last-admin invariant).
    if (
      input.targetUserId === input.callerUserId &&
      !Roles.assignsRoles(change.rolesTo)
    ) {
      return Result.err(GovernanceError.rolesSelf(input.callerUserId));
    }
    const link = RoleAssignmentSystem.linkOf({
      target: target.value,
      targetUserId: input.targetUserId,
      rolesTo: change.rolesTo,
      linkRequest: input.linkRequest,
      facts: input.linkFacts,
    });
    if (!link.ok) return link;
    return Result.ok({
      rolesFrom: Roles.known(target.value.roles),
      rolesTo: change.rolesTo,
      rolesChanged: change.rolesChanged,
      ...link.value,
    });
  },

  /**
   * The barber link an admitted roles change leaves (staff analytics,
   * "Which barber the caller is"), on the account as stored and the set the
   * call writes (`rolesTo`, normalised). The design's decision table:
   *
   * - `SET` on an account that will not hold `barber` after the call →
   *   `GOVERNANCE_ROLES_LINK_WITHOUT_BARBER` (removing the role and setting
   *   a link in one call included);
   * - `SET` naming a record with no `barbers/{id}` document →
   *   `GOVERNANCE_ROLES_BARBER_UNKNOWN`;
   * - `SET` naming a record whose lock names another account →
   *   `GOVERNANCE_ROLES_BARBER_ALREADY_LINKED` — THE LOCK DECIDES: a
   *   blocked or erased holder still holds it until its link is cleared
   *   (removing its barber role clears it), and a lock already naming this
   *   account is no conflict;
   * - `barber` added without a `SET` (`KEEP` or `CLEAR`) →
   *   `GOVERNANCE_ROLES_BARBER_LINK_REQUIRED`;
   * - `barber` not held after the call (removed, or never held) → the link
   *   is cleared, whatever a `KEEP` or `CLEAR` asked;
   * - otherwise `SET` links the record, `CLEAR` releases the link ("barber,
   *   not linked") and `KEEP` leaves it as stored.
   *
   * The same link as stored is `linkChanged: false` and plans no lock
   * write, so a retry of a committed change finds nothing to do. A changed
   * link releases the old record's lock when that lock names this account,
   * and takes the new record's lock.
   */
  linkOf(input: {
    readonly target: User;
    readonly targetUserId: UserId;
    readonly rolesTo: readonly Role[];
    readonly linkRequest: BarberLinkRequest;
    readonly facts: BarberLinkFacts;
  }): Result<BarberLinkAssignment, GovernanceError> {
    const from = StaffLink.of(input.target).linkedBarberId;
    const willBeBarber = holds(input.rolesTo, Role.Barber);
    const wasBarber = holds(input.target.roles, Role.Barber);
    const request = input.linkRequest;
    let to: BarberId | null;
    if (request.barberLinkChange === BarberLinkChange.Set) {
      if (!willBeBarber) {
        return Result.err(
          GovernanceError.rolesLinkWithoutBarber(input.targetUserId),
        );
      }
      if (!input.facts.requestedBarberExists) {
        return Result.err(
          GovernanceError.rolesBarberUnknown(request.linkedBarberId),
        );
      }
      const lock = input.facts.requestedLock;
      if (lock !== null && lock.linkedUserId !== input.targetUserId) {
        return Result.err(
          GovernanceError.rolesBarberAlreadyLinked(request.linkedBarberId),
        );
      }
      to = request.linkedBarberId;
    } else if (!willBeBarber) {
      to = null;
    } else if (!wasBarber) {
      return Result.err(
        GovernanceError.rolesBarberLinkRequired(input.targetUserId),
      );
    } else {
      to = request.barberLinkChange === BarberLinkChange.Clear ? null : from;
    }
    const linkChanged = to !== from;
    const current = input.facts.currentLock;
    return Result.ok({
      linkedBarberIdFrom: from,
      linkedBarberIdTo: to,
      linkChanged,
      lockReleased:
        linkChanged &&
        from !== null &&
        current !== null &&
        current.linkedUserId === input.targetUserId
          ? from
          : null,
      lockTaken: linkChanged ? to : null,
    });
  },

  /**
   * Whether an admitted change ends the target's sessions (S-RU-10): every
   * change but the caller's own (staff permissions P9). A revoke exists so
   * a session minted from the old roles cannot outlive them; a caller's own
   * admitted change leaves their token holding `admin`, which already
   * passes every token gate an assignable role passes, and a stale lesser
   * claim adds nothing to it — so signing the owner out would buy nothing.
   * The roles and the link the change wrote are on the stored account,
   * which the callables and the web read.
   */
  revokesSessions(callerUserId: UserId, targetUserId: UserId): boolean {
    return targetUserId !== callerUserId;
  },

  /**
   * Whether the card may OFFER the «Роли» block (S-L-18): the viewer
   * assigns roles (`Roles.assignsRoles` on the viewer's claims), and the
   * subject is a stored, `REGISTERED`, not `ERASED` account that is not the
   * viewer and holds no `sysadmin` — the subject guards `decide` shares.
   * The card never offers the viewer's own account: an admin's own change
   * (`decide` admits one that keeps `admin`) has its door on the Team
   * screen. The server stays the authority: this only hides a block.
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
  saveOf(
    change: RoleChange,
    revokePending: boolean,
    link: CardLinkChange = NO_LINK_CHANGE,
  ): boolean {
    return (
      !change.rolesEmpty &&
      !link.linkMissing &&
      (change.rolesChanged || link.linkChanged || revokePending)
    );
  },

  /**
   * The card's barber picker, decided (staff analytics, "Which barber the
   * caller is"): `picked` is the record the picker shows — the stored link
   * until the admin taps a tile, `null` once they untick it. While the set
   * Save would send holds `barber`, the picker shows: the stored record
   * again is `KEEP`; another record is `SET`; none at all is `CLEAR` for a
   * barber who keeps the role, and MISSING for one being granted it (Save
   * waits, as `setRoles` would refuse `GOVERNANCE_ROLES_BARBER_LINK_REQUIRED`).
   * Without `barber`, nothing is asked: removing the role clears the link
   * on the server.
   */
  cardLinkOf(input: {
    readonly storedRoles: readonly Role[];
    readonly rolesTo: readonly Role[];
    readonly storedLink: BarberId | null;
    readonly picked: BarberId | null;
  }): CardLinkChange {
    if (!holds(input.rolesTo, Role.Barber)) return NO_LINK_CHANGE;
    const wasBarber = holds(input.storedRoles, Role.Barber);
    if (input.picked === null) {
      if (!wasBarber) {
        return {
          linkRequest: BarberLinkRequest.KEEP,
          linkChanged: false,
          linkMissing: true,
          linkOffered: true,
        };
      }
      return input.storedLink === null
        ? { ...NO_LINK_CHANGE, linkOffered: true }
        : {
            linkRequest: BarberLinkRequest.CLEAR,
            linkChanged: true,
            linkMissing: false,
            linkOffered: true,
          };
    }
    return input.picked === input.storedLink
      ? { ...NO_LINK_CHANGE, linkOffered: true }
      : {
          linkRequest: BarberLinkRequest.set(input.picked),
          linkChanged: true,
          linkMissing: false,
          linkOffered: true,
        };
  },
} as const;
