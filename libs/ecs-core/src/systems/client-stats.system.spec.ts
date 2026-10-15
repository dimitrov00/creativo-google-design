import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BarberPreference,
  BookingPolicy,
  ClientStatsPolicy,
  type ClientMoneyStats,
  ClientStats,
  type ClientStatsMeta,
  PauseSuggestion,
  PolicyPassStamp,
  PreciseInstant,
  type VisitFact,
  E164,
  Placement,
  SeatLabel,
  CancellationReason,
  CancelledBy,
  type SeatOutcome,
  Seat,
  SeatSubject,
  SubjectRelationship,
  type ShopNow,
  WriteAction,
  WriteOp,
} from '@core/components';
import {
  AttendanceState,
  SchedulingErrorCode,
  Currency,
  AppointmentId,
  BarberId,
  SeatId,
  ServiceId,
  UserId,
  EndMinute,
  DurationMinutes,
  MinuteCount,
  PriceCents,
  UtcEpochMs,
} from '@core/primitives';
import type { Appointment } from '@core/entities';
import {
  FIXTURE_TIME_ZONE,
  deepFreeze,
  minute,
  unwrapOk,
  utcMs,
  appointmentFixture,
  seatFixture,
  customerOf,
} from '@core/testing';
import {
  type BilledAppointment,
  ClientStatsSystem,
  type ClientStatsWriteInput,
  type PauseBasisFact,
  type StoredClientStats,
} from './client-stats.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The cases of libs/domain/scheduling/src/lib/client-stats.spec.ts (the BGN
 * → EUR case included) and of apps/functions/src/lib/clients/
 * client-stats-projection.spec.ts (the canonical-JSON change detection, the
 * subjects, the clock, the revision guard, the placements), copied — the
 * legacy specs keep running against their shims — and re-targeted to the
 * flat shapes (Laws 6 and 7): an appointment is the stats slice of the
 * entity (`localDate` + minutes on the shop's clock, `utcEpochMs` the start
 * instant) with its bill in cents; a seat is the flat `Seat` (subject,
 * terms and outcome at its root, SCREAMING tags); the answer is the flat
 * `ClientStats` (`lifetime*`, `last365*`, `lastVisit*`, `pauseSuggested*`);
 * the spend is `lifetimeSpendCents` + `currency`; "now" is a `ShopNow`.
 *
 * A case still NAMES a visit by its instant (`daysAgo(n)`, the legacy
 * vocabulary) and the spec converts it at its own boundary — exactly what
 * the ingestion boundary does — with `ZonedTimeSystem` in the fixture
 * shop's zone. The rolling windows are `LocalDate` arithmetic (flatten-spec
 * T8); every case sits well clear of a DST night, so each expectation keeps
 * its meaning. The policy-pass cases of the projection spec live in
 * `policy-recompute-job.system.spec.ts`, beside the guard they exercise.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;
/** The clock every case reads — a Thursday noon in Sofia. */
const NOW_UTC_MS = utcMs('2026-09-24T09:00:00.000Z');
/** The shipping free-cancellation window — what a cancel stamps by default. */
const DEFAULT_WINDOW_HOURS = BookingPolicy.DEFAULT.cancellationWindowHours;

/** An instant literal in epoch ms. */
const instant = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));
/** "Now" as the fixture shop sees the instant `ms`. */
const nowAt = (ms: number): ShopNow =>
  ZonedTimeSystem.shopNow(instant(ms), FIXTURE_TIME_ZONE);
const NOW: ShopNow = nowAt(NOW_UTC_MS);
/** The shop wall clock of an instant — the boundary's conversion. */
const wallOf = (ms: number) =>
  ZonedTimeSystem.toLocal(instant(ms), FIXTURE_TIME_ZONE);
/** A visit fact for the visit `id` starting at the instant `ms`. */
const factAt = (id: string, ms: number): VisitFact => {
  const wall = wallOf(ms);
  return {
    appointmentId: AppointmentId.of(id),
    localDate: wall.localDate,
    startMinutes: wall.minute,
  };
};

const PEOPLE = {
  ana: UserId.of('ana'),
  bob: UserId.of('bob'),
} as const;
/** Their client records (D29) — whose visits the statistics count. */
const RECORDS = {
  ana: customerOf(PEOPLE.ana),
  bob: customerOf(PEOPLE.bob),
} as const;
type Who = keyof typeof PEOPLE | 'guest';

type OutcomeSpec =
  | { readonly kind: 'scheduled' }
  | { readonly kind: 'worked' }
  | { readonly kind: 'no_show' }
  | {
      readonly kind: 'cancelled';
      readonly by: CancelledBy;
      readonly reason: Exclude<CancellationReason, 'OTHER'>;
      /** Hours before the visit's start it was called off. */
      readonly leadHours: number;
      /**
       * The window stamped when it was called off; `null` for a row older
       * than the stamp. Absent means what the live paths stamp under the
       * shipping policy.
       */
      readonly windowHours?: number | null;
    };

interface SeatSpec {
  readonly who: Who;
  readonly outcome: OutcomeSpec;
  readonly service?: string;
  readonly barber?: string;
  readonly pref?: BarberPreference | null;
  readonly price?: number;
  readonly tip?: number | null;
}

interface VisitSpec {
  readonly id: string;
  /** The visit's start instant, epoch ms. */
  readonly startMs: number;
  readonly seats: readonly SeatSpec[];
  /** Who put it in the book — `SELF` unless a case says otherwise; `null` is a legacy import. */
  readonly placement?: Placement | null;
  /** False for a legacy row with no booking instant. */
  readonly booked?: boolean;
  readonly currency?: Currency;
  /** A percent-off discount on the whole bill. */
  readonly percentOff?: number;
}

const SEAT_MINUTES = 30;
/** Seats run back to back, so no party ever double-books a barber or a person. */
const SEAT_STRIDE_MINUTES = 45;

function outcomeOf(spec: OutcomeSpec, visitStartMs: number): SeatOutcome {
  switch (spec.kind) {
    case 'scheduled':
      return { attendanceState: AttendanceState.Scheduled };
    case 'worked':
      return {
        attendanceState: AttendanceState.Worked,
        workedAtUtcMs: instant(visitStartMs + SEAT_MINUTES * MINUTE),
      };
    case 'no_show':
      return {
        attendanceState: AttendanceState.NoShow,
        noShowAtUtcMs: instant(visitStartMs + 15 * MINUTE),
      };
    case 'cancelled':
      return {
        attendanceState: AttendanceState.Cancelled,
        cancelledAtUtcMs: instant(visitStartMs - spec.leadHours * HOUR),
        cancelledBy: spec.by,
        cancellationReason: spec.reason,
        cancellationWindowHours:
          spec.windowHours === undefined
            ? DEFAULT_WINDOW_HOURS
            : spec.windowHours,
      };
  }
}

function seatOf(spec: SeatSpec, index: number, visit: VisitSpec): Seat {
  const currency = visit.currency ?? Currency.EUR;
  const start = wallOf(visit.startMs);
  const occupant =
    spec.who === 'guest'
      ? {
          seatSubject: SeatSubject.Anonymous,
          guestLabel: SeatLabel.of('Гост'),
        }
      : {
          seatSubject: SeatSubject.Account,
          subjectUserId: PEOPLE[spec.who],
          subjectCustomerId: RECORDS[spec.who],
          subjectRelationship:
            spec.who === 'ana'
              ? SubjectRelationship.Self
              : SubjectRelationship.Companion,
        };
  return {
    seatId: SeatId.of(`${visit.id}-seat-${index}`),
    serviceId: ServiceId.of(spec.service ?? 'cut'),
    variantId: null,
    barberId: BarberId.of(spec.barber ?? `barber-${index}`),
    barberPreference: spec.pref ?? null,
    // One shop day per appointment (T7): the party's seats on its day.
    startMinutes: minute(start.minute + index * SEAT_STRIDE_MINUTES),
    tipCents: spec.tip == null ? null : unwrapOk(PriceCents.of(spec.tip)),
    priceCents: unwrapOk(PriceCents.of(spec.price ?? 2000)),
    currency,
    durationMinutes: unwrapOk(DurationMinutes.of(SEAT_MINUTES)),
    setupMinutes: MinuteCount.ZERO,
    cleanupMinutes: MinuteCount.ZERO,
    catalogPriceCents: null,
    catalogDurationMinutes: null,
    ...occupant,
    ...outcomeOf(spec.outcome, visit.startMs),
  } as Seat;
}

