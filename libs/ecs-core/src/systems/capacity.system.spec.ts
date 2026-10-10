import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CapacityEntry } from '../components/capacity-entry.data';
import { DayKey } from '../components/day-key.data';
import { DayOffset } from '../components/day-offset.data';
import { ExceptionEffect } from '../components/exception-effect.data';
import { DayHours } from '../components/opening-hours.data';
import {
  type ScheduleVersion,
  ShiftSegment,
} from '../components/schedule-version.data';
import { TimeInterval } from '../components/time-interval.data';
import { Weekday } from '../components/weekday.data';
import { BarberId } from '../entities/barber.entity';
import { LocationId } from '../entities/location.entity';
import { dayTableFixture, deepFreeze, unwrapOk } from '../testing';
import {
  type CapacityPlan,
  type CapacityPlanInput,
  CapacitySystem,
} from './capacity.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The cases of apps/functions/src/lib/booking/capacity-plan.spec.ts (14) and
 * libs/application/booking/src/lib/ports/capacity-document.spec.ts (5 —
 * shop sums and narrowing, read through `CapacityEntry.freeMinutesOn`),
 * COPIED over plain structs; the legacy specs keep running against the
 * shims. Plus the replace-not-merge fold of §3.6 (`applyPlan`) proved
 * against brute-force filter + concat + sort.
 */

const B1 = BarberId.of('b1');
const LOC_A = LocationId.of('loc-a');
const LOC_B = LocationId.of('loc-b');
const k = DayKey.of;

/** August and September 2026 in Sofia — 2026-08-03 is a Monday. */
const DAYS = dayTableFixture('2026-08-01', '2026-09-30');

/** Mon-first: open six days 09:00–17:00, closed Sunday. */
function hours(opens = 9 * 60, closes = 17 * 60): readonly DayHours[] {
  return [
    ...Array.from({ length: 6 }, () => DayHours.open(opens, closes)),
    DayHours.closed(),
  ];
}

const WORKDAYS = [
  Weekday.Mon,
  Weekday.Tue,
  Weekday.Wed,
  Weekday.Thu,
  Weekday.Fri,
  Weekday.Sat,
];

function schedule(
  segments: readonly {
    start: number;
    end: number;
    locationId: LocationId;
  }[],
  turnaroundMinutes = 0,
) {
  const version: ScheduleVersion = {
    seq: 1,
    effectiveFromDayKey: k('2026-01-01'),
    effectiveToDayKey: null,
    segments: WORKDAYS.flatMap((weekday) =>
      segments.map((segment) =>
        ShiftSegment.of(
          weekday,
          segment.locationId,
          segment.start,
          segment.end,
        ),
      ),
    ),
  };
  return { versions: [version], turnaroundMinutes };
}

/** A wall-clock span on `dayKey`, as the instants the projection stores. */
function busy(fromMinutes: number, toMinutes: number, dayKey: string) {
  const day = DayOffset.find(k(dayKey), DAYS) as DayOffset;
  return TimeInterval.of(
    ZonedTimeSystem.instantOf(day, fromMinutes),
    ZonedTimeSystem.instantOf(day, toMinutes),
  );
}

function input(overrides: Partial<CapacityPlanInput> = {}): CapacityPlanInput {
  return {
    barberId: B1,
    dayKeys: [k('2026-08-03')],
    schedule: schedule([{ start: 540, end: 1020, locationId: LOC_A }]),
    shops: [{ locationId: LOC_A, week: hours() }],
    busy: [],
    exceptions: [],
    ...overrides,
  };
}

const plan = (overrides: Partial<CapacityPlanInput> = {}) =>
  CapacitySystem.planBarberCapacity(input(overrides), DAYS);

/** The day's free minutes per shop, as the legacy contribution map read. */
function contributionOn(
  planned: CapacityPlan,
  dayKey: string,
): Record<string, number> | null {
  const own = planned.entries.filter((entry) => entry.dayKey === dayKey);
  if (own.length === 0) return null;
  return Object.fromEntries(
    own.map((entry) => [entry.locationId, entry.freeMinutes]),
  );
}

