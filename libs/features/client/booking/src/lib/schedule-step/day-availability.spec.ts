import { describe, expect, it } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import type { SchedulingReadPorts } from '@core/ports';
import type {
  BarberBusyDay,
  BarberSchedule,
  ScheduleException,
  ShopLocation,
} from '@core/entities';
import {
  BlockKind,
  type BookingCart,
  BookingPolicy,
  CapacityEntry,
  type ChairTime,
  LocationStatus,
  MinuteBlock,
} from '@core/components';
import {
  BarberId,
  CapacityMonthId,
  CartLineId,
  LocationId,
  MinuteCount,
  Result,
  SeatKeyText,
  ServiceId,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  at,
  barberBusyDayFixture,
  barberScheduleFixture,
  localDate,
  locationFixture,
  memorySchedulingReadPorts,
  scheduleExceptionFixture,
  serviceFixture,
  unwrapOk,
  until,
} from '@core/testing';
import {
  type DayDocs,
  type DayDocsKey,
  type DayQuery,
  barberDays,
  capacityByDay,
  capacityMonthsOf,
  dayDocsKey,
  dayOptions,
  observeCapacityEntries,
  observeDayDocs,
  releaseOn,
  sameDayDocsKey,
} from './day-availability';

/*
 * ONE SHOP DAY'S GRID, FROM ITS RAW DOCUMENTS — the composition the schedule
 * step and its time sheet run in a `computed()` (flip 1, F1-10). The engine
 * itself is `AvailabilitySystem`'s and `BookingCartSystem`'s, pinned by their
 * own specs; what is pinned here is the CALL: which documents a day reads,
 * how they reach the systems (roster windows at the listed shops, busy
 * padded by the turnaround, a move's own chairs handed back first), and the
 * structural identity that keeps a no-op recompute from re-billing a read.
 */

const IVAN = BarberId.of('b-ivan');
const NIKO = BarberId.of('b-niko');
const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');
/** A Tuesday — the fixture roster works it; the day after the pinned "today". */
const TUESDAY = localDate('2026-09-29');

/** The classic cut in the bag for the booker, with anyone. */
const CART: BookingCart = {
  cartSeats: [
    {
      seatKey: SeatKeyText.of('self'),
      lines: [
        {
          lineId: CartLineId.of('line-1'),
          seatKey: SeatKeyText.of('self'),
          serviceId: ServiceId.of('svc-classic-cut'),
          variantId: null,
          barberId: null,
          locationId: null,
        },
      ],
    },
  ],
  cartNextSequence: 1,
};

/** A day question with the fixture catalogue, clock and shop. */
function query(change: Partial<DayQuery> = {}): DayQuery {
  return {
    cart: CART,
    services: [serviceFixture()],
    barberIds: [IVAN],
    locationId: null,
    localDate: TUESDAY,
    policy: BookingPolicy.DEFAULT,
    now: FIXTURE_NOW,
    riders: [],
    release: [],
    releaseLocalDate: null,
    shops: [locationFixture()],
    ...change,
  };
}

/** The day's documents: Ivan's roster (Mon–Fri 09:00–18:00 at the Centre) and, optionally, his busy day and exception. */
function docs(
  day: {
    readonly schedule?: BarberSchedule | null;
    readonly busy?: BarberBusyDay | null;
    readonly exception?: ScheduleException | null;
    readonly namedLocation?: ShopLocation | null;
    readonly key?: DayDocsKey;
  } = {},
): DayDocs {
  return {
    key: day.key ?? dayDocsKey(query()),
    barbers: [
      {
        barberId: IVAN,
        schedule:
          day.schedule === undefined ? barberScheduleFixture() : day.schedule,
        busy: day.busy ?? null,
        exception: day.exception ?? null,
      },
    ],
    namedLocation: day.namedLocation ?? null,
  };
}

/** Ivan's busy day on TUESDAY with these blocks. */
function busyOn(...blocks: readonly [number, number][]): BarberBusyDay {
  return barberBusyDayFixture({
    localDate: TUESDAY,
    utcEpochMs: ZonedTimeSystem.startOfLocalDay(TUESDAY, FIXTURE_TIME_ZONE),
    blocks: blocks.map(([start, end]) =>
      MinuteBlock.of(at(0, start), until(0, end), BlockKind.Busy),
    ),
  });
}

