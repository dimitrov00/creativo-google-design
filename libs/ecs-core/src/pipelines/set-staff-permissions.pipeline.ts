import {
  Actor,
  type PermissionsCall,
  type Role,
  Roles,
  WriteOp,
  WriteProvenance,
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
  type SetStaffPermissionsError,
} from '@core/errors';
import {
  Collections,
  STAFF_PERMISSIONS_DOC,
  type StaffPermissionsSettings,
} from '@core/entities';
import type { ClockPorts, CommitPorts, HashPorts, LogPorts } from '@core/ports';
import { AuditSystem, StaffPermissionsEditSystem } from '@core/systems';
import { readStaffCaller } from './team-caller.pipeline';

/**
 * `setStaffPermissions` — «Права» → «Запази»: the owner's save of what a
 * staff level may do (`docs/designs/staff-permissions.md`, P4, P6, P11).
 * The caller gate first, on the VERIFIED token (`admitPermissionsCaller`:
 * a `Roles.ASSIGN` role — the list that guards `setRoles`; editing
 * permissions is no capability and cannot be granted). Then ONE commit
 * (Law 4: the transaction is the sandwich) that reads `users/{caller}` and
 * `settings/staffPermissions` and asks:
 *
 * - `StaffPermissionsEditSystem.admit` — the STORED account is an active
 *   admin, whatever the token still claims;
 * - `StaffPermissionsEditSystem.plan` — the cells after the save, and
 *   which of them really changed; a cell that is not on offer, or one
 *   named twice, refuses the whole save.
 *
 * The document is SET whole — every cell, each one that equals its default
 * stored as `null`, stamped with the act (`writeOperationId`) — beside its
 * ONE `TEAM_PERMISSIONS_CHANGED` row, credited to the caller over their
 * stored roles and keyed by the operation id; the row lands with the
 * document or not at all, and the settings trigger plans none for a write
 * that stamped its operation. A save that changes no cell — and so the
 * replay of one that landed — writes no document and no row. The document
 * is never deleted.
 *
 * A changed cell applies to the next call of every converted callable: each
 * reads the document inside its own transaction. Nobody is signed out.
 *
 * The answer: `{ changes }` — the cells that changed, each with its scope
 * before and after.
 */

/** The call as the wire decoded it, with the verified caller. */
export type SetStaffPermissionsCommand = PermissionsCall & {
  /** The verified session's uid; `null` without one. */
  readonly adminUserId: UserId | null;
  /** The verified token's roles — the wire's gate read them. */
  readonly adminRoles: readonly Role[];
  /** The act's name (WS-4.1) — REQUIRED: it stamps the document and keys the row. */
  readonly operationId: OperationId;
};

export type SetStaffPermissionsPorts = CommitPorts &
  ClockPorts &
  HashPorts &
  LogPorts;

/** The stored body: the entity minus its id (Law 5). */
type PermissionsBody = Omit<StaffPermissionsSettings, 'id'>;

/** The transaction's decision: the answer and its plan. */
type PermissionsDecision = PermissionsCall.Saved & {
  readonly writes: readonly WriteOp[];
};

/**
 * The caller of a permissions save — a uid whose claims hold a
 * `Roles.ASSIGN` role, or the refusal
 * (`GOVERNANCE_PERMISSIONS_UNAUTHENTICATED`, `_FORBIDDEN`). The wire asks
 * it before the payload is read; the pipeline asks it again.
 */
export function admitPermissionsCaller(
  adminUserId: UserId | null,
  adminRoles: readonly Role[],
): Result<UserId, GovernanceError> {
  if (adminUserId === null) {
    return Result.err(GovernanceError.permissionsUnauthenticated());
  }
  return Roles.assignsRoles(adminRoles)
    ? Result.ok(adminUserId)
    : Result.err(GovernanceError.permissionsForbidden(adminUserId));
}

export const setStaffPermissions =
  (ports: SetStaffPermissionsPorts) =>
  async (
    cmd: SetStaffPermissionsCommand,
  ): Promise<Result<PermissionsCall.Saved, SetStaffPermissionsError>> => {
    const admitted = admitPermissionsCaller(cmd.adminUserId, cmd.adminRoles);
    if (!admitted.ok) {
      ports.log('info', LogEvent.PermissionsChangeRefused, {
        errorCode: admitted.error.errorCode,
      });
      return admitted;
    }
    const callerUserId = admitted.value;
    // Read once, before the transaction: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      (tx) => readStaffCaller(tx, callerUserId),
      ({
        caller,
        permissions,
      }): Result<PermissionsDecision, GovernanceError> => {
        const owner = StaffPermissionsEditSystem.admit(
          callerUserId,
          caller,
          nowUtcMs,
        );
        if (!owner.ok) return owner;
        const edit = StaffPermissionsEditSystem.plan(permissions, cmd.changes);
        if (!edit.ok) return edit;
        const { changes } = edit.value;
        // Nothing changed — and so the replay of a save that landed.
        if (changes.length === 0) return Result.ok({ changes, writes: [] });
        const body: PermissionsBody = {
          ...edit.value.permissions,
          ...WriteProvenance.of(cmd.operationId),
        };
        return Result.ok({
          changes,
          writes: [
            WriteOp.set([Collections.Settings, STAFF_PERMISSIONS_DOC], body),
            ...AuditSystem.createsOf(
              [
                AuditSystem.planPermissionsChanged(
                  changes,
                  Actor.forCaller(callerUserId, owner.value.roles),
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
        ports.log('info', LogEvent.PermissionsChangeRefused, {
          errorCode: committed.error.errorCode,
        });
      }
      return committed;
    }
    const { changes } = committed.value;
    if (changes.length > 0) {
      ports.log('info', LogEvent.PermissionsChanged, {
        changedCount: changes.length,
      });
    }
    return Result.ok({ changes });
  };
