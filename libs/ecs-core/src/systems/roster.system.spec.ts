import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ExceptionEffectRule,
  MinuteRange,
  DayHours,
  type RosterWindow,
  ShopDayHours,
  ScheduleVersion,
  ShiftSegment,
} from '@core/components';
import { TimeErrorCode, Weekday, BarberId, LocationId } from '@core/primitives';
import {
  type BuildDayWindowsInput,
  type DayException,
  RosterSystem,
  type ShopHours,
} from './roster.system';
import { ZonedTimeSystem } from './zoned-time.system';
import {
  deepFreeze,
  endMinute,
  FIXTURE_TIME_ZONE,
  localDate,
  minute,
  unwrapErr,
  unwrapOk,
  minuteCount,
} from '@core/testing';

/*
 * The cases of libs/domain/scheduling/src/lib/roster-window.spec.ts, copied
 * over plain arrays on the shop's wall clock (the class spec stays in place
 * and runs against its shim), plus version selection, shop hours from a
 * stored week, DST days (immune by construction: no zone reaches the
 * roster, flatten-spec T1), purity and a brute-force minute-set property.
 */

const key = (raw: string) => localDate(raw);

const IVAN = BarberId.of('ivan');
const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');

/** `'HH:mm'` → minutes of the day, so the fixtures read like a roster. */
function clock(raw: string): number {
  return Number(raw.slice(0, 2)) * 60 + Number(raw.slice(3, 5));
}

/** `'HH:mm'` as a wall-clock start / exclusive end. */
const at = (raw: string) => minute(clock(raw));
const until = (raw: string) => endMinute(clock(raw));

/** Minutes of the day → `'HH:mm'`. */
function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function range(start: string, end: string): MinuteRange {
  return MinuteRange.of(minute(clock(start)), endMinute(clock(end)));
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
          minute(clock(segment.start)),
          endMinute(clock(segment.end)),
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

const closed = (): ExceptionEffectRule => ExceptionEffectRule.closed();
const hours = (...ranges: readonly MinuteRange[]): ExceptionEffectRule =>
  unwrap(ExceptionEffectRule.hours(ranges));
const blocked = (...ranges: readonly MinuteRange[]): ExceptionEffectRule =>
  unwrap(ExceptionEffectRule.blocked(ranges));

function exception(effect: ExceptionEffectRule, onDay: string): DayException {
  return { localDate: key(onDay), ...effect };
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
        ShopDayHours.of(minute(clock(start)), endMinute(clock(end))),
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
    localDate: key(onDay),
    versions,
    exceptions: options.exceptions ?? [],
    shopHours: options.shopHours ?? [],
  };
}

const windowsOf = (i: BuildDayWindowsInput) => RosterSystem.buildDayWindows(i);
const carveOutsOf = (i: BuildDayWindowsInput) =>
  RosterSystem.buildDayCarveOuts(i);

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
    expect(RosterSystem.rosteredMinutes(windows)).toBe(9 * 60);
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
    expect(RosterSystem.rosteredMinutes(windows)).toBe(8 * 60);
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

  it('reads the weekday from the LocalDate, not a Date', () => {
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

  it('answers any day from the roster alone — there is no zone table to fall outside', () => {
    // The legacy table covered a window of days and failed closed outside
    // it; on the wall clock every LocalDate is a day the roster can answer.
    expect(
      asClock(
        windowsOf(input('2027-03-01', scheduleFrom([['09:00', '18:00']]))),
      ),
    ).toEqual(['09:00–18:00']);
    expect(
      asClock(
        carveOutsOf(
          input('2027-03-01', scheduleFrom([['09:00', '18:00']]), {
            exceptions: [
              exception(blocked(range('13:00', '14:00')), '2027-03-01'),
            ],
          }),
        ),
      ),
    ).toEqual(['13:00–14:00']);
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
    expect(RosterSystem.rosteredMinutes(windows)).toBe(8 * 60);
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
    expect(ExceptionEffectRule.hours([]).ok).toBe(false);
    expect(ExceptionEffectRule.blocked([]).ok).toBe(false);
  });
});

