import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  BlockReason,
  Role,
  StaffPermissions,
  StaffTarget,
} from '@core/components';
import {
  AccessScope,
  BarberId,
  StaffCapability,
  UtcEpochMs,
} from '@core/primitives';
import { AccessErrorCode } from '@core/errors';
import type { User } from '@core/entities';
import {
  deepFreeze,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  unwrapErr,
  unwrapOk,
  userFixture,
} from '@core/testing';
import { StaffAccessSystem } from './staff-access.system';

/*
 * `StaffAccessSystem` (staff permissions P3, P4, P6): how far a capability
 * reaches for a role set, who is a staff member as of an instant, and the
 * decision a converted callable asks. That the DEFAULTS answer what the
 * fixed role lists answered is `staff-access.characterization.spec.ts`;
 * here are the rules themselves, and what the owner's cells change.
 */

const NOW = FIXTURE_NOW_UTC_MS;
const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('niko');
const DEFAULTS = StaffPermissions.UNSET;
const { None, Own, All } = AccessScope;
const { Hours, TimeOff, Analytics, TeamProfiles, TeamOfferings, TeamManage } =
  StaffCapability;

/** The cells a stored body reads as — what a converted callable hands the system. */
const cells = (stored: Record<string, unknown>): StaffPermissions =>
  StaffPermissions.read(stored);

const barber = (linkedBarberId: BarberId | null = IVAN): User =>
  userFixture({ roles: [Role.Barber], linkedBarberId });
const desk = userFixture({ roles: [Role.Receptionist] });
const editor = userFixture({ roles: [Role.ContentManager] });
const admin = userFixture({ roles: [Role.Admin] });

const NOT_STAFF = { errorCode: AccessErrorCode.NotStaff };
const denied = (staffCapability: StaffCapability) => ({
  errorCode: AccessErrorCode.Denied,
  staffCapability,
});
const ownOnly = (staffCapability: StaffCapability) => ({
  errorCode: AccessErrorCode.OwnOnly,
  staffCapability,
});

const admit = (
  caller: User | null,
  staffCapability: StaffCapability,
  staffTarget: StaffTarget,
  permissions: StaffPermissions = DEFAULTS,
) =>
  StaffAccessSystem.admit({
    staffCapability,
    staffTarget,
    caller,
    permissions,
    nowUtcMs: NOW,
  });