/** The visit as the stats read it, with its bill (the discount taken off the subtotal). */
function build(visit: VisitSpec): BilledAppointment<Seat> {
  const seats = visit.seats.map((spec, index) => seatOf(spec, index, visit));
  const start = wallOf(visit.startMs);
  let subtotal = 0;
  let end: number = start.minute;
  for (const seat of seats) {
    subtotal += seat.priceCents;
    end = Math.max(end, seat.startMinutes + seat.durationMinutes);
  }
  const off =
    visit.percentOff === undefined
      ? 0
      : Math.round((subtotal * visit.percentOff) / 100);
  return {
    id: AppointmentId.of(visit.id),
    localDate: start.localDate,
    startMinutes: start.minute,
    endMinutes: unwrapOk(EndMinute.of(end)),
    utcEpochMs: instant(visit.startMs),
    bookedAtUtcMs:
      visit.booked === false ? null : instant(visit.startMs - 7 * DAY),
    placement: visit.placement === undefined ? Placement.Self : visit.placement,
    seats,
    bill: {
      subtotalCents: unwrapOk(PriceCents.of(subtotal)),
      totalCents: unwrapOk(PriceCents.of(subtotal - off)),
      currency: visit.currency ?? Currency.EUR,
    },
  };
}

function stats(
  visits: readonly VisitSpec[],
  who: Who = 'ana',
  now: ShopNow = NOW,
  policy = ClientStatsPolicy.DEFAULT,
): ClientStats {
  if (who === 'guest') throw new Error('guests have no stats');
  const person = who === 'ana' ? RECORDS.ana : RECORDS.bob;
  return ClientStatsSystem.stats(person, visits.map(build), policy, now);
}

/** The shipping stats policy over a booking policy with this free-cancellation window. */
function policyWithWindow(cancellationWindowHours: number): ClientStatsPolicy {
  return ClientStatsPolicy.forBooking({
    ...BookingPolicy.DEFAULT,
    cancellationWindowHours,
  });
}

/** Ana's stats as the owner's window of `hours` would compute them. */
const anaUnder = (hours: number, visits: readonly VisitSpec[]) =>
  stats(visits, 'ana', NOW, policyWithWindow(hours));

const daysAgo = (days: number): number => NOW_UTC_MS - days * DAY;
const WORKED: OutcomeSpec = { kind: 'worked' };
const NO_SHOW: OutcomeSpec = { kind: 'no_show' };
const solo = (
  id: string,
  startMs: number,
  outcome: OutcomeSpec,
  extra: Partial<SeatSpec> = {},
): VisitSpec => ({ id, startMs, seats: [{ who: 'ana', outcome, ...extra }] });

describe('stats — per visit, per subject', () => {
  it('counts a visit once however many of the person’s services it held', () => {
    const result = stats([
      {
        id: 'a1',
        startMs: daysAgo(10),
        seats: [
          { who: 'ana', outcome: WORKED, service: 'cut' },
          { who: 'ana', outcome: WORKED, service: 'beard' },
        ],
      },
    ]);
    expect(result.lifetimeVisitsCompleted).toBe(1);
    expect(result.last365VisitsCompleted).toHaveLength(1);
  });

  it('reads only the person’s own seats on a party', () => {
    const party: VisitSpec = {
      id: 'a1',
      startMs: daysAgo(3),
      seats: [
        { who: 'ana', outcome: WORKED },
        { who: 'bob', outcome: NO_SHOW },
        { who: 'guest', outcome: NO_SHOW },
      ],
    };
    const lifetimeOf = (result: ClientStats) => ({
      visitsCompleted: result.lifetimeVisitsCompleted,
      noShows: result.lifetimeNoShows,
      lateCancels: result.lifetimeLateCancels,
      clientCancels: result.lifetimeClientCancels,
    });
    expect(lifetimeOf(stats([party], 'ana'))).toEqual({
      visitsCompleted: 1,
      noShows: 0,
      lateCancels: 0,
      clientCancels: 0,
    });
    expect(lifetimeOf(stats([party], 'bob'))).toEqual({
      visitsCompleted: 0,
      noShows: 1,
      lateCancels: 0,
      clientCancels: 0,
    });
  });

  it('files a visit whose seats all no-showed as one no-show', () => {
    const result = stats([
      {
        id: 'a1',
        startMs: daysAgo(3),
        seats: [
          { who: 'ana', outcome: NO_SHOW },
          { who: 'ana', outcome: NO_SHOW },
        ],
      },
    ]);
    expect(result.lifetimeNoShows).toBe(1);
    expect(result.lifetimeVisitsCompleted).toBe(0);
  });

  it('keeps a visit with any worked seat a visit, even with a service still to come', () => {
    const result = stats([
      {
        id: 'a1',
        startMs: NOW_UTC_MS - HOUR,
        seats: [
          { who: 'ana', outcome: WORKED },
          { who: 'ana', outcome: { kind: 'scheduled' } },
        ],
      },
    ]);
    expect(result.lifetimeVisitsCompleted).toBe(1);
    expect(result.nextVisitAppointmentId).toBeNull();
  });

  it('knows nothing about somebody with no seat anywhere', () => {
    const result = stats([solo('a1', daysAgo(3), WORKED)], 'bob');
    expect(result.lifetimeVisitsCompleted).toBe(0);
    expect(result.lastVisitAppointmentId).toBeNull();
    expect(result.lastVisitLegs).toEqual([]);
    expect(result.firstVisitLocalDate).toBeNull();
    expect(result.firstVisitStartMinutes).toBeNull();
  });
});

describe('stats — cancellations', () => {
  const cancel = (
    by: CancelledBy,
    reason: Exclude<CancellationReason, 'OTHER'>,
    leadHours: number,
  ): OutcomeSpec => ({ kind: 'cancelled', by, reason, leadHours });

  it('counts a client cancel inside the window as late, and outside it as a cancel only', () => {
    const result = stats([
      solo('late', daysAgo(20), cancel('CLIENT', 'UNSPECIFIED', 2)),
      solo('early', daysAgo(10), cancel('CLIENT', 'UNSPECIFIED', 48)),
    ]);
    expect(result.lifetimeClientCancels).toBe(2);
    expect(result.lifetimeLateCancels).toBe(1);
    expect(result.last365LateCancels.map((f) => f.appointmentId)).toEqual([
      'late',
    ]);
  });

  it('counts a client reason the desk filed as the client’s', () => {
    const result = stats([
      solo('a1', daysAgo(5), cancel('STAFF', 'CLIENT_UNWELL', 1)),
    ]);
    expect(result.lifetimeLateCancels).toBe(1);
  });

  it('never counts a shop-caused cancellation, however late', () => {
    const result = stats([
      solo('a1', daysAgo(5), cancel('STAFF', 'STAFF_BARBER_ABSENCE', 1)),
      solo('a2', daysAgo(6), cancel('STAFF', 'STAFF_SHOP_CLOSURE', 1)),
      solo('a3', daysAgo(7), cancel('STAFF', 'UNSPECIFIED', 1)),
    ]);
    expect(result.lifetimeClientCancels).toBe(0);
    expect(result.lifetimeLateCancels).toBe(0);
  });

  it('holds a converted no-show against nobody until a correction says whose it was', () => {
    const result = stats([
      solo('a1', daysAgo(5), cancel('STAFF', 'NO_SHOW_CONVERTED', 0)),
    ]);
    expect(result.lifetimeClientCancels).toBe(0);
  });

  it('never calls a legacy row late — its cancellation instant is derived', () => {
    const legacy: VisitSpec = {
      ...solo('a1', daysAgo(5), cancel('CLIENT', 'UNSPECIFIED', 0)),
      booked: false,
    };
    const result = stats([legacy]);
    expect(result.lifetimeClientCancels).toBe(1);
    expect(result.lifetimeLateCancels).toBe(0);
  });

  it('decides a fully cancelled visit by the seat called off last', () => {
    const result = stats([
      {
        id: 'a1',
        startMs: daysAgo(5),
        seats: [
          { who: 'ana', outcome: cancel('CLIENT', 'CLIENT_CHANGED_PLANS', 72) },
          { who: 'ana', outcome: cancel('STAFF', 'STAFF_BARBER_ABSENCE', 3) },
        ],
      },
    ]);
    expect(result.lifetimeClientCancels).toBe(0);
  });
});

/*
 * ── THE RULE IN FORCE (2026-09-25) ───────────────────────────────────────
 * A cancellation is judged by the window the policy had WHEN THE CLIENT
 * CANCELLED, stamped on the seat. Moving the window later must neither turn
 * an on-time cancel late nor let a real late one go.
 */
