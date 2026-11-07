import {
  Actor,
  BarberLinkChange,
  type DocBody,
  type DocPath,
  type Role,
  Roles,
  type RolesCall,
  StaffLink,
  WriteOp,
} from '@core/components';
import {
  type BarberId,
  LogEvent,
  type OperationId,
  Result,
  Tag,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  GovernanceError,
  GovernanceErrorCode,
  type SetRolesError,
} from '@core/errors';
import {
  BARBER_LINK_DOC,
  type Barber,
  type BarberLink,
  Collections,
  Subcollections,
  type User,
} from '@core/entities';
import type {
  AuthSessionRevokePorts,
  ClockPorts,
  CommitPorts,
  HashPorts,
  TelemetryPorts,
} from '@core/ports';
import {
  AuditSystem,
  type BarberLinkFacts,
  type RoleAssignment,
  RoleAssignmentSystem,
} from '@core/systems';

/**
 * `setRoles` — an admin changes one account's roles (security hardening
 * S-WS-E; S-RU-9 … S-RU-14, S-L-15 … S-L-17, S-L-26). The caller gate
 * first, on the VERIFIED token (the wire asks it too, before the payload
 * is read): no session → `GOVERNANCE_ROLES_UNAUTHENTICATED`, claims holding
 * no `Roles.ASSIGN` role → `GOVERNANCE_ROLES_FORBIDDEN`. Then ONE commit
 * (Law 4: the transaction is the sandwich) that reads `users/{caller}` and
 * `users/{target}` — and, for a link `SET`, `barbers/{id}` (does the
 * record exist) and its lock `barbers/{id}/restricted/link`, then the lock
 * of the record the target is linked to today (staff analytics, "Which
 * barber the caller is": two accounts can never hold one record, because
 * both locks are in the transaction's conflict set) — and asks
 * `RoleAssignmentSystem.decide` — the caller's STORED roles and block
 * judged at the instant read once before the transaction, self, the
 * target's four guards, the requested set, then the link — and, when the
 * set or the link changes, plans the `users` update (`roles` and/or
 * `linkedBarberId`, and `profileEditedAtUtcMs` — the marker the profile
 * trigger reads as "audited by a callable", S-RU-12), the lock writes (the
 * old record's lock deleted, the new one's set naming the account) and its
 * ONE `PROFILE_ROLES_CHANGED` row (`AuditSystem.planRolesChanged`,
 * credited through `Actor.forCaller` over the STORED roles, never the
 * token's) under `hash(idBasis)` — the row lands with the change or not at
 * all. An unchanged set and link commits nothing.
 *
 * After the commit — a link-only change and the unchanged call too, so a
 * retry finishes a revoke
 * that failed (S-L-15) — the target's refresh tokens are revoked
 * (S-RU-10): their next session is minted from the written roles. Every
 * successful revoke logs `roles.sessions_revoked` (a forced sign-out is
 * never silent, S-L-26); a failed one logs `roles.sessions_not_revoked`
 * (alerted on any occurrence) and answers
 * `GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED` — the roles stay committed. A
 * refusal commits nothing, never revokes and logs `roles.change_refused`
 * with its code; a store failure answers as the commit answers it.
 */

export type SetRolesPorts = CommitPorts &
  ClockPorts &
  HashPorts &
  AuthSessionRevokePorts &
  TelemetryPorts;

/** The call (`RolesCall`) & the verified caller — never the payload's. */
export type SetRolesCommand = RolesCall & {
  /** The verified session's uid; `null` without one. */
  readonly adminUserId: UserId | null;
  /** The verified token's roles — the wire's gate read them. */
  readonly adminRoles: readonly Role[];
  /**
   * The call's transport operation id (RU-21) — optional on the wire:
   * absent or malformed is `null`, never refused.
   */
  readonly operationId: OperationId | null;
};

/** The transaction's decision: the admitted change and its plan. */
type RolesDecision = {
  readonly assignment: RoleAssignment;
  readonly writes: readonly WriteOp[];
};

/** What the transaction read: both accounts and the link's facts. */
type Snapshot = {
  readonly caller: User | null;
  readonly target: User | null;
  readonly linkFacts: BarberLinkFacts;
};

/** `barbers/{barberId}/restricted/link` — the record's account lock. */
function lockPath(barberId: BarberId): DocPath {
  return [
    Collections.Barbers,
    barberId,
    Subcollections.Restricted,
    BARBER_LINK_DOC,
  ];
}

/**
 * The `users` update of an admitted change: the roles when they changed,
 * the link when it changed, and the `profileEditedAtUtcMs` marker the
 * profile trigger reads as "audited by a callable" (S-RU-12) — a link-only
 * change stamps it like a role change.
 */
function userFieldsOf(
  assignment: RoleAssignment,
  nowUtcMs: UtcEpochMs,
): DocBody {
  const fields: Record<string, unknown> = { profileEditedAtUtcMs: nowUtcMs };
  if (assignment.rolesChanged) fields['roles'] = assignment.rolesTo;
  if (assignment.linkChanged) {
    fields['linkedBarberId'] = assignment.linkedBarberIdTo;
  }
  return fields;
}

