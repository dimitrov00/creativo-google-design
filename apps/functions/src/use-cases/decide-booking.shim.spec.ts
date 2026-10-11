import { describe, expect, it } from 'vitest';
import { Result, ZonedDateTime } from '@creativo/domain/kernel';
import { Service } from '@creativo/domain/catalog';
import {
  BookingPolicy,
  CalendarDay,
  Interval,
  StaffScheduleHistory,
  WeeklyPattern,
} from '@creativo/domain/scheduling';
import {
  type BookingSnapshot,
  type RequestedSeat,
  type StaffTermsOverride,
  decideBooking,
} from './decide-booking';

/*
 * The Phase 2 shim's own fidelity cases: what the legacy `decideBooking`
 * wrote that the ecs-core structs alone cannot carry back, pinned against
 * the shim (decide-booking.spec.ts keeps its cases unchanged). Both were
 * found by a differential run of the legacy decision against the shim.
 */

const ZONE = 'Europe/Sofia';
const OWNER = 'user-1';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** 2026-08-03 is a Monday in Sofia — the fixture roster works Mondays. */
function at(hour: number): ZonedDateTime {
  return unwrap(
    ZonedDateTime.fromParts(
      { year: 2026, month: 8, day: 3, hour, minute: 0 },
      ZONE,
    ),
  );
}

const OPEN = { kind: 'open' as const, opens: '09:00', closes: '20:00' };

/** Ivan's fade: 45,00 € / 30 min, 10 minutes of cleanup. */
function fadeService(): Service {
  return unwrap(
    Service.create({
      id: 'svc-fade',
      name: { bg: 'Фейд', en: 'Fade' },
      description: { bg: '—', en: '—' },
      categoryId: 'cat-hair',
      priceMinorUnits: 4000,
      currencyCode: 'EUR',
      durationMinutes: 60,
      locationIds: ['loc-center'],
      conflictsWith: [],
      variants: [],
      offerings: [
        {
          barberId: 'ivan',
          base: {
            priceMinorUnits: 4500,
            currencyCode: 'EUR',
            durationMinutes: 30,
            cleanupMinutes: 10,
          },
        },
      ],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      status: 'active',
      sortOrder: 1,
    }),
  );
}

function snapshot(): BookingSnapshot {
  const day = [{ start: '09:00', end: '18:00', locationId: 'loc-center' }];
  const pattern = unwrap(WeeklyPattern.create({ byWeekday: { monday: day } }));
  return {
    zone: ZONE,
    shopHours: [OPEN, OPEN, OPEN, OPEN, OPEN, OPEN, { kind: 'closed' }],
    services: [fadeService()],
    schedules: new Map([
      [
        'ivan',
        {
          history: StaffScheduleHistory.startingWith(
            pattern,
            unwrap(CalendarDay.create('2026-01-01', ZONE)),
          ),
          turnaroundMinutes: 0,
        },
      ],
    ]),
    busy: new Map(),
    exceptions: new Map(),
  };
}

const SEAT: RequestedSeat = {
  lineId: 'line-1',
  serviceId: 'svc-fade',
  variantId: null,
  barberId: 'ivan',
  startIso: at(12).toISO(),
  subject: { kind: 'self' },
};

/** A staff edit: the seat's stored terms carried as an override. */
function carry(override: StaffTermsOverride) {
  let counter = 0;
  return decideBooking(
    { locationId: 'loc-center', seats: [SEAT] },
    snapshot(),
    {
      now: at(8),
      policy: BookingPolicy.default(),
      nextId: () => `id-${counter++}`,
      ownerUserId: OWNER,
      allowOutsideWindow: true,
      termsOverrides: new Map([['line-1', override]]),
    },
  );
}

describe('decideBooking shim — carried terms rebuild as the legacy decision wrote them', () => {
  it('keeps the catalogue row, with ITS pads, as provenance when an override changes only cleanup', () => {
    const decision = unwrap(carry({ cleanupMinutes: 0 }));
    const [seat] = decision.appointment.seats;

    expect(seat?.terms.cleanupMinutes).toBe(0);
    expect(seat?.overridden()).toBe(true);
    expect(seat?.catalogTerms?.price.toMinorUnits()).toBe(4500);
    expect(seat?.catalogTerms?.durationMinutes).toBe(30);
    expect(seat?.catalogTerms?.cleanupMinutes).toBe(10);
  });

  it('records no provenance when the carried terms equal the catalogue', () => {
    const decision = unwrap(
      carry({
        priceMinorUnits: 4500,
        currencyCode: 'EUR',
        durationMinutes: 30,
        setupMinutes: 0,
        cleanupMinutes: 10,
      }),
    );
    expect(decision.appointment.seats[0]?.catalogTerms).toBeNull();
  });

  it('accepts a staff edit of a visit priced in leva, as the legacy kernel did', () => {
    const decision = unwrap(
      carry({
        priceMinorUnits: 3000,
        currencyCode: 'BGN',
        durationMinutes: 30,
        setupMinutes: 0,
        cleanupMinutes: 10,
      }),
    );
    const [seat] = decision.appointment.seats;

    expect(seat?.terms.price.toMinorUnits()).toBe(3000);
    expect(seat?.terms.price.currencyCode()).toBe('BGN');
  });
});

/*
 * A DST night (Europe/Sofia): the shop day's wall clock is not its elapsed
 * time, so the commit's barber-busy collision is judged on the absolute
 * timeline, as the legacy decision judged it — never let through on the
 * wall clock (a seat before the spring-forward against a span after it) and
 * never refused for two seats an hour apart in the repeated fall-back hour.
 */