describe('stats — a cancellation keeps the window it was made under', () => {
  const clientCancel = (
    id: string,
    leadHours: number,
    windowHours: number | null,
  ): VisitSpec =>
    solo(id, daysAgo(10), {
      kind: 'cancelled',
      by: 'CLIENT',
      reason: 'CLIENT_CHANGED_PLANS',
      leadHours,
      windowHours,
    });

  it('never turns an on-time cancel late when the owner lengthens the window', () => {
    // 30 h ahead under a 24 h window: on time, and still on time at 48 h.
    const history = [clientCancel('a1', 30, 24)];
    expect(anaUnder(24, history).lifetimeLateCancels).toBe(0);
    expect(anaUnder(48, history).lifetimeLateCancels).toBe(0);
    expect(anaUnder(48, history).lifetimeClientCancels).toBe(1);
  });

  it('never lets a real late cancel go when the owner shortens the window', () => {
    // 3 h ahead under a 24 h window: late, and still late at 2 h.
    const history = [clientCancel('a1', 3, 24)];
    expect(anaUnder(24, history).lifetimeLateCancels).toBe(1);
    expect(anaUnder(2, history).lifetimeLateCancels).toBe(1);
    expect(
      anaUnder(2, history).last365LateCancels.map((f) => f.appointmentId),
    ).toEqual(['a1']);
  });

  it('judges two identical lead times by their own windows', () => {
    // The same 10 h lead, cancelled under two different rules.
    const history = [
      clientCancel('under-6', 10, 6),
      clientCancel('under-12', 10, 12),
    ];
    for (const today of [0, 6, 12, 24, 72]) {
      expect(
        anaUnder(today, history).last365LateCancels.map((f) => f.appointmentId),
      ).toEqual(['under-12']);
    }
  });

  it('falls back to the current window for a cancellation recorded before the stamp', () => {
    const legacy = [clientCancel('a1', 30, null)];
    expect(anaUnder(24, legacy).lifetimeLateCancels).toBe(0);
    expect(anaUnder(48, legacy).lifetimeLateCancels).toBe(1);
  });
});

describe('clientCaused', () => {
  const clientCaused = ClientStatsSystem.clientCaused;

  // The two `OTHER` rows of the legacy spec carried a note; the reason is
  // code-only now (§9 D23), so they are the same `OTHER` by either side.
  it.each<[CancellationReason, CancelledBy, boolean]>([
    ['CLIENT_CHANGED_PLANS', 'STAFF', true],
    ['CLIENT_UNWELL', 'CLIENT', true],
    ['STAFF_BARBER_ABSENCE', 'CLIENT', false],
    ['STAFF_SHOP_CLOSURE', 'STAFF', false],
    ['UNSPECIFIED', 'CLIENT', true],
    ['UNSPECIFIED', 'STAFF', false],
    ['OTHER', 'CLIENT', true],
    ['OTHER', 'STAFF', false],
    ['NO_SHOW_CONVERTED', 'STAFF', false],
  ])('%s by %s → %s', (cancellationReason, cancelledBy, expected) => {
    expect(clientCaused({ cancelledBy, cancellationReason })).toBe(expected);
  });

  it('takes a converted no-show’s side from the correction', () => {
    const converted = {
      cancelledBy: CancelledBy.Staff,
      cancellationReason: CancellationReason.NoShowConverted,
    };
    expect(clientCaused(converted, 'CLIENT')).toBe(true);
    expect(clientCaused(converted, 'SHOP')).toBe(false);
  });
});

describe('stats — bounded instants and windows', () => {
  const history = [
    solo('old', daysAgo(400), WORKED),
    solo('year', daysAgo(200), WORKED),
    solo('recent', daysAgo(30), WORKED),
    solo('ns-old', daysAgo(120), NO_SHOW),
    solo('ns', daysAgo(10), NO_SHOW),
  ];

  it('keeps lifetime counts whole and instants for the last 365 days only', () => {
    const result = stats(history);
    expect(result.lifetimeVisitsCompleted).toBe(3);
    expect(result.last365VisitsCompleted.map((f) => f.appointmentId)).toEqual([
      'year',
      'recent',
    ]);
    // A fact is the visit's start on the shop's clock.
    expect(result.last365VisitsCompleted[1]).toEqual(
      factAt('recent', daysAgo(30)),
    );
  });

  it('computes the windows at read, so time alone moves a count', () => {
    const result = stats(history);
    expect(ClientStatsSystem.statWindows(result, NOW)).toEqual({
      visitsCompleted: { lifetime: 3, last12m: 2, last90d: 1 },
      noShows: { lifetime: 2, last12m: 2, last90d: 1 },
      lateCancels: { lifetime: 0, last12m: 0, last90d: 0 },
    });
    // Half a year on, with nothing written: both windows have moved.
    expect(
      ClientStatsSystem.statWindows(result, nowAt(NOW_UTC_MS + 180 * DAY))
        .visitsCompleted,
    ).toEqual({ lifetime: 3, last12m: 1, last90d: 0 });
  });
});

describe('stats — the visits a reader names', () => {
  it('names the first, the last and the next visit', () => {
    const result = stats([
      solo('first', daysAgo(90), WORKED),
      {
        id: 'last',
        startMs: daysAgo(10),
        seats: [
          { who: 'ana', outcome: WORKED, service: 'cut', barber: 'ivan' },
          { who: 'ana', outcome: WORKED, service: 'beard', barber: 'ivan' },
          { who: 'bob', outcome: WORKED, service: 'kids', barber: 'petar' },
        ],
      },
      solo('stale', daysAgo(2), { kind: 'scheduled' }),
      solo('later', NOW_UTC_MS + 20 * DAY, { kind: 'scheduled' }),
      solo(
        'next',
        NOW_UTC_MS + 5 * DAY,
        { kind: 'scheduled' },
        {
          service: 'cut',
        },
      ),
    ]);
    const first = wallOf(daysAgo(90));
    expect(result.firstVisitLocalDate).toBe(first.localDate);
    expect(result.firstVisitStartMinutes).toBe(first.minute);
    expect(result.lastVisitAppointmentId).toBe('last');
    expect(result.lastVisitLocalDate).toBe(wallOf(daysAgo(10)).localDate);
    expect(result.lastVisitServiceIds).toEqual(['cut', 'beard']);
    expect(result.lastVisitBarberIds).toEqual(['ivan']);
    expect(result.lastVisitLegs).toHaveLength(2);
    expect(result.lastVisitLegs[1]?.durationMinutes).toBe(SEAT_MINUTES);
    // The unsettled visit two days ago is not "next"; the nearest future one is.
    expect(result.nextVisitAppointmentId).toBe('next');
    expect(result.nextVisitServiceIds).toEqual(['cut']);
  });
});

describe('stats — cadence (R34)', () => {
  it('states no rhythm below three visits', () => {
    expect(
      stats([solo('a', daysAgo(60), WORKED), solo('b', daysAgo(30), WORKED)])
        .avgCadenceDays,
    ).toBeNull();
  });

  it('is the mean gap between worked visits', () => {
    const result = stats([
      solo('a', daysAgo(90), WORKED),
      solo('b', daysAgo(60), WORKED),
      solo('c', daysAgo(20), WORKED),
    ]);
    expect(result.avgCadenceDays).toBe(35);
  });

  it('leaves out a gap the shop stretched', () => {
    const result = stats([
      solo('a', daysAgo(120), WORKED),
      solo('b', daysAgo(90), WORKED),
      solo('shop', daysAgo(60), {
        kind: 'cancelled',
        by: 'STAFF',
        reason: 'STAFF_BARBER_ABSENCE',
        leadHours: 20,
      }),
      solo('c', daysAgo(30), WORKED),
    ]);
    // 120→90 counts (30 days); 90→30 held the shop's cancellation.
    expect(result.avgCadenceDays).toBe(30);
  });

  it('measures the gaps in REAL elapsed days — a spring-forward between two visits moves no stored figure', () => {
    // 10 days, then 10 days 2:53 on the wall clock across 2026-03-29 — but
    // one hour less of real time: (10 + 10.0786) / 2 = 10.04 → 10.0. Read on
    // the wall clock the mean would be 10.06 → 10.1.
    const result = stats([
      solo('a', utcMs('2026-03-10T10:00:00+02:00'), WORKED),
      solo('b', utcMs('2026-03-20T10:00:00+02:00'), WORKED),
      solo('c', utcMs('2026-03-30T12:53:00+03:00'), WORKED),
    ]);
    expect(result.avgCadenceDays).toBe(10);
  });
});

