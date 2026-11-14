import { describe, expect, it } from 'vitest';
import { BarberStatus, ShiftSegment } from '@core/components';
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

const shift = (weekday: Weekday, locationId: LocationId): ShiftSegment => {
  const start = unwrapOk(MinuteOfDay.of(9 * 60));
  const end = unwrapOk(EndMinute.of(17 * 60));
  return ShiftSegment.of(weekday, locationId, start, end);
};

/*
 * WHO may edit a barber's hours and days is `StaffAccessSystem`'s question
 * since staff permissions stage A (`staff-access.system.spec.ts` holds
 * those cases, and the table that pins the defaults to what this system
 * answered before). What stays here are the record's own rules, asked
 * after the caller is admitted.
 */
describe('RosterAccessSystem.recordOf — which record’s hours can be edited', () => {
  it('answers the record the id names', () => {
    expect(unwrapOk(RosterAccessSystem.recordOf(ivan))).toBe(ivan);
  });

  it('names an id with no record as invalid input', () => {
    expect(unwrapErr(RosterAccessSystem.recordOf(null))).toEqual({
      errorCode: SchedulingErrorCode.RosterInvalidInput,
      field: 'barberId',
    });
  });

  it('never edits the hours of a barber who has left — a draft’s and a live record’s are editable', () => {
    expect(unwrapErr(RosterAccessSystem.recordOf(departed))).toEqual({
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
    expect(RosterAccessSystem.recordOf(draft).ok).toBe(true);
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

describe('RosterAccessSystem.worksAt / placedDays — an act on barbers’ days', () => {
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

  it('takes every barber the act touches whose record was read', () => {
    expect(
      RosterAccessSystem.placedDays(
        [ivan, niko],
        [
          { barberId: IVAN, locationId: null },
          { barberId: NIKO, locationId: CENTER },
        ],
      ),
    ).toEqual({ ok: true, value: null });
  });

  it('refuses a day filed at a shop its barber does not work at; a lift names no shop and is not asked', () => {
    expect(
      unwrapErr(
        RosterAccessSystem.placedDays(
          [ivan],
          [{ barberId: IVAN, locationId: MLADOST }],
        ),
      ),
    ).toEqual({
      errorCode: SchedulingErrorCode.RosterOutsideShops,
      locationId: MLADOST,
    });
    expect(
      RosterAccessSystem.placedDays(
        [ivan],
        [{ barberId: IVAN, locationId: null }],
      ).ok,
    ).toBe(true);
  });

  it('refuses a barber with no record among those read, and one who has left — the first, in the request’s order', () => {
    expect(
      unwrapErr(
        RosterAccessSystem.placedDays(
          [ivan],
          [{ barberId: NIKO, locationId: CENTER }],
        ),
      ),
    ).toEqual({
      errorCode: SchedulingErrorCode.RosterInvalidInput,
      field: 'barberId',
    });
    expect(
      unwrapErr(
        RosterAccessSystem.placedDays(
          [departed],
          [{ barberId: IVAN, locationId: CENTER }],
        ),
      ),
    ).toEqual({
      errorCode: SchedulingErrorCode.RosterDeparted,
      barberId: IVAN,
    });
    expect(
      unwrapErr(
        RosterAccessSystem.placedDays(
          [departed],
          [
            { barberId: IVAN, locationId: CENTER },
            { barberId: NIKO, locationId: CENTER },
          ],
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
    const barber = deepFreeze(barberFixture());
    const week = deepFreeze([shift(Weekday.Mon, CENTER)]);
    const placements = deepFreeze([{ barberId: IVAN, locationId: CENTER }]);
    expect(RosterAccessSystem.recordOf(barber)).toEqual(
      RosterAccessSystem.recordOf(barber),
    );
    expect(RosterAccessSystem.withinShops(barber, week)).toEqual(
      RosterAccessSystem.withinShops(barber, week),
    );
    expect(RosterAccessSystem.placedDays([barber], placements)).toEqual(
      RosterAccessSystem.placedDays([barber], placements),
    );
  });
});
