import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DayKey } from '../components/day-key.data';
import { DayOffset } from '../components/day-offset.data';
import { ExceptionEffect } from '../components/exception-effect.data';
import { MinuteRange } from '../components/minute-range.data';
import { DayHours } from '../components/opening-hours.data';
import {
  type RosterWindow,
  ShopDayHours,
} from '../components/roster-window.data';
import {
  ScheduleVersion,
  ShiftSegment,
} from '../components/schedule-version.data';
import { TimeInterval } from '../components/time-interval.data';
import { Weekday } from '../components/weekday.data';
import { BarberId } from '../entities/barber.entity';
import { LocationId } from '../entities/location.entity';
import {
  type BuildDayWindowsInput,
  type DayException,
  RosterSystem,
  type ShopHours,
} from './roster.system';
import { ZonedTimeSystem } from './zoned-time.system';
import { deepFreeze } from '../testing';

/*
 * The cases of libs/domain/scheduling/src/lib/roster-window.spec.ts, copied
 * over plain arrays and the zone table (the class spec stays in place until
 * its Phase 2 shim), plus version selection, shop hours from a stored week,
 * DST edges, purity and a brute-force minute-set property.
 */

const SOFIA = 'Europe/Sofia';
const key = (raw: string) => DayKey.of(raw);

/** The Sofia table every case reads — built once, as a pipeline would. */
const DAYS = ZonedTimeSystem.dayTable(
  SOFIA,
  key('2025-12-01'),
  key('2026-12-31'),
);

function row(raw: string): DayOffset {
  const day = DayOffset.find(key(raw), DAYS);
  if (day === null) throw new Error(`bad fixture: ${raw} not in the table`);
  return day;
}

const IVAN = BarberId.of('ivan');
const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');

/** `'HH:mm'` → minutes of the day, so the fixtures read like a roster. */
function clock(raw: string): number {
  return Number(raw.slice(0, 2)) * 60 + Number(raw.slice(3, 5));
}

/** Minutes of the day → `'HH:mm'`. */
function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function range(start: string, end: string): MinuteRange {
  return MinuteRange.of(clock(start), clock(end));
}

const ALL_WEEKDAYS: readonly Weekday[] = [
  Weekday.Mon,
  Weekday.Tue,
  Weekday.Wed,
  Weekday.Thu,
  Weekday.Fri,
  Weekday.Sat,
  Weekday.Sun,
];

type Segment = {
  readonly start: string;
  readonly end: string;
  readonly locationId: LocationId;
};

/** A roster from `from` on, the same segments on the given weekdays. */
function rosterOf(
  segments: readonly Segment[],
  from = '2026-01-01',
  weekdays: readonly Weekday[] = ALL_WEEKDAYS,
): readonly ScheduleVersion[] {
  const all: ShiftSegment[] = [];
  for (const weekday of weekdays) {
    for (const segment of segments) {
      all.push(
        ShiftSegment.of(
          weekday,
          segment.locationId,
          clock(segment.start),
          clock(segment.end),
        ),
      );
    }
  }
  return ScheduleVersion.startingWith(all, key(from));
}

/** Every weekday, the given shifts at one shop. 2026-07-29 is a Wednesday. */
function scheduleFrom(
  ranges: readonly (readonly [string, string])[],
  from = '2026-01-01',
  at: LocationId = CENTER,
): readonly ScheduleVersion[] {
  return rosterOf(
    ranges.map(([start, end]) => ({ start, end, locationId: at })),
    from,
  );
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error('bad fixture');
  return result.value;
}

const closed = (): ExceptionEffect => ExceptionEffect.closed();
const hours = (...ranges: readonly MinuteRange[]): ExceptionEffect =>
  unwrap(ExceptionEffect.hours(ranges));
const blocked = (...ranges: readonly MinuteRange[]): ExceptionEffect =>
  unwrap(ExceptionEffect.blocked(ranges));

function exception(effect: ExceptionEffect, onDay: string): DayException {
  return { dayKey: key(onDay), effect };
}

/** One shop's published hours for a day, as the per-shop list. */
function shopHours(
  ranges: readonly (readonly [string, string])[],
  at: LocationId = CENTER,
): readonly ShopHours[] {
  return [
    {
      locationId: at,
      hours: ranges.map(([start, end]) =>
        ShopDayHours.of(clock(start), clock(end)),
      ),
    },
  ];
}

