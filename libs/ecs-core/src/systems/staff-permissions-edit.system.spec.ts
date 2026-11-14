import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  BlockReason,
  type PermissionChange,
  PermissionsCall,
  Role,
  StaffPermissions,
} from '@core/components';
import { AccessScope, StaffCapability, UserId } from '@core/primitives';
import { GovernanceErrorCode } from '@core/errors';
import {
  deepFreeze,
  FIXTURE_NOW_UTC_MS,
  unwrapErr,
  unwrapOk,
  userFixture,
} from '@core/testing';
import { StaffPermissionsEditSystem } from './staff-permissions-edit.system';

/*
 * `StaffPermissionsEditSystem` (staff permissions P4, P6): who may save
 * what a level may do, and what a save comes to.
 */

const NOW = FIXTURE_NOW_UTC_MS;
const OWNER = UserId.of('u-owner');
const { None, Own, All } = AccessScope;
const { Hours, TimeOff, TeamManage, TeamOfferings } = StaffCapability;
const UNSET = StaffPermissions.UNSET;

const change = (
  role: Role,
  staffCapability: StaffCapability,
  accessScope: AccessScope,
): PermissionChange => ({ staffCapability, role, accessScope });

const INVALID_CHANGES = {
  errorCode: GovernanceErrorCode.PermissionsInvalid,
  field: 'changes',
};

describe('StaffPermissionsEditSystem.admit — who may edit permissions', () => {
  it('admits a stored, active admin — alone or beside another role', () => {
    for (const roles of [[Role.Admin], [Role.Barber, Role.Admin]]) {
      const caller = userFixture({ id: OWNER, roles });
      expect(
        unwrapOk(StaffPermissionsEditSystem.admit(OWNER, caller, NOW)),
      ).toBe(caller);
    }
  });

  it('refuses everyone else — the sysadmin included, and an admin who is blocked or gone', () => {
    const refused = [
      null,
      userFixture({ roles: [Role.Sysadmin] }),
      userFixture({ roles: [Role.Receptionist] }),
      userFixture({ roles: [Role.Barber, Role.ContentManager] }),
      userFixture({ roles: [Role.Client] }),
      userFixture({
        roles: [Role.Admin],
        ...AccountLifecycle.block(BlockReason.Manual, null),
      }),
      userFixture({ roles: [Role.Admin], ...AccountLifecycle.erase(NOW) }),
    ];
    for (const caller of refused) {
      expect(
        unwrapErr(StaffPermissionsEditSystem.admit(OWNER, caller, NOW)),
      ).toEqual({
        errorCode: GovernanceErrorCode.PermissionsForbidden,
        callerUserId: OWNER,
      });
    }
  });
});