/** The lock writes of a changed link: the old record's lock released, the new one's taken. */
function lockWritesOf(
  assignment: RoleAssignment,
  targetUserId: UserId,
): readonly WriteOp[] {
  const out: WriteOp[] = [];
  if (assignment.lockReleased !== null) {
    out.push(WriteOp.remove(lockPath(assignment.lockReleased)));
  }
  if (assignment.lockTaken !== null) {
    const lock: Omit<BarberLink, 'id'> = { linkedUserId: targetUserId };
    out.push(WriteOp.set(lockPath(assignment.lockTaken), lock));
  }
  return out;
}

/**
 * The caller as `setRoles` gates them on the verified token — a uid whose
 * claims hold a `Roles.ASSIGN` role, or the refusal. The wire asks it
 * before reading the payload; the pipeline asks it again before its read.
 */
export function admitRolesCaller(
  adminUserId: UserId | null,
  adminRoles: readonly Role[],
): Result<UserId, GovernanceError> {
  if (adminUserId === null) {
    return Result.err(GovernanceError.rolesUnauthenticated());
  }
  return Roles.assignsRoles(adminRoles)
    ? Result.ok(adminUserId)
    : Result.err(GovernanceError.rolesForbidden(adminUserId));
}

export const setRoles =
  (ports: SetRolesPorts) =>
  async (
    cmd: SetRolesCommand,
  ): Promise<Result<RolesCall.Changed, SetRolesError>> => {
    const admitted = admitRolesCaller(cmd.adminUserId, cmd.adminRoles);
    if (!admitted.ok) {
      ports.log('info', LogEvent.RolesChangeRefused, {
        errorCode: admitted.error.errorCode,
      });
      return admitted;
    }
    const callerUserId = admitted.value;
    const targetPath = [Collections.Users, cmd.targetUserId];
    // Read once, before the transaction: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();
    // The barber record a `SET` names — `null` for `KEEP` and `CLEAR`.
    const requested =
      cmd.barberLinkChange === BarberLinkChange.Set ? cmd.linkedBarberId : null;
    const committed = await ports.commit(
      async (tx): Promise<Snapshot> => {
        // One round trip: both accounts, and a SET's record and its lock.
        const [accounts, barber, requestedLock] = await Promise.all([
          tx.getAll<User>([[Collections.Users, callerUserId], targetPath]),
          requested === null
            ? null
            : tx.get<Barber>([Collections.Barbers, requested]),
          requested === null ? null : tx.get<BarberLink>(lockPath(requested)),
        ]);
        const [caller = null, target = null] = accounts;
        // The lock of the record the account is linked to today — the
        // requested one already read when the two are one record.
        const current =
          target === null ? null : StaffLink.of(target).linkedBarberId;
        const currentLock =
          current === null
            ? null
            : current === requested
              ? requestedLock
              : await tx.get<BarberLink>(lockPath(current));
        return {
          caller,
          target,
          linkFacts: {
            requestedBarberExists: barber !== null,
            requestedLock,
            currentLock,
          },
        };
      },
      ({
        caller,
        target,
        linkFacts,
      }): Result<RolesDecision, GovernanceError> => {
        const decided = RoleAssignmentSystem.decide({
          callerUserId,
          caller,
          target,
          targetUserId: cmd.targetUserId,
          requestedRoles: cmd.roles,
          linkRequest: cmd,
          linkFacts,
          nowUtcMs,
        });
        if (!decided.ok) return decided;
        const assignment = decided.value;
        if (!assignment.rolesChanged && !assignment.linkChanged)
          return Result.ok({ assignment, writes: [] });
        // `decide` admits only a stored caller holding `Roles.ASSIGN`.
        const actor = Actor.forCaller(callerUserId, caller?.roles ?? []);
        return Result.ok({
          assignment,
          writes: [
            WriteOp.update(targetPath, userFieldsOf(assignment, nowUtcMs)),
            ...lockWritesOf(assignment, cmd.targetUserId),
            ...AuditSystem.createsOf(
              [
                AuditSystem.planRolesChanged(
                  cmd.targetUserId,
                  assignment,
                  actor,
                  nowUtcMs,
                  cmd.operationId,
                ),
              ],
              ports.hash,
            ),
          ],
        });
      },
    );
    if (!committed.ok) {
      if (Tag.has(GovernanceErrorCode, committed.error.errorCode)) {
        ports.log('info', LogEvent.RolesChangeRefused, {
          errorCode: committed.error.errorCode,
        });
      }
      return committed;
    }
    const { rolesTo, rolesChanged, linkedBarberIdTo, linkChanged } =
      committed.value.assignment;
    if (rolesChanged || linkChanged) {
      ports.log('info', LogEvent.RolesChanged, {
        targetUserId: cmd.targetUserId,
        rolesCount: rolesTo.length,
        rolesChanged,
        linkChanged,
      });
    }
    const revoked = await ports.revokeRefreshTokens(cmd.targetUserId);
    if (!revoked.ok) {
      ports.log('error', LogEvent.RolesSessionsNotRevoked, {
        targetUserId: cmd.targetUserId,
        errorCode: revoked.error.errorCode,
      });
      return Result.err(
        GovernanceError.rolesSessionsNotRevoked(cmd.targetUserId),
      );
    }
    ports.log('info', LogEvent.RolesSessionsRevoked, {
      targetUserId: cmd.targetUserId,
      rolesChanged,
      linkChanged,
    });
    return Result.ok({
      targetUserId: cmd.targetUserId,
      roles: rolesTo,
      rolesChanged,
      linkedBarberId: linkedBarberIdTo,
      linkChanged,
    });
  };
