import { describe, expect, it } from 'vitest';
import {
  MinuteRange,
  RosterBreak,
  ShiftSegment,
  WriteOp,
} from '@core/components';
import { Collections } from '@core/entities';
import { SchedulingErrorCode } from '@core/errors';
import { Weekday } from '@core/primitives';
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
import { setRosterWeek } from './set-roster-week.pipeline';

/*
 * The hours editor's save — ONE transaction: the roster and the shop read,
 * the week judged and standing from the day on, the roster written whole.
 * The fixture clock reads 2026-09-28 at the fixture shop.
 */

const ROSTER = [Collections.BarberSchedules, FIXTURE_IDS.barber];
const SHOP = [Collections.Locations, FIXTURE_IDS.location];
const MONDAY = ShiftSegment.of(
  Weekday.Mon,
  FIXTURE_IDS.location,
  minute(540),
  endMinute(1080),
);
const LUNCH = RosterBreak.of(
  Weekday.Mon,
  MinuteRange.of(minute(780), endMinute(840)),
);

function rig(withRoster = true) {
  const store = memoryStore([
    { path: SHOP, body: bodyOf(locationFixture()) },
    ...(withRoster
      ? [{ path: ROSTER, body: bodyOf(barberScheduleFixture()) }]
      : []),
  ]);
  const tx = memoryTxPorts(store);
  return { store, tx, run: setRosterWeek(tx) };
}

const week = {
  barberId: FIXTURE_IDS.barber,
  locationId: FIXTURE_IDS.location,
  fromLocalDate: localDate('2026-09-28'),
  segments: [MONDAY],
  breaks: [LUNCH],
};

describe('setRosterWeek', () => {
  it('writes the roster whole, the week standing from the day on', async () => {
    const { tx, store, run } = rig();
    expect(unwrapOk(await run(week))).toEqual({ barberId: FIXTURE_IDS.barber });
    expect(tx.plans).toHaveLength(1);
    expect(tx.plans[0]).toEqual([
      WriteOp.set(ROSTER, {
        turnaroundMinutes: barberScheduleFixture().turnaroundMinutes,
        versions: expect.any(Array),
      }),
    ]);
    const versions = store.get(ROSTER.join('/'))?.['versions'] as readonly {
      readonly effectiveFromLocalDate: string;
      readonly breaks: readonly unknown[];
    }[];
    expect(versions.map((v) => v.effectiveFromLocalDate)).toEqual([
      '2026-01-01',
      '2026-09-28',
    ]);
    expect(versions[1]?.breaks).toEqual([LUNCH]);
  });

  it('starts a roster for a chair with none', async () => {
    const { store, run } = rig(false);
    unwrapOk(await run(week));
    expect(store.get(ROSTER.join('/'))?.['turnaroundMinutes']).toBe(0);
  });

  it('refuses a break outside the shifts, and writes nothing', async () => {
    const { tx, run } = rig();
    const refused = await run({
      ...week,
      breaks: [
        RosterBreak.of(
          Weekday.Tue,
          MinuteRange.of(minute(780), endMinute(840)),
        ),
      ],
    });
    expect(unwrapErr(refused).errorCode).toBe(
      SchedulingErrorCode.RosterBreakOutsideShift,
    );
    expect(tx.plans).toEqual([]);
  });
});
