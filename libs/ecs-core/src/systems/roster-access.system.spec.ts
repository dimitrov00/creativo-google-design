import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  BarberStatus,
  BlockReason,
  Role,
  ShiftSegment,
} from '@core/components';
import {
  BarberId,
  EndMinute,
  LocationId,
  MinuteOfDay,
  Weekday,
} from '@core/primitives';
import { SchedulingErrorCode } from '@core/errors';
import {
  barberFixture,
  deepFreeze,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  unwrapErr,
  unwrapOk,
  userFixture,
} from '@core/testing';
import { RosterAccessSystem } from './roster-access.system';

const NOW = FIXTURE_NOW_UTC_MS;
const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('niko');
const CENTER = FIXTURE_IDS.location;
const MLADOST = LocationId.of('loc-mladost');

const ivan = barberFixture();
const departed = barberFixture(
  {},
  {
    barberStatus: BarberStatus.Departed,
    barberStatusChangedAtUtcMs: NOW,
    barberDepartedUserId: null,
    barberSessionsRevokedAtUtcMs: null,
    barberRehireStatus: BarberStatus.Public,
  },
);
const FORBIDDEN = { errorCode: SchedulingErrorCode.RosterForbidden };

const shift = (weekday: Weekday, locationId: LocationId): ShiftSegment => {
  const start = unwrapOk(MinuteOfDay.of(9 * 60));
  const end = unwrapOk(EndMinute.of(17 * 60));
  return ShiftSegment.of(weekday, locationId, start, end);
};

describe('RosterAccessSystem.admit — who edits a barber’s hours', () => {
  it('lets the front desk, the admin and the sysadmin edit any barber’s', () => {
    for (const role of [Role.Receptionist, Role.Admin, Role.Sysadmin]) {
      expect(
        unwrapOk(
          RosterAccessSystem.admit(
            userFixture({ roles: [role] }),
            ivan,
            IVAN,
            NOW,
          ),
        ),
        role,
      ).toBe(ivan);
    }
  });

  it('lets a barber edit their own — the record their account is linked to — and no colleague’s', () => {
    const own = userFixture({ roles: [Role.Barber], linkedBarberId: IVAN });
    expect(RosterAccessSystem.admit(own, ivan, IVAN, NOW).ok).toBe(true);
    expect(
      unwrapErr(
        RosterAccessSystem.admit(own, barberFixture({ id: NIKO }), NIKO, NOW),
      ),
    ).toEqual(FORBIDDEN);
    // A barber with no link edits nobody's.
    expect(
      unwrapErr(
        RosterAccessSystem.admit(
          userFixture({ roles: [Role.Barber] }),
          ivan,
          IVAN,
          NOW,
        ),
      ),
    ).toEqual(FORBIDDEN);
  });

  it('refuses the content editor, a client, a missing account and anyone blocked — a link alone is no grant', () => {
    const refused = [
      userFixture({ roles: [Role.ContentManager] }),
      userFixture({ roles: [Role.Client] }),
      // The link without a role that works the book opens nothing.
      userFixture({ roles: [Role.ContentManager], linkedBarberId: IVAN }),
      userFixture({ roles: [Role.Client], linkedBarberId: IVAN }),
      userFixture({
        roles: [Role.Admin],
        ...AccountLifecycle.block(BlockReason.Manual, null),
      }),
      userFixture({
        roles: [Role.Barber],
        linkedBarberId: IVAN,
        ...AccountLifecycle.block(BlockReason.Manual, null),
      }),
      null,
    ];
    for (const caller of refused) {
      expect(
        unwrapErr(RosterAccessSystem.admit(caller, ivan, IVAN, NOW)),
      ).toEqual(FORBIDDEN);
    }
  });

  it('names an id with no record as invalid input — only to an admitted caller', () => {
    const admin = userFixture({ roles: [Role.Admin] });
    expect(unwrapErr(RosterAccessSystem.admit(admin, null, NIKO, NOW))).toEqual(
      { errorCode: SchedulingErrorCode.RosterInvalidInput, field: 'barberId' },
    );
    expect(
      unwrapErr(
        RosterAccessSystem.admit(
          userFixture({ roles: [Role.Barber] }),
          null,
          NIKO,
          NOW,
        ),
      ),
    ).toEqual(FORBIDDEN);
  });

  it('never edits the hours of a barber who has left — a draft’s and a live record’s are editable', () => {
    const admin = userFixture({ roles: [Role.Admin] });
    expect(
      unwrapErr(RosterAccessSystem.admit(admin, departed, IVAN, NOW)),
    ).toEqual({
      errorCode: SchedulingErrorCode.RosterDeparted,
      barberId: IVAN,
    });
    const draft = barberFixture(
      {},
      {
        barberStatus: BarberStatus.Draft,
        barberStatusChangedAtUtcMs: NOW,
        barberDraftTargetStatus: BarberStatus.Public,
      },
    );
    expect(RosterAccessSystem.admit(admin, draft, IVAN, NOW).ok).toBe(true);
  });
});