/** A held chair of a moved visit, as the draft keeps it: minutes of its shop day. */
function heldChair(
  startMinutes: number,
  endMinutes: number,
  barberId: BarberId = IVAN,
): ChairTime {
  return {
    barberId,
    startMinutes: at(0, startMinutes),
    endMinutes: until(0, endMinutes),
  };
}

/** A move whose visit holds `chairs` on the shop day `day`. */
function moving(
  day: string,
  chairs: readonly ChairTime[],
  change: Partial<DayQuery> = {},
): DayQuery {
  return query({
    release: chairs,
    releaseLocalDate: localDate(day),
    ...change,
  });
}

/** The distinct party starts of a day's options, in order. */
function starts(q: DayQuery, d: DayDocs): readonly number[] {
  return dayOptions(q, d).map((entry) => entry.option.startMinutes);
}

describe('dayOptions — one shop day, derived from its documents by the systems', () => {
  it('offers every step of a rostered barber’s free day, from the day’s first minute', () => {
    const offered = starts(query(), docs());

    // 09:00 to the last 30-minute cut that ends by 18:00, every 15 minutes.
    expect(offered[0]).toBe(9 * 60);
    expect(offered.at(-1)).toBe(17 * 60 + 30);
    expect(offered).toHaveLength(35);
  });

  it('floors today at now plus the lead time — never a start that is already too soon', () => {
    const today = query({ localDate: FIXTURE_TODAY });
    // FIXTURE_NOW is 09:00; the default lead is two hours.
    expect(starts(today, docs({ key: dayDocsKey(today) }))[0]).toBe(11 * 60);
  });

  it('keeps out what is taken', () => {
    const offered = starts(query(), docs({ busy: busyOn([600, 630]) }));

    expect(offered).toContain(9 * 60 + 30);
    expect(offered).not.toContain(9 * 60 + 45);
    expect(offered).not.toContain(10 * 60);
    expect(offered).not.toContain(10 * 60 + 15);
    expect(offered).toContain(10 * 60 + 30);
  });

  it('pads what is taken by the barber’s turnaround — the one rule the commit checks', () => {
    const turnaround = barberScheduleFixture({
      turnaroundMinutes: unwrapOk(MinuteCount.of(15)),
    });
    const offered = starts(
      query(),
      docs({ schedule: turnaround, busy: busyOn([600, 630]) }),
    );

    // 10:00–10:30 is held 09:45–10:45: a cut must end by 09:45 and may start at 10:45.
    expect(offered).toContain(9 * 60 + 15);
    expect(offered).not.toContain(9 * 60 + 30);
    expect(offered).not.toContain(10 * 60 + 30);
    expect(offered).toContain(10 * 60 + 45);
  });

  it('hands a moved visit’s own chairs back before anything is placed', () => {
    const move = moving('2026-09-29', [heldChair(600, 630)]);
    const offered = starts(
      move,
      docs({ key: dayDocsKey(move), busy: busyOn([600, 630]) }),
    );

    expect(offered).toContain(10 * 60);
    expect(offered).toContain(10 * 60 + 15);
  });

  it('hands back nothing a chair of another day holds', () => {
    const move = moving('2026-09-30', [heldChair(600, 630)]);
    expect(
      starts(move, docs({ key: dayDocsKey(move), busy: busyOn([600, 630]) })),
    ).not.toContain(10 * 60);
  });

  it('offers nothing on a day the exception closes, and nothing without a roster', () => {
    expect(
      starts(
        query(),
        docs({ exception: scheduleExceptionFixture({ localDate: TUESDAY }) }),
      ),
    ).toEqual([]);
    expect(starts(query(), docs({ schedule: null }))).toEqual([]);
  });

  it('clamps every segment to its shop’s hours, and offers nothing at a shop that is not listed', () => {
    const hidden = locationFixture({ locationStatus: LocationStatus.Hidden });
    expect(starts(query({ shops: [hidden] }), docs())).toEqual([]);
    expect(starts(query({ shops: [] }), docs())).toEqual([]);
  });

  it('offers a MOVE its own shop, listed or not — still clamped to that shop’s hours', () => {
    const hidden = locationFixture({ locationStatus: LocationStatus.Hidden });
    const move = moving('2026-09-29', [heldChair(600, 630)], {
      locationId: CENTER,
      shops: [],
    });
    const key = dayDocsKey(move);
    expect(key.namedLocationId).toBe(CENTER);

    const offered = starts(move, docs({ key, namedLocation: hidden }));
    expect(offered[0]).toBe(9 * 60);
    expect(offered.at(-1)).toBe(17 * 60 + 30);
  });

  it('names each option’s own shop under “any shop”, and narrows to the chosen one', () => {
    const shops = [
      locationFixture(),
      locationFixture({ id: MLADOST, name: { en: 'Mladost', bg: 'Младост' } }),
    ];
    const anywhere = dayOptions(query({ shops }), docs());
    expect(new Set(anywhere.map((entry) => entry.locationId))).toEqual(
      new Set([CENTER]),
    );

    // Ivan works only the Centre: chosen Mladost has no window for him.
    expect(dayOptions(query({ shops, locationId: MLADOST }), docs())).toEqual(
      [],
    );
  });

  it('runs no shop that does not offer the service', () => {
    const elsewhere = serviceFixture({ locationIds: [MLADOST] });
    expect(starts(query({ services: [elsewhere] }), docs())).toEqual([]);
  });

  it('builds each barber’s day only from a roster at an offered shop', () => {
    expect(barberDays(query(), docs())).toHaveLength(1);
    expect(barberDays(query({ shops: [] }), docs())).toEqual([]);
  });
});