describe('buildDayWindows — DST days are ordinary on the wall clock (T1)', () => {
  /*
   * The roster never sees a zone (Law 7.3): a shift is "09:00–18:00 on the
   * shop's clock" and stays that on the two transition days. Whether a
   * wall-clock minute exists as an instant is asked ONCE, at the ingestion
   * boundary (`ZonedTimeSystem.toUtc` refuses a spring-forward gap time with
   * `DST_GAP_INVALID_TIME` and resolves a fall-back repeat to the earlier
   * offset — see the boundary block below). The legacy instant model
   * measured these days in real time and dropped erased or repeated
   * boundaries; each case below keeps its scenario and pins the wall-clock
   * answer (the shop is closed between 03:00 and 04:00, so no product
   * figure moves).
   */
  it('a 23-hour day still materialises correctly', () => {
    const windows = windowsOf(
      input('2026-03-29', scheduleFrom([['09:00', '18:00']])),
    );
    // 09:00–18:00 is entirely after the 03:00 transition: nine hours.
    expect(RosterSystem.rosteredMinutes(windows)).toBe(9 * 60);
    expect(asClock(windows)).toEqual(['09:00–18:00']);
  });

  it('a shift spanning the spring-forward is counted on the wall clock', () => {
    // 02:00–06:00 on the wall clock is four rostered hours; the elapsed
    // three are the boundary's arithmetic (02:00 → 06:00 via toUtc).
    const windows = windowsOf(
      input('2026-03-29', scheduleFrom([['02:00', '06:00']])),
    );
    expect(RosterSystem.rosteredMinutes(windows)).toBe(4 * 60);
    expect(asClock(windows)).toEqual(['02:00–06:00']);
  });

  it('a shift spanning the fall-back is counted on the wall clock', () => {
    const windows = windowsOf(
      input('2026-10-25', scheduleFrom([['02:00', '06:00']])),
    );
    expect(RosterSystem.rosteredMinutes(windows)).toBe(4 * 60);
    expect(asClock(windows)).toEqual(['02:00–06:00']);
  });

  it('keeps a rostered range inside the spring-forward gap on the wall clock, inventing nothing', () => {
    // 03:15–03:45 never happens on 2026-03-29 in Sofia. The roster neither
    // relocates nor drops it: the shop's clock says what was rostered, and a
    // booking at 03:15 is refused where it becomes an instant.
    const windows = windowsOf(
      input(
        '2026-03-29',
        scheduleFrom([
          ['03:15', '03:45'],
          ['09:00', '12:00'],
        ]),
      ),
    );
    expect(asClock(windows)).toEqual(['03:15–03:45', '09:00–12:00']);
  });

  it('keeps a segment whose boundary the fall-back repeats — 03:30 is one wall-clock minute', () => {
    const windows = windowsOf(
      input(
        '2026-10-25',
        scheduleFrom([
          ['03:30', '06:00'],
          ['09:00', '12:00'],
        ]),
      ),
    );
    expect(asClock(windows)).toEqual(['03:30–06:00', '09:00–12:00']);
  });

  it('bounds by the published hours on a transition day exactly as on any other', () => {
    // Open 03:30 on 2026-03-29 (a minute that never happens), closing 03:30
    // on the fall-back day (a minute that happens twice), and a week later:
    // three days, one rule — roster ∩ hours on the wall clock.
    const roster = scheduleFrom([['01:00', '12:00']]);
    expect(
      asClock(
        windowsOf(
          input('2026-03-29', roster, {
            shopHours: shopHours([['03:30', '10:00']]),
          }),
        ),
      ),
    ).toEqual(['03:30–10:00']);
    expect(
      asClock(
        windowsOf(
          input('2026-10-25', roster, {
            shopHours: shopHours([['01:00', '03:30']]),
          }),
        ),
      ),
    ).toEqual(['01:00–03:30']);
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

  it('carves a break out of a transition day on the wall clock', () => {
    const windows = windowsOf(
      input('2026-03-29', scheduleFrom([['01:00', '06:00']]), {
        exceptions: [exception(blocked(range('03:00', '03:30')), '2026-03-29')],
      }),
    );
    expect(asClock(windows)).toEqual(['01:00–03:00', '03:30–06:00']);
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
        ShiftSegment.of(Weekday.Mon, CENTER, at('09:00'), until('13:00')),
        ShiftSegment.of(Weekday.Mon, MLADOST, at('13:00'), until('18:00')),
      ],
      minuteCount(30),
    );
    expect(impossible.ok).toBe(false);

    // The SAME shape at one shop is a legal split shift — nobody travels.
    const oneShop = ShiftSegment.validate(
      [
        ShiftSegment.of(Weekday.Mon, CENTER, at('09:00'), until('13:00')),
        ShiftSegment.of(Weekday.Mon, CENTER, at('13:00'), until('18:00')),
      ],
      minuteCount(30),
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
    DayHours.open(minute(540), endMinute(1200)),
    DayHours.open(minute(540), endMinute(1200)),
    DayHours.open(minute(540), endMinute(1200)),
    DayHours.open(minute(540), endMinute(1200)),
    DayHours.open(minute(540), endMinute(1200)),
    DayHours.open(minute(600), endMinute(960)),
    DayHours.closed(),
  ];

  it('indexes the Mon-first week by the day’s ISO weekday', () => {
    expect(RosterSystem.shopDayHours(week, key('2026-07-29'))).toEqual([
      ShopDayHours.of(minute(540), endMinute(1200)),
    ]);
    expect(RosterSystem.shopDayHours(week, key('2026-08-01'))).toEqual([
      ShopDayHours.of(minute(600), endMinute(960)),
    ]);
  });

  it('is closed — an empty list — on the shop’s closed day', () => {
    expect(RosterSystem.shopDayHours(week, key('2026-08-02'))).toEqual([]);
  });

  it('imposes no bound (null) when the week is not seven days', () => {
    expect(RosterSystem.shopDayHours([], key('2026-07-29'))).toBeNull();
    expect(
      RosterSystem.shopDayHours(week.slice(0, 6), key('2026-07-29')),
    ).toBeNull();
  });

  it('reads the stored minutes as they are on a DST day — the gap is the boundary’s to refuse', () => {
    // 2026-03-29 is a Sunday whose 03:30 never happens in Sofia. On the
    // shop's wall clock the published hours are still 03:30–10:00, exactly
    // as on any other Sunday; turning that opening into an instant is the
    // ingestion boundary's job (`ZonedTimeSystem.toUtc` →
    // `DST_GAP_INVALID_TIME`), never the roster's.
    const nightOwl: readonly DayHours[] = [
      ...week.slice(0, 6),
      DayHours.open(minute(210), endMinute(600)),
    ];
    expect(RosterSystem.shopDayHours(nightOwl, key('2026-03-29'))).toEqual([
      ShopDayHours.of(minute(210), endMinute(600)),
    ]);
    expect(RosterSystem.shopDayHours(nightOwl, key('2026-03-22'))).toEqual([
      ShopDayHours.of(minute(210), endMinute(600)),
    ]);
  });

  it('bounds a roster through buildDayWindows — the closed Sunday offers nothing', () => {
    const sunday = key('2026-08-02');
    const hoursToday = RosterSystem.shopDayHours(week, sunday);
    const windows = windowsOf(
      input('2026-08-02', scheduleFrom([['09:00', '18:00']]), {
        shopHours: [{ locationId: CENTER, hours: hoursToday }],
      }),
    );
    expect(windows).toEqual([]);
  });
});

/*
 * `intervalsOf` / `resolvedIntervalsOf` are deleted (flatten-spec §2.4:
 * windows ARE minute ranges). Their four cases move to the successor — the
 * ingestion boundary that turns a window's minutes into instants with the
 * location's zone (`ZonedTimeSystem.toUtc` / `toLocal`), on the same days.
 */
describe('a window becomes instants only at the boundary — ZonedTimeSystem', () => {
  const ordinary = key('2026-07-29');
  const spring = key('2026-03-29');
  const autumn = key('2026-10-25');
  const instant = (day: typeof ordinary, raw: string) =>
    unwrapOk(ZonedTimeSystem.toUtc(day, minute(clock(raw)), FIXTURE_TIME_ZONE));

  it('places a span on its day: the day’s first instant + minutes on an ordinary day', () => {
    const start = ZonedTimeSystem.startOfLocalDay(ordinary, FIXTURE_TIME_ZONE);
    expect(instant(ordinary, '09:00')).toBe(start + 540 * 60_000);
    expect(instant(ordinary, '10:30')).toBe(start + 630 * 60_000);
  });

  it('keeps the real length across a transition', () => {
    expect((instant(spring, '05:00') - instant(spring, '02:00')) / 60_000).toBe(
      120,
    );
    expect((instant(autumn, '05:00') - instant(autumn, '02:00')) / 60_000).toBe(
      240,
    );
  });

  it('refuses a declared minute the spring-forward erased; resolves a repeated one to the earlier offset', () => {
    expect(
      unwrapErr(
        ZonedTimeSystem.toUtc(
          spring,
          minute(clock('03:30')),
          FIXTURE_TIME_ZONE,
        ),
      ).errorCode,
    ).toBe(TimeErrorCode.DstGap);
    // 03:30 happens twice on the fall-back day: the earlier offset (EEST,
    // UTC+3) wins, so it lands an hour before the second 03:30.
    expect(instant(autumn, '03:30')).toBe(
      instant(autumn, '04:00') - 90 * 60_000,
    );
  });

  it('round-trips a window: minutes → instants → minutes', () => {
    for (const day of [ordinary, spring, autumn]) {
      for (const [from, to] of [
        ['00:00', '02:59'],
        ['04:00', '23:59'],
      ] as const) {
        for (const raw of [from, to]) {
          expect(
            ZonedTimeSystem.toLocal(instant(day, raw), FIXTURE_TIME_ZONE),
          ).toEqual({ localDate: day, minute: clock(raw) });
        }
      }
    }
  });
});

describe('RosterSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
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
    const once = RosterSystem.buildDayWindows(fixture);
    const twice = RosterSystem.buildDayWindows(fixture);
    expect(twice).toEqual(once);
    expect(RosterSystem.buildDayCarveOuts(fixture)).toEqual(
      RosterSystem.buildDayCarveOuts(fixture),
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
      MinuteRange.of(
        minute(start * 15),
        endMinute(Math.min(1440, (start + length) * 15)),
      ),
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
                minute(s.startMinutes),
                endMinute(s.endMinutes),
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
                      ShopDayHours.of(
                        minute(h.startMinutes),
                        endMinute(h.endMinutes),
                      ),
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
              ? coverage([MinuteRange.of(minute(0), endMinute(1440))])
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
          expect(RosterSystem.rosteredMinutes(windows)).toBe(
            expectedWindows.filter(Boolean).length,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
