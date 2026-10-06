import { Money, Result, ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { BarberId, ServiceId, ServiceTerms } from '@creativo/domain/catalog';
import { CouponValue } from '@creativo/domain/engagement';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AppliedDiscount } from './applied-discount';
import { Appointment } from './appointment';
import { CONFIRMED } from './appointment-status';
import { BarberPref } from './barber-pref';
import { BookingPolicy } from './booking-policy';
import { CancellationWindow } from './cancellation-window';
import {
  ClientStats,
  type VisitPlacement,
  type VisitPlacements,
  clientCaused,
  computeClientMoneyStats,
  computeClientStats,
  pauseSuggestionAt,
  statWindows,
  subjectVisitOf,
} from './client-stats';
import { ClientStatsPolicy } from './client-stats-policy';
import { AppointmentId, SeatId } from './ids';
import { Seat, SeatSubject } from './seat';
import { SeatLabel } from './seat-label';
import {
  CancellationReason,
  SEAT_SCHEDULED,
  SeatOutcome,
  summarizeSeatOutcomes,
} from './seat-outcome';

const ZONE = 'Europe/Sofia';
const DAY = 86_400_000;
const HOUR = 3_600_000;
/** The clock every case reads — a Thursday noon in Sofia. */
const NOW = Date.parse('2026-09-24T09:00:00.000Z');
/** The shipping free-cancellation window — what a cancel stamps by default. */
const DEFAULT_WINDOW_HOURS = BookingPolicy.default().cancellationWindowHours;

function must<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`bad fixture: ${String(result.error)}`);
  }
  return result.value;
}

/** A stamp of `hours`, or unknown. */
function windowOf(hours: number): CancellationWindow;
function windowOf(hours: number | null): CancellationWindow | null;
function windowOf(hours: number | null): CancellationWindow | null {
  return hours === null ? null : must(CancellationWindow.create(hours));
}

const PEOPLE = {
  ana: must(UserId.create('ana')),
  bob: must(UserId.create('bob')),
} as const;
type Who = keyof typeof PEOPLE | 'guest';

type OutcomeSpec =
  | { readonly kind: 'scheduled' }
  | { readonly kind: 'worked' }
  | { readonly kind: 'no_show' }
  | {
      readonly kind: 'cancelled';
      readonly by: 'client' | 'staff';
      readonly reason: Exclude<CancellationReason['kind'], 'other'>;
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
  readonly pref?: 'any' | 'specific' | null;
  readonly price?: number;
  readonly tip?: number | null;
}

interface VisitSpec {
  readonly id: string;
  readonly startMs: number;
  readonly seats: readonly SeatSpec[];
  /** Who put it in the book — `self` unless a case says otherwise; `null` is a legacy import. */
  readonly placement?: VisitPlacement | null;
  /** False for a legacy row with no booking instant. */
  readonly booked?: boolean;
  readonly currency?: string;
  readonly discount?: CouponValue;
}

const SEAT_MINUTES = 30;
/** Seats run back to back, so no party ever double-books a barber or a person. */
const SEAT_STRIDE_MS = 45 * 60_000;

function zoned(ms: number): ZonedDateTime {
  return must(ZonedDateTime.fromMillis(ms, ZONE));
}

function outcomeOf(spec: OutcomeSpec, visitStartMs: number): SeatOutcome {
  switch (spec.kind) {
    case 'scheduled':
      return SEAT_SCHEDULED;
    case 'worked':
      return { kind: 'worked', atMs: visitStartMs + SEAT_MINUTES * 60_000 };
    case 'no_show':
      return { kind: 'no_show', atMs: visitStartMs + 15 * 60_000 };
    case 'cancelled':
      return {
        kind: 'cancelled',
        atMs: visitStartMs - spec.leadHours * HOUR,
        by: spec.by,
        reason: { kind: spec.reason } as CancellationReason,
        window: windowOf(
          spec.windowHours === undefined
            ? DEFAULT_WINDOW_HOURS
            : spec.windowHours,
        ),
      };
  }
}

