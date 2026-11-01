import {
  Actor,
  type Role,
  Roles,
  type RolesCall,
  WriteOp,
} from '@core/components';
import {
  LogEvent,
  type OperationId,
  Result,
  Tag,
  type UserId,
} from '@core/primitives';
import {
  GovernanceError,
  GovernanceErrorCode,
  type SetRolesError,
} from '@core/errors';
import { Collections, type User } from '@core/entities';
import type {
  AuthSessionRevokePorts,
  ClockPorts,
  CommitPorts,
  HashPorts,
  TelemetryPorts,
} from '@core/ports';
import {
  AuditSystem,
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
 * `users/{target}` and asks `RoleAssignmentSystem.decide` — the caller's
 * STORED roles and block judged at the instant read once before the
 * transaction, self, the target's four guards, the requested set — and,
 * when the set changes, plans the `users` update (`roles`, and
 * `profileEditedAtUtcMs` — the marker the profile trigger reads as "audited
 * by a callable", S-RU-12) and its ONE `PROFILE_ROLES_CHANGED` row
 * (`AuditSystem.planRolesChanged`, credited through `Actor.forCaller` over
 * the STORED roles, never the token's) under `hash(idBasis)` — the row
 * lands with the roles or not at all. An unchanged set commits nothing.
 *
 * After the commit — the unchanged set too, so a retry finishes a revoke
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
    const committed = await ports.commit(
      (tx) => tx.getAll<User>([[Collections.Users, callerUserId], targetPath]),
      ([caller = null, target = null]): Result<
        RolesDecision,
        GovernanceError
      > => {
        const decided = RoleAssignmentSystem.decide({
          callerUserId,
          caller,
          target,
          targetUserId: cmd.targetUserId,
          requestedRoles: cmd.roles,
          nowUtcMs,
        });
        if (!decided.ok) return decided;
        const assignment = decided.value;
        if (!assignment.rolesChanged)
          return Result.ok({ assignment, writes: [] });
        // `decide` admits only a stored caller holding `Roles.ASSIGN`.
        const actor = Actor.forCaller(callerUserId, caller?.roles ?? []);
        return Result.ok({
          assignment,
          writes: [
            WriteOp.update(targetPath, {
              roles: assignment.rolesTo,
              profileEditedAtUtcMs: nowUtcMs,
            }),
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
    const { rolesTo, rolesChanged } = committed.value.assignment;
    if (rolesChanged) {
      ports.log('info', LogEvent.RolesChanged, {
        targetUserId: cmd.targetUserId,
        rolesCount: rolesTo.length,
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
    });
    return Result.ok({
      targetUserId: cmd.targetUserId,
      roles: rolesTo,
      rolesChanged,
    });
  };