describe('stats — preferred barber and usual services', () => {
  it('names a barber asked for by name on two of the last three visits', () => {
    const result = stats([
      solo('a', daysAgo(90), WORKED, { barber: 'petar', pref: 'SPECIFIC' }),
      solo('b', daysAgo(60), WORKED, { barber: 'ivan', pref: 'SPECIFIC' }),
      solo('c', daysAgo(30), WORKED, { barber: 'ivan', pref: 'SPECIFIC' }),
      solo('d', daysAgo(5), WORKED, { barber: 'petar', pref: 'ANY' }),
    ]);
    expect(result.preferredBarberId).toBe('ivan');
  });

  it('reads nothing into who happened to be free, or into an unknown preference', () => {
    const result = stats([
      solo('a', daysAgo(60), WORKED, { barber: 'ivan', pref: 'ANY' }),
      solo('b', daysAgo(30), WORKED, { barber: 'ivan', pref: null }),
      solo('c', daysAgo(5), WORKED, { barber: 'ivan', pref: 'SPECIFIC' }),
    ]);
    expect(result.preferredBarberId).toBeNull();
  });

  // §11.2 #6: the placement gate. A legacy import carries no placement and
  // is no evidence, whatever its seats say — but it still takes its place
  // among the last three.
  it('ignores a visit whose placement is unknown, a legacy import', () => {
    const result = stats([
      solo('a', daysAgo(90), WORKED, { barber: 'ivan', pref: 'SPECIFIC' }),
      {
        ...solo('b', daysAgo(60), WORKED, { barber: 'ivan', pref: 'SPECIFIC' }),
        placement: null,
      },
      {
        ...solo('c', daysAgo(30), WORKED, { barber: 'ivan', pref: 'SPECIFIC' }),
        placement: null,
      },
      solo('d', daysAgo(5), WORKED, { barber: 'ivan', pref: 'SPECIFIC' }),
    ]);
    // Last three: b, c (legacy) and d — one piece of evidence, not two.
    expect(result.preferredBarberId).toBeNull();
  });

  it('counts a staff placement only where the form recorded the request', () => {
    const phoned = (id: string, days: number, pref: 'SPECIFIC' | null) => ({
      ...solo(id, daysAgo(days), WORKED, { barber: 'niko', pref }),
      placement: Placement.Staff,
    });
    // The desk put her in whichever chair was free: no preference recorded.
    expect(
      stats([
        phoned('a', 60, null),
        phoned('b', 30, null),
        phoned('c', 5, null),
      ]).preferredBarberId,
    ).toBeNull();
    // The desk wrote down that she asked for Niko.
    expect(
      stats([phoned('a', 60, 'SPECIFIC'), phoned('b', 30, 'SPECIFIC')])
        .preferredBarberId,
    ).toBe('niko');
  });

  // The pre-P0 commit stored an omitted preference as `SPECIFIC`. The
  // backfill may learn from the audit trail that the desk placed these, but
  // it records that as an inference, which never reaches `placement` — so
  // the chairs that happened to be free cannot become «asks for Ivan».
  it('takes no pre-P0 phone booking as a request, whoever placed it', () => {
    const prePhone = (id: string, days: number): VisitSpec => ({
      ...solo(id, daysAgo(days), WORKED, { barber: 'ivan', pref: 'SPECIFIC' }),
      placement: null,
    });
    const history = [prePhone('a', 90), prePhone('b', 60), prePhone('c', 30)];
    expect(stats(history).preferredBarberId).toBeNull();

    // Two visits the P0 commit recorded her asking for Petar: the signal
    // heals from new visits alone.
    const asked = (id: string, days: number): VisitSpec =>
      solo(id, daysAgo(days), WORKED, { barber: 'petar', pref: 'SPECIFIC' });
    expect(
      stats([...history, asked('d', 20), asked('e', 10)]).preferredBarberId,
    ).toBe('petar');
  });

  it('reads no placements at all as no evidence', () => {
    const history = [
      solo('a', daysAgo(60), WORKED, { barber: 'ivan', pref: 'SPECIFIC' }),
      solo('b', daysAgo(30), WORKED, { barber: 'ivan', pref: 'SPECIFIC' }),
    ];
    expect(
      ClientStatsSystem.stats(
        RECORDS.ana,
        history.map((visit) => build({ ...visit, placement: null })),
        ClientStatsPolicy.DEFAULT,
        NOW,
      ).preferredBarberId,
    ).toBeNull();
  });

  it('calls a service usual when it is on three of the last five visits', () => {
    const on = (id: string, days: number, services: string[]): VisitSpec => ({
      id,
      startMs: daysAgo(days),
      seats: services.map((service) => ({
        who: 'ana' as const,
        outcome: WORKED,
        service,
      })),
    });
    const result = stats([
      on('v0', 300, ['beard']),
      on('v0b', 280, ['beard']),
      on('v1', 150, ['cut', 'beard']),
      on('v2', 120, ['cut']),
      on('v3', 90, ['wash']),
      on('v4', 60, ['cut', 'wash']),
      on('v5', 30, ['beard']),
    ]);
    // Last five: v1..v5 — cut ×3, beard ×2, wash ×2. The older beards are out.
    expect(result.usualServiceIds).toEqual(['cut']);
  });
});

describe('pause suggestion (R25) — a suggestion, never a pause', () => {
  const three = [
    solo('n1', daysAgo(50), NO_SHOW),
    solo('n2', daysAgo(20), NO_SHOW),
    solo('n3', daysAgo(2), NO_SHOW),
  ];
  /** The stored no-show facts with the start instants the dismissal is compared with. */
  const basisOf = (
    facts: readonly VisitFact[],
    visits: readonly VisitSpec[],
  ): PauseBasisFact[] =>
    facts.map((fact) => ({
      ...fact,
      startUtcMs: instant(
        visits.find((visit) => visit.id === fact.appointmentId)?.startMs ??
          Number.NaN,
      ),
    }));

  it('raises at three no-shows inside sixty days, on the newest one', () => {
    const result = stats(three);
    expect({
      pauseSuggestedNoShows: result.pauseSuggestedNoShows,
      pauseSuggestedWindowDays: result.pauseSuggestedWindowDays,
      pauseSuggestionBasis: result.pauseSuggestionBasis,
      pauseSuggestedAtUtcMs: result.pauseSuggestedAtUtcMs,
    }).toEqual({
      pauseSuggestedNoShows: 3,
      pauseSuggestedWindowDays: 60,
      pauseSuggestionBasis: ['n1', 'n2', 'n3'],
      pauseSuggestedAtUtcMs: daysAgo(2),
    });
    expect(PauseSuggestion.isRaised(result)).toBe(true);
  });

  it('stays quiet at two, or when the third is outside the window', () => {
    const quiet = {
      pauseSuggestedNoShows: null,
      pauseSuggestedWindowDays: null,
      pauseSuggestionBasis: [],
      pauseSuggestedAtUtcMs: null,
    };
    expect(stats(three.slice(1))).toMatchObject(quiet);
    expect(
      stats([solo('n0', daysAgo(70), NO_SHOW), ...three.slice(1)]),
    ).toMatchObject(quiet);
  });

  it('is re-checked at read: the basis ages out, and «Не сега» holds until a newer no-show', () => {
    const result = stats(three);
    const basis = basisOf(result.last365NoShows, three);
    const at = ClientStatsSystem.pauseSuggestionAt;
    expect(at(basis, nowAt(NOW_UTC_MS + 15 * DAY))).toEqual(
      PauseSuggestion.NONE,
    );
    expect(
      at(basis, NOW, ClientStatsPolicy.DEFAULT, instant(daysAgo(1))),
    ).toEqual(PauseSuggestion.NONE);
    expect(
      at(basis, NOW, ClientStatsPolicy.DEFAULT, instant(daysAgo(10)))
        .pauseSuggestedNoShows,
    ).toBe(3);
  });
});

