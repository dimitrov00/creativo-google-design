import { describe, expect, it } from 'vitest';
import { BarberId, LocationId } from '@creativo/domain/catalog';
import { CalendarDay } from './calendar-day';
import { Interval } from './interval';
import { LocalTimeRange } from './local-time-of-day';
import {
  ScheduleException,
  ScheduleExceptionId,
  type ScheduleExceptionKind,
} from './schedule-exception';
import { StaffScheduleHistory } from './staff-schedule';
import { WeeklyPattern } from './weekly-pattern';
import {
  buildDayCarveOuts,
  buildDayWindows,
  rosteredMinutes,
  windowsAt,
} from './roster-window';

const zone = 'Europe/Sofia';

function day(key: string): CalendarDay {
  const result = CalendarDay.create(key, zone);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function locationId(raw = 'loc-center'): LocationId {
  const result = LocationId.create(raw);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function barberId(raw = 'ivan'): BarberId {
  const result = BarberId.create(raw);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function range(start: string, end: string): LocalTimeRange {
  const result = LocalTimeRange.create(start, end);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

/** Every weekday, one shift. 2026-07-29 is a Wednesday. */
function scheduleFrom(
  ranges: readonly (readonly [string, string])[],
  from = '2026-01-01',
  at = 'loc-center',
): StaffScheduleHistory {
  const segments = ranges.map(([start, end]) => ({
    start,
    end,
    locationId: at,
  }));
  const pattern = WeeklyPattern.create({
    byWeekday: {
      monday: segments,
      tuesday: segments,
      wednesday: segments,
      thursday: segments,
      friday: segments,
      saturday: segments,
      sunday: segments,
    },
  });
  if (pattern.isFailure()) throw new Error('bad fixture');
  return StaffScheduleHistory.startingWith(pattern.value, day(from));
}

function exception(
  detail: ScheduleExceptionKind,
  onDay: string,
  barber: BarberId | null = barberId(),
): ScheduleException {
  const result = ScheduleException.create({
    id: ScheduleExceptionId.of(`exc-${onDay}-${detail.kind}`),
    day: day(onDay),
    barberId: barber,
    locationId: locationId(),
    detail,
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

/** Materialise one shop's hours for a day, as the per-shop map. */
function shopHours(
  onDay: string,
  ranges: readonly (readonly [string, string])[],
) {
  return new Map([
    [
      locationId().value,
      {
        locationId: locationId(),
        intervals: ranges.map(([start, end]) => {
          const from = range(start, end).start.onDay(day(onDay));
          const to = range(start, end).end.onDay(day(onDay));
          if (from.isFailure() || to.isFailure())
            throw new Error('bad fixture');
          return Interval.of(from.value.toMillis(), to.value.toMillis());
        }),
      },
    ],
  ]);
}

/** Windows rendered as local HH:mm for readable assertions. */
function asClock(
  windows: readonly { readonly interval: Interval }[],
): readonly string[] {
  return windows.map((window) => {
    const from = new Date(window.interval.startMs);
    const to = new Date(window.interval.endMs);
    const fmt = (d: Date) =>
      d.toLocaleTimeString('en-GB', {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
      });
    return `${fmt(from)}–${fmt(to)}`;
  });
}

describe('buildDayWindows — the bookable window', () => {
  it('materialises the pattern in force', () => {
    const windows = buildDayWindows({
      day: day('2026-07-29'),
      schedule: scheduleFrom([['09:00', '18:00']]),
      exceptions: [],
    });
    expect(asClock(windows)).toEqual(['09:00–18:00']);
    expect(rosteredMinutes(windows)).toBe(9 * 60);
  });

  it('keeps a split shift split', () => {
    const windows = buildDayWindows({
      day: day('2026-07-29'),
      schedule: scheduleFrom([
        ['09:00', '13:00'],
        ['14:00', '18:00'],
      ]),
      exceptions: [],
    });
    expect(asClock(windows)).toEqual(['09:00–13:00', '14:00–18:00']);
    expect(rosteredMinutes(windows)).toBe(8 * 60);
  });

  it('returns nothing before the schedule began, or on an unworked weekday', () => {
    expect(
      buildDayWindows({
        day: day('2025-12-31'),
        schedule: scheduleFrom([['09:00', '18:00']]),
        exceptions: [],
      }),
    ).toEqual([]);

    const weekdaysOnly = WeeklyPattern.create({
      byWeekday: {
        monday: [{ start: '09:00', end: '18:00', locationId: 'loc-center' }],
      },
    });
    if (weekdaysOnly.isFailure()) throw new Error('bad fixture');
    expect(
      buildDayWindows({
        day: day('2026-07-29'), // a Wednesday
        schedule: StaffScheduleHistory.startingWith(
          weekdaysOnly.value,
          day('2026-01-01'),
        ),
        exceptions: [],
      }),
    ).toEqual([]);
  });

  it('carries the locationId on each window, so a two-shop day is attributable', () => {
    const windows = buildDayWindows({
      day: day('2026-07-29'),
      schedule: scheduleFrom([['09:00', '18:00']]),
      exceptions: [],
    });
    expect(windows[0]?.locationId.value).toBe('loc-center');
  });
});

describe('buildDayWindows — ruling R1: shop hours bound the PUBLIC surface', () => {
  it('INTERSECTS the roster with the shop’s published hours', () => {
    // Ivan is rostered 08:00–21:00; the shop opens 09:00–20:00. A client can
    // never be offered a time the door is locked.
    const windows = buildDayWindows({
      day: day('2026-07-29'),
      schedule: scheduleFrom([['08:00', '21:00']]),
      exceptions: [],
      shopHours: shopHours('2026-07-29', [['09:00', '20:00']]),
    });
    expect(asClock(windows)).toEqual(['09:00–20:00']);
  });

  it('imposes no bound when the shop publishes no hours at all', () => {
    // Absent hours are not a closure — the roster stands as written.
    const windows = buildDayWindows({
      day: day('2026-07-29'),
      schedule: scheduleFrom([['08:00', '21:00']]),
      exceptions: [],
      shopHours: null,
    });
    expect(asClock(windows)).toEqual(['08:00–21:00']);
  });

  it('offers NOTHING on a day the shop publishes as closed', () => {
    // Empty intervals mean the door is locked, not "unbounded". Reading them
    // as unbounded is how a shop's closed Sunday starts quietly offering
    // whatever a barber's weekly pattern happens to say.
    const windows = buildDayWindows({
      day: day('2026-07-29'),
      schedule: scheduleFrom([['08:00', '21:00']]),
      exceptions: [],
      shopHours: new Map([
        [locationId().value, { locationId: locationId(), intervals: [] }],
      ]),
    });
    expect(asClock(windows)).toEqual([]);
  });

  it('intersects against a shop that itself closes for lunch', () => {
    const windows = buildDayWindows({
      day: day('2026-07-29'),
      schedule: scheduleFrom([['09:00', '18:00']]),
      exceptions: [],
      shopHours: shopHours('2026-07-29', [
        ['09:00', '13:00'],
        ['14:00', '20:00'],
      ]),
    });
    expect(asClock(windows)).toEqual(['09:00–13:00', '14:00–18:00']);
  });
});

describe('buildDayWindows — exceptions', () => {
  it('a whole-day absence removes the day entirely', () => {
    for (const detail of [
      { kind: 'time_off' } as const,
      { kind: 'sick', paid: true } as const,
      { kind: 'training', topic: null } as const,
      { kind: 'travel', toLocationId: locationId('loc-mladost') } as const,
    ]) {
      expect(
        buildDayWindows({
          day: day('2026-07-29'),
          schedule: scheduleFrom([['09:00', '18:00']]),
          exceptions: [exception(detail, '2026-07-29')],
        }),
      ).toEqual([]);
    }
  });

  it('a location-wide closure removes the day for every barber', () => {
    const closure = exception({ kind: 'closed' }, '2026-07-29', null);
    expect(closure.isLocationWide()).toBe(true);
    expect(closure.appliesTo(barberId('anyone'))).toBe(true);
    expect(
      buildDayWindows({
        day: day('2026-07-29'),
        schedule: scheduleFrom([['09:00', '18:00']]),
        exceptions: [closure],
      }),
    ).toEqual([]);
  });

  it('an `hours` exception REPLACES the pattern for that day', () => {
    const windows = buildDayWindows({
      day: day('2026-07-29'),
      schedule: scheduleFrom([['09:00', '18:00']]),
      exceptions: [
        exception(
          { kind: 'hours', ranges: [range('12:00', '16:00')] },
          '2026-07-29',
        ),
      ],
    });
    expect(asClock(windows)).toEqual(['12:00–16:00']);
  });

  it('a break is carved OUT of the roster, splitting the window', () => {
    // Subtracted from the windows rather than merely marked busy, so unpaid
    // time never enters the capacity denominator at all.
    const windows = buildDayWindows({
      day: day('2026-07-29'),
      schedule: scheduleFrom([['09:00', '18:00']]),
      exceptions: [
        exception(
          { kind: 'break', ranges: [range('13:00', '14:00')], paid: false },
          '2026-07-29',
        ),
      ],
    });
    expect(asClock(windows)).toEqual(['09:00–13:00', '14:00–18:00']);
    expect(rosteredMinutes(windows)).toBe(8 * 60);
  });

  it('an admin block is carved out the same way', () => {
    const windows = buildDayWindows({
      day: day('2026-07-29'),
      schedule: scheduleFrom([['09:00', '18:00']]),
      exceptions: [
        exception(
          {
            kind: 'admin',
            ranges: [range('16:00', '18:00')],
            note: 'stocktake',
          },
          '2026-07-29',
        ),
      ],
    });
    expect(asClock(windows)).toEqual(['09:00–16:00']);
  });

  it('ignores exceptions for other days', () => {
    const windows = buildDayWindows({
      day: day('2026-07-29'),
      schedule: scheduleFrom([['09:00', '18:00']]),
      exceptions: [exception({ kind: 'time_off' }, '2026-07-30')],
    });
    expect(asClock(windows)).toEqual(['09:00–18:00']);
  });

  it('rejects a range-bearing exception with no ranges', () => {
    const result = ScheduleException.create({
      id: ScheduleExceptionId.of('exc-empty'),
      day: day('2026-07-29'),
      barberId: barberId(),
      locationId: locationId(),
      detail: { kind: 'hours', ranges: [] },
    });
    // An empty `hours` would silently mean "closed" — a second way to say one
    // thing is how two code paths start disagreeing.
    expect(result.isFailure()).toBe(true);
  });
});

describe('buildDayWindows — DST', () => {
  it('a 23-hour day still materialises correctly', () => {
    const windows = buildDayWindows({
      day: day('2026-03-29'),
      schedule: scheduleFrom([['09:00', '18:00']]),
      exceptions: [],
    });
    // 09:00–18:00 is entirely after the 03:00 transition, so it is a normal
    // nine hours of real time.
    expect(rosteredMinutes(windows)).toBe(9 * 60);
    expect(asClock(windows)).toEqual(['09:00–18:00']);
  });

  it('a shift spanning the spring-forward loses the erased hour of REAL time', () => {
    // 02:00–06:00 on the wall clock is only three hours of actual work,
    // because 03:00–03:59 never happens. Utilisation must divide by three.
    const windows = buildDayWindows({
      day: day('2026-03-29'),
      schedule: scheduleFrom([['02:00', '06:00']]),
      exceptions: [],
    });
    expect(rosteredMinutes(windows)).toBe(3 * 60);
  });

  it('a shift spanning the fall-back gains the repeated hour', () => {
    const windows = buildDayWindows({
      day: day('2026-10-25'),
      schedule: scheduleFrom([['02:00', '06:00']]),
      exceptions: [],
    });
    expect(rosteredMinutes(windows)).toBe(5 * 60);
  });

  it('DROPS a rostered range the spring-forward erased entirely, rather than inventing one', () => {
    // 03:15–03:45 does not exist on 2026-03-29. Relocating it would book a
    // client at a time nobody rostered.
    const windows = buildDayWindows({
      day: day('2026-03-29'),
      schedule: scheduleFrom([
        ['03:15', '03:45'],
        ['09:00', '12:00'],
      ]),
      exceptions: [],
    });
    expect(asClock(windows)).toEqual(['09:00–12:00']);
  });
});

describe('buildDayWindows — a barber who covers TWO shops', () => {
  const CENTER = 'loc-center';
  const MLADOST = 'loc-mladost';

  function twoShopSchedule(
    segments: readonly { start: string; end: string; locationId: string }[],
  ): StaffScheduleHistory {
    const pattern = WeeklyPattern.create({
      byWeekday: {
        monday: segments,
        tuesday: segments,
        wednesday: segments,
      },
    });
    if (pattern.isFailure()) {
      throw new Error(`bad fixture: ${JSON.stringify(pattern.error)}`);
    }
    return StaffScheduleHistory.startingWith(pattern.value, day('2026-01-01'));
  }

  function hoursFor(
    onDay: string,
    entries: readonly {
      readonly locationId: string;
      readonly ranges: readonly (readonly [string, string])[];
    }[],
  ) {
    return new Map(
      entries.map((entry) => {
        const id = LocationId.create(entry.locationId);
        if (id.isFailure()) throw new Error('bad fixture');
        return [
          entry.locationId,
          {
            locationId: id.value,
            intervals: entry.ranges.map(([start, end]) => {
              const from = range(start, end).start.onDay(day(onDay));
              const to = range(start, end).end.onDay(day(onDay));
              if (from.isFailure() || to.isFailure()) {
                throw new Error('bad fixture');
              }
              return Interval.of(from.value.toMillis(), to.value.toMillis());
            }),
          },
        ];
      }),
    );
  }

  it('splits one day across two shops, each window tagged with its own', () => {
    // The case the old model could not express at all: mornings at Center,
    // afternoons at Mladost.
    const windows = buildDayWindows({
      day: day('2026-07-29'),
      schedule: twoShopSchedule([
        { start: '09:00', end: '13:00', locationId: CENTER },
        { start: '14:00', end: '18:00', locationId: MLADOST },
      ]),
      exceptions: [],
    });

    expect(
      windows.map((w) => `${asClock([w])[0]} @ ${w.locationId.value}`),
    ).toEqual([`09:00–13:00 @ ${CENTER}`, `14:00–18:00 @ ${MLADOST}`]);
  });

  it('clips each segment to ITS OWN shop’s hours, not the other’s', () => {
    // Center runs 09:00–20:00; Mladost opens at 15:00. Clipping the Mladost
    // afternoon against Center's hours is how a client gets offered a time at
    // a locked door.
    const windows = buildDayWindows({
      day: day('2026-07-29'),
      schedule: twoShopSchedule([
        { start: '09:00', end: '13:00', locationId: CENTER },
        { start: '14:00', end: '18:00', locationId: MLADOST },
      ]),
      exceptions: [],
      shopHours: hoursFor('2026-07-29', [
        { locationId: CENTER, ranges: [['09:00', '20:00']] },
        { locationId: MLADOST, ranges: [['15:00', '19:00']] },
      ]),
    });

    expect(
      windows.map((w) => `${asClock([w])[0]} @ ${w.locationId.value}`),
    ).toEqual([`09:00–13:00 @ ${CENTER}`, `15:00–18:00 @ ${MLADOST}`]);
  });

  it('yields nothing for a shop that is closed, while the other shop stands', () => {
    const windows = buildDayWindows({
      day: day('2026-07-29'),
      schedule: twoShopSchedule([
        { start: '09:00', end: '13:00', locationId: CENTER },
        { start: '14:00', end: '18:00', locationId: MLADOST },
      ]),
      exceptions: [],
      shopHours: hoursFor('2026-07-29', [
        { locationId: CENTER, ranges: [['09:00', '20:00']] },
        { locationId: MLADOST, ranges: [] },
      ]),
    });

    expect(
      windows.map((w) => `${asClock([w])[0]} @ ${w.locationId.value}`),
    ).toEqual([`09:00–13:00 @ ${CENTER}`]);
  });

  it('`windowsAt` narrows to the shop being booked', () => {
    const windows = buildDayWindows({
      day: day('2026-07-29'),
      schedule: twoShopSchedule([
        { start: '09:00', end: '13:00', locationId: CENTER },
        { start: '14:00', end: '18:00', locationId: MLADOST },
      ]),
      exceptions: [],
    });

    const center = LocationId.create(CENTER);
    if (center.isFailure()) throw new Error('bad fixture');
    expect(asClock(windowsAt(windows, center.value))).toEqual(['09:00–13:00']);
  });

  it('REFUSES a roster that cannot physically be worked', () => {
    // Center until 13:00 and Mladost from 13:00 is not a shift, it is a
    // teleport. Refused at authoring rather than silently trimmed: a roster
    // nobody can work is a mistake someone should fix.
    const impossible = WeeklyPattern.create(
      {
        byWeekday: {
          monday: [
            { start: '09:00', end: '13:00', locationId: CENTER },
            { start: '13:00', end: '18:00', locationId: MLADOST },
          ],
        },
      },
      30,
    );
    expect(impossible.isFailure()).toBe(true);

    // The SAME shape at one shop is a legal split shift — nobody travels.
    const oneShop = WeeklyPattern.create(
      {
        byWeekday: {
          monday: [
            { start: '09:00', end: '13:00', locationId: CENTER },
            { start: '13:00', end: '18:00', locationId: CENTER },
          ],
        },
      },
      30,
    );
    expect(oneShop.isSuccess()).toBe(true);
  });

  it('reports every shop a barber covers', () => {
    const schedule = twoShopSchedule([
      { start: '09:00', end: '13:00', locationId: CENTER },
      { start: '14:00', end: '18:00', locationId: MLADOST },
    ]);
    expect(schedule.locations().map((id) => id.value)).toEqual([
      CENTER,
      MLADOST,
    ]);
  });
});

describe('buildDayCarveOuts — the block as a thing, not an absence', () => {
  /*
   * The question `buildDayWindows` cannot answer. It subtracts a break and
   * hands back the survivors, so by the time any UI sees the day "Ivan is on
   * lunch", "Ivan is not rostered" and "the shop is shut" are one fact: no
   * window. Correct for capacity, useless for a calendar — a block is a thing
   * someone created, and it has to be drawable, nameable and removable.
   */
  it('returns the carved-out stretch as an interval of its own', () => {
    const blocks = buildDayCarveOuts({
      day: day('2026-07-29'),
      schedule: scheduleFrom([['09:00', '18:00']]),
      exceptions: [
        exception(
          { kind: 'break', ranges: [range('13:00', '14:00')], paid: false },
          '2026-07-29',
        ),
      ],
    });
    expect(asClock(blocks)).toEqual(['13:00–14:00']);
  });

  // The two views are one subtraction: what is drawn as a block and what is
  // removed from the windows must never be able to disagree.
  it('is exactly the complement of what buildDayWindows kept', () => {
    const input = {
      day: day('2026-07-29'),
      schedule: scheduleFrom([['09:00', '18:00']]),
      exceptions: [
        exception(
          { kind: 'admin', ranges: [range('13:00', '14:00')], note: '' },
          '2026-07-29',
        ),
      ],
    };
    expect(asClock(buildDayWindows(input))).toEqual([
      '09:00–13:00',
      '14:00–18:00',
    ]);
    expect(asClock(buildDayCarveOuts(input))).toEqual(['13:00–14:00']);
  });

  /*
   * A block is only drawable where there was something to block. Carving an
   * hour out of a day the barber does not work has removed nothing, and
   * drawing it would lay a solid rectangle over hours the shop was already
   * shut — inventing an event out of a no-op.
   */
  it('draws nothing for a carve-out over unrostered time', () => {
    const blocks = buildDayCarveOuts({
      day: day('2026-07-29'),
      schedule: scheduleFrom([['14:00', '18:00']]),
      exceptions: [
        exception(
          { kind: 'admin', ranges: [range('09:00', '10:00')], note: '' },
          '2026-07-29',
        ),
      ],
    });
    expect(blocks).toEqual([]);
  });

  it('clips a carve-out that only partly overlaps the shift', () => {
    const blocks = buildDayCarveOuts({
      day: day('2026-07-29'),
      schedule: scheduleFrom([['09:00', '18:00']]),
      exceptions: [
        exception(
          { kind: 'admin', ranges: [range('17:30', '19:00')], note: '' },
          '2026-07-29',
        ),
      ],
    });
    expect(asClock(blocks)).toEqual(['17:30–18:00']);
  });

  // The shop's envelope bounds a block exactly as it bounds a window — a
  // block outside opening hours is over time that was never worked.
  it('bounds a carve-out by the shop the segment is worked at', () => {
    const blocks = buildDayCarveOuts({
      day: day('2026-07-29'),
      schedule: scheduleFrom([['09:00', '20:00']]),
      exceptions: [
        exception(
          { kind: 'admin', ranges: [range('17:00', '19:00')], note: '' },
          '2026-07-29',
        ),
      ],
      shopHours: shopHours('2026-07-29', [['09:00', '18:00']]),
    });
    expect(asClock(blocks)).toEqual(['17:00–18:00']);
  });

  // A whole-day absence took the day; there is no worked time left for a
  // carve-out to sit inside, and a block over a day off is a contradiction.
  it('draws nothing on a day the barber is entirely off', () => {
    const blocks = buildDayCarveOuts({
      day: day('2026-07-29'),
      schedule: scheduleFrom([['09:00', '18:00']]),
      exceptions: [
        exception({ kind: 'time_off' }, '2026-07-29'),
        exception(
          { kind: 'admin', ranges: [range('13:00', '14:00')], note: '' },
          '2026-07-29',
        ),
      ],
    });
    expect(blocks).toEqual([]);
  });

  it('has nothing to say about a day with no exception at all', () => {
    expect(
      buildDayCarveOuts({
        day: day('2026-07-29'),
        schedule: scheduleFrom([['09:00', '18:00']]),
        exceptions: [],
      }),
    ).toEqual([]);
  });
});