describe('decideBooking shim — a DST night is judged on the absolute timeline', () => {
  const ALL_NIGHT = { kind: 'open' as const, opens: '00:00', closes: '12:00' };

  function nightOn(day: number, month: number, hour: number, minute = 0) {
    return unwrap(
      ZonedDateTime.fromParts({ year: 2026, month, day, hour, minute }, ZONE),
    );
  }

  /** A 60-minute fade, no pads: the chair time is the sold hour. */
  function nightService(): Service {
    return unwrap(
      Service.create({
        id: 'svc-fade',
        name: { bg: 'Фейд', en: 'Fade' },
        description: { bg: '—', en: '—' },
        categoryId: 'cat-hair',
        priceMinorUnits: 4000,
        currencyCode: 'EUR',
        durationMinutes: 60,
        locationIds: ['loc-center'],
        conflictsWith: [],
        variants: [],
        offerings: [],
        composition: { kind: 'single' },
        upsellOnly: false,
        popular: false,
        status: 'active',
        sortOrder: 1,
      }),
    );
  }

  /** Ivan works Sundays from midnight to noon; both transition days are Sundays. */
  function nightSnapshot(
    busyKey: string,
    busy: readonly Interval[],
  ): BookingSnapshot {
    const sunday = [{ start: '00:00', end: '12:00', locationId: 'loc-center' }];
    const pattern = unwrap(WeeklyPattern.create({ byWeekday: { sunday } }));
    return {
      zone: ZONE,
      shopHours: [
        ALL_NIGHT,
        ALL_NIGHT,
        ALL_NIGHT,
        ALL_NIGHT,
        ALL_NIGHT,
        ALL_NIGHT,
        ALL_NIGHT,
      ],
      services: [nightService()],
      schedules: new Map([
        [
          'ivan',
          {
            history: StaffScheduleHistory.startingWith(
              pattern,
              unwrap(CalendarDay.create('2026-01-04', ZONE)),
            ),
            turnaroundMinutes: 0,
          },
        ],
      ]),
      busy: new Map([[busyKey, busy]]),
      exceptions: new Map(),
    };
  }

  function bookAt(startIso: string, snap: BookingSnapshot, now: ZonedDateTime) {
    let counter = 0;
    return decideBooking(
      {
        locationId: 'loc-center',
        seats: [{ ...SEAT, startIso }],
      },
      snap,
      {
        now,
        policy: BookingPolicy.default(),
        nextId: () => `id-${counter++}`,
        ownerUserId: OWNER,
      },
    );
  }

  const SPRING_NOW = nightOn(20, 3, 8);
  const FALL_NOW = nightOn(20, 10, 8);

  it('refuses 02:30 for an hour against a span at 04:00 the spring-forward put one real half-hour later', () => {
    // 02:30+02:00 is 00:30Z; 04:00–04:30+03:00 is 01:00Z–01:30Z: they overlap.
    const busy = [
      Interval.of(
        nightOn(29, 3, 4).toMillis(),
        nightOn(29, 3, 4, 30).toMillis(),
      ),
    ];
    const result = bookAt(
      '2026-03-29T02:30:00.000+02:00',
      nightSnapshot('ivan__2026-03-29', busy),
      SPRING_NOW,
    );
    expect(result.isFailure() && result.error.code).toBe(
      'booking.commit.slot_unavailable',
    );
  });

  it('still books 02:30 beside a span that ends before it', () => {
    const busy = [
      Interval.of(nightOn(29, 3, 1).toMillis(), nightOn(29, 3, 2).toMillis()),
    ];
    const decision = unwrap(
      bookAt(
        '2026-03-29T02:30:00.000+02:00',
        nightSnapshot('ivan__2026-03-29', busy),
        SPRING_NOW,
      ),
    );
    expect(decision.busyWrites.map((write) => write.interval)).toEqual([
      Interval.of(
        Date.parse('2026-03-29T00:30:00Z'),
        Date.parse('2026-03-29T01:30:00Z'),
      ),
    ]);
  });

  it('books 03:00 EET beside a span at 03:00 EEST an hour earlier — the repeated hour is two hours of the clock', () => {
    // 03:00–03:30+03:00 is 00:00Z–00:30Z; 03:00+02:00 is 01:00Z.
    const busy = [
      Interval.of(
        Date.parse('2026-10-25T03:00:00+03:00'),
        Date.parse('2026-10-25T03:30:00+03:00'),
      ),
    ];
    const decision = unwrap(
      bookAt(
        '2026-10-25T03:00:00.000+02:00',
        nightSnapshot('ivan__2026-10-25', busy),
        FALL_NOW,
      ),
    );
    expect(decision.busyWrites.map((write) => write.interval)).toEqual([
      Interval.of(
        Date.parse('2026-10-25T01:00:00Z'),
        Date.parse('2026-10-25T02:00:00Z'),
      ),
    ]);
  });

  it('refuses a wall-clock start inside the spring-forward gap as DST_GAP_INVALID_TIME, never shifting it an hour on', () => {
    const result = bookAt(
      '2026-03-29T03:30:00',
      nightSnapshot('ivan__2026-03-29', []),
      SPRING_NOW,
    );
    if (result.isSuccess()) throw new Error('expected a refusal');
    expect(result.error.code).toBe('time.nonexistent_local_time');
    expect(result.error.params).toEqual({
      rawValue: '2026-03-29T03:30',
      zone: ZONE,
    });
  });
});