describe('money', () => {
  it('sums worked seats, never tips, no-shows or cancellations', () => {
    const result = ClientStatsSystem.money(RECORDS.ana, [
      build({
        id: 'a1',
        startMs: daysAgo(10),
        seats: [
          { who: 'ana', outcome: WORKED, price: 2500, tip: 500 },
          { who: 'bob', outcome: WORKED, price: 1800 },
        ],
      }),
      build(solo('a2', daysAgo(5), NO_SHOW, { price: 9900 })),
      build(
        solo(
          'a3',
          daysAgo(4),
          {
            kind: 'cancelled',
            by: 'CLIENT',
            reason: 'UNSPECIFIED',
            leadHours: 1,
          },
          { price: 9900 },
        ),
      ),
    ]);
    expect(result).toEqual({
      lifetimeSpendCents: 2500,
      currency: 'EUR',
    });
  });

  it('takes the person’s pro-rata share of a discount', () => {
    const result = ClientStatsSystem.money(RECORDS.ana, [
      build({
        id: 'a1',
        startMs: daysAgo(10),
        seats: [
          { who: 'ana', outcome: WORKED, price: 3000 },
          { who: 'bob', outcome: WORKED, price: 1000 },
        ],
        percentOff: 10,
      }),
    ]);
    expect(result.lifetimeSpendCents).toBe(2700);
  });

  it('converts a legacy leva price at the fixed rate', () => {
    const result = ClientStatsSystem.money(RECORDS.ana, [
      build({
        ...solo('a1', daysAgo(900), WORKED, { price: 3912 }),
        currency: Currency.BGN,
      }),
    ]);
    expect(result).toMatchObject({
      lifetimeSpendCents: 2000,
      currency: 'EUR',
    });
  });

  it('leaves out a price in a currency with no fixed rate, and a free visit', () => {
    const result = ClientStatsSystem.money(RECORDS.ana, [
      build({
        ...solo('a1', daysAgo(30), WORKED, { price: 5000 }),
        currency: Currency.USD,
      }),
      build(solo('a2', daysAgo(20), WORKED, { price: 0 })),
      build(solo('a3', daysAgo(10), WORKED, { price: 1200 })),
    ]);
    expect(result.lifetimeSpendCents).toBe(1200);
  });

  it('is what compute returns beside the stats, from one read of the history', () => {
    const history = [
      build(solo('a1', daysAgo(30), WORKED, { price: 2500 })),
      build(solo('a2', daysAgo(5), NO_SHOW)),
    ];
    expect(
      ClientStatsSystem.compute(
        RECORDS.ana,
        history,
        ClientStatsPolicy.DEFAULT,
        NOW,
      ),
    ).toEqual({
      stats: ClientStatsSystem.stats(
        RECORDS.ana,
        history,
        ClientStatsPolicy.DEFAULT,
        NOW,
      ),
      money: ClientStatsSystem.money(RECORDS.ana, history),
    });
  });
});

describe('ClientStatsPolicy', () => {
  it('refuses thresholds that are not positive, or a window past the stored instants', () => {
    const result = ClientStatsPolicy.create({
      booking: BookingPolicy.DEFAULT,
      suggestPauseNoShows: 0,
      suggestPauseWindowDays: 400,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.error.map((error) => ('field' in error ? error.field : null)),
      ).toEqual(['suggestPauseNoShows', 'suggestPauseWindowDays']);
      expect(result.error[0]?.errorCode).toBe(
        SchedulingErrorCode.ClientStatsPolicyInvalid,
      );
      expect(result.error[0]?.errorCode).toBe(
        'SCHEDULING_CLIENT_STATS_POLICY_INVALID',
      );
    }
  });

  it('draws the late line exactly where the free cancellation ends', () => {
    const policy = ClientStatsPolicy.DEFAULT;
    const start = NOW_UTC_MS + 3 * DAY;
    const deadline = start - policy.booking.cancellationWindowHours * HOUR;
    expect(
      ClientStatsPolicy.isLateCancellation(
        policy,
        instant(start),
        instant(deadline),
        null,
      ),
    ).toBe(false);
    expect(
      ClientStatsPolicy.isLateCancellation(
        policy,
        instant(start),
        instant(deadline + 1),
        null,
      ),
    ).toBe(true);
  });

  it('draws a stamped line where THAT window ended, whatever the policy says now', () => {
    const start = NOW_UTC_MS + 3 * DAY;
    const deadline = start - 6 * HOUR;
    for (const today of [0, 6, 24, 168]) {
      const policy = policyWithWindow(today);
      expect(
        ClientStatsPolicy.isLateCancellation(
          policy,
          instant(start),
          instant(deadline),
          6,
        ),
      ).toBe(false);
      expect(
        ClientStatsPolicy.isLateCancellation(
          policy,
          instant(start),
          instant(deadline + 1),
          6,
        ),
      ).toBe(true);
    }
  });
});

// ── Properties ───────────────────────────────────────────────────────────

const REASONS = [
  'CLIENT_CHANGED_PLANS',
  'CLIENT_UNWELL',
  'STAFF_BARBER_ABSENCE',
  'STAFF_SHOP_CLOSURE',
  'NO_SHOW_CONVERTED',
  'UNSPECIFIED',
] as const;

const outcomeArb: fc.Arbitrary<OutcomeSpec> = fc.oneof(
  fc.constant<OutcomeSpec>({ kind: 'scheduled' }),
  fc.constant<OutcomeSpec>({ kind: 'worked' }),
  fc.constant<OutcomeSpec>({ kind: 'no_show' }),
  fc.record({
    kind: fc.constant('cancelled' as const),
    by: fc.constantFrom(CancelledBy.Client, CancelledBy.Staff),
    reason: fc.constantFrom(...REASONS),
    leadHours: fc.integer({ min: 0, max: 96 }),
    // Stamped under some window, or older than the stamp.
    windowHours: fc.option(fc.integer({ min: 0, max: 96 }), { nil: null }),
  }),
);

/** Every cancellation in `history` stamped: an unstamped one takes `hours`. */
function stampedWith(
  history: readonly VisitSpec[],
  hours: number,
): VisitSpec[] {
  return history.map((visit) => ({
    ...visit,
    seats: visit.seats.map((seat) =>
      seat.outcome.kind === 'cancelled' && seat.outcome.windowHours === null
        ? { ...seat, outcome: { ...seat.outcome, windowHours: hours } }
        : seat,
    ),
  }));
}

const windowArb = fc.integer({ min: 0, max: 96 });

const prefArb = fc.constantFrom<BarberPreference | null>(
  BarberPreference.Any,
  BarberPreference.Specific,
  null,
);

const seatArb: fc.Arbitrary<SeatSpec> = fc.record({
  who: fc.constantFrom<Who>('ana', 'bob', 'guest'),
  outcome: outcomeArb,
  service: fc.constantFrom('cut', 'beard', 'wash'),
  barber: fc.constantFrom('ivan', 'petar'),
  pref: prefArb,
  price: fc.integer({ min: 0, max: 6000 }),
});

const historyArb: fc.Arbitrary<VisitSpec[]> = fc
  .array(
    fc.record({
      dayOffset: fc.integer({ min: -500, max: 40 }),
      minute: fc.integer({ min: 0, max: 600 }),
      seats: fc.array(seatArb, { minLength: 1, maxLength: 3 }),
    }),
    { maxLength: 12 },
  )
  .map((rows) =>
    rows.map((row, index) => ({
      id: `appt-${index}`,
      startMs: NOW_UTC_MS + row.dayOffset * DAY + row.minute * MINUTE,
      seats: row.seats,
    })),
  );

/** A history where each visit's commit stamped it, or did not (`null`). */
const stampedHistoryArb: fc.Arbitrary<VisitSpec[]> = historyArb.chain(
  (history) =>
    fc
      .array(
        fc.constantFrom<Placement | null>(
          Placement.Self,
          Placement.Staff,
          null,
        ),
        {
          minLength: history.length,
          maxLength: history.length,
        },
      )
      .map((placements) =>
        history.map((visit, index) => ({
          ...visit,
          placement: placements.at(index) ?? null,
        })),
      ),
);

const ana = (history: readonly VisitSpec[]): ClientStats =>
  stats(history, 'ana');

/** The lifetime counts of an answer. */
const lifetimeOf = (result: ClientStats) => [
  result.lifetimeVisitsCompleted,
  result.lifetimeNoShows,
  result.lifetimeLateCancels,
  result.lifetimeClientCancels,
];

/** The bounded facts of an answer. */
const last365Of = (result: ClientStats) => [
  result.last365VisitsCompleted,
  result.last365NoShows,
  result.last365LateCancels,
];