function seatOf(spec: SeatSpec, index: number, visit: VisitSpec): Seat {
  const currency = visit.currency ?? 'EUR';
  const price = must(Money.fromMinorUnitsAndCode(spec.price ?? 2000, currency));
  const barberId = must(BarberId.create(spec.barber ?? `barber-${index}`));
  const subject =
    spec.who === 'guest'
      ? SeatSubject.anonymous(must(SeatLabel.create('Гост')))
      : SeatSubject.account(
          PEOPLE[spec.who],
          spec.who === 'ana' ? 'self' : 'companion',
        );
  const tip =
    spec.tip == null
      ? null
      : must(Money.fromMinorUnitsAndCode(spec.tip, currency));
  const pref = spec.pref ?? null;
  return Seat.of({
    id: must(SeatId.create(`${visit.id}-seat-${index}`)),
    subject,
    serviceId: must(ServiceId.create(spec.service ?? 'cut')),
    variantId: null,
    barberId,
    pref:
      pref === null
        ? null
        : pref === 'any'
          ? BarberPref.any()
          : BarberPref.specific(barberId),
    terms: must(ServiceTerms.create(price, SEAT_MINUTES)),
    startsAt: zoned(visit.startMs + index * SEAT_STRIDE_MS),
    outcome: outcomeOf(spec.outcome, visit.startMs),
    tip,
  });
}

function build(visit: VisitSpec): Appointment {
  const seats = visit.seats.map((spec, index) => seatOf(spec, index, visit));
  const discounts =
    visit.discount === undefined
      ? []
      : [
          AppliedDiscount.of({
            id: 'manual',
            source: 'manual',
            label: 'Отстъпка',
            value: visit.discount,
            appliedAt: zoned(visit.startMs),
          }),
        ];
  return must(
    Appointment.reconstitute({
      id: visit.id,
      locationId: 'shop-1',
      seats,
      status: summarizeSeatOutcomes(
        seats.map((seat) => seat.outcome),
        CONFIRMED,
      ),
      bookedAt: visit.booked === false ? null : zoned(visit.startMs - 7 * DAY),
      discounts,
    }),
  );
}

/** Each visit's placement as the stored rows carry it — a legacy row has none. */
function placementsOf(visits: readonly VisitSpec[]): VisitPlacements {
  const placements = new Map<string, VisitPlacement>();
  for (const visit of visits) {
    const placement = visit.placement === undefined ? 'self' : visit.placement;
    if (placement !== null) placements.set(visit.id, placement);
  }
  return placements;
}

function stats(
  visits: readonly VisitSpec[],
  who: Who = 'ana',
  nowMs = NOW,
  policy = ClientStatsPolicy.default(),
) {
  if (who === 'guest') throw new Error('guests have no stats');
  const person = who === 'ana' ? PEOPLE.ana : PEOPLE.bob;
  return computeClientStats(
    person,
    visits.map(build),
    nowMs,
    policy,
    placementsOf(visits),
  );
}

/** The shipping stats policy over a booking policy with this free-cancellation window. */
function policyWithWindow(cancellationWindowHours: number): ClientStatsPolicy {
  const defaults = BookingPolicy.default();
  return ClientStatsPolicy.forBooking(
    must(
      BookingPolicy.create({
        maxPartySize: defaults.maxPartySize,
        slotStepMinutes: defaults.slotStepMinutes,
        minLeadMinutes: defaults.minLeadMinutes,
        horizonMonths: defaults.horizonMonths,
        cancellationWindowHours,
        maxFlexibleDays: defaults.maxFlexibleDays,
        autoConfirm: defaults.autoConfirm,
      }),
    ),
  );
}

/** Ana's stats as the owner's window of `hours` would compute them. */
const anaUnder = (hours: number, visits: readonly VisitSpec[]) =>
  stats(visits, 'ana', NOW, policyWithWindow(hours));

const daysAgo = (days: number): number => NOW - days * DAY;
const WORKED: OutcomeSpec = { kind: 'worked' };
const NO_SHOW: OutcomeSpec = { kind: 'no_show' };
const solo = (
  id: string,
  startMs: number,
  outcome: OutcomeSpec,
  extra: Partial<SeatSpec> = {},
): VisitSpec => ({ id, startMs, seats: [{ who: 'ana', outcome, ...extra }] });