describe('planBarberCapacity', () => {
  it('yields the full rostered minutes on an empty day', () => {
    expect(contributionOn(plan(), '2026-08-03')).toEqual({ 'loc-a': 480 });
  });

  it('pads busy with the turnaround on both sides before subtracting', () => {
    const planned = plan({
      schedule: schedule([{ start: 540, end: 1020, locationId: LOC_A }], 15),
      busy: [
        { dayKey: k('2026-08-03'), spans: [busy(600, 660, '2026-08-03')] },
      ],
    });
    // 480 − (60 busy + 15 either side) = 390.
    expect(contributionOn(planned, '2026-08-03')).toEqual({ 'loc-a': 390 });
  });

  it('clamps rostered time to the shop published hours', () => {
    const planned = plan({
      shops: [{ locationId: LOC_A, week: hours(540, 780) }],
    });
    expect(contributionOn(planned, '2026-08-03')).toEqual({ 'loc-a': 240 });
  });

  it('splits a two-shop day per location', () => {
    const planned = plan({
      schedule: schedule([
        { start: 540, end: 780, locationId: LOC_A },
        { start: 840, end: 1020, locationId: LOC_B },
      ]),
      shops: [
        { locationId: LOC_A, week: hours() },
        { locationId: LOC_B, week: hours() },
      ],
    });
    expect(contributionOn(planned, '2026-08-03')).toEqual({
      'loc-a': 240,
      'loc-b': 180,
    });
  });

  // The archived-shop leak the adversarial review caught: an absent hours
  // entry means "no bound" to the roster, which must not let a retired
  // shop's chair sell unclamped hours into "any shop".
  it('drops segments at locations outside the active set entirely', () => {
    const planned = plan({
      schedule: schedule([
        { start: 540, end: 780, locationId: LOC_A },
        { start: 840, end: 1020, locationId: LocationId.of('loc-archived') },
      ]),
    });
    expect(contributionOn(planned, '2026-08-03')).toEqual({ 'loc-a': 240 });
  });

  it('deletes the entry for a day a published exception closes', () => {
    const planned = plan({
      exceptions: [
        { dayKey: k('2026-08-03'), effect: ExceptionEffect.closed() },
      ],
    });
    expect(contributionOn(planned, '2026-08-03')).toBeNull();
    expect(planned.dayKeys).toEqual(['2026-08-03']);
  });

  it('replaces the roster with an hours exception', () => {
    const planned = plan({
      exceptions: [
        {
          dayKey: k('2026-08-03'),
          effect: unwrapOk(
            ExceptionEffect.hours([{ startMinutes: 600, endMinutes: 720 }]),
          ),
        },
      ],
    });
    expect(contributionOn(planned, '2026-08-03')).toEqual({ 'loc-a': 120 });
  });

  it('deletes every entry when the barber has no roster at all', () => {
    const planned = plan({
      schedule: null,
      dayKeys: [k('2026-08-03'), k('2026-08-04')],
    });
    expect(contributionOn(planned, '2026-08-03')).toBeNull();
    expect(contributionOn(planned, '2026-08-04')).toBeNull();
    expect(planned.dayKeys).toEqual(['2026-08-03', '2026-08-04']);
  });

  it('deletes the entry for a fully booked day rather than keeping zeros', () => {
    const planned = plan({
      busy: [
        { dayKey: k('2026-08-03'), spans: [busy(540, 1020, '2026-08-03')] },
      ],
    });
    expect(contributionOn(planned, '2026-08-03')).toBeNull();
  });

  it('deletes the entry on the shop rest day', () => {
    // 2026-08-09 is a Sunday: shop closed, roster has no sunday segments.
    const planned = plan({ dayKeys: [k('2026-08-09')] });
    expect(contributionOn(planned, '2026-08-09')).toBeNull();
  });

  it('groups a month-straddling span into sorted month plans', () => {
    const months = CapacitySystem.byMonth(
      plan({
        dayKeys: [k('2026-08-31'), k('2026-09-01'), k('2026-09-02')],
      }),
    );
    expect(months.map((month) => month.month)).toEqual(['2026-08', '2026-09']);
    expect(months[0]?.dayKeys).toEqual(['2026-08-31']);
    expect(months[1]?.dayKeys).toEqual(['2026-09-01', '2026-09-02']);
    expect(months[1]?.entries.map((entry) => entry.dayKey)).toEqual([
      '2026-09-01',
      '2026-09-02',
    ]);
  });
});

