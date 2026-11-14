import {
  AccountLifecycle,
  type PermissionChange,
  PermissionsCall,
  Roles,
  StaffPermissions,
} from '@core/components';
import {
  type AccessScope,
  Result,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { GovernanceError } from '@core/errors';
import type { User } from '@core/entities';

/** What a permissions save comes to. */
export type PermissionsEdit = {
  /** The whole next cells — the body the save SETS; the stored ones when nothing changed. */
  readonly permissions: StaffPermissions;
  /** The cells whose scope really changed, in the request's order — none: the save writes nothing. */
  readonly changes: readonly PermissionsCall.CellChange[];
};

/**
 * StaffPermissionsEditSystem — the owner's save of what a staff level may
 * do (`docs/designs/staff-permissions.md`, P4, P6). Pure: the
 * `setStaffPermissions` pipeline reads the caller's account and the stored
 * cells inside its commit and asks.
 */
export const StaffPermissionsEditSystem = {
  /**
   * Who may edit permissions: a caller whose STORED roles hold a
   * `Roles.ASSIGN` role — the shop's admin, the list that guards
   * `setRoles` — and who is not blocked (or erased) at `nowUtcMs`, else
   * `GOVERNANCE_PERMISSIONS_FORBIDDEN`. It is no capability and cannot be
   * granted (P4): no level can raise itself.
   */
  admit(
    callerUserId: UserId,
    caller: User | null,
    nowUtcMs: UtcEpochMs,
  ): Result<User, GovernanceError> {
    return caller !== null &&
      Roles.assignsRoles(caller.roles) &&
      !AccountLifecycle.isBlockedAt(caller, nowUtcMs)
      ? Result.ok(caller)
      : Result.err(GovernanceError.permissionsForbidden(callerUserId));
  },

  /**
   * The save over the stored cells, or its refusal — the first in the
   * request's order:
   *
   * - more entries than the grid has cells, or a cell named twice →
   *   `GOVERNANCE_PERMISSIONS_INVALID` (`changes`);
   * - a level the owner does not edit (`admin`, `sysadmin`, `client`), or
   *   "own only" where the cell does not offer it →
   *   `GOVERNANCE_PERMISSIONS_NOT_OFFERED`.
   *
   * A change is a cell whose EFFECTIVE scope moves — the default resolved
   * on both sides — so asking for what a cell already grants changes
   * nothing, and a save that changes no cell answers the stored cells and
   * no change: it writes nothing, which also makes a replay harmless.
   * Otherwise the next cells are the whole body, each cell that equals its
   * default stored as `null`.
   */
  plan(
    stored: StaffPermissions,
    requested: readonly PermissionChange[],
  ): Result<PermissionsEdit, GovernanceError> {
    if (requested.length > PermissionsCall.CHANGES_MAX) {
      return Result.err(GovernanceError.permissionsInvalid('changes'));
    }
    const wanted = new Map<keyof StaffPermissions, AccessScope>();
    const changes: PermissionsCall.CellChange[] = [];
    for (let i = 0; i < requested.length; i++) {
      const { staffCapability, role, accessScope } = requested[
        i
      ] as PermissionChange;
      if (
        !StaffPermissions.isLevel(role) ||
        !StaffPermissions.offers(role, staffCapability, accessScope)
      ) {
        return Result.err(
          GovernanceError.permissionsNotOffered(
            staffCapability,
            role,
            accessScope,
          ),
        );
      }
      const field = StaffPermissions.fieldOf(role, staffCapability);
      if (wanted.has(field)) {
        return Result.err(GovernanceError.permissionsInvalid('changes'));
      }
      wanted.set(field, accessScope);
      const accessScopeFrom = StaffPermissions.scopeOf(
        stored,
        role,
        staffCapability,
      );
      if (accessScopeFrom !== accessScope) {
        changes.push({
          staffCapability,
          role,
          accessScopeFrom,
          accessScopeTo: accessScope,
        });
      }
    }
    return Result.ok(
      changes.length === 0
        ? { permissions: stored, changes }
        : { permissions: StaffPermissions.saved(stored, wanted), changes },
    );
  },
} as const;