describe('computeClientStats — per visit, per subject', () => {
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
    expect(result.lifetime.visitsCompleted).toBe(1);
    expect(result.last365.visitsCompleted).toHaveLength(1);
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
    expect(stats([party], 'ana').lifetime).toEqual({
      visitsCompleted: 1,
      noShows: 0,
      lateCancels: 0,
      clientCancels: 0,
    });
    expect(stats([party], 'bob').lifetime).toEqual({
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
    expect(result.lifetime.noShows).toBe(1);
    expect(result.lifetime.visitsCompleted).toBe(0);
  });

  it('keeps a visit with any worked seat a visit, even with a service still to come', () => {
    const result = stats([
      {
        id: 'a1',
        startMs: NOW - HOUR,
        seats: [
          { who: 'ana', outcome: WORKED },
          { who: 'ana', outcome: { kind: 'scheduled' } },
        ],
      },
    ]);
    expect(result.lifetime.visitsCompleted).toBe(1);
    expect(result.nextVisit).toBeNull();
  });

  it('knows nothing about somebody with no seat anywhere', () => {
    const result = stats([solo('a1', daysAgo(3), WORKED)], 'bob');
    expect(result.lifetime.visitsCompleted).toBe(0);
    expect(result.lastVisit).toBeNull();
    expect(result.firstVisitAtMs).toBeNull();
  });
});

describe('computeClientStats — cancellations', () => {
  const cancel = (
    by: 'client' | 'staff',
    reason: Exclude<CancellationReason['kind'], 'other'>,
    leadHours: number,
  ): OutcomeSpec => ({ kind: 'cancelled', by, reason, leadHours });

  it('counts a client cancel inside the window as late, and outside it as a cancel only', () => {
    const result = stats([
      solo('late', daysAgo(20), cancel('client', 'unspecified', 2)),
      solo('early', daysAgo(10), cancel('client', 'unspecified', 48)),
    ]);
    expect(result.lifetime.clientCancels).toBe(2);
    expect(result.lifetime.lateCancels).toBe(1);
    expect(
      result.last365.lateCancels.map((f) => f.appointmentId.value),
    ).toEqual(['late']);
  });

  it('counts a client reason the desk filed as the client’s', () => {
    const result = stats([
      solo('a1', daysAgo(5), cancel('staff', 'client_unwell', 1)),
    ]);
    expect(result.lifetime.lateCancels).toBe(1);
  });

  it('never counts a shop-caused cancellation, however late', () => {
    const result = stats([
      solo('a1', daysAgo(5), cancel('staff', 'staff_barber_absence', 1)),
      solo('a2', daysAgo(6), cancel('staff', 'staff_shop_closure', 1)),
      solo('a3', daysAgo(7), cancel('staff', 'unspecified', 1)),
    ]);
    expect(result.lifetime.clientCancels).toBe(0);
    expect(result.lifetime.lateCancels).toBe(0);
  });

  it('holds a converted no-show against nobody until a correction says whose it was', () => {
    const result = stats([
      solo('a1', daysAgo(5), cancel('staff', 'no_show_converted', 0)),
    ]);
    expect(result.lifetime.clientCancels).toBe(0);
  });

  it('never calls a legacy row late — its cancellation instant is derived', () => {
    const legacy: VisitSpec = {
      ...solo('a1', daysAgo(5), cancel('client', 'unspecified', 0)),
      booked: false,
    };
    const result = stats([legacy]);
    expect(result.lifetime.clientCancels).toBe(1);
    expect(result.lifetime.lateCancels).toBe(0);
  });

  it('decides a fully cancelled visit by the seat called off last', () => {
    const result = stats([
      {
        id: 'a1',
        startMs: daysAgo(5),
        seats: [
          { who: 'ana', outcome: cancel('client', 'client_changed_plans', 72) },
          { who: 'ana', outcome: cancel('staff', 'staff_barber_absence', 3) },
        ],
      },
    ]);
    expect(result.lifetime.clientCancels).toBe(0);
  });
});