describe('releaseOn — a held chair on the shop’s wall clock', () => {
  it('hands back the chairs of the visit’s own day, as they are, and nothing on another day', () => {
    const chairs = [heldChair(600, 645), heldChair(600, 645, NIKO)];
    expect(releaseOn(chairs, TUESDAY, TUESDAY)).toEqual([
      { barberId: IVAN, startMinutes: 600, endMinutes: 645 },
      { barberId: NIKO, startMinutes: 600, endMinutes: 645 },
    ]);
    expect(releaseOn(chairs, TUESDAY, localDate('2026-09-30'))).toEqual([]);
  });

  it('keeps a chair ending at the closing midnight whole', () => {
    expect(
      releaseOn([heldChair(23 * 60 + 30, 24 * 60)], TUESDAY, TUESDAY),
    ).toEqual([
      { barberId: IVAN, startMinutes: 23 * 60 + 30, endMinutes: 1440 },
    ]);
  });

  it('hands back nothing on a new booking — no visit, no day', () => {
    expect(releaseOn([], null, TUESDAY)).toEqual([]);
  });
});

// The structural identity that keeps a no-op recompute from re-billing a
// day's read (it moved here from `same-day-query.ts`). A day's listeners
// depend only on WHICH documents it reads — the day, the barbers, a move's
// named shop — so that is the key compared; every other field of the
// question re-derives the grid in the `computed()` without a new listener.
describe('sameDayDocsKey — one structural identity for every day read', () => {
  const key = (change: Partial<DayQuery> = {}) => dayDocsKey(query(change));

  /** For every field of the key, a question that reads different documents. */
  const DIFFERENT: Record<keyof DayDocsKey, Partial<DayQuery>> = {
    localDate: { localDate: localDate('2026-09-30') },
    barberIds: { barberIds: [IVAN, NIKO] },
    namedLocationId: {
      locationId: CENTER,
      release: [heldChair(600, 630)],
      releaseLocalDate: TUESDAY,
    },
  };

  it('holds two fresh keys asking for the same documents equal', () => {
    expect(sameDayDocsKey(key(), key())).toBe(true);
  });

  it.each(Object.entries(DIFFERENT))(
    'tells a key apart by `%s` — no field of the key is ignored',
    (_field, change) => {
      expect(sameDayDocsKey(key(), key(change))).toBe(false);
    },
  );

  it('asks nothing new of a pool listed by fresh ids, in either order', () => {
    expect(
      sameDayDocsKey(
        key({ barberIds: [IVAN, NIKO] }),
        key({ barberIds: [BarberId.of('b-niko'), BarberId.of('b-ivan')] }),
      ),
    ).toBe(true);
  });

  it('reads a shop by id only for a move — a chosen shop alone reads nothing more', () => {
    expect(key({ locationId: CENTER }).namedLocationId).toBeNull();
    expect(sameDayDocsKey(key(), key({ locationId: CENTER }))).toBe(true);
  });

  it('equals `null` only to `null`, so readiness always passes', () => {
    expect(sameDayDocsKey(null, null)).toBe(true);
    expect(sameDayDocsKey(null, key())).toBe(false);
    expect(sameDayDocsKey(key(), null)).toBe(false);
  });
});