describe('stats — properties', () => {
  it('is idempotent: the same history gives the same stats', () => {
    fc.assert(
      fc.property(historyArb, (history) => {
        expect(ana(history)).toEqual(ana(history));
      }),
    );
  });

  it('is order-independent', () => {
    fc.assert(
      fc.property(
        historyArb.chain((history) =>
          fc.tuple(
            fc.constant(history),
            fc.shuffledSubarray(history, {
              minLength: history.length,
              maxLength: history.length,
            }),
          ),
        ),
        ([history, shuffled]) => {
          expect(ana(shuffled)).toEqual(ana(history));
          expect(
            ClientStatsSystem.money(RECORDS.ana, shuffled.map(build)),
          ).toEqual(ClientStatsSystem.money(RECORDS.ana, history.map(build)));
        },
      ),
    );
  });

  it('counts a party appointment once per person, however many seats they hold', () => {
    fc.assert(
      fc.property(historyArb, (history) => {
        const workedFor = history.filter((visit) =>
          visit.seats.some(
            (seat) => seat.who === 'ana' && seat.outcome.kind === 'worked',
          ),
        ).length;
        expect(ana(history).lifetimeVisitsCompleted).toBe(workedFor);
        // Listing the same appointment twice cannot double it either.
        expect(lifetimeOf(ana([...history, ...history]))).toEqual(
          lifetimeOf(ana(history)),
        );
      }),
    );
  });

  it('a stamped cancellation keeps its verdict under ANY policy window', () => {
    fc.assert(
      fc.property(
        historyArb,
        windowArb,
        windowArb,
        windowArb,
        (history, stampHours, before, after) => {
          const stamped = stampedWith(history, stampHours);
          // The whole projection, not only the counts: nothing it holds may
          // move when the owner edits the window.
          expect(anaUnder(after, stamped)).toEqual(anaUnder(before, stamped));
        },
      ),
    );
  });

  it('judges an unstamped cancellation exactly as if the current window were stamped on it', () => {
    fc.assert(
      fc.property(historyArb, windowArb, (history, today) => {
        expect(anaUnder(today, history)).toEqual(
          anaUnder(today, stampedWith(history, today)),
        );
      }),
    );
  });

  it('never counts a shop-caused cancellation', () => {
    const shopCancelArb = fc.record({
      dayOffset: fc.integer({ min: -400, max: 30 }),
      reason: fc.constantFrom(
        CancellationReason.StaffBarberAbsence,
        CancellationReason.StaffShopClosure,
      ),
      by: fc.constantFrom(CancelledBy.Client, CancelledBy.Staff),
      leadHours: fc.integer({ min: 0, max: 96 }),
    });
    fc.assert(
      fc.property(
        historyArb,
        fc.array(shopCancelArb, { maxLength: 4 }),
        (history, shopCancels) => {
          const extra = shopCancels.map((cancel, index): VisitSpec =>
            solo(`shop-${index}`, NOW_UTC_MS + cancel.dayOffset * DAY, {
              kind: 'cancelled',
              by: cancel.by,
              reason: cancel.reason,
              leadHours: cancel.leadHours,
            }),
          );
          const before = ana(history);
          const after = ana([...history, ...extra]);
          expect(lifetimeOf(after)).toEqual(lifetimeOf(before));
          expect(last365Of(after)).toEqual(last365Of(before));
        },
      ),
    );
  });

  // The placement gate as an invariant: a visit its commit did not stamp
  // (legacy, or pre-P0 with only an inferred placement) is no evidence, so
  // whatever its seats' preferences say, nothing moves.
  it('never reads a preference off a visit its commit did not stamp', () => {
    fc.assert(
      fc.property(
        stampedHistoryArb,
        fc.array(prefArb, { minLength: 1 }),
        (history, prefs) => {
          let cursor = 0;
          const rewritten = history.map((visit) =>
            visit.placement !== null
              ? visit
              : {
                  ...visit,
                  seats: visit.seats.map((seat) => ({
                    ...seat,
                    pref: prefs.at(cursor++ % prefs.length) ?? null,
                  })),
                },
          );
          expect(ana(rewritten)).toEqual(ana(history));
        },
      ),
    );
  });

  it('names a barber only on two stamped requests among the last three visits', () => {
    fc.assert(
      fc.property(stampedHistoryArb, (history) => {
        const preferred = ana(history).preferredBarberId;
        if (preferred === null) return;
        const lastThree = history
          .filter((visit) =>
            visit.seats.some(
              (seat) => seat.who === 'ana' && seat.outcome.kind === 'worked',
            ),
          )
          .sort((a, b) => a.startMs - b.startMs || (a.id < b.id ? -1 : 1))
          .slice(-3);
        const requests = lastThree.filter(
          (visit) =>
            visit.placement !== null &&
            visit.seats.some(
              (seat) =>
                seat.who === 'ana' &&
                seat.outcome.kind === 'worked' &&
                seat.pref === 'SPECIFIC' &&
                seat.barber === preferred,
            ),
        );
        expect(requests.length).toBeGreaterThanOrEqual(2);
      }),
    );
  });

  it('never moves one person’s stats when only another person’s seats change', () => {
    fc.assert(
      fc.property(historyArb, fc.array(seatArb), (history, replacements) => {
        let cursor = 0;
        const changed = history.map((visit) => ({
          ...visit,
          seats: visit.seats.map((seat) => {
            if (seat.who !== 'bob') return seat;
            const next =
              replacements[cursor++ % Math.max(replacements.length, 1)];
            return next === undefined ? seat : { ...next, who: 'bob' as const };
          }),
        }));
        expect(ana(changed)).toEqual(ana(history));
      }),
    );
  });
});

describe('the account’s own reading — accountVisitOf, statsOfVisits, moneyOfVisits (D29)', () => {
  const history = [
    solo('a1', daysAgo(90), WORKED, { price: 2500 }),
    {
      id: 'a2',
      startMs: daysAgo(40),
      seats: [
        { who: 'ana' as const, outcome: WORKED },
        { who: 'bob' as const, outcome: NO_SHOW },
      ],
    },
    solo('a3', daysAgo(5), NO_SHOW),
  ].map(build);
  /** The same visits as a seat with no client record reads them (a legacy shim's). */
  const recordless = history.map((visit) => ({
    ...visit,
    seats: visit.seats.map((seat) =>
      Seat.composeAccount(seat, seat, seat, seat),
    ),
  }));

  it('picks the account’s seats as the record reading picks the record’s — the same visit', () => {
    for (const appointment of history) {
      expect(ClientStatsSystem.accountVisitOf(PEOPLE.ana, appointment)).toEqual(
        ClientStatsSystem.subjectVisitOf(RECORDS.ana, appointment),
      );
    }
    for (const appointment of history) {
      expect(
        ClientStatsSystem.accountVisitOf(UserId.of('stranger'), appointment),
      ).toBeNull();
    }
  });

  it('counts the same stats and spend from an account’s visits as from its record’s', () => {
    const visits = ClientStatsSystem.accountVisitsOf(PEOPLE.ana, recordless);
    expect(visits.map((visit) => visit.appointment.id)).toEqual([
      'a1',
      'a2',
      'a3',
    ]);
    expect(
      ClientStatsSystem.statsOfVisits(visits, ClientStatsPolicy.DEFAULT, NOW),
    ).toEqual(
      ClientStatsSystem.stats(
        RECORDS.ana,
        history,
        ClientStatsPolicy.DEFAULT,
        NOW,
      ),
    );
    expect(ClientStatsSystem.moneyOfVisits(visits)).toEqual(
      ClientStatsSystem.money(RECORDS.ana, history),
    );
  });

  it('counts an appointment listed twice once', () => {
    expect(
      ClientStatsSystem.accountVisitsOf(PEOPLE.ana, [
        ...recordless,
        ...recordless,
      ]),
    ).toHaveLength(3);
  });
});