/*
 * ── THE RULE IN FORCE (2026-09-25) ───────────────────────────────────────
 * A cancellation is judged by the window the policy had WHEN THE CLIENT
 * CANCELLED, stamped on the seat. Moving the window later must neither turn
 * an on-time cancel late nor let a real late one go.
 */
describe('computeClientStats — a cancellation keeps the window it was made under', () => {
  const clientCancel = (
    id: string,
    leadHours: number,
    windowHours: number | null,
  ): VisitSpec =>
    solo(id, daysAgo(10), {
      kind: 'cancelled',
      by: 'client',
      reason: 'client_changed_plans',
      leadHours,
      windowHours,
    });

  it('never turns an on-time cancel late when the owner lengthens the window', () => {
    // 30 h ahead under a 24 h window: on time, and still on time at 48 h.
    const history = [clientCancel('a1', 30, 24)];
    expect(anaUnder(24, history).lifetime.lateCancels).toBe(0);
    expect(anaUnder(48, history).lifetime.lateCancels).toBe(0);
    expect(anaUnder(48, history).lifetime.clientCancels).toBe(1);
  });

  it('never lets a real late cancel go when the owner shortens the window', () => {
    // 3 h ahead under a 24 h window: late, and still late at 2 h.
    const history = [clientCancel('a1', 3, 24)];
    expect(anaUnder(24, history).lifetime.lateCancels).toBe(1);
    expect(anaUnder(2, history).lifetime.lateCancels).toBe(1);
    expect(
      anaUnder(2, history).last365.lateCancels.map(
        (f) => f.appointmentId.value,
      ),
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
        anaUnder(today, history).last365.lateCancels.map(
          (f) => f.appointmentId.value,
        ),
      ).toEqual(['under-12']);
    }
  });

  it('falls back to the current window for a cancellation recorded before the stamp', () => {
    const legacy = [clientCancel('a1', 30, null)];
    expect(anaUnder(24, legacy).lifetime.lateCancels).toBe(0);
    expect(anaUnder(48, legacy).lifetime.lateCancels).toBe(1);
  });
});

describe('clientCaused', () => {
  it.each<[CancellationReason, 'client' | 'staff', boolean]>([
    [{ kind: 'client_changed_plans' }, 'staff', true],
    [{ kind: 'client_unwell' }, 'client', true],
    [{ kind: 'staff_barber_absence' }, 'client', false],
    [{ kind: 'staff_shop_closure' }, 'staff', false],
    [{ kind: 'unspecified' }, 'client', true],
    [{ kind: 'unspecified' }, 'staff', false],
    [{ kind: 'other', note: 'пътува' }, 'client', true],
    [{ kind: 'other', note: 'токов удар' }, 'staff', false],
    [{ kind: 'no_show_converted' }, 'staff', false],
  ])('%j by %s → %s', (reason, by, expected) => {
    expect(clientCaused({ by, reason })).toBe(expected);
  });

  it('takes a converted no-show’s side from the correction', () => {
    const converted = {
      by: 'staff' as const,
      reason: { kind: 'no_show_converted' as const },
    };
    expect(clientCaused(converted, 'client')).toBe(true);
    expect(clientCaused(converted, 'shop')).toBe(false);
  });
});

describe('computeClientStats — bounded instants and windows', () => {
  const history = [
    solo('old', daysAgo(400), WORKED),
    solo('year', daysAgo(200), WORKED),
    solo('recent', daysAgo(30), WORKED),
    solo('ns-old', daysAgo(120), NO_SHOW),
    solo('ns', daysAgo(10), NO_SHOW),
  ];

  it('keeps lifetime counts whole and instants for the last 365 days only', () => {
    const result = stats(history);
    expect(result.lifetime.visitsCompleted).toBe(3);
    expect(
      result.last365.visitsCompleted.map((f) => f.appointmentId.value),
    ).toEqual(['year', 'recent']);
  });

  it('computes the windows at read, so time alone moves a count', () => {
    const result = stats(history);
    expect(statWindows(result, NOW)).toEqual({
      visitsCompleted: { lifetime: 3, last12m: 2, last90d: 1 },
      noShows: { lifetime: 2, last12m: 2, last90d: 1 },
      lateCancels: { lifetime: 0, last12m: 0, last90d: 0 },
    });
    // Half a year on, with nothing written: both windows have moved.
    expect(statWindows(result, NOW + 180 * DAY).visitsCompleted).toEqual({
      lifetime: 3,
      last12m: 1,
      last90d: 0,
    });
  });
});