describe('dayKeysBetween', () => {
  it('walks the range inclusively', () => {
    expect(
      CapacitySystem.dayKeysBetween(k('2026-08-30'), k('2026-09-02')),
    ).toEqual({
      keys: ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'],
      truncated: false,
    });
  });

  it('flags truncation at 500 days instead of walking forever', () => {
    const result = CapacitySystem.dayKeysBetween(
      k('2026-01-01'),
      k('2030-01-01'),
    );
    expect(result.keys).toHaveLength(500);
    expect(result.truncated).toBe(true);
  });
});

describe('horizonSpanEndKey', () => {
  it('lands on the true last day of the following month', () => {
    // The failure this encodes: setUTCMonth(+1) on Jan 31 rolls THROUGH
    // short February and left its tail unmaterialized.
    expect(CapacitySystem.horizonSpanEndKey(k('2026-01-31'))).toBe(
      '2026-02-28',
    );
    expect(CapacitySystem.horizonSpanEndKey(k('2024-01-31'))).toBe(
      '2024-02-29',
    ); // leap
    expect(CapacitySystem.horizonSpanEndKey(k('2026-12-31'))).toBe(
      '2027-01-31',
    ); // year roll
    expect(CapacitySystem.horizonSpanEndKey(k('2026-10-15'))).toBe(
      '2026-11-30',
    ); // mid-month
  });
});

describe('the rollup’s read semantics (capacity-document)', () => {
  const ivan = BarberId.of('ivan');
  const stefan = BarberId.of('stefan');
  const center = LocationId.of('loc-center');
  const mladost = LocationId.of('loc-mladost');
  const day = k('2026-08-14');
  const entries = [
    CapacityEntry.of(day, ivan, center, 240),
    CapacityEntry.of(day, stefan, center, 180),
    CapacityEntry.of(day, stefan, mladost, 60),
  ];

  it('derives the month key from a day key', () => {
    expect(CapacityEntry.monthOf(day)).toBe('2026-08');
  });

  it('sums every shop for "any shop"', () => {
    expect(
      CapacityEntry.freeMinutesOn(entries, day, [ivan, stefan], null),
    ).toBe(480);
  });

  it('narrows to one shop when a location is chosen', () => {
    expect(
      CapacityEntry.freeMinutesOn(entries, day, [ivan, stefan], mladost),
    ).toBe(60);
  });

  // The rollup stores per-barber contributions precisely so a barber the
  // catalog no longer lists stops counting immediately, without a sweep.
  it('counts only the barbers the caller names', () => {
    expect(CapacityEntry.freeMinutesOn(entries, day, [stefan], null)).toBe(240);
    expect(
      CapacityEntry.freeMinutesOn(entries, day, [BarberId.of('ghost')], null),
    ).toBe(0);
  });

  it('reads an absent day as zero', () => {
    expect(
      CapacityEntry.freeMinutesOn(entries, k('2026-08-15'), [ivan], null),
    ).toBe(0);
    expect(CapacityEntry.freeMinutesOn([], day, [ivan], null)).toBe(0);
  });
});