/**
 * The scheduling double over these rosters, with the reads of a shop by id
 * counted and, when asked, one barber's roster read failing — the one
 * member a spec wraps.
 */
function ports(
  state: {
    readonly schedules?: readonly BarberSchedule[];
    readonly locations?: readonly ShopLocation[];
    readonly failing?: BarberId;
  } = {},
): SchedulingReadPorts & { readonly locationReads: () => number } {
  const base = memorySchedulingReadPorts({
    schedules: state.schedules ?? [],
    locations: state.locations ?? [],
  });
  let locationReads = 0;
  return {
    ...base,
    observeSchedule: (barberId) =>
      barberId === state.failing
        ? of(Result.err(RepositoryError.unavailable()))
        : base.observeSchedule(barberId),
    observeLocation: (locationId) => {
      locationReads += 1;
      return base.observeLocation(locationId);
    },
    locationReads: () => locationReads,
  };
}

describe('observeDayDocs — which documents a day reads', () => {
  it('reads every barber’s roster, busy day and exception, in the key’s order', async () => {
    const read = await firstValueFrom(
      observeDayDocs(
        ports({ schedules: [barberScheduleFixture()] }),
        key([NIKO, IVAN]),
      ),
    );

    expect(
      read.ok && read.value.barbers.map((barber) => barber.barberId),
    ).toEqual([IVAN, NIKO]);
    expect(read.ok && read.value.barbers[1]?.schedule).toBeNull();
  });

  it('fails the whole day when one barber’s read fails — never a grid that hides someone', async () => {
    const read = await firstValueFrom(
      observeDayDocs(
        ports({ schedules: [barberScheduleFixture()], failing: NIKO }),
        key([IVAN, NIKO]),
      ),
    );

    expect(read.ok).toBe(false);
  });

  it('answers an empty day for no barber, and reads a shop only when the key names one', async () => {
    const reads = ports();
    const read = await firstValueFrom(observeDayDocs(reads, key([])));

    expect(read.ok && read.value.barbers).toEqual([]);
    expect(reads.locationReads()).toBe(0);

    await firstValueFrom(
      observeDayDocs(reads, { ...key([IVAN]), namedLocationId: CENTER }),
    );
    expect(reads.locationReads()).toBe(1);
  });

  function key(barberIds: readonly BarberId[]): DayDocsKey {
    return dayDocsKey(query({ barberIds }));
  }
});

describe('the calendar’s capacity markers', () => {
  const OCTOBER = localDate('2026-10-01');
  const free = (minutes: number) => unwrapOk(MinuteCount.of(minutes));
  const ENTRIES = [
    CapacityEntry.of(OCTOBER, IVAN, CENTER, free(120)),
    CapacityEntry.of(OCTOBER, NIKO, CENTER, free(60)),
    CapacityEntry.of(OCTOBER, IVAN, MLADOST, free(30)),
  ];

  it('sums the free minutes of the barbers asked about, at the one shop asked about', () => {
    const second = localDate('2026-10-02');
    expect(capacityByDay(ENTRIES, OCTOBER, second, [IVAN], CENTER)).toEqual(
      new Map([
        [OCTOBER, 120],
        [second, 0],
      ]),
    );
    expect(
      capacityByDay(ENTRIES, OCTOBER, OCTOBER, [IVAN, NIKO], null),
    ).toEqual(new Map([[OCTOBER, 210]]));
  });

  it('reads each month of the run once', () => {
    expect(
      capacityMonthsOf(localDate('2026-09-29'), localDate('2026-11-02')),
    ).toEqual([
      CapacityMonthId.of('2026-09'),
      CapacityMonthId.of('2026-10'),
      CapacityMonthId.of('2026-11'),
    ]);
  });

  it('collects the months’ entries, a month never rebuilt holding none', async () => {
    const october = CapacityMonthId.of('2026-10');
    const read = await firstValueFrom(
      observeCapacityEntries(
        memorySchedulingReadPorts({
          capacityMonths: [{ id: october, month: october, entries: ENTRIES }],
        }),
        [CapacityMonthId.of('2026-09'), october],
      ),
    );

    expect(read.ok && read.value).toEqual(ENTRIES);
  });
});