describe('computeClientStats — the visits a reader names', () => {
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
      solo('later', NOW + 20 * DAY, { kind: 'scheduled' }),
      solo('next', NOW + 5 * DAY, { kind: 'scheduled' }, { service: 'cut' }),
    ]);
    expect(result.firstVisitAtMs).toBe(daysAgo(90));
    expect(result.lastVisit?.appointmentId.value).toBe('last');
    expect(result.lastVisit?.serviceIds.map((id) => id.value)).toEqual([
      'cut',
      'beard',
    ]);
    expect(result.lastVisit?.barberIds.map((id) => id.value)).toEqual(['ivan']);
    expect(result.lastVisit?.legs).toHaveLength(2);
    expect(result.lastVisit?.legs[1]?.minutes).toBe(SEAT_MINUTES);
    // The unsettled visit two days ago is not "next"; the nearest future one is.
    expect(result.nextVisit?.appointmentId.value).toBe('next');
  });
});

describe('computeClientStats — cadence (R34)', () => {
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
        by: 'staff',
        reason: 'staff_barber_absence',
        leadHours: 20,
      }),
      solo('c', daysAgo(30), WORKED),
    ]);
    // 120→90 counts (30 days); 90→30 held the shop's cancellation.
    expect(result.avgCadenceDays).toBe(30);
  });
});