describe('applyPlan — the replace-not-merge fold (§3.6)', () => {
  const ivan = BarberId.of('ivan');
  const stefan = BarberId.of('stefan');

  it('drops the scope, merges the plan in place, leaves other barbers alone', () => {
    const month = {
      month: '2026-08',
      entries: [
        CapacityEntry.of(k('2026-08-03'), ivan, LOC_A, 100),
        CapacityEntry.of(k('2026-08-03'), stefan, LOC_A, 50),
        CapacityEntry.of(k('2026-08-04'), ivan, LOC_B, 30),
        CapacityEntry.of(k('2026-08-05'), ivan, LOC_A, 70),
      ],
    };
    const replacement: CapacityPlan = {
      barberId: ivan,
      dayKeys: [k('2026-08-03'), k('2026-08-04')],
      entries: [CapacityEntry.of(k('2026-08-03'), ivan, LOC_B, 200)],
    };
    expect(CapacitySystem.applyPlan(month, replacement)).toEqual([
      CapacityEntry.of(k('2026-08-03'), ivan, LOC_B, 200),
      CapacityEntry.of(k('2026-08-03'), stefan, LOC_A, 50),
      // 2026-08-04 emptied: the ghost entry is gone, not zeroed.
      CapacityEntry.of(k('2026-08-05'), ivan, LOC_A, 70),
    ]);
  });

  it('seeds a month that does not exist yet with only its own entries', () => {
    const planned = plan({
      dayKeys: [k('2026-08-31'), k('2026-09-01')],
    });
    expect(
      CapacitySystem.applyPlan({ month: '2026-09', entries: [] }, planned),
    ).toEqual([CapacityEntry.of(k('2026-09-01'), B1, LOC_A, 480)]);
  });

  const barberArb = fc.constantFrom('ana', 'ana2', 'ivan', 'stefan');
  const shopArb = fc.constantFrom('loc-a', 'loc-b', 'loc-a2');
  const dayArb = fc.integer({ min: 1, max: 9 }).map((d) => k(`2026-08-0${d}`));
  const entryArb = fc
    .tuple(dayArb, barberArb, shopArb, fc.integer({ min: 1, max: 600 }))
    .map(([day, barber, shop, minutes]) =>
      CapacityEntry.of(day, BarberId.of(barber), LocationId.of(shop), minutes),
    );
  /** Sorted, one entry per key — what a stored month or a plan holds. */
  const canonical = (entries: readonly CapacityEntry[]) => {
    const seen = new Set<string>();
    return [...entries]
      .filter((entry) => {
        const key = CapacityEntry.keyOf(entry);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(CapacityEntry.compare);
  };

  it('equals brute-force filter + concat + sort (property)', () => {
    fc.assert(
      fc.property(
        fc.array(entryArb, { maxLength: 20 }),
        barberArb,
        fc.array(dayArb, { maxLength: 5 }),
        fc.array(entryArb, { maxLength: 8 }),
        (stored, barber, scopeDays, planned) => {
          const barberId = BarberId.of(barber);
          const dayKeys = [...new Set(scopeDays)].sort();
          const month = { month: '2026-08', entries: canonical(stored) };
          const replacement: CapacityPlan = {
            barberId,
            dayKeys,
            // A plan only ever holds its own barber's in-scope days.
            entries: canonical(
              planned
                .filter((entry) => dayKeys.includes(entry.dayKey))
                .map((entry) => ({ ...entry, barberId })),
            ),
          };
          const brute = [
            ...month.entries.filter(
              (entry) =>
                !(
                  entry.barberId === barberId && dayKeys.includes(entry.dayKey)
                ),
            ),
            ...replacement.entries,
          ].sort(CapacityEntry.compare);
          expect(CapacitySystem.applyPlan(month, replacement)).toEqual(brute);
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozenInput = deepFreeze(
      input({
        dayKeys: [k('2026-08-04'), k('2026-08-03')],
        busy: [
          { dayKey: k('2026-08-03'), spans: [busy(600, 660, '2026-08-03')] },
        ],
      }),
    );
    const days = deepFreeze([...DAYS]);
    const once = CapacitySystem.planBarberCapacity(frozenInput, days);
    expect(CapacitySystem.planBarberCapacity(frozenInput, days)).toEqual(once);
    const month = deepFreeze({
      month: '2026-08',
      entries: [CapacityEntry.of(k('2026-08-03'), B1, LOC_B, 5)],
    });
    expect(CapacitySystem.applyPlan(month, once)).toEqual(
      CapacitySystem.applyPlan(month, once),
    );
    expect(frozenInput.dayKeys).toEqual(['2026-08-04', '2026-08-03']);
    expect(once.dayKeys).toEqual(['2026-08-03', '2026-08-04']);
  });
});