describe('RosterAccessSystem.withinShops — hours only where the barber works', () => {
  it('takes any shop for a barber of every shop', () => {
    const everywhere = barberFixture({ locationIds: [] });
    const week = [shift(Weekday.Mon, CENTER), shift(Weekday.Tue, MLADOST)];
    expect(unwrapOk(RosterAccessSystem.withinShops(everywhere, week))).toBe(
      week,
    );
  });

  it('takes a week at the barber’s shops, and an empty week', () => {
    const both = barberFixture({ locationIds: [CENTER, MLADOST] });
    expect(
      RosterAccessSystem.withinShops(both, [
        shift(Weekday.Mon, CENTER),
        shift(Weekday.Fri, MLADOST),
      ]).ok,
    ).toBe(true);
    expect(RosterAccessSystem.withinShops(ivan, []).ok).toBe(true);
  });

  it('names the first shift at a shop the barber does not work at', () => {
    expect(
      unwrapErr(
        RosterAccessSystem.withinShops(ivan, [
          shift(Weekday.Mon, CENTER),
          shift(Weekday.Fri, MLADOST),
        ]),
      ),
    ).toEqual({
      errorCode: SchedulingErrorCode.RosterOutsideShops,
      locationId: MLADOST,
    });
  });
});

describe('RosterAccessSystem.worksAt / admitDays — an act on barbers’ days', () => {
  const desk = userFixture({ roles: [Role.Receptionist] });
  const own = userFixture({ roles: [Role.Barber], linkedBarberId: IVAN });
  const niko = barberFixture({ id: NIKO });

  it('worksAt: every shop for an empty list, else only the listed ones', () => {
    expect(
      RosterAccessSystem.worksAt(barberFixture({ locationIds: [] }), MLADOST)
        .ok,
    ).toBe(true);
    expect(unwrapOk(RosterAccessSystem.worksAt(ivan, CENTER))).toBe(ivan);
    expect(unwrapErr(RosterAccessSystem.worksAt(ivan, MLADOST))).toEqual({
      errorCode: SchedulingErrorCode.RosterOutsideShops,
      locationId: MLADOST,
    });
  });

  it('admits the front desk for every barber the act touches', () => {
    expect(
      RosterAccessSystem.admitDays(
        desk,
        [ivan, niko],
        [
          { barberId: IVAN, locationId: null },
          { barberId: NIKO, locationId: CENTER },
        ],
        NOW,
      ),
    ).toEqual({ ok: true, value: null });
  });

  it('admits a barber for their own days only — a move onto a colleague is refused', () => {
    expect(
      RosterAccessSystem.admitDays(
        own,
        [ivan],
        [{ barberId: IVAN, locationId: CENTER }],
        NOW,
      ).ok,
    ).toBe(true);
    expect(
      unwrapErr(
        RosterAccessSystem.admitDays(
          own,
          [ivan, niko],
          [
            { barberId: IVAN, locationId: null },
            { barberId: NIKO, locationId: CENTER },
          ],
          NOW,
        ),
      ),
    ).toEqual(FORBIDDEN);
  });

  it('refuses a day filed at a shop its barber does not work at; a lift names no shop and is not asked', () => {
    expect(
      unwrapErr(
        RosterAccessSystem.admitDays(
          desk,
          [ivan],
          [{ barberId: IVAN, locationId: MLADOST }],
          NOW,
        ),
      ),
    ).toEqual({
      errorCode: SchedulingErrorCode.RosterOutsideShops,
      locationId: MLADOST,
    });
    expect(
      RosterAccessSystem.admitDays(
        desk,
        [ivan],
        [{ barberId: IVAN, locationId: null }],
        NOW,
      ).ok,
    ).toBe(true);
  });

  it('refuses a barber with no record among those read, and one who has left', () => {
    expect(
      unwrapErr(
        RosterAccessSystem.admitDays(
          desk,
          [ivan],
          [{ barberId: NIKO, locationId: CENTER }],
          NOW,
        ),
      ),
    ).toEqual({
      errorCode: SchedulingErrorCode.RosterInvalidInput,
      field: 'barberId',
    });
    expect(
      unwrapErr(
        RosterAccessSystem.admitDays(
          desk,
          [departed],
          [{ barberId: IVAN, locationId: CENTER }],
          NOW,
        ),
      ),
    ).toEqual({
      errorCode: SchedulingErrorCode.RosterDeparted,
      barberId: IVAN,
    });
  });
});

describe('RosterAccessSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const caller = deepFreeze(
      userFixture({ roles: [Role.Barber], linkedBarberId: IVAN }),
    );
    const barber = deepFreeze(barberFixture());
    const week = deepFreeze([shift(Weekday.Mon, CENTER)]);
    expect(RosterAccessSystem.admit(caller, barber, IVAN, NOW)).toEqual(
      RosterAccessSystem.admit(caller, barber, IVAN, NOW),
    );
    expect(RosterAccessSystem.withinShops(barber, week)).toEqual(
      RosterAccessSystem.withinShops(barber, week),
    );
  });
});