describe('computeClientStats — preferred barber and usual services', () => {
  it('names a barber asked for by name on two of the last three visits', () => {
    const result = stats([
      solo('a', daysAgo(90), WORKED, { barber: 'petar', pref: 'specific' }),
      solo('b', daysAgo(60), WORKED, { barber: 'ivan', pref: 'specific' }),
      solo('c', daysAgo(30), WORKED, { barber: 'ivan', pref: 'specific' }),
      solo('d', daysAgo(5), WORKED, { barber: 'petar', pref: 'any' }),
    ]);
    expect(result.preferredBarberId?.value).toBe('ivan');
  });

  it('reads nothing into who happened to be free, or into an unknown preference', () => {
    const result = stats([
      solo('a', daysAgo(60), WORKED, { barber: 'ivan', pref: 'any' }),
      solo('b', daysAgo(30), WORKED, { barber: 'ivan', pref: null }),
      solo('c', daysAgo(5), WORKED, { barber: 'ivan', pref: 'specific' }),
    ]);
    expect(result.preferredBarberId).toBeNull();
  });

  // §11.2 #6: the placement gate. A legacy import carries no placement and
  // is no evidence, whatever its seats say — but it still takes its place
  // among the last three.
  it('ignores a visit whose placement is unknown, a legacy import', () => {
    const result = stats([
      solo('a', daysAgo(90), WORKED, { barber: 'ivan', pref: 'specific' }),
      {
        ...solo('b', daysAgo(60), WORKED, { barber: 'ivan', pref: 'specific' }),
        placement: null,
      },
      {
        ...solo('c', daysAgo(30), WORKED, { barber: 'ivan', pref: 'specific' }),
        placement: null,
      },
      solo('d', daysAgo(5), WORKED, { barber: 'ivan', pref: 'specific' }),
    ]);
    // Last three: b, c (legacy) and d — one piece of evidence, not two.
    expect(result.preferredBarberId).toBeNull();
  });

  it('counts a staff placement only where the form recorded the request', () => {
    const phoned = (id: string, days: number, pref: 'specific' | null) => ({
      ...solo(id, daysAgo(days), WORKED, { barber: 'niko', pref }),
      placement: 'staff' as const,
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
      stats([phoned('a', 60, 'specific'), phoned('b', 30, 'specific')])
        .preferredBarberId?.value,
    ).toBe('niko');
  });

  // The pre-P0 commit stored an omitted preference as `specific`. The
  // backfill may learn from the audit trail that the desk placed these, but
  // it records that as an inference, which never reaches `placements` — so
  // the chairs that happened to be free cannot become «asks for Ivan».
  it('takes no pre-P0 phone booking as a request, whoever placed it', () => {
    const prePhone = (id: string, days: number): VisitSpec => ({
      ...solo(id, daysAgo(days), WORKED, { barber: 'ivan', pref: 'specific' }),
      placement: null,
    });
    const history = [prePhone('a', 90), prePhone('b', 60), prePhone('c', 30)];
    expect(stats(history).preferredBarberId).toBeNull();

    // Two visits the P0 commit recorded her asking for Petar: the signal
    // heals from new visits alone.
    const asked = (id: string, days: number): VisitSpec =>
      solo(id, daysAgo(days), WORKED, { barber: 'petar', pref: 'specific' });
    expect(
      stats([...history, asked('d', 20), asked('e', 10)]).preferredBarberId
        ?.value,
    ).toBe('petar');
  });

  it('reads no placements at all as no evidence', () => {
    const history = [
      solo('a', daysAgo(60), WORKED, { barber: 'ivan', pref: 'specific' }),
      solo('b', daysAgo(30), WORKED, { barber: 'ivan', pref: 'specific' }),
    ];
    expect(
      computeClientStats(PEOPLE.ana, history.map(build), NOW).preferredBarberId,
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
    expect(result.usualServiceIds.map((id) => id.value)).toEqual(['cut']);
  });
});

describe('pause suggestion (R25) — a suggestion, never a pause', () => {
  const three = [
    solo('n1', daysAgo(50), NO_SHOW),
    solo('n2', daysAgo(20), NO_SHOW),
    solo('n3', daysAgo(2), NO_SHOW),
  ];

  it('raises at three no-shows inside sixty days, on the newest one', () => {
    const result = stats(three);
    expect(result.pauseSuggestion).toEqual({
      noShows: 3,
      windowDays: 60,
      basis: ['n1', 'n2', 'n3'].map((id) => must(AppointmentId.create(id))),
      raisedAtMs: daysAgo(2),
    });
  });

  it('stays quiet at two, or when the third is outside the window', () => {
    expect(stats(three.slice(1)).pauseSuggestion).toBeNull();
    expect(
      stats([solo('n0', daysAgo(70), NO_SHOW), ...three.slice(1)])
        .pauseSuggestion,
    ).toBeNull();
  });

  it('is re-checked at read: the basis ages out, and «Не сега» holds until a newer no-show', () => {
    const result = stats(three);
    expect(
      pauseSuggestionAt(result.last365.noShows, NOW + 15 * DAY),
    ).toBeNull();
    expect(
      pauseSuggestionAt(
        result.last365.noShows,
        NOW,
        ClientStatsPolicy.default(),
        daysAgo(1),
      ),
    ).toBeNull();
    expect(
      pauseSuggestionAt(
        result.last365.noShows,
        NOW,
        ClientStatsPolicy.default(),
        daysAgo(10),
      )?.noShows,
    ).toBe(3);
  });
});

describe('computeClientMoneyStats', () => {
  it('sums worked seats, never tips, no-shows or cancellations', () => {
    const result = computeClientMoneyStats(PEOPLE.ana, [
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
            by: 'client',
            reason: 'unspecified',
            leadHours: 1,
          },
          { price: 9900 },
        ),
      ),
    ]);
    expect(result).toEqual({
      userId: PEOPLE.ana,
      lifetimeSpendMinor: 2500,
      currencyCode: 'EUR',
    });
  });

  it('takes the person’s pro-rata share of a discount', () => {
    const result = computeClientMoneyStats(PEOPLE.ana, [
      build({
        id: 'a1',
        startMs: daysAgo(10),
        seats: [
          { who: 'ana', outcome: WORKED, price: 3000 },
          { who: 'bob', outcome: WORKED, price: 1000 },
        ],
        discount: must(CouponValue.percentOff(10)),
      }),
    ]);
    expect(result.lifetimeSpendMinor).toBe(2700);
  });

  it('converts a legacy leva price at the fixed rate', () => {
    const result = computeClientMoneyStats(PEOPLE.ana, [
      build({
        ...solo('a1', daysAgo(900), WORKED, { price: 3912 }),
        currency: 'BGN',
      }),
    ]);
    expect(result.lifetimeSpendMinor).toBe(2000);
  });
});