function input(
  onDay: string,
  versions: readonly ScheduleVersion[],
  options: {
    readonly exceptions?: readonly DayException[];
    readonly shopHours?: readonly ShopHours[];
  } = {},
): BuildDayWindowsInput {
  return {
    barberId: IVAN,
    dayKey: key(onDay),
    versions,
    exceptions: options.exceptions ?? [],
    shopHours: options.shopHours ?? [],
  };
}

const windowsOf = (i: BuildDayWindowsInput) =>
  RosterSystem.buildDayWindows(i, DAYS);
const carveOutsOf = (i: BuildDayWindowsInput) =>
  RosterSystem.buildDayCarveOuts(i, DAYS);

/** Windows rendered as local HH:mm for readable assertions. */
function asClock(windows: readonly RosterWindow[]): readonly string[] {
  return windows.map((w) => `${hhmm(w.startMinutes)}–${hhmm(w.endMinutes)}`);
}

describe('buildDayWindows — the bookable window', () => {
  it('materialises the pattern in force', () => {
    const windows = windowsOf(
      input('2026-07-29', scheduleFrom([['09:00', '18:00']])),
    );
    expect(asClock(windows)).toEqual(['09:00–18:00']);
    expect(RosterSystem.rosteredMinutes(windows, row('2026-07-29'))).toBe(
      9 * 60,
    );
  });

  it('keeps a split shift split', () => {
    const windows = windowsOf(
      input(
        '2026-07-29',
        scheduleFrom([
          ['09:00', '13:00'],
          ['14:00', '18:00'],
        ]),
      ),
    );
    expect(asClock(windows)).toEqual(['09:00–13:00', '14:00–18:00']);
    expect(RosterSystem.rosteredMinutes(windows, row('2026-07-29'))).toBe(
      8 * 60,
    );
  });

  it('returns nothing before the schedule began, or on an unworked weekday', () => {
    expect(
      windowsOf(input('2025-12-31', scheduleFrom([['09:00', '18:00']]))),
    ).toEqual([]);

    const mondaysOnly = rosterOf(
      [{ start: '09:00', end: '18:00', locationId: CENTER }],
      '2026-01-01',
      [Weekday.Mon],
    );
    // 2026-07-29 is a Wednesday.
    expect(windowsOf(input('2026-07-29', mondaysOnly))).toEqual([]);
  });

  it('carries the locationId (and the barber) on each window, so a two-shop day is attributable', () => {
    const [window] = windowsOf(
      input('2026-07-29', scheduleFrom([['09:00', '18:00']])),
    );
    expect(window?.locationId).toBe('loc-center');
    expect(window?.barberId).toBe('ivan');
  });

  it('reads the weekday from the table row, not a Date', () => {
    // Sunday 2026-08-02 is index 6 of the week — a Mon-first slip would read
    // Saturday's (absent) segments and offer nothing.
    const sundaysOnly = rosterOf(
      [{ start: '10:00', end: '14:00', locationId: CENTER }],
      '2026-01-01',
      [Weekday.Sun],
    );
    expect(asClock(windowsOf(input('2026-08-02', sundaysOnly)))).toEqual([
      '10:00–14:00',
    ]);
    expect(windowsOf(input('2026-08-01', sundaysOnly))).toEqual([]);
  });

  it('fails closed on a day the table does not cover', () => {
    expect(
      windowsOf(input('2027-03-01', scheduleFrom([['09:00', '18:00']]))),
    ).toEqual([]);
    expect(
      carveOutsOf(
        input('2027-03-01', scheduleFrom([['09:00', '18:00']]), {
          exceptions: [
            exception(blocked(range('13:00', '14:00')), '2027-03-01'),
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe('buildDayWindows — ruling R1: shop hours bound the PUBLIC surface', () => {
  it('INTERSECTS the roster with the shop’s published hours', () => {
    // Ivan is rostered 08:00–21:00; the shop opens 09:00–20:00. A client can
    // never be offered a time the door is locked.
    const windows = windowsOf(
      input('2026-07-29', scheduleFrom([['08:00', '21:00']]), {
        shopHours: shopHours([['09:00', '20:00']]),
      }),
    );
    expect(asClock(windows)).toEqual(['09:00–20:00']);
  });

  it('imposes no bound when the shop publishes no hours at all', () => {
    // Absent hours are not a closure — the roster stands as written: no
    // entry, and an entry holding `null`, both mean "no bound".
    expect(
      asClock(
        windowsOf(input('2026-07-29', scheduleFrom([['08:00', '21:00']]))),
      ),
    ).toEqual(['08:00–21:00']);
    expect(
      asClock(
        windowsOf(
          input('2026-07-29', scheduleFrom([['08:00', '21:00']]), {
            shopHours: [{ locationId: CENTER, hours: null }],
          }),
        ),
      ),
    ).toEqual(['08:00–21:00']);
  });

  it('offers NOTHING on a day the shop publishes as closed', () => {
    // Empty hours mean the door is locked, not "unbounded". Reading them as
    // unbounded is how a shop's closed Sunday starts quietly offering
    // whatever a barber's weekly pattern happens to say.
    const windows = windowsOf(
      input('2026-07-29', scheduleFrom([['08:00', '21:00']]), {
        shopHours: [{ locationId: CENTER, hours: [] }],
      }),
    );
    expect(asClock(windows)).toEqual([]);
  });

  it('intersects against a shop that itself closes for lunch', () => {
    const windows = windowsOf(
      input('2026-07-29', scheduleFrom([['09:00', '18:00']]), {
        shopHours: shopHours([
          ['09:00', '13:00'],
          ['14:00', '20:00'],
        ]),
      }),
    );
    expect(asClock(windows)).toEqual(['09:00–13:00', '14:00–18:00']);
  });
});

describe('buildDayWindows — exceptions', () => {
  it('a whole-day absence removes the day entirely', () => {
    // Time off, sick, training and travel all collapse to the public
    // `closed` effect (D16(b)) — the reason never reaches this system.
    expect(
      windowsOf(
        input('2026-07-29', scheduleFrom([['09:00', '18:00']]), {
          exceptions: [exception(closed(), '2026-07-29')],
        }),
      ),
    ).toEqual([]);
  });

  it('a closed effect on the day removes it, whoever it was fanned out to', () => {
    // The legacy case ('a location-wide closure removes the day for every
    // barber', roster-window.spec.ts:259) also asserted `isLocationWide()`
    // and `appliesTo(anyone)`. Under D16(b) that applicability moved to the
    // WRITE-time fan-out: a shop-wide closure is written as one `closed`
    // exception per barber, so a `DayException` carries no barber and this
    // system never filters by one. The two applicability assertions are
    // schedule-exception.system.spec.ts 'applies a shop-wide closure to any
    // barber, as the same closed effect'.
    expect(
      windowsOf(
        input('2026-07-29', scheduleFrom([['09:00', '18:00']]), {
          exceptions: [exception(closed(), '2026-07-29')],
        }),
      ),
    ).toEqual([]);
  });

  it('an `hours` exception REPLACES the pattern for that day', () => {
    const windows = windowsOf(
      input('2026-07-29', scheduleFrom([['09:00', '18:00']]), {
        exceptions: [exception(hours(range('12:00', '16:00')), '2026-07-29')],
      }),
    );
    expect(asClock(windows)).toEqual(['12:00–16:00']);
  });

  it('an `hours` exception keeps the place: it lands on the first segment’s shop', () => {
    const versions = rosterOf([
      { start: '09:00', end: '13:00', locationId: CENTER },
      { start: '14:00', end: '18:00', locationId: MLADOST },
    ]);
    const windows = windowsOf(
      input('2026-07-29', versions, {
        exceptions: [
          exception(
            hours(range('10:00', '12:00'), range('15:00', '17:00')),
            '2026-07-29',
          ),
        ],
      }),
    );
    expect(windows.map((w) => `${asClock([w])[0]} @ ${w.locationId}`)).toEqual([
      '10:00–12:00 @ loc-center',
      '15:00–17:00 @ loc-center',
    ]);
  });

  it('an `hours` exception cannot open a weekday the roster does not work', () => {
    const mondaysOnly = rosterOf(
      [{ start: '09:00', end: '18:00', locationId: CENTER }],
      '2026-01-01',
      [Weekday.Mon],
    );
    expect(
      windowsOf(
        input('2026-07-29', mondaysOnly, {
          exceptions: [exception(hours(range('12:00', '16:00')), '2026-07-29')],
        }),
      ),
    ).toEqual([]);
  });

  it('a break is carved OUT of the roster, splitting the window', () => {
    // Subtracted from the windows rather than merely marked busy, so unpaid
    // time never enters the capacity denominator at all.
    const windows = windowsOf(
      input('2026-07-29', scheduleFrom([['09:00', '18:00']]), {
        exceptions: [exception(blocked(range('13:00', '14:00')), '2026-07-29')],
      }),
    );
    expect(asClock(windows)).toEqual(['09:00–13:00', '14:00–18:00']);
    expect(RosterSystem.rosteredMinutes(windows, row('2026-07-29'))).toBe(
      8 * 60,
    );
  });

  it('an admin block is carved out the same way', () => {
    const windows = windowsOf(
      input('2026-07-29', scheduleFrom([['09:00', '18:00']]), {
        exceptions: [exception(blocked(range('16:00', '18:00')), '2026-07-29')],
      }),
    );
    expect(asClock(windows)).toEqual(['09:00–16:00']);
  });

  it('ignores exceptions for other days', () => {
    const windows = windowsOf(
      input('2026-07-29', scheduleFrom([['09:00', '18:00']]), {
        exceptions: [exception(closed(), '2026-07-30')],
      }),
    );
    expect(asClock(windows)).toEqual(['09:00–18:00']);
  });

  it('rejects a range-bearing exception with no ranges', () => {
    // An empty `hours` would silently mean "closed" — a second way to say one
    // thing is how two code paths start disagreeing.
    expect(ExceptionEffect.hours([]).ok).toBe(false);
    expect(ExceptionEffect.blocked([]).ok).toBe(false);
  });
});

describe('buildDayWindows — DST', () => {
  it('a 23-hour day still materialises correctly', () => {
    const windows = windowsOf(
      input('2026-03-29', scheduleFrom([['09:00', '18:00']])),
    );
    // 09:00–18:00 is entirely after the 03:00 transition, so it is a normal
    // nine hours of real time.
    expect(RosterSystem.rosteredMinutes(windows, row('2026-03-29'))).toBe(
      9 * 60,
    );
    expect(asClock(windows)).toEqual(['09:00–18:00']);
  });

  it('a shift spanning the spring-forward loses the erased hour of REAL time', () => {
    // 02:00–06:00 on the wall clock is only three hours of actual work,
    // because 03:00–03:59 never happens. Utilisation must divide by three.
    const windows = windowsOf(
      input('2026-03-29', scheduleFrom([['02:00', '06:00']])),
    );
    expect(RosterSystem.rosteredMinutes(windows, row('2026-03-29'))).toBe(
      3 * 60,
    );
    expect(asClock(windows)).toEqual(['02:00–06:00']);
  });

  it('a shift spanning the fall-back gains the repeated hour', () => {
    const windows = windowsOf(
      input('2026-10-25', scheduleFrom([['02:00', '06:00']])),
    );
    expect(RosterSystem.rosteredMinutes(windows, row('2026-10-25'))).toBe(
      5 * 60,
    );
    expect(asClock(windows)).toEqual(['02:00–06:00']);
  });

  it('DROPS a rostered range the spring-forward erased entirely, rather than inventing one', () => {
    // 03:15–03:45 does not exist on 2026-03-29. Relocating it would book a
    // client at a time nobody rostered.
    const windows = windowsOf(
      input(
        '2026-03-29',
        scheduleFrom([
          ['03:15', '03:45'],
          ['09:00', '12:00'],
        ]),
      ),
    );
    expect(asClock(windows)).toEqual(['09:00–12:00']);
  });

  it('drops a segment whose boundary the fall-back REPEATS — which 03:30 would it be?', () => {
    // The legacy `onDay` refused an ambiguous wall clock exactly as it
    // refused an erased one; the port keeps that.
    const windows = windowsOf(
      input(
        '2026-10-25',
        scheduleFrom([
          ['03:30', '06:00'],
          ['09:00', '12:00'],
        ]),
      ),
    );
    expect(asClock(windows)).toEqual(['09:00–12:00']);
  });

  it('closes the shop when its opening minute was erased, however the hours were loaded', () => {
    // Hours mapped straight from a stored week (NOT through shopDayHours):
    // open 03:30 on 2026-03-29, a minute that never happens. Snapping it to
    // 04:00 would declare a window edge nobody set; the shop is closed.
    const roster = scheduleFrom([['01:00', '12:00']]);
    expect(
      windowsOf(
        input('2026-03-29', roster, {
          shopHours: shopHours([['03:30', '10:00']]),
        }),
      ),
    ).toEqual([]);
    // …and a repeated closing minute on the fall-back day (03:30 twice).
    expect(
      windowsOf(
        input('2026-10-25', roster, {
          shopHours: shopHours([['01:00', '03:30']]),
        }),
      ),
    ).toEqual([]);
    // A week later the same hours stand.
    expect(
      asClock(
        windowsOf(
          input('2026-04-05', roster, {
            shopHours: shopHours([['03:30', '10:00']]),
          }),
        ),
      ),
    ).toEqual(['03:30–10:00']);
  });

  it('drops a carve-out the transition erased, keeping the worked day whole', () => {
    const windows = windowsOf(
      input('2026-03-29', scheduleFrom([['01:00', '06:00']]), {
        exceptions: [exception(blocked(range('03:00', '03:30')), '2026-03-29')],
      }),
    );
    expect(asClock(windows)).toEqual(['01:00–06:00']);
  });
});

describe('buildDayWindows — a barber who covers TWO shops', () => {
  const twoShops = rosterOf(
    [
      { start: '09:00', end: '13:00', locationId: CENTER },
      { start: '14:00', end: '18:00', locationId: MLADOST },
    ],
    '2026-01-01',
    [Weekday.Mon, Weekday.Tue, Weekday.Wed],
  );

  const tagged = (windows: readonly RosterWindow[]) =>
    windows.map((w) => `${asClock([w])[0]} @ ${w.locationId}`);

  it('splits one day across two shops, each window tagged with its own', () => {
    // The case the old model could not express at all: mornings at Center,
    // afternoons at Mladost.
    expect(tagged(windowsOf(input('2026-07-29', twoShops)))).toEqual([
      '09:00–13:00 @ loc-center',
      '14:00–18:00 @ loc-mladost',
    ]);
  });

  it('clips each segment to ITS OWN shop’s hours, not the other’s', () => {
    // Center runs 09:00–20:00; Mladost opens at 15:00. Clipping the Mladost
    // afternoon against Center's hours is how a client gets offered a time at
    // a locked door.
    const windows = windowsOf(
      input('2026-07-29', twoShops, {
        shopHours: [
          ...shopHours([['09:00', '20:00']], CENTER),
          ...shopHours([['15:00', '19:00']], MLADOST),
        ],
      }),
    );
    expect(tagged(windows)).toEqual([
      '09:00–13:00 @ loc-center',
      '15:00–18:00 @ loc-mladost',
    ]);
  });

  it('yields nothing for a shop that is closed, while the other shop stands', () => {
    const windows = windowsOf(
      input('2026-07-29', twoShops, {
        shopHours: [
          ...shopHours([['09:00', '20:00']], CENTER),
          { locationId: MLADOST, hours: [] },
        ],
      }),
    );
    expect(tagged(windows)).toEqual(['09:00–13:00 @ loc-center']);
  });

  it('orders windows that start together by shop id — deterministic even on a roster the edge guard would refuse', () => {
    // Overlapping segments at two shops cannot be authored
    // (`ShiftSegment.validate`), but a stored document is still answered the
    // same way on every runtime: by start, then shop id in code-unit order.
    const clash = rosterOf([
      { start: '09:00', end: '12:00', locationId: MLADOST },
      { start: '09:00', end: '13:00', locationId: CENTER },
    ]);
    expect(tagged(windowsOf(input('2026-07-29', clash)))).toEqual([
      '09:00–13:00 @ loc-center',
      '09:00–12:00 @ loc-mladost',
    ]);
  });

  it('`windowsAt` narrows to the shop being booked', () => {
    const windows = windowsOf(input('2026-07-29', twoShops));
    expect(asClock(RosterSystem.windowsAt(windows, CENTER))).toEqual([
      '09:00–13:00',
    ]);
  });

  it('REFUSES a roster that cannot physically be worked', () => {
    // Center until 13:00 and Mladost from 13:00 is not a shift, it is a
    // teleport. Refused at authoring rather than silently trimmed: a roster
    // nobody can work is a mistake someone should fix.
    const impossible = ShiftSegment.validate(
      [
        ShiftSegment.of(Weekday.Mon, CENTER, clock('09:00'), clock('13:00')),
        ShiftSegment.of(Weekday.Mon, MLADOST, clock('13:00'), clock('18:00')),
      ],
      30,
    );
    expect(impossible.ok).toBe(false);

    // The SAME shape at one shop is a legal split shift — nobody travels.
    const oneShop = ShiftSegment.validate(
      [
        ShiftSegment.of(Weekday.Mon, CENTER, clock('09:00'), clock('13:00')),
        ShiftSegment.of(Weekday.Mon, CENTER, clock('13:00'), clock('18:00')),
      ],
      30,
    );
    expect(oneShop.ok).toBe(true);
  });

  it('reports every shop a barber covers', () => {
    expect(ScheduleVersion.locations(twoShops)).toEqual([CENTER, MLADOST]);
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
    const blocks = carveOutsOf(
      input('2026-07-29', scheduleFrom([['09:00', '18:00']]), {
        exceptions: [exception(blocked(range('13:00', '14:00')), '2026-07-29')],
      }),
    );
    expect(asClock(blocks)).toEqual(['13:00–14:00']);
    expect(blocks[0]?.locationId).toBe(CENTER);
  });

  // The two views are one subtraction: what is drawn as a block and what is
  // removed from the windows must never be able to disagree.
  it('is exactly the complement of what buildDayWindows kept', () => {
    const day = input('2026-07-29', scheduleFrom([['09:00', '18:00']]), {
      exceptions: [exception(blocked(range('13:00', '14:00')), '2026-07-29')],
    });
    expect(asClock(windowsOf(day))).toEqual(['09:00–13:00', '14:00–18:00']);
    expect(asClock(carveOutsOf(day))).toEqual(['13:00–14:00']);
  });

  /*
   * A block is only drawable where there was something to block. Carving an
   * hour out of a day the barber does not work has removed nothing, and
   * drawing it would lay a solid rectangle over hours the shop was already
   * shut — inventing an event out of a no-op.
   */
  it('draws nothing for a carve-out over unrostered time', () => {
    const blocks = carveOutsOf(
      input('2026-07-29', scheduleFrom([['14:00', '18:00']]), {
        exceptions: [exception(blocked(range('09:00', '10:00')), '2026-07-29')],
      }),
    );
    expect(blocks).toEqual([]);
  });

  it('clips a carve-out that only partly overlaps the shift', () => {
    const blocks = carveOutsOf(
      input('2026-07-29', scheduleFrom([['09:00', '18:00']]), {
        exceptions: [exception(blocked(range('17:30', '19:00')), '2026-07-29')],
      }),
    );
    expect(asClock(blocks)).toEqual(['17:30–18:00']);
  });

  // The shop's envelope bounds a block exactly as it bounds a window — a
  // block outside opening hours is over time that was never worked.
  it('bounds a carve-out by the shop the segment is worked at', () => {
    const blocks = carveOutsOf(
      input('2026-07-29', scheduleFrom([['09:00', '20:00']]), {
        exceptions: [exception(blocked(range('17:00', '19:00')), '2026-07-29')],
        shopHours: shopHours([['09:00', '18:00']]),
      }),
    );
    expect(asClock(blocks)).toEqual(['17:00–18:00']);
  });

  // A whole-day absence took the day; there is no worked time left for a
  // carve-out to sit inside, and a block over a day off is a contradiction.
  it('draws nothing on a day the barber is entirely off', () => {
    const blocks = carveOutsOf(
      input('2026-07-29', scheduleFrom([['09:00', '18:00']]), {
        exceptions: [
          exception(closed(), '2026-07-29'),
          exception(blocked(range('13:00', '14:00')), '2026-07-29'),
        ],
      }),
    );
    expect(blocks).toEqual([]);
  });

  it('has nothing to say about a day with no exception at all', () => {
    expect(
      carveOutsOf(input('2026-07-29', scheduleFrom([['09:00', '18:00']]))),
    ).toEqual([]);
  });

  it('draws the blocks inside an `hours` day, sorted by start', () => {
    const blocks = carveOutsOf(
      input('2026-07-29', scheduleFrom([['09:00', '18:00']]), {
        exceptions: [
          exception(hours(range('10:00', '19:00')), '2026-07-29'),
          exception(
            blocked(range('17:00', '17:30'), range('11:00', '11:15')),
            '2026-07-29',
          ),
        ],
      }),
    );
    expect(asClock(blocks)).toEqual(['11:00–11:15', '17:00–17:30']);
  });
});

describe('versionFor — the roster in force on a date', () => {
  const history = unwrap(
    ScheduleVersion.amend(
      scheduleFrom([['09:00', '18:00']], '2026-01-01'),
      scheduleFrom([['12:00', '20:00']], '2026-01-01')[0]?.segments ?? [],
      key('2026-08-01'),
    ),
  );

  it('answers old days with the old pattern and new days with the amended one', () => {
    expect(RosterSystem.versionFor(history, key('2026-07-31'))?.seq).toBe(0);
    expect(RosterSystem.versionFor(history, key('2026-08-01'))?.seq).toBe(1);
    expect(asClock(windowsOf(input('2026-07-29', history)))).toEqual([
      '09:00–18:00',
    ]);
    expect(asClock(windowsOf(input('2026-08-03', history)))).toEqual([
      '12:00–20:00',
    ]);
  });

  it('is null before the first version began, and for no history at all', () => {
    expect(RosterSystem.versionFor(history, key('2025-12-31'))).toBeNull();
    expect(RosterSystem.versionFor([], key('2026-07-29'))).toBeNull();
  });
});

describe('shopDayHours — a stored week, read for one day', () => {
  /** Mon–Sat 09:00–20:00, Sunday closed — Mon first. */
  const week: readonly DayHours[] = [
    DayHours.open(540, 1200),
    DayHours.open(540, 1200),
    DayHours.open(540, 1200),
    DayHours.open(540, 1200),
    DayHours.open(540, 1200),
    DayHours.open(600, 960),
    DayHours.closed(),
  ];

  it('indexes the Mon-first week by the row’s ISO weekday', () => {
    expect(RosterSystem.shopDayHours(week, row('2026-07-29'))).toEqual([
      ShopDayHours.of(540, 1200),
    ]);
    expect(RosterSystem.shopDayHours(week, row('2026-08-01'))).toEqual([
      ShopDayHours.of(600, 960),
    ]);
  });

  it('is closed — an empty list — on the shop’s closed day', () => {
    expect(RosterSystem.shopDayHours(week, row('2026-08-02'))).toEqual([]);
  });

  it('imposes no bound (null) when the week is not seven days', () => {
    expect(RosterSystem.shopDayHours([], row('2026-07-29'))).toBeNull();
    expect(
      RosterSystem.shopDayHours(week.slice(0, 6), row('2026-07-29')),
    ).toBeNull();
  });

  it('closes rather than guesses when the transition erased the opening minute', () => {
    // 2026-03-29 is a Sunday: open 03:30 that day, which never happens.
    const nightOwl: readonly DayHours[] = [
      ...week.slice(0, 6),
      DayHours.open(210, 600),
    ];
    expect(RosterSystem.shopDayHours(nightOwl, row('2026-03-29'))).toEqual([]);
    expect(RosterSystem.shopDayHours(nightOwl, row('2026-03-22'))).toEqual([
      ShopDayHours.of(210, 600),
    ]);
  });

  it('bounds a roster through buildDayWindows — the closed Sunday offers nothing', () => {
    const sunday = row('2026-08-02');
    const hoursToday = RosterSystem.shopDayHours(week, sunday);
    const windows = windowsOf(
      input('2026-08-02', scheduleFrom([['09:00', '18:00']]), {
        shopHours: [{ locationId: CENTER, hours: hoursToday }],
      }),
    );
    expect(windows).toEqual([]);
  });
});

describe('intervalsOf / resolvedIntervalsOf — minutes to instants over the row', () => {
  const ordinary = row('2026-07-29');
  const spring = row('2026-03-29');
  const autumn = row('2026-10-25');

  it('places a span on the row’s day: dayStart + minutes on an ordinary day', () => {
    expect(
      RosterSystem.intervalsOf([range('09:00', '10:30')], ordinary),
    ).toEqual([
      TimeInterval.of(
        ordinary.dayStartMs + 540 * 60_000,
        ordinary.dayStartMs + 630 * 60_000,
      ),
    ]);
  });

  it('keeps the real length across a transition', () => {
    const [springSpan] = RosterSystem.intervalsOf(
      [range('02:00', '05:00')],
      spring,
    );
    const [autumnSpan] = RosterSystem.intervalsOf(
      [range('02:00', '05:00')],
      autumn,
    );
    expect(TimeInterval.durationMinutes(springSpan as TimeInterval)).toBe(120);
    expect(TimeInterval.durationMinutes(autumnSpan as TimeInterval)).toBe(240);
  });

  it('drops a declared span whose end the spring-forward erased, or the fall-back repeated', () => {
    expect(
      RosterSystem.resolvedIntervalsOf([range('03:00', '03:30')], spring),
    ).toEqual([]);
    expect(
      RosterSystem.resolvedIntervalsOf([range('01:00', '03:30')], autumn),
    ).toEqual([]);
    expect(
      RosterSystem.resolvedIntervalsOf([range('01:00', '04:00')], autumn),
    ).toHaveLength(1);
  });

  it('round-trips a window: minutes → instants → minutes', () => {
    for (const day of [ordinary, spring, autumn]) {
      for (const span of [range('00:00', '02:59'), range('04:00', '23:59')]) {
        const [interval] = RosterSystem.intervalsOf([span], day);
        expect(
          ZonedTimeSystem.minuteOfDay((interval as TimeInterval).startMs, day),
        ).toBe(span.startMinutes);
        expect(
          ZonedTimeSystem.minuteOfDay((interval as TimeInterval).endMs, day),
        ).toBe(span.endMinutes);
      }
    }
  });
});

describe('RosterSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const days = deepFreeze([...DAYS]);
    const fixture = deepFreeze(
      input(
        '2026-07-29',
        rosterOf([
          { start: '09:00', end: '13:00', locationId: CENTER },
          { start: '14:00', end: '18:00', locationId: MLADOST },
        ]),
        {
          exceptions: [
            exception(blocked(range('11:00', '11:30')), '2026-07-29'),
            exception(blocked(range('15:00', '15:15')), '2026-07-29'),
          ],
          shopHours: [
            ...shopHours([['09:00', '20:00']], CENTER),
            ...shopHours([['15:00', '19:00']], MLADOST),
          ],
        },
      ),
    );
    const once = RosterSystem.buildDayWindows(fixture, days);
    const twice = RosterSystem.buildDayWindows(fixture, days);
    expect(twice).toEqual(once);
    expect(RosterSystem.buildDayCarveOuts(fixture, days)).toEqual(
      RosterSystem.buildDayCarveOuts(fixture, days),
    );
    expect(asClock(once)).toEqual([
      '09:00–11:00',
      '11:30–13:00',
      '15:15–18:00',
    ]);
  });
});

describe('RosterSystem — the minute-set model (property)', () => {
  /** A brute-force model of one ordinary day: which minutes are covered. */
  function coverage(spans: readonly MinuteRange[]): boolean[] {
    const covered = new Array<boolean>(1440).fill(false);
    for (const span of spans) {
      covered.fill(true, span.startMinutes, span.endMinutes);
    }
    return covered;
  }

  const anyRange = fc
    .tuple(fc.integer({ min: 0, max: 95 }), fc.integer({ min: 1, max: 24 }))
    .map(([start, length]) =>
      MinuteRange.of(start * 15, Math.min(1440, (start + length) * 15)),
    );

  it('windows = roster ∩ shop hours − blocks, and blocks are exactly what was removed', () => {
    fc.assert(
      fc.property(
        fc.array(anyRange, { minLength: 1, maxLength: 3 }),
        fc.option(fc.array(anyRange, { maxLength: 2 }), { nil: null }),
        fc.array(anyRange, { maxLength: 3 }),
        (segmentsRaw, hoursRaw, blocksRaw) => {
          // A valid roster: disjoint segments (normalized), one shop.
          const segments = MinuteRange.normalize(segmentsRaw);
          const versions = ScheduleVersion.startingWith(
            segments.map((s) =>
              ShiftSegment.of(
                Weekday.Wed,
                CENTER,
                s.startMinutes,
                s.endMinutes,
              ),
            ),
            key('2026-01-01'),
          );
          const shop: readonly ShopHours[] =
            hoursRaw === null
              ? []
              : [
                  {
                    locationId: CENTER,
                    hours: MinuteRange.normalize(hoursRaw).map((h) =>
                      ShopDayHours.of(h.startMinutes, h.endMinutes),
                    ),
                  },
                ];
          const exceptions =
            blocksRaw.length === 0
              ? []
              : [exception(blocked(...blocksRaw), '2026-07-29')];
          const day = input('2026-07-29', versions, {
            exceptions,
            shopHours: shop,
          });

          const roster = coverage(segments);
          const open =
            hoursRaw === null
              ? coverage([MinuteRange.of(0, 1440)])
              : coverage(hoursRaw);
          const cut = coverage(blocksRaw);
          const expectedWindows = roster.map(
            (r, i) => r && open.at(i) === true && cut.at(i) !== true,
          );
          const expectedBlocks = roster.map(
            (r, i) => r && open.at(i) === true && cut.at(i) === true,
          );

          const windows = windowsOf(day);
          const blocks = carveOutsOf(day);
          expect(coverage(windows)).toEqual(expectedWindows);
          expect(coverage(blocks)).toEqual(expectedBlocks);
          // Sorted, non-empty, never overlapping.
          for (let i = 0; i < windows.length; i++) {
            const w = windows.at(i) as RosterWindow;
            expect(w.startMinutes).toBeLessThan(w.endMinutes);
            if (i > 0) {
              expect(w.startMinutes).toBeGreaterThanOrEqual(
                (windows[i - 1] as RosterWindow).endMinutes,
              );
            }
          }
          expect(RosterSystem.rosteredMinutes(windows, row('2026-07-29'))).toBe(
            expectedWindows.filter(Boolean).length,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