describe('StaffAccessSystem.scopeOf — how far a capability reaches for a role set', () => {
  it('answers each level its default when the owner changed nothing', () => {
    expect(StaffAccessSystem.scopeOf(DEFAULTS, Hours, [Role.Barber])).toBe(Own);
    expect(
      StaffAccessSystem.scopeOf(DEFAULTS, Hours, [Role.Receptionist]),
    ).toBe(All);
    expect(
      StaffAccessSystem.scopeOf(DEFAULTS, Hours, [Role.ContentManager]),
    ).toBe(None);
    expect(
      StaffAccessSystem.scopeOf(DEFAULTS, TeamProfiles, [Role.ContentManager]),
    ).toBe(All);
  });

  it('gives the WIDEST scope any held level grants', () => {
    // A barber who also works the front desk edits everyone's hours.
    expect(
      StaffAccessSystem.scopeOf(DEFAULTS, Hours, [
        Role.Barber,
        Role.Receptionist,
      ]),
    ).toBe(All);
    // Own beats nobody.
    expect(
      StaffAccessSystem.scopeOf(DEFAULTS, Analytics, [
        Role.Receptionist,
        Role.Barber,
      ]),
    ).toBe(Own);
    // Order never matters.
    expect(
      StaffAccessSystem.scopeOf(DEFAULTS, Hours, [
        Role.Receptionist,
        Role.Barber,
      ]),
    ).toBe(All);
  });

  it('reads the owner’s cell in place of the default — narrowed and widened', () => {
    const changed = cells({
      receptionistHoursScope: None,
      barberTimeOffScope: All,
      contentManagerTeamManageScope: All,
    });
    expect(StaffAccessSystem.scopeOf(changed, Hours, [Role.Receptionist])).toBe(
      None,
    );
    expect(StaffAccessSystem.scopeOf(changed, TimeOff, [Role.Barber])).toBe(
      All,
    );
    expect(
      StaffAccessSystem.scopeOf(changed, TeamManage, [Role.ContentManager]),
    ).toBe(All);
    // A cell the owner did not touch still follows its default.
    expect(StaffAccessSystem.scopeOf(changed, Hours, [Role.Barber])).toBe(Own);
  });

  it('never locks the owner out: admin is everyone before a cell is read (P4)', () => {
    // A body nobody could have saved: every cell nobody, and junk beside it.
    const hostile: Record<string, unknown> = { adminHoursScope: None };
    for (const level of StaffPermissions.LEVELS) {
      for (const capability of StaffPermissions.CAPABILITIES) {
        hostile[StaffPermissions.fieldOf(level, capability)] = None;
      }
    }
    for (const capability of StaffPermissions.CAPABILITIES) {
      expect(
        StaffAccessSystem.scopeOf(cells(hostile), capability, [Role.Admin]),
        capability,
      ).toBe(All);
      // Beside any other role too.
      expect(
        StaffAccessSystem.scopeOf(cells(hostile), capability, [
          Role.Barber,
          Role.Admin,
        ]),
        capability,
      ).toBe(All);
    }
  });

  it('keeps the vendor’s sysadmin on its fixed column, whatever the cells say', () => {
    const everything: Record<string, unknown> = {};
    for (const level of StaffPermissions.LEVELS) {
      for (const capability of StaffPermissions.CAPABILITIES) {
        everything[StaffPermissions.fieldOf(level, capability)] = All;
      }
    }
    for (const capability of StaffPermissions.CAPABILITIES) {
      expect(
        StaffAccessSystem.scopeOf(cells(everything), capability, [
          Role.Sysadmin,
        ]),
        capability,
      ).toBe(StaffPermissions.SYSADMIN[capability]);
    }
    expect(StaffPermissions.SYSADMIN).toEqual({
      TIME_OFF: All,
      HOURS: All,
      ANALYTICS: None,
      TEAM_PROFILES: None,
      TEAM_OFFERINGS: None,
      TEAM_MANAGE: None,
    });
  });

  it('grants nothing to a client, an empty set or a string that is no role', () => {
    for (const roles of [[], [Role.Client], ['owner', 'ADMIN', 'Barber']]) {
      for (const capability of StaffPermissions.CAPABILITIES) {
        expect(
          StaffAccessSystem.scopeOf(DEFAULTS, capability, roles),
          `${roles.join('+')} ${capability}`,
        ).toBe(None);
      }
    }
    // An unknown entry beside a real one changes nothing.
    expect(
      StaffAccessSystem.scopeOf(DEFAULTS, Hours, ['owner', Role.Barber]),
    ).toBe(Own);
  });
});

describe('StaffAccessSystem.staffOf — a staff member as of the call', () => {
  it('answers the stored account of anyone holding a staff role', () => {
    for (const role of [
      Role.Barber,
      Role.Receptionist,
      Role.ContentManager,
      Role.Admin,
      Role.Sysadmin,
    ]) {
      const caller = userFixture({ roles: [role] });
      expect(unwrapOk(StaffAccessSystem.staffOf(caller, NOW)), role).toBe(
        caller,
      );
    }
  });

  it('refuses a missing account, a client, and a blocked or erased one', () => {
    const refused: (User | null)[] = [
      null,
      userFixture({ roles: [Role.Client] }),
      userFixture({ roles: [] }),
      userFixture({
        roles: [Role.Admin],
        ...AccountLifecycle.block(BlockReason.Manual, null),
      }),
      userFixture({
        roles: [Role.Barber],
        ...AccountLifecycle.erase(NOW),
      }),
    ];
    for (const caller of refused) {
      expect(unwrapErr(StaffAccessSystem.staffOf(caller, NOW))).toEqual(
        NOT_STAFF,
      );
    }
  });

  it('reads a temporary block as elapsed time: denied until its expiry, admitted from it', () => {
    const until = UtcEpochMs.plusMs(NOW, 10 * 60_000);
    const blocked = userFixture({
      roles: [Role.Receptionist],
      ...AccountLifecycle.block(BlockReason.Manual, until),
    });
    expect(unwrapErr(StaffAccessSystem.staffOf(blocked, NOW))).toEqual(
      NOT_STAFF,
    );
    expect(StaffAccessSystem.staffOf(blocked, until).ok).toBe(true);
  });
});

