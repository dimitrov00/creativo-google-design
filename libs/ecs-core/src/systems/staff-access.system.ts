import {
  AccountLifecycle,
  Role,
  Roles,
  StaffLink,
  StaffPermissions,
  StaffReach,
  type StaffTarget,
} from '@core/components';
import {
  AccessScope,
  type BarberId,
  Result,
  type StaffCapability,
  type UtcEpochMs,
} from '@core/primitives';
import { AccessError } from '@core/errors';
import type { User } from '@core/entities';

/**
 * How far one capability reaches for one caller: the scope, and the barber
 * record that is their own (`null`: not linked). What a call that does not
 * name a target — the analytics pair — decides on.
 */
export type StaffAccess = {
  readonly accessScope: AccessScope;
  readonly linkedBarberId: BarberId | null;
};

/** The wider of two scopes: nobody < own < everyone. */
function wider(a: AccessScope, b: AccessScope): AccessScope {
  if (a === AccessScope.All || b === AccessScope.All) return AccessScope.All;
  return a === AccessScope.Own || b === AccessScope.Own
    ? AccessScope.Own
    : AccessScope.None;
}

/**
 * StaffAccessSystem — who may do what, as the owner set it
 * (`docs/designs/staff-permissions.md`, P3, P4, P6). Pure: a converted
 * callable reads the caller's STORED account and `settings/staffPermissions`
 * inside its own read step and asks. The token is never read here — it
 * cannot know the cells — so a cell change and a role change both apply to
 * the next call.
 *
 * The caller's block is an elapsed-time rule on the account
 * (`AccountLifecycle.isBlockedAt`): `nowUtcMs`, never the shop clock.
 */
export const StaffAccessSystem = {
  /**
   * How far `staffCapability` reaches for an account that holds `roles`:
   * the WIDEST scope any of its levels grants.
   *
   * - `admin` is everyone, always — answered before a cell is read, so no
   *   document, hand-edited or not, can lock the owner out (P4);
   * - `sysadmin` is the fixed column of `StaffPermissions.SYSADMIN`;
   * - each editable level is its cell, or the default it follows;
   * - `client` and any string that is no role grant nothing. `roles` is
   *   read as the claims are: unknown entries are ignored.
   */
  scopeOf(
    permissions: StaffPermissions,
    staffCapability: StaffCapability,
    roles: readonly string[],
  ): AccessScope {
    let scope: AccessScope = AccessScope.None;
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i];
      if (role === Role.Admin) return AccessScope.All;
      if (role === Role.Sysadmin) {
        scope = wider(scope, StaffPermissions.SYSADMIN[staffCapability]);
      } else if (StaffPermissions.isLevel(role)) {
        scope = wider(
          scope,
          StaffPermissions.scopeOf(permissions, role, staffCapability),
        );
      }
    }
    return scope;
  },

  /**
   * The stored account, when it is a staff member's as of `nowUtcMs` —
   * else `ACCESS_NOT_STAFF`: no account document, a blocked or erased
   * account, or a role set that holds no staff role. The fixed staff tier
   * (`activateBarber`) asks only this.
   */
  staffOf(
    caller: User | null,
    nowUtcMs: UtcEpochMs,
  ): Result<User, AccessError> {
    return caller !== null &&
      Roles.isStaff(caller.roles) &&
      !AccountLifecycle.isBlockedAt(caller, nowUtcMs)
      ? Result.ok(caller)
      : Result.err(AccessError.notStaff());
  },

  /**
   * A staff member's reach for one capability: its scope over the STORED
   * roles and the record the account is linked to (`StaffLink.of`: an
   * absent or malformed link is none).
   */
  accessOf(
    permissions: StaffPermissions,
    staffCapability: StaffCapability,
    staff: User,
  ): StaffAccess {
    return {
      accessScope: StaffAccessSystem.scopeOf(
        permissions,
        staffCapability,
        staff.roles,
      ),
      linkedBarberId: StaffLink.of(staff).linkedBarberId,
    };
  },

  /**
   * THE DECISION (P6) — the stored account, when it may make an act of
   * `staffCapability` on `staffTarget`:
   *
   * | Case                                                    | Answer             |
   * | ------------------------------------------------------- | ------------------ |
   * | missing, blocked or erased account, or no staff role    | `ACCESS_NOT_STAFF` |
   * | the scope is nobody                                     | `ACCESS_DENIED`    |
   * | the scope is everyone                                   | the account        |
   * | own, a shop target                                      | `ACCESS_OWN_ONLY`  |
   * | own, no linked record                                   | `ACCESS_OWN_ONLY`  |
   * | own, a barbers target naming another record, or none    | `ACCESS_OWN_ONLY`  |
   * | own, a barbers target naming only the caller's record   | the account        |
   *
   * It answers the account because the pipelines credit the audit row to
   * it. The record checks — an unknown barber, one who has left, a shop
   * they do not work at — are not asked here: they run after.
   */
  admit(input: {
    readonly staffCapability: StaffCapability;
    readonly staffTarget: StaffTarget;
    readonly caller: User | null;
    readonly permissions: StaffPermissions;
    readonly nowUtcMs: UtcEpochMs;
  }): Result<User, AccessError> {
    const staff = StaffAccessSystem.staffOf(input.caller, input.nowUtcMs);
    if (!staff.ok) return staff;
    const { staffCapability, staffTarget } = input;
    const access = StaffAccessSystem.accessOf(
      input.permissions,
      staffCapability,
      staff.value,
    );
    if (access.accessScope === AccessScope.None) {
      return Result.err(AccessError.denied(staffCapability));
    }
    if (access.accessScope === AccessScope.All) return staff;
    const own = access.linkedBarberId;
    if (staffTarget.staffReach === StaffReach.Shop || own === null) {
      return Result.err(AccessError.ownOnly(staffCapability));
    }
    const named = staffTarget.targetBarberIds;
    if (named.length === 0) {
      return Result.err(AccessError.ownOnly(staffCapability));
    }
    for (let i = 0; i < named.length; i++) {
      if (named[i] !== own) {
        return Result.err(AccessError.ownOnly(staffCapability));
      }
    }
    return staff;
  },
} as const;