describe('StaffPermissionsEditSystem.plan — what a save comes to', () => {
  it('answers the changed cells with both sides, and the whole next cells', () => {
    const edit = unwrapOk(
      StaffPermissionsEditSystem.plan(UNSET, [
        change(Role.Receptionist, Hours, None),
        change(Role.Barber, TimeOff, All),
      ]),
    );
    expect(edit.changes).toEqual([
      {
        staffCapability: Hours,
        role: Role.Receptionist,
        accessScopeFrom: All,
        accessScopeTo: None,
      },
      {
        staffCapability: TimeOff,
        role: Role.Barber,
        accessScopeFrom: Own,
        accessScopeTo: All,
      },
    ]);
    expect(edit.permissions).toEqual({
      ...UNSET,
      receptionistHoursScope: None,
      barberTimeOffScope: All,
    });
    // The whole body: every cell is there.
    expect(Object.keys(edit.permissions).sort()).toEqual(
      Object.keys(UNSET).sort(),
    );
  });

  it('changes nothing when every cell already grants what was asked — the stored cells, no change', () => {
    const stored = StaffPermissions.read({ receptionistHoursScope: None });
    const edit = unwrapOk(
      StaffPermissionsEditSystem.plan(stored, [
        // Already nobody.
        change(Role.Receptionist, Hours, None),
        // The default, asked for by name.
        change(Role.Barber, Hours, Own),
      ]),
    );
    expect(edit.changes).toEqual([]);
    expect(edit.permissions).toBe(stored);
    // An empty save is the same.
    const empty = unwrapOk(StaffPermissionsEditSystem.plan(stored, []));
    expect(empty).toEqual({ permissions: stored, changes: [] });
  });

  it('stores a cell put back to its default as null — and reports the change', () => {
    const stored = StaffPermissions.read({ receptionistHoursScope: None });
    const edit = unwrapOk(
      StaffPermissionsEditSystem.plan(stored, [
        change(Role.Receptionist, Hours, All),
      ]),
    );
    expect(edit.changes).toEqual([
      {
        staffCapability: Hours,
        role: Role.Receptionist,
        accessScopeFrom: None,
        accessScopeTo: All,
      },
    ]);
    expect(edit.permissions).toEqual(UNSET);
  });

  it('repairs a hand-written bad cell: it read as nobody, and the save writes a real scope', () => {
    const broken = StaffPermissions.read({
      receptionistHoursScope: 'EVERYONE',
      barberHoursScope: 7,
    });
    const edit = unwrapOk(
      StaffPermissionsEditSystem.plan(broken, [
        change(Role.Receptionist, Hours, All),
      ]),
    );
    expect(edit.changes).toEqual([
      {
        staffCapability: Hours,
        role: Role.Receptionist,
        accessScopeFrom: None,
        accessScopeTo: All,
      },
    ]);
    // The cell the save did not name keeps what it read as: nobody, now valid.
    expect(edit.permissions).toEqual({ ...UNSET, barberHoursScope: None });
  });

  it('refuses a level the owner does not edit', () => {
    for (const role of [Role.Admin, Role.Sysadmin, Role.Client]) {
      expect(
        unwrapErr(
          StaffPermissionsEditSystem.plan(UNSET, [change(role, Hours, None)]),
        ),
      ).toEqual({
        errorCode: GovernanceErrorCode.PermissionsNotOffered,
        staffCapability: Hours,
        role,
        accessScope: None,
      });
    }
  });

  it('refuses "own only" off the barber level, and on the team switch', () => {
    expect(
      unwrapErr(
        StaffPermissionsEditSystem.plan(UNSET, [
          change(Role.Receptionist, Hours, Own),
        ]),
      ),
    ).toEqual({
      errorCode: GovernanceErrorCode.PermissionsNotOffered,
      staffCapability: Hours,
      role: Role.Receptionist,
      accessScope: Own,
    });
    expect(
      unwrapErr(
        StaffPermissionsEditSystem.plan(UNSET, [
          change(Role.Barber, TeamManage, Own),
        ]),
      ),
    ).toEqual({
      errorCode: GovernanceErrorCode.PermissionsNotOffered,
      staffCapability: TeamManage,
      role: Role.Barber,
      accessScope: Own,
    });
    // A barber may be given their own prices (O8).
    expect(
      StaffPermissionsEditSystem.plan(UNSET, [
        change(Role.Barber, TeamOfferings, Own),
      ]).ok,
    ).toBe(true);
  });

  it('refuses a cell named twice, and a save longer than the grid', () => {
    expect(
      unwrapErr(
        StaffPermissionsEditSystem.plan(UNSET, [
          change(Role.Barber, Hours, All),
          change(Role.Barber, Hours, None),
        ]),
      ),
    ).toEqual(INVALID_CHANGES);
    // Twice the same scope is still twice.
    expect(
      unwrapErr(
        StaffPermissionsEditSystem.plan(UNSET, [
          change(Role.Barber, Hours, All),
          change(Role.Barber, Hours, All),
        ]),
      ),
    ).toEqual(INVALID_CHANGES);
    expect(PermissionsCall.CHANGES_MAX).toBe(18);
    expect(
      unwrapErr(
        StaffPermissionsEditSystem.plan(
          UNSET,
          Array.from({ length: PermissionsCall.CHANGES_MAX + 1 }, () =>
            change(Role.Barber, Hours, All),
          ),
        ),
      ),
    ).toEqual(INVALID_CHANGES);
  });

  it('takes the whole grid in one save', () => {
    const everything = StaffPermissions.LEVELS.flatMap((level) =>
      StaffPermissions.CAPABILITIES.map((capability) =>
        change(level, capability, All),
      ),
    );
    const edit = unwrapOk(StaffPermissionsEditSystem.plan(UNSET, everything));
    for (const level of StaffPermissions.LEVELS) {
      for (const capability of StaffPermissions.CAPABILITIES) {
        expect(
          StaffPermissions.scopeOf(edit.permissions, level, capability),
        ).toBe(All);
      }
    }
    // Only the cells that were not already everyone changed.
    expect(edit.changes).toHaveLength(18 - 3);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const stored = deepFreeze(
      StaffPermissions.read({ barberTimeOffScope: All }),
    );
    const requested = deepFreeze([
      change(Role.Receptionist, Hours, None),
      change(Role.Barber, TimeOff, Own),
    ]);
    expect(StaffPermissionsEditSystem.plan(stored, requested)).toEqual(
      StaffPermissionsEditSystem.plan(stored, requested),
    );
    const caller = deepFreeze(userFixture({ roles: [Role.Admin] }));
    expect(StaffPermissionsEditSystem.admit(OWNER, caller, NOW)).toEqual(
      StaffPermissionsEditSystem.admit(OWNER, caller, NOW),
    );
  });
});