describe('StaffAccessSystem.accessOf — the scope and the record that is one’s own', () => {
  it('reads the link off the stored account, an absent or malformed one as none', () => {
    expect(StaffAccessSystem.accessOf(DEFAULTS, Analytics, barber())).toEqual({
      accessScope: Own,
      linkedBarberId: IVAN,
    });
    expect(
      StaffAccessSystem.accessOf(DEFAULTS, Analytics, barber(null)),
    ).toEqual({ accessScope: Own, linkedBarberId: null });
    // A document written before the link existed has no such field.
    const unlinked = Object.fromEntries(
      Object.entries(barber()).filter(([field]) => field !== 'linkedBarberId'),
    ) as User;
    expect(StaffAccessSystem.accessOf(DEFAULTS, Analytics, unlinked)).toEqual({
      accessScope: Own,
      linkedBarberId: null,
    });
    expect(StaffAccessSystem.accessOf(DEFAULTS, Analytics, admin)).toEqual({
      accessScope: All,
      linkedBarberId: null,
    });
  });
});

describe('StaffAccessSystem.admit — the decision table (P6)', () => {
  it('a missing, blocked or erased account, or one with no staff role, is ACCESS_NOT_STAFF — before the capability is asked', () => {
    const blocked = userFixture({
      roles: [Role.Admin],
      ...AccountLifecycle.block(BlockReason.Manual, null),
    });
    for (const caller of [
      null,
      userFixture({ roles: [Role.Client] }),
      blocked,
    ]) {
      expect(unwrapErr(admit(caller, Hours, StaffTarget.SHOP))).toEqual(
        NOT_STAFF,
      );
      expect(
        unwrapErr(admit(caller, Hours, StaffTarget.barbers([IVAN]))),
      ).toEqual(NOT_STAFF);
    }
  });

  it('a scope of nobody is ACCESS_DENIED, naming the capability', () => {
    expect(
      unwrapErr(admit(editor, Hours, StaffTarget.barbers([IVAN]))),
    ).toEqual(denied(Hours));
    expect(unwrapErr(admit(desk, TeamManage, StaffTarget.SHOP))).toEqual(
      denied(TeamManage),
    );
    expect(
      unwrapErr(admit(barber(), TeamOfferings, StaffTarget.barbers([IVAN]))),
    ).toEqual(denied(TeamOfferings));
  });

  it('a scope of everyone admits any target, and answers the stored account', () => {
    expect(unwrapOk(admit(desk, Hours, StaffTarget.barbers([NIKO])))).toBe(
      desk,
    );
    expect(
      unwrapOk(admit(desk, TimeOff, StaffTarget.barbers([IVAN, NIKO]))),
    ).toBe(desk);
    expect(unwrapOk(admit(admin, TeamManage, StaffTarget.SHOP))).toBe(admin);
    // Everyone needs no link, and names nobody in particular.
    expect(unwrapOk(admit(desk, TimeOff, StaffTarget.barbers([])))).toBe(desk);
  });

  it('own: only the caller’s record — every barber named, never the shop, never nobody', () => {
    const own = barber();
    expect(unwrapOk(admit(own, Hours, StaffTarget.barbers([IVAN])))).toBe(own);
    // The same record named twice is still only the caller's.
    expect(admit(own, TimeOff, StaffTarget.barbers([IVAN, IVAN])).ok).toBe(
      true,
    );

    const refused: [User, StaffTarget][] = [
      // A colleague.
      [own, StaffTarget.barbers([NIKO])],
      // The caller AND a colleague: a move onto them.
      [own, StaffTarget.barbers([IVAN, NIKO])],
      // Naming none is never "own" by default.
      [own, StaffTarget.barbers([])],
      // A shop target needs everyone.
      [own, StaffTarget.SHOP],
      // No linked record: nothing is the caller's own.
      [barber(null), StaffTarget.barbers([IVAN])],
    ];
    for (const [caller, target] of refused) {
      expect(unwrapErr(admit(caller, Hours, target))).toEqual(ownOnly(Hours));
    }
  });

  it('follows the owner’s cells: a narrowed level is refused, a widened one admitted', () => {
    // The owner took hours from the front desk.
    const narrowed = cells({ receptionistHoursScope: None });
    expect(
      unwrapErr(admit(desk, Hours, StaffTarget.barbers([IVAN]), narrowed)),
    ).toEqual(denied(Hours));
    // …and from barbers, their own included.
    expect(
      unwrapErr(
        admit(
          barber(),
          Hours,
          StaffTarget.barbers([IVAN]),
          cells({ barberHoursScope: None }),
        ),
      ),
    ).toEqual(denied(Hours));

    // The owner lets barbers block time for each other.
    const widened = cells({ barberTimeOffScope: All });
    expect(
      admit(barber(), TimeOff, StaffTarget.barbers([NIKO]), widened).ok,
    ).toBe(true);
    // …lets a barber price their own work, and only their own (O8).
    const prices = cells({ barberTeamOfferingsScope: Own });
    expect(
      admit(barber(), TeamOfferings, StaffTarget.barbers([IVAN]), prices).ok,
    ).toBe(true);
    expect(
      unwrapErr(
        admit(barber(), TeamOfferings, StaffTarget.barbers([NIKO]), prices),
      ),
    ).toEqual(ownOnly(TeamOfferings));
    // …and hands the Team page to the content editor.
    expect(
      admit(
        editor,
        TeamManage,
        StaffTarget.SHOP,
        cells({ contentManagerTeamManageScope: All }),
      ).ok,
    ).toBe(true);
  });

  it('a stored value it cannot read grants nothing — and the owner is still admitted (O11)', () => {
    const broken = cells({
      receptionistHoursScope: 'EVERYONE',
      barberHoursScope: 7,
    });
    expect(
      unwrapErr(admit(desk, Hours, StaffTarget.barbers([IVAN]), broken)),
    ).toEqual(denied(Hours));
    expect(
      unwrapErr(admit(barber(), Hours, StaffTarget.barbers([IVAN]), broken)),
    ).toEqual(denied(Hours));
    expect(admit(admin, Hours, StaffTarget.barbers([IVAN]), broken).ok).toBe(
      true,
    );
  });
});

describe('StaffAccessSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const caller = deepFreeze(barber());
    const permissions = deepFreeze(cells({ barberTimeOffScope: All }));
    const target = deepFreeze(StaffTarget.barbers([IVAN, NIKO]));
    const input = deepFreeze({
      staffCapability: TimeOff,
      staffTarget: target,
      caller,
      permissions,
      nowUtcMs: NOW,
    });
    expect(StaffAccessSystem.admit(input)).toEqual(
      StaffAccessSystem.admit(input),
    );
    expect(StaffAccessSystem.scopeOf(permissions, TimeOff, caller.roles)).toBe(
      StaffAccessSystem.scopeOf(permissions, TimeOff, caller.roles),
    );
    expect(StaffAccessSystem.staffOf(caller, NOW)).toEqual(
      StaffAccessSystem.staffOf(caller, NOW),
    );
    expect(StaffAccessSystem.accessOf(permissions, Analytics, caller)).toEqual(
      StaffAccessSystem.accessOf(permissions, Analytics, caller),
    );
  });
});
