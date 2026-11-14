import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AccessScope, StaffCapability } from '@core/primitives';
import { deepFreeze } from '@core/testing';
import { Role } from './role.data';
import { StaffPermissions } from './staff-permissions.data';

/*
 * `StaffPermissions` (staff permissions P2, P5): the cells of
 * `settings/staffPermissions`, the defaults they follow, and the reading
 * guard every reader goes through (stage A, exit test 2).
 */

const { None, Own, All } = AccessScope;
const { Barber, Receptionist, ContentManager } = Role;
const LEVELS = StaffPermissions.LEVELS;
const CAPABILITIES = StaffPermissions.CAPABILITIES;

/** Every cell as [level, capability, field]. */
const CELLS = LEVELS.flatMap((level) =>
  CAPABILITIES.map(
    (capability) =>
      [level, capability, StaffPermissions.fieldOf(level, capability)] as const,
  ),
);

describe('StaffPermissions — the grid', () => {
  it('has three editable levels and stage A’s six capabilities: eighteen cells', () => {
    expect(LEVELS).toEqual([Barber, Receptionist, ContentManager]);
    expect(CAPABILITIES).toEqual([
      'TIME_OFF',
      'HOURS',
      'ANALYTICS',
      'TEAM_PROFILES',
      'TEAM_OFFERINGS',
      'TEAM_MANAGE',
    ]);
    expect(CELLS).toHaveLength(18);
  });

  it('names each cell <level><Capability>Scope, once — the struct’s keys are exactly the table’s', () => {
    const fields = CELLS.map(([, , field]) => field);
    expect(new Set(fields).size).toBe(fields.length);
    expect([...fields].sort()).toEqual(
      Object.keys(StaffPermissions.UNSET).sort(),
    );
    expect(StaffPermissions.fieldOf(Barber, StaffCapability.Hours)).toBe(
      'barberHoursScope',
    );
    expect(
      StaffPermissions.fieldOf(Receptionist, StaffCapability.TimeOff),
    ).toBe('receptionistTimeOffScope');
    expect(
      StaffPermissions.fieldOf(ContentManager, StaffCapability.TeamManage),
    ).toBe('contentManagerTeamManageScope');
    for (const [level, capability, field] of CELLS) {
      const camel = capability
        .toLowerCase()
        .replace(/(^|_)([a-z])/g, (_m, _sep, letter: string) =>
          letter.toUpperCase(),
        );
      const prefix = level === ContentManager ? 'contentManager' : level;
      expect(field, `${level} ${capability}`).toBe(`${prefix}${camel}Scope`);
    }
  });

  it('assembles a struct whose every cell sits in the field its table names', () => {
    // Each cell reads back the one value written to it and nothing else's.
    for (const [level, capability, field] of CELLS) {
      const read = StaffPermissions.read({ [field]: None });
      for (const [otherLevel, otherCapability, otherField] of CELLS) {
        const expected =
          otherField === field
            ? None
            : StaffPermissions.DEFAULT[otherLevel][otherCapability];
        expect(
          StaffPermissions.scopeOf(read, otherLevel, otherCapability),
          `${level} ${capability} → ${otherField}`,
        ).toBe(expected);
      }
    }
  });

  it('isLevel: the three editable levels, never admin, sysadmin, client or anything else', () => {
    for (const level of LEVELS)
      expect(StaffPermissions.isLevel(level)).toBe(true);
    for (const other of [
      Role.Admin,
      Role.Sysadmin,
      Role.Client,
      'BARBER',
      '',
      null,
      undefined,
      7,
      [Barber],
    ]) {
      expect(StaffPermissions.isLevel(other), String(other)).toBe(false);
    }
  });
});

describe('StaffPermissions.DEFAULT — today’s behaviour, per level (P2, O1)', () => {
  it('is the table of the design', () => {
    expect(StaffPermissions.DEFAULT).toEqual({
      barber: {
        TIME_OFF: Own,
        HOURS: Own,
        ANALYTICS: Own,
        TEAM_PROFILES: Own,
        TEAM_OFFERINGS: None,
        TEAM_MANAGE: None,
      },
      receptionist: {
        TIME_OFF: All,
        HOURS: All,
        ANALYTICS: None,
        TEAM_PROFILES: None,
        TEAM_OFFERINGS: None,
        TEAM_MANAGE: None,
      },
      content_manager: {
        TIME_OFF: None,
        HOURS: None,
        ANALYTICS: None,
        TEAM_PROFILES: All,
        TEAM_OFFERINGS: None,
        TEAM_MANAGE: None,
      },
    });
  });

  it('holds only scopes its cell offers — "own" on the barber level alone', () => {
    for (const [level, capability] of CELLS) {
      expect(
        StaffPermissions.offers(
          level,
          capability,
          StaffPermissions.DEFAULT[level][capability],
        ),
        `${level} ${capability}`,
      ).toBe(true);
    }
  });

  it('is what an unset struct and no document read as', () => {
    for (const raw of [null, undefined, {}, [], 'nothing', 7]) {
      expect(StaffPermissions.read(raw)).toEqual(StaffPermissions.UNSET);
    }
    for (const [level, capability] of CELLS) {
      expect(
        StaffPermissions.scopeOf(StaffPermissions.UNSET, level, capability),
      ).toBe(StaffPermissions.DEFAULT[level][capability]);
    }
  });
});

