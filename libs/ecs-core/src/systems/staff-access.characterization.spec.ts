import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Role, Roles, StaffPermissions, StaffTarget } from '@core/components';
import { BarberId, StaffCapability } from '@core/primitives';
import { AnalyticsErrorCode } from '@core/errors';
import { FIXTURE_IDS, FIXTURE_NOW_UTC_MS, userFixture } from '@core/testing';
import { StaffAccessSystem } from './staff-access.system';
import { StaffAnalyticsSystem } from './staff-analytics.system';

/*
 * THE CHARACTERIZATION TABLE (staff permissions stage A, exit test 1) —
 * what the fixed role lists answered BEFORE the owner's cells existed,
 * frozen, and the proof that the defaults answer the same: nothing changes
 * for anybody on the day stage A ships (O1).
 *
 * How it was taken. Before any caller check was touched (main at
 * 18f04b47), a throwaway spec ran the systems that then judged the caller —
 * `RosterAccessSystem.admit` / `admitDays`, `TeamSystem.admit` /
 * `admitProfileEdit` / `admitActivation` and
 * `StaffAnalyticsSystem.callerOf` + `scopeOf` + `locationScopeOf` — over
 * every one of the 64 role sets, and wrote each answer to
 * `staff-access.characterization.json`. Those functions are gone; the file
 * is what they said, and it is never regenerated from the code under test.
 *
 * A row is a role set and the account's barber link: `NONE`, `OWN` (the
 * record the act names) or `OTHER` (a colleague's). The link rows exist
 * only for sets that hold `barber`: `setRoles` clears the link of an
 * account that stops being a barber, so a link without the role is a state
 * no call can write (`RoleAssignmentSystem.linkOf`).
 *
 * The nine columns, in order:
 *
 * 1. hours of the record              A admitted · R refused
 * 2. a day off of the record          A · R
 * 3. managing the team, and prices    A · R
 * 4. the record's profile             A · R
 * 5. the go-live step                 A · R
 * 6. analytics, no barber named       S the shop · O1 one record · L not linked · R
 * 7. analytics, the record named      O1 · L · R
 * 8. analytics, record + colleague    O2 · L · R
 * 9. analytics, a location named      A · R
 */
const BEFORE = JSON.parse(
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the frozen table beside this spec.
  readFileSync(
    resolve(__dirname, './staff-access.characterization.json'),
    'utf8',
  ),
) as Readonly<Record<string, string>>;

const NOW = FIXTURE_NOW_UTC_MS;
const TARGET = FIXTURE_IDS.barber;
const OTHER = BarberId.of('niko');
const SHOP = FIXTURE_IDS.location;
const DEFAULTS = StaffPermissions.UNSET;

const LINKS: Readonly<Record<string, BarberId | null>> = {
  NONE: null,
  OWN: TARGET,
  OTHER,
};

/** Every subset of the six roles, in the order the table was taken. */
function roleSets(): Role[][] {
  const all = Roles.ALL;
  const sets: Role[][] = [];
  for (let mask = 0; mask < 1 << all.length; mask++) {
    const set: Role[] = [];
    for (let i = 0; i < all.length; i++) {
      if (mask & (1 << i)) set.push(all[i] as Role);
    }
    sets.push(set);
  }
  return sets;
}

/** One row as the access system answers it over the defaults. */
function after(roles: readonly Role[], linkedBarberId: BarberId | null) {
  const caller = userFixture({ roles: [...roles], linkedBarberId });
  const admitted = (
    staffCapability: StaffCapability,
    staffTarget: StaffTarget,
  ): string =>
    StaffAccessSystem.admit({
      staffCapability,
      staffTarget,
      caller,
      permissions: DEFAULTS,
      nowUtcMs: NOW,
    }).ok
      ? 'A'
      : 'R';
  const record = StaffTarget.barbers([TARGET]);
  const staff = StaffAccessSystem.staffOf(caller, NOW);
  const access = staff.ok
    ? StaffAccessSystem.accessOf(
        DEFAULTS,
        StaffCapability.Analytics,
        staff.value,
      )
    : null;
  const analytics = (asked: readonly BarberId[]): string => {
    if (access === null) return 'R';
    const scope = StaffAnalyticsSystem.scopeOf(
      access,
      { scopeBarberIds: asked },
      [TARGET, OTHER],
    );
    if (!scope.ok) {
      return scope.error.errorCode === AnalyticsErrorCode.BarberNotLinked
        ? 'L'
        : 'R';
    }
    return scope.value.length === 0 ? 'S' : `O${scope.value.length}`;
  };
  const location =
    access !== null &&
    StaffAnalyticsSystem.locationScopeOf(access, { scopeLocationIds: [SHOP] }, [
      { id: SHOP } as never,
    ]).ok
      ? 'A'
      : 'R';
  const team = admitted(StaffCapability.TeamManage, StaffTarget.SHOP);
  return {
    cells: [
      admitted(StaffCapability.Hours, record),
      admitted(StaffCapability.TimeOff, record),
      team,
      admitted(StaffCapability.TeamProfiles, record),
      staff.ok ? 'A' : 'R',
      analytics([]),
      analytics([TARGET]),
      analytics([TARGET, OTHER]),
      location,
    ].join(' '),
    // Prices were the team manager's: one check answered for both.
    offerings: admitted(StaffCapability.TeamOfferings, record),
    team,
  };
}

describe('StaffAccessSystem over the defaults — the same answers as the fixed role lists gave', () => {
  it('holds every reachable role set and link: 64 sets, and both links for the 32 that hold barber', () => {
    expect(Object.keys(BEFORE)).toHaveLength(64 + 32 * 2);
    const answered: Record<string, string> = {};
    for (const roles of roleSets()) {
      const links = roles.includes(Role.Barber)
        ? ['NONE', 'OWN', 'OTHER']
        : ['NONE'];
      for (const link of links) {
        const name = `${roles.join('+') || '-'}|${link}`;
        const row = after(roles, LINKS[link] ?? null);
        answered[name] = row.cells;
        expect(row.offerings, `${name}: prices`).toBe(row.team);
      }
    }
    expect(answered).toEqual(BEFORE);
  });

  it('differs, on purpose, only where no call can write the state: a link with no barber role', () => {
    // The old profile check admitted ANY account linked to the record,
    // whatever its roles; a link is now worth nothing without the barber
    // level, the only one "own" is offered on (P3).
    for (const roles of [[Role.Client], [Role.Receptionist]]) {
      expect(
        StaffAccessSystem.admit({
          staffCapability: StaffCapability.TeamProfiles,
          staffTarget: StaffTarget.barbers([TARGET]),
          caller: userFixture({ roles, linkedBarberId: TARGET }),
          permissions: DEFAULTS,
          nowUtcMs: NOW,
        }).ok,
        roles.join('+'),
      ).toBe(false);
    }
  });
});