describe('subjectVisitOf — one appointment, one person’s story', () => {
  const party = (seats: readonly SeatSpec[]): BilledAppointment<Seat> =>
    build({ id: 'appt-party', startMs: daysAgo(3), seats });

  it('is the person’s own seats, the visit’s span and their outcome', () => {
    const appointment = party([
      { who: 'ana', outcome: WORKED, service: 'fade' },
      { who: 'bob', outcome: NO_SHOW },
      { who: 'ana', outcome: WORKED, service: 'beard' },
    ]);
    const visit = ClientStatsSystem.subjectVisitOf(RECORDS.ana, appointment);
    expect(visit?.appointment).toBe(appointment);
    expect(visit?.seats.map((seat) => seat.serviceId)).toEqual([
      'fade',
      'beard',
    ]);
    expect(visit?.localDate).toBe(appointment.localDate);
    expect(visit?.startMinutes).toBe(appointment.startMinutes);
    expect(visit?.endMinutes).toBe(appointment.endMinutes);
    expect(visit?.startUtcMs).toBe(appointment.utcEpochMs);
    expect(visit?.outcome).toEqual({ subjectVisitOutcome: 'WORKED' });
  });

  // A companion's no-show says nothing about the booker, and the reverse.
  it('reads each person from their seats alone', () => {
    const appointment = party([
      { who: 'ana', outcome: WORKED },
      { who: 'bob', outcome: NO_SHOW },
    ]);
    expect(
      ClientStatsSystem.subjectVisitOf(RECORDS.bob, appointment)?.outcome,
    ).toEqual({ subjectVisitOutcome: 'NO_SHOW' });
  });

  it('keeps a visit open while any of the person’s seats is', () => {
    const appointment = party([
      { who: 'ana', outcome: { kind: 'scheduled' } },
      { who: 'ana', outcome: NO_SHOW },
    ]);
    expect(
      ClientStatsSystem.subjectVisitOf(RECORDS.ana, appointment)?.outcome
        .subjectVisitOutcome,
    ).toBe('OPEN');
  });

  it('decides a cancelled visit by the seat called off last', () => {
    const appointment = party([
      {
        who: 'ana',
        outcome: {
          kind: 'cancelled',
          by: 'CLIENT',
          reason: 'CLIENT_CHANGED_PLANS',
          leadHours: 48,
        },
      },
      {
        who: 'ana',
        outcome: {
          kind: 'cancelled',
          by: 'STAFF',
          reason: 'STAFF_SHOP_CLOSURE',
          leadHours: 2,
        },
      },
    ]);
    const outcome = ClientStatsSystem.subjectVisitOf(
      RECORDS.ana,
      appointment,
    )?.outcome;
    expect(outcome?.subjectVisitOutcome).toBe('CANCELLED');
    if (outcome?.subjectVisitOutcome === 'CANCELLED') {
      expect(outcome.decisive.cancelledBy).toBe('STAFF');
      // The decisive cancellation IS the seat that carries it.
      expect(outcome.decisive).toBe(appointment.seats[1]);
      expect(ClientStatsSystem.clientCaused(outcome.decisive)).toBe(false);
    }
  });

  it('is null for a person with no seat on the appointment', () => {
    const appointment = party([
      { who: 'bob', outcome: WORKED },
      { who: 'guest', outcome: WORKED },
    ]);
    expect(
      ClientStatsSystem.subjectVisitOf(RECORDS.ana, appointment),
    ).toBeNull();
  });

  // The statistics count through the same reading: a row can never tell
  // one story and the counts above it another.
  it('agrees with the statistics it feeds', () => {
    const visits: VisitSpec[] = [
      solo('a1', daysAgo(40), WORKED),
      solo('a2', daysAgo(20), NO_SHOW),
      {
        id: 'a3',
        startMs: daysAgo(5),
        seats: [
          { who: 'bob', outcome: NO_SHOW },
          { who: 'ana', outcome: WORKED },
        ],
      },
    ];
    const outcomes = visits
      .map(build)
      .map(
        (appointment) =>
          ClientStatsSystem.subjectVisitOf(RECORDS.ana, appointment)?.outcome
            .subjectVisitOutcome,
      );
    const counted = stats(visits);
    expect(outcomes.filter((outcome) => outcome === 'WORKED')).toHaveLength(
      counted.lifetimeVisitsCompleted,
    );
    expect(outcomes.filter((outcome) => outcome === 'NO_SHOW')).toHaveLength(
      counted.lifetimeNoShows,
    );
  });
});

/* ── The projection: client-stats-projection.spec.ts ─────────────────── */

describe('statsInputChanged — the early exit (§13 R28)', () => {
  const seat = seatFixture({ barberPreference: BarberPreference.Specific });
  const visit = (
    overrides: Parameters<typeof appointmentFixture>[0] = {},
  ): Appointment =>
    appointmentFixture({ placement: null, seats: [seat], ...overrides });
  const base = visit();
  const changed = ClientStatsSystem.statsInputChanged;

  it('ignores what no stat reads: a tip, an arrival, a contact, a revision', () => {
    expect(
      changed(
        base,
        visit({
          seats: [{ ...seat, tipCents: unwrapOk(PriceCents.of(500)) }],
          arrivedAtUtcMs: instant(base.utcEpochMs - 2 * MINUTE),
          contactName: 'Ана',
          contactPhone: E164.of('+359888000000'),
          revision: 4,
          subjectUserIds: [UserId.of('ana')],
          subjectCustomerIds: [customerOf(UserId.of('ana'))],
        }),
      ),
    ).toBe(false);
  });

  // The preferred barber counts only visits their commit stamped (§11.2 #6).
  it('wakes on a placement stamped or changed', () => {
    const placed = visit({ placement: Placement.Self });
    expect(changed(base, placed)).toBe(true);
    expect(changed(placed, visit({ placement: Placement.Staff }))).toBe(true);
    expect(changed(placed, visit({ placement: Placement.Self }))).toBe(false);
  });

  // The backfill's inference is no stat's input, so stamping it on a
  // pre-P0 row moves nobody's stats and wakes no recompute.
  it('sleeps through an inferred placement', () => {
    expect(changed(base, visit({ inferredPlacement: Placement.Staff }))).toBe(
      false,
    );
  });

  it('wakes on an outcome, a subject, a time or a price', () => {
    const changes: Seat[] = [
      {
        ...seat,
        attendanceState: AttendanceState.NoShow,
        noShowAtUtcMs: instant(1),
      } as Seat,
      { ...seat, subjectUserId: UserId.of('bob') } as Seat,
      // D29: whose client record the seat is — the projection's key.
      { ...seat, subjectCustomerId: customerOf(UserId.of('bob')) } as Seat,
      { ...seat, startMinutes: minute(seat.startMinutes + 30) },
      { ...seat, priceCents: unwrapOk(PriceCents.of(1800)) },
    ];
    for (const next of changes) {
      expect(changed(base, visit({ seats: [next] }))).toBe(true);
    }
    // The same minute on another day is another time.
    const nextDay = ZonedTimeSystem.toLocal(
      instant(base.utcEpochMs + DAY),
      FIXTURE_TIME_ZONE,
    ).localDate;
    expect(changed(base, visit({ localDate: nextDay }))).toBe(true);
  });

  it('wakes on a create and a delete', () => {
    expect(changed(null, base)).toBe(true);
    expect(changed(base, null)).toBe(true);
  });

  it('does not mistake a reordered map for a change', () => {
    const reversed = <T extends object>(value: T): T =>
      Object.fromEntries(Object.entries(value).reverse()) as T;
    const reordered: Appointment = {
      ...reversed(base),
      seats: base.seats.map((entry) => reversed(entry)),
    };
    expect(changed(base, reordered)).toBe(false);
    expect(ClientStatsSystem.canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      ClientStatsSystem.canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
});

describe('affectedSubjects', () => {
  it('is everyone on the visit before and after, once, sorted', () => {
    // The seats' subjects (guests left out) are read by the caller (R33).
    expect(
      ClientStatsSystem.affectedSubjects(['ana', 'zora'], ['ana', 'bob']),
    ).toEqual(['ana', 'bob', 'zora']);
    expect(ClientStatsSystem.affectedSubjects([], [])).toEqual([]);
  });
});

describe('projectionClock', () => {
  it('never runs behind the stored answer', () => {
    expect(
      ClientStatsSystem.projectionClock(
        utcMs('2026-09-25T09:00:00.000Z'),
        utcMs('2026-09-25T10:00:00.000Z'),
      ),
    ).toBe(utcMs('2026-09-25T10:00:00.000Z'));
    expect(ClientStatsSystem.projectionClock(instant(5), null)).toBe(5);
    // A corrupt stored time (a zero-mapper read of broken bytes) is no bound.
    expect(
      ClientStatsSystem.projectionClock(instant(5), Number.NaN as UtcEpochMs),
    ).toBe(5);
  });
});

describe('planWrite (planClientStatsWrite) — the revision guard', () => {
  const NOW_W = utcMs('2026-09-25T10:00:00.000Z');
  const ANA = customerOf(UserId.of('ana'));
  const PATHS = {
    stats: ['clientStats', ANA],
    money: ['clientStats', ANA, 'restricted', 'money'],
  } as const;
  const content: ClientStats = {
    ...ClientStats.empty(),
    lifetimeVisitsCompleted: 1,
  };
  const money: ClientMoneyStats = {
    lifetimeSpendCents: unwrapOk(PriceCents.of(2500)),
    currency: Currency.EUR,
  };
  const meta = (version: number): ClientStatsMeta => ({
    version,
    updatedAtUtcMs: instant(NOW_W - 1000),
  });
  const stored = (
    version: number,
    moneyVersion = version,
  ): StoredClientStats => ({
    statsPresent: true,
    moneyPresent: true,
    stats: { ...content, ...meta(version) },
    money: { ...money, ...meta(moneyVersion) },
    statsVersion: version,
    moneyVersion,
  });
  const NOTHING: StoredClientStats = {
    statsPresent: false,
    moneyPresent: false,
    stats: null,
    money: null,
    statsVersion: null,
    moneyVersion: null,
  };
  const input = (
    overrides: Partial<ClientStatsWriteInput> = {},
  ): ClientStatsWriteInput => ({
    customerId: ANA,
    stored: NOTHING,
    stats: content,
    money,
    hasHistory: true,
    nowUtcMs: NOW_W,
    stamp: null,
    restamp: false,
    ...overrides,
  });
  const plan = (overrides: Partial<ClientStatsWriteInput> = {}) =>
    ClientStatsSystem.planWrite(input(overrides), PATHS);
  const bodyOf = (op: WriteOp | undefined) =>
    op !== undefined && op.writeAction === WriteAction.Set ? op.body : null;

  it('writes nothing for a person with no history and nothing stored', () => {
    expect(plan({ hasHistory: false })).toEqual({
      statsWriteDecision: 'UNCHANGED',
      writes: [],
    });
  });

  it('writes both documents at version 1 the first time', () => {
    const first = plan();
    expect(first.statsWriteDecision).toBe('WRITE');
    if (first.statsWriteDecision !== 'WRITE') return;
    expect(first.version).toBe(1);
    const [stats, spend] = first.writes;
    expect(stats?.path).toEqual(PATHS.stats);
    expect(spend?.path).toEqual(PATHS.money);
    expect(bodyOf(stats)?.['version']).toBe(1);
    expect(bodyOf(spend)?.['version']).toBe(1);
    expect(bodyOf(stats)?.['updatedAtUtcMs']).toBe(NOW_W);
    // Whose pair it is, in both bodies — the client record (D29).
    expect(bodyOf(stats)?.['customerId']).toBe(ANA);
    expect(bodyOf(spend)?.['customerId']).toBe(ANA);
    expect(bodyOf(stats)).not.toHaveProperty('lifetimeSpendCents');
    // Every 1-to-1 field at the document root (Law 6).
    expect(bodyOf(stats)?.['lifetimeVisitsCompleted']).toBe(1);
    expect(bodyOf(stats)?.['policyPassGeneration']).toBeNull();
  });

  it('leaves an unchanged answer alone — a redelivery bumps nothing', () => {
    expect(plan({ stored: stored(4) })).toEqual({
      statsWriteDecision: 'UNCHANGED',
      writes: [],
    });
  });

  it('bumps both documents when only the spend moved', () => {
    const next = plan({
      stored: stored(4),
      money: { ...money, lifetimeSpendCents: unwrapOk(PriceCents.of(3000)) },
    });
    expect(next.statsWriteDecision === 'WRITE' && next.version).toBe(5);
  });

  it('rewrites a pair whose versions disagree', () => {
    const next = plan({ stored: stored(4, 3) });
    expect(next.statsWriteDecision === 'WRITE' && next.version).toBe(5);
  });

  it('empties the stats of somebody who left every visit, rather than keeping stale numbers', () => {
    const next = plan({
      stored: stored(4),
      stats: { ...content, lifetimeVisitsCompleted: 0 },
      money: { ...money, lifetimeSpendCents: PriceCents.ZERO },
      hasHistory: false,
    });
    expect(next.statsWriteDecision === 'WRITE' && next.version).toBe(5);
  });

  it('never goes backwards past a stored version it could not parse', () => {
    const broken: StoredClientStats = {
      ...NOTHING,
      statsPresent: true,
      statsVersion: 9,
    };
    const next = plan({ stored: broken });
    expect(next.statsWriteDecision === 'WRITE' && next.version).toBe(10);
  });

  it('carries the pass stamp on a write, and moves it alone on an unchanged answer', () => {
    const changedAt = PreciseInstant.of(1_790_000_000, 0);
    if (changedAt === null) throw new Error('a broken fixture instant');
    const pass = { generation: 'evt-a', changedAt };
    const written = plan({ stamp: pass, restamp: true });
    expect(bodyOf(written.writes[0])).toMatchObject({
      policyPassGeneration: 'evt-a',
      policyPassChangedAtSeconds: 1_790_000_000,
      policyPassChangedAtNanos: 0,
    });
    const moved = plan({ stored: stored(4), stamp: pass, restamp: true });
    expect(moved).toEqual({
      statsWriteDecision: 'UNCHANGED',
      writes: [WriteOp.update(PATHS.stats, PolicyPassStamp.of(pass))],
    });
    // The stamp's root fields alone — never a nested `policyPass` (Law 5).
    expect(moved.writes[0]).toMatchObject({
      writeAction: WriteAction.Update,
      fields: {
        policyPassGeneration: 'evt-a',
        policyPassChangedAtSeconds: 1_790_000_000,
        policyPassChangedAtNanos: 0,
      },
    });
  });

  it('judges two answers by their content alone — the bookkeeping and the stamp aside (sampleDiff)', () => {
    const fresh = { stats: content, money };
    const storedPair = {
      stats: {
        ...content,
        ...meta(7),
        id: ANA,
        ...PolicyPassStamp.NONE,
      },
      money: { ...money, ...meta(7) },
    };
    expect(ClientStatsSystem.sameAnswer(storedPair, fresh)).toBe(true);
    expect(
      ClientStatsSystem.sameAnswer(storedPair, {
        ...fresh,
        stats: { ...content, avgCadenceDays: 28 },
      }),
    ).toBe(false);
    expect(
      ClientStatsSystem.sameAnswer(storedPair, {
        ...fresh,
        money: { ...money, lifetimeSpendCents: unwrapOk(PriceCents.of(1)) },
      }),
    ).toBe(false);
  });

  it('converges: what it writes, read back, is unchanged', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.option(fc.integer({ min: 0, max: 50 }), { nil: null }),
        (visits, spend, storedVersion) => {
          const fresh = {
            stats: { ...content, lifetimeVisitsCompleted: visits },
            money: {
              ...money,
              lifetimeSpendCents: unwrapOk(PriceCents.of(spend)),
            },
          };
          const before =
            storedVersion === null ? NOTHING : stored(storedVersion);
          const first = plan({ ...fresh, stored: before });
          if (first.statsWriteDecision !== 'WRITE') return;
          const after: StoredClientStats = {
            statsPresent: true,
            moneyPresent: true,
            stats: bodyOf(first.writes[0]) as ClientStats & ClientStatsMeta,
            money: bodyOf(first.writes[1]) as ClientMoneyStats &
              ClientStatsMeta,
            statsVersion: first.version,
            moneyVersion: first.version,
          };
          expect(plan({ ...fresh, stored: after }).statsWriteDecision).toBe(
            'UNCHANGED',
          );
        },
      ),
    );
  });
});