describe('ClientStatsPolicy', () => {
  it('refuses thresholds that are not positive, or a window past the stored instants', () => {
    const result = ClientStatsPolicy.create({
      booking: BookingPolicy.default(),
      suggestPauseNoShows: 0,
      suggestPauseWindowDays: 400,
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.map((error) => error.field)).toEqual([
        'suggestPauseNoShows',
        'suggestPauseWindowDays',
      ]);
      expect(result.error[0]?.code).toBe(
        'scheduling.client_stats_policy.invalid',
      );
    }
  });

  it('draws the late line exactly where the free cancellation ends', () => {
    const policy = ClientStatsPolicy.default();
    const start = NOW + 3 * DAY;
    const deadline = policy.booking.cancellationDeadlineMs(start);
    expect(policy.isLateCancellation(start, deadline, null)).toBe(false);
    expect(policy.isLateCancellation(start, deadline + 1, null)).toBe(true);
  });

  it('draws a stamped line where THAT window ended, whatever the policy says now', () => {
    const start = NOW + 3 * DAY;
    const deadline = start - 6 * HOUR;
    for (const today of [0, 6, 24, 168]) {
      const policy = policyWithWindow(today);
      expect(policy.isLateCancellation(start, deadline, windowOf(6))).toBe(
        false,
      );
      expect(policy.isLateCancellation(start, deadline + 1, windowOf(6))).toBe(
        true,
      );
    }
  });
});

// ── Properties ───────────────────────────────────────────────────────────

const REASONS = [
  'client_changed_plans',
  'client_unwell',
  'staff_barber_absence',
  'staff_shop_closure',
  'no_show_converted',
  'unspecified',
] as const;

const outcomeArb: fc.Arbitrary<OutcomeSpec> = fc.oneof(
  fc.constant<OutcomeSpec>({ kind: 'scheduled' }),
  fc.constant<OutcomeSpec>({ kind: 'worked' }),
  fc.constant<OutcomeSpec>({ kind: 'no_show' }),
  fc.record({
    kind: fc.constant('cancelled' as const),
    by: fc.constantFrom('client' as const, 'staff' as const),
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

const prefArb = fc.constantFrom<'any' | 'specific' | null>(
  'any',
  'specific',
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
      startMs: NOW + row.dayOffset * DAY + row.minute * 60_000,
      seats: row.seats,
    })),
  );

/** A history where each visit's commit stamped it, or did not (`null`). */
const stampedHistoryArb: fc.Arbitrary<VisitSpec[]> = historyArb.chain(
  (history) =>
    fc
      .array(fc.constantFrom<VisitPlacement | null>('self', 'staff', null), {
        minLength: history.length,
        maxLength: history.length,
      })
      .map((placements) =>
        history.map((visit, index) => ({
          ...visit,
          placement: placements.at(index) ?? null,
        })),
      ),
);

const ana = (history: readonly VisitSpec[]): ClientStats =>
  stats(history, 'ana');