describe('StaffPermissions.offers — which scopes a cell can hold', () => {
  it('offers nobody and everyone on every cell', () => {
    for (const [level, capability] of CELLS) {
      expect(StaffPermissions.offers(level, capability, None)).toBe(true);
      expect(StaffPermissions.offers(level, capability, All)).toBe(true);
    }
  });

  it('offers "own" on the barber level only, and never on the team switch', () => {
    for (const [level, capability] of CELLS) {
      expect(
        StaffPermissions.offers(level, capability, Own),
        `${level} ${capability}`,
      ).toBe(level === Barber && capability !== StaffCapability.TeamManage);
    }
  });
});

describe('StaffPermissions.read — the reading guard (P5, O11)', () => {
  it('reads an absent field and null as "follows the default"', () => {
    const read = StaffPermissions.read({ barberHoursScope: null });
    expect(read.barberHoursScope).toBeNull();
    expect(read.receptionistHoursScope).toBeNull();
    expect(read).toEqual(StaffPermissions.UNSET);
  });

  it('reads a scope the cell offers as that scope', () => {
    const read = StaffPermissions.read({
      barberHoursScope: All,
      barberTimeOffScope: Own,
      receptionistHoursScope: None,
      contentManagerTeamManageScope: All,
    });
    expect(read.barberHoursScope).toBe(All);
    expect(read.barberTimeOffScope).toBe(Own);
    expect(read.receptionistHoursScope).toBe(None);
    expect(read.contentManagerTeamManageScope).toBe(All);
  });

  it('reads anything else as NOBODY — never as the default', () => {
    const junk: unknown[] = [
      'EVERYONE',
      'all',
      '',
      0,
      7,
      true,
      false,
      [All],
      { accessScope: All },
    ];
    for (const value of junk) {
      // Front desk hours default to everyone: a bad value must not fall back to it.
      expect(
        StaffPermissions.read({ receptionistHoursScope: value })
          .receptionistHoursScope,
        JSON.stringify(value),
      ).toBe(None);
    }
    // "Own" where it is not offered: off the barber level, and on the switch.
    expect(
      StaffPermissions.read({ receptionistHoursScope: Own })
        .receptionistHoursScope,
    ).toBe(None);
    expect(
      StaffPermissions.read({ contentManagerTeamProfilesScope: Own })
        .contentManagerTeamProfilesScope,
    ).toBe(None);
    expect(
      StaffPermissions.read({ barberTeamManageScope: Own })
        .barberTeamManageScope,
    ).toBe(None);
  });

  it('ignores every key that is no cell — the stamp, a level with no cells, a later capability', () => {
    const read = StaffPermissions.read({
      writeOperationId: 'op-1',
      adminHoursScope: None,
      sysadminHoursScope: All,
      barberBookingManageScope: None,
      id: 'staffPermissions',
    });
    expect(read).toEqual(StaffPermissions.UNSET);
    expect(Object.keys(read).sort()).toEqual(
      Object.keys(StaffPermissions.UNSET).sort(),
    );
  });

  it('never throws on arbitrary JSON, and always answers the whole struct of readable cells', () => {
    const scopes: (AccessScope | null)[] = [None, Own, All, null];
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        const read = StaffPermissions.read(raw);
        expect(Object.keys(read).sort()).toEqual(
          Object.keys(StaffPermissions.UNSET).sort(),
        );
        for (const [level, capability, field] of CELLS) {
          const cell = read[field];
          expect(scopes).toContain(cell);
          if (cell !== null) {
            expect(StaffPermissions.offers(level, capability, cell)).toBe(true);
          }
        }
      }),
    );
    // …and over objects that DO hold cell names, with any value in them.
    const fields = CELLS.map(([, , field]) => field);
    fc.assert(
      fc.property(
        fc.dictionary(fc.constantFrom(...fields), fc.anything()),
        (raw) => {
          const read = StaffPermissions.read(raw);
          for (const [level, capability, field] of CELLS) {
            const stored: unknown = Object.hasOwn(raw, field)
              ? raw[field]
              : undefined;
            const expected =
              stored === undefined || stored === null
                ? null
                : (stored === None || stored === Own || stored === All) &&
                    StaffPermissions.offers(level, capability, stored)
                  ? stored
                  : None;
            expect(read[field]).toBe(expected);
          }
        },
      ),
    );
  });
});

describe('StaffPermissions.saved — the body a save writes', () => {
  it('sets the cells named and keeps every other as it was', () => {
    const stored = StaffPermissions.read({ barberTimeOffScope: All });
    const next = StaffPermissions.saved(
      stored,
      new Map([['receptionistHoursScope', None]]),
    );
    expect(next).toEqual({
      ...StaffPermissions.UNSET,
      barberTimeOffScope: All,
      receptionistHoursScope: None,
    });
  });

  it('stores null for every cell that equals its default — the document holds only departures', () => {
    // Back to the default: stored as null, not as the scope.
    const stored = StaffPermissions.read({ receptionistHoursScope: None });
    expect(
      StaffPermissions.saved(
        stored,
        new Map([['receptionistHoursScope', All]]),
      ),
    ).toEqual(StaffPermissions.UNSET);
    // A hand-written redundant value (the default, spelled out) is cleaned too.
    const redundant = StaffPermissions.read({
      barberHoursScope: Own,
      barberTimeOffScope: All,
    });
    expect(StaffPermissions.saved(redundant, new Map())).toEqual({
      ...StaffPermissions.UNSET,
      barberTimeOffScope: All,
    });
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const stored = deepFreeze(
      StaffPermissions.read({ barberTimeOffScope: All }),
    );
    const wanted = new Map([['barberHoursScope', None]] as const);
    expect(StaffPermissions.saved(stored, wanted)).toEqual(
      StaffPermissions.saved(stored, wanted),
    );
    expect(
      StaffPermissions.read(deepFreeze({ barberHoursScope: All })),
    ).toEqual(StaffPermissions.read({ barberHoursScope: All }));
  });
});