describe('placementsFrom', () => {
  const rows = (
    raw: readonly {
      id: string;
      placement?: unknown;
      inferredPlacement?: unknown;
    }[],
  ) =>
    raw.map((row) => ({
      id: AppointmentId.of(row.id),
      placement: Placement.parse(row.placement ?? null),
    }));

  it('names each stored placement and leaves a legacy row out', () => {
    expect([
      ...ClientStatsSystem.placementsFrom(
        rows([
          { id: 'a1', placement: 'SELF' },
          { id: 'a2', placement: 'STAFF' },
          { id: 'a3', placement: null },
          { id: 'a4' },
          { id: 'a5', placement: 'guessed' },
        ]),
      ),
    ]).toEqual([
      ['a1', 'SELF'],
      ['a2', 'STAFF'],
    ]);
  });

  // legacyPref: a pre-P0 row's seats carry the old defaulted `SPECIFIC`, so
  // what the audit trail says about who placed it is no evidence of a request.
  it('never passes an inferred placement on as evidence', () => {
    expect([
      ...ClientStatsSystem.placementsFrom(
        rows([
          { id: 'p1', inferredPlacement: 'STAFF' },
          { id: 'p2', placement: null, inferredPlacement: 'SELF' },
          { id: 'n1', placement: 'STAFF', inferredPlacement: 'SELF' },
        ]),
      ),
    ]).toEqual([['n1', 'STAFF']]);
  });
});

describe('purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const history = deepFreeze([
      build(
        solo('a1', daysAgo(40), WORKED, { barber: 'ivan', pref: 'SPECIFIC' }),
      ),
      build(
        solo('a2', daysAgo(20), WORKED, { barber: 'ivan', pref: 'SPECIFIC' }),
      ),
      build(solo('a3', daysAgo(10), NO_SHOW)),
      build({
        id: 'a4',
        startMs: daysAgo(5),
        seats: [
          { who: 'ana', outcome: WORKED, price: 3000 },
          { who: 'bob', outcome: WORKED, price: 1000 },
        ],
        percentOff: 10,
      }),
    ]);
    const policy = deepFreeze(policyWithWindow(12));
    const now = deepFreeze(NOW);
    const once = ClientStatsSystem.compute(RECORDS.ana, history, policy, now);
    const twice = ClientStatsSystem.compute(RECORDS.ana, history, policy, now);
    expect(twice).toEqual(once);
    expect(once.stats.preferredBarberId).toBe('ivan');
    expect(ClientStatsSystem.statWindows(deepFreeze(once.stats), now)).toEqual(
      ClientStatsSystem.statWindows(once.stats, now),
    );
    const entity = deepFreeze(appointmentFixture());
    expect(ClientStatsSystem.statsInputOf(entity)).toEqual(
      ClientStatsSystem.statsInputOf(entity),
    );
  });
});