describe('computeClientStats — properties', () => {
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
            computeClientMoneyStats(PEOPLE.ana, shuffled.map(build)),
          ).toEqual(computeClientMoneyStats(PEOPLE.ana, history.map(build)));
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
        expect(ana(history).lifetime.visitsCompleted).toBe(workedFor);
        // Listing the same appointment twice cannot double it either.
        expect(ana([...history, ...history]).lifetime).toEqual(
          ana(history).lifetime,
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
        'staff_barber_absence' as const,
        'staff_shop_closure' as const,
      ),
      by: fc.constantFrom('client' as const, 'staff' as const),
      leadHours: fc.integer({ min: 0, max: 96 }),
    });
    fc.assert(
      fc.property(
        historyArb,
        fc.array(shopCancelArb, { maxLength: 4 }),
        (history, shopCancels) => {
          const extra = shopCancels.map((cancel, index): VisitSpec =>
            solo(`shop-${index}`, NOW + cancel.dayOffset * DAY, {
              kind: 'cancelled',
              by: cancel.by,
              reason: cancel.reason,
              leadHours: cancel.leadHours,
            }),
          );
          const before = ana(history);
          const after = ana([...history, ...extra]);
          expect(after.lifetime).toEqual(before.lifetime);
          expect(after.last365).toEqual(before.last365);
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
                seat.pref === 'specific' &&
                seat.barber === preferred.value,
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

describe('subjectVisitOf — one appointment, one person’s story', () => {
  const party = (seats: readonly SeatSpec[]): Appointment =>
    build({ id: 'appt-party', startMs: daysAgo(3), seats });

  it('is the person’s own seats, the visit’s span and their outcome', () => {
    const appointment = party([
      { who: 'ana', outcome: WORKED, service: 'fade' },
      { who: 'bob', outcome: NO_SHOW },
      { who: 'ana', outcome: WORKED, service: 'beard' },
    ]);
    const visit = subjectVisitOf(PEOPLE.ana, appointment);
    expect(visit?.appointment).toBe(appointment);
    expect(visit?.seats.map((seat) => seat.serviceId.value)).toEqual([
      'fade',
      'beard',
    ]);
    expect(visit?.atMs).toBe(appointment.timeSlot.start.toMillis());
    expect(visit?.endMs).toBe(appointment.timeSlot.end.toMillis());
    expect(visit?.outcome).toEqual({ kind: 'worked' });
  });

  // A companion's no-show says nothing about the booker, and the reverse.
  it('reads each person from their seats alone', () => {
    const appointment = party([
      { who: 'ana', outcome: WORKED },
      { who: 'bob', outcome: NO_SHOW },
    ]);
    expect(subjectVisitOf(PEOPLE.bob, appointment)?.outcome).toEqual({
      kind: 'no_show',
    });
  });

  it('keeps a visit open while any of the person’s seats is', () => {
    const appointment = party([
      { who: 'ana', outcome: { kind: 'scheduled' } },
      { who: 'ana', outcome: NO_SHOW },
    ]);
    expect(subjectVisitOf(PEOPLE.ana, appointment)?.outcome.kind).toBe('open');
  });

  it('decides a cancelled visit by the seat called off last', () => {
    const appointment = party([
      {
        who: 'ana',
        outcome: {
          kind: 'cancelled',
          by: 'client',
          reason: 'client_changed_plans',
          leadHours: 48,
        },
      },
      {
        who: 'ana',
        outcome: {
          kind: 'cancelled',
          by: 'staff',
          reason: 'staff_shop_closure',
          leadHours: 2,
        },
      },
    ]);
    const outcome = subjectVisitOf(PEOPLE.ana, appointment)?.outcome;
    expect(outcome?.kind).toBe('cancelled');
    if (outcome?.kind === 'cancelled') {
      expect(outcome.decisive.by).toBe('staff');
      expect(clientCaused(outcome.decisive)).toBe(false);
    }
  });

  it('is null for a person with no seat on the appointment', () => {
    const appointment = party([
      { who: 'bob', outcome: WORKED },
      { who: 'guest', outcome: WORKED },
    ]);
    expect(subjectVisitOf(PEOPLE.ana, appointment)).toBeNull();
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
        (appointment) => subjectVisitOf(PEOPLE.ana, appointment)?.outcome.kind,
      );
    const counted = stats(visits).lifetime;
    expect(outcomes.filter((kind) => kind === 'worked')).toHaveLength(
      counted.visitsCompleted,
    );
    expect(outcomes.filter((kind) => kind === 'no_show')).toHaveLength(
      counted.noShows,
    );
  });
});
