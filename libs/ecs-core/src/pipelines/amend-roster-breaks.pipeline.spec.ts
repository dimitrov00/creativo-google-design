import { describe, expect, it } from 'vitest';
import { MinuteRange, RosterBreak, WriteOp } from '@core/components';
import { Collections } from '@core/entities';
import { SchedulingErrorCode } from '@core/errors';
import { LocationId, Weekday } from '@core/primitives';
import {
  barberScheduleFixture,
  bodyOf,
  endMinute,
  FIXTURE_IDS,
  localDate,
  locationFixture,
  memoryStore,
  memoryTxPorts,
  minute,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { amendRosterBreaks } from './amend-roster-breaks.pipeline';

/*
 * A chair's standing breaks changed «from this day on» — ONE transaction:
 * the roster and the shop read, the versions revised from the day on by
 * `RosterBreakSystem.amend`, the roster's `versions` written whole. The
 * fixture clock reads 2026-09-28 (a Monday) at the fixture shop.
 */

const LUNCH = MinuteRange.of(minute(780), endMinute(840));
const ROSTER = [Collections.BarberSchedules, FIXTURE_IDS.barber];
const SHOP = [Collections.Locations, FIXTURE_IDS.location];

function rig(withRoster = true) {
  const store = memoryStore([
    { path: SHOP, body: bodyOf(locationFixture()) },
    ...(withRoster
      ? [{ path: ROSTER, body: bodyOf(barberScheduleFixture()) }]
      : []),
  ]);
  const tx = memoryTxPorts(store);
  return { store, tx, run: amendRosterBreaks(tx) };
}

const weekdayLunch = {
  barberId: FIXTURE_IDS.barber,
  locationId: FIXTURE_IDS.location,
  fromLocalDate: localDate('2026-09-28'),
  weekdays: [Weekday.Mon, Weekday.Tue, Weekday.Wed, Weekday.Thu, Weekday.Fri],
  before: null,
  after: LUNCH,
};

describe('amendRosterBreaks', () => {
  it('adds a weekday lunch from today on in ONE roster write', async () => {
    const { tx, run } = rig();
    expect(unwrapOk(await run(weekdayLunch))).toEqual({
      barberId: FIXTURE_IDS.barber,
    });
    expect(tx.plans).toHaveLength(1);
    const [write] = tx.plans[0] as readonly WriteOp[];
    expect(write).toEqual(
      WriteOp.update(ROSTER, { versions: expect.any(Array) }),
    );
    expect(tx.transactions[0]?.reads).toEqual([ROSTER, SHOP]);
  });

  it('keeps the weeks before the day as they were', async () => {
    const { store, run } = rig();
    unwrapOk(await run(weekdayLunch));
    const versions = store.get(ROSTER.join('/'))?.['versions'] as readonly {
      readonly effectiveFromLocalDate: string;
      readonly breaks: readonly RosterBreak[];
    }[];
    expect(versions.map((v) => v.effectiveFromLocalDate)).toEqual([
      '2026-01-01',
      '2026-09-28',
    ]);
    expect(versions[0]?.breaks).toEqual([]);
    expect(versions[1]?.breaks).toHaveLength(5);
  });

  it('refuses a day already past at the shop, and writes nothing', async () => {
    const { tx, run } = rig();
    const refused = await run({
      ...weekdayLunch,
      fromLocalDate: localDate('2026-09-27'),
    });
    expect(unwrapErr(refused).errorCode).toBe(
      SchedulingErrorCode.RosterBreakInPast,
    );
    expect(tx.plans).toEqual([]);
  });

  it('refuses a chair with no roster, and a shop that is not there', async () => {
    expect(unwrapErr(await rig(false).run(weekdayLunch)).errorCode).toBe(
      SchedulingErrorCode.RosterMissing,
    );
    expect(
      unwrapErr(
        await rig().run({
          ...weekdayLunch,
          locationId: LocationId.of('loc-gone'),
        }),
      ).errorCode,
    ).toBe(SchedulingErrorCode.RosterInvalidInput);
  });
});
