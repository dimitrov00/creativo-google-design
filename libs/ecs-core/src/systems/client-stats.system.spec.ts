import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BookingPolicy } from '../components/booking-policy.data';
import { ClientStatsPolicy } from '../components/client-stats-policy.data';
import type {
  ClientMoneyStats,
  ClientStats,
  ClientStatsMeta,
} from '../components/client-stats.data';
import { E164 } from '../components/phone-number.data';
import { PlacementKind } from '../components/placement-kind.data';
import { SeatLabel } from '../components/seat-label.data';
import {
  CancellationReason,
  type CancelledBy,
  SeatOutcome,
} from '../components/seat-outcome.data';
import {
  Seat,
  SeatId,
  SeatRelationship,
  SeatSubject,
} from '../components/seat.data';
import { ServiceTerms } from '../components/service-terms.data';
import { SchedulingErrorCode } from '../components/scheduling-errors.data';
import { TimeInterval } from '../components/time-interval.data';
import { WriteKind, type WriteOp } from '../components/write-op.data';
import {
  AppointmentId,
  type AppointmentEntity,
} from '../entities/appointment.entity';
import { BarberId } from '../entities/barber.entity';
import { ServiceId } from '../entities/service.entity';
import { UserId } from '../entities/user.entity';
import { appointmentFixture, deepFreeze, seatFixture } from '../testing';
import {
  type BilledAppointment,
  ClientStatsSystem,
  type ClientStatsWriteInput,
  type StoredClientStats,
} from './client-stats.system';

/*
 * The cases of libs/domain/scheduling/src/lib/client-stats.spec.ts (the BGN
 * → EUR case included) and of apps/functions/src/lib/clients/
 * client-stats-projection.spec.ts (the canonical-JSON change detection, the
 * subjects, the clock, the revision guard, the placements), copied — the
 * legacy specs keep running against their shims — and re-targeted to plain
 * structs: an appointment is the stats slice of the entity with its bill,
 * ids are plain strings (`x.value` → `x`), the spend is a nested `Money`.
 * The policy-pass cases of the projection spec live in
 * `policy-recompute-job.system.spec.ts`, beside the guard they exercise.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** The clock every case reads — a Thursday noon in Sofia. */
const NOW = Date.parse('2026-09-24T09:00:00.000Z');
/** The shipping free-cancellation window — what a cancel stamps by default. */
const DEFAULT_WINDOW_HOURS = BookingPolicy.DEFAULT.cancellationWindowHours;

const PEOPLE = {
  ana: UserId.of('ana'),
  bob: UserId.of('bob'),
} as const;
type Who = keyof typeof PEOPLE | 'guest';

type OutcomeSpec =
  | { readonly kind: 'scheduled' }
  | { readonly kind: 'worked' }
  | { readonly kind: 'no_show' }
  | {
      readonly kind: 'cancelled';
      readonly by: CancelledBy;
      readonly reason: Exclude<CancellationReason, 'other'>;
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
  readonly placement?: PlacementKind | null;
  /** False for a legacy row with no booking instant. */
  readonly booked?: boolean;
  readonly currency?: string;
  /** A percent-off discount on the whole bill. */
  readonly percentOff?: number;
}

const SEAT_MINUTES = 30;
/** Seats run back to back, so no party ever double-books a barber or a person. */
const SEAT_STRIDE_MS = 45 * 60_000;

function outcomeOf(spec: OutcomeSpec, visitStartMs: number): SeatOutcome {
  switch (spec.kind) {
    case 'scheduled':
      return SeatOutcome.scheduled();
    case 'worked':
      return SeatOutcome.worked(visitStartMs + SEAT_MINUTES * 60_000);
    case 'no_show':
      return SeatOutcome.noShow(visitStartMs + 15 * 60_000);
    case 'cancelled':
      return SeatOutcome.cancelled(
        visitStartMs - spec.leadHours * HOUR,
        spec.by,
        spec.reason,
        spec.windowHours === undefined
          ? DEFAULT_WINDOW_HOURS
          : spec.windowHours,
      );
  }
}

function seatOf(spec: SeatSpec, index: number, visit: VisitSpec): Seat {
  const currency = visit.currency ?? 'EUR';
  const charged = ServiceTerms.unpadded(
    spec.price ?? 2000,
    currency,
    SEAT_MINUTES,
  );
  return {
    id: SeatId.of(`${visit.id}-seat-${index}`),
    serviceId: ServiceId.of(spec.service ?? 'cut'),
    variantId: null,
    barberId: BarberId.of(spec.barber ?? `barber-${index}`),
    barberPref: spec.pref ?? null,
    terms: Seat.termsOf(charged, null),
    startMs: visit.startMs + index * SEAT_STRIDE_MS,
    subject:
      spec.who === 'guest'
        ? SeatSubject.anonymous(SeatLabel.of('Гост'))
        : SeatSubject.account(
            PEOPLE[spec.who],
            spec.who === 'ana'
              ? SeatRelationship.Self
              : SeatRelationship.Companion,
          ),
    outcome: outcomeOf(spec.outcome, visit.startMs),
    tip:
      spec.tip == null
        ? null
        : { amountMinorUnits: spec.tip, currencyCode: currency },
  };
}

/** The visit as the stats read it, with its bill (the discount taken off the subtotal). */
function build(visit: VisitSpec): BilledAppointment {
  const seats = visit.seats.map((spec, index) => seatOf(spec, index, visit));
  let subtotal = 0;
  let endMs = visit.startMs;
  for (const seat of seats) {
    subtotal += seat.terms.priceMinorUnits;
    endMs = Math.max(endMs, Seat.endMs(seat));
  }
  const off =
    visit.percentOff === undefined
      ? 0
      : Math.round((subtotal * visit.percentOff) / 100);
  const currencyCode = visit.currency ?? 'EUR';
  return {
    id: AppointmentId.of(visit.id),
    timeInterval: TimeInterval.of(visit.startMs, endMs),
    bookedAtMs: visit.booked === false ? null : visit.startMs - 7 * DAY,
    placement: visit.placement === undefined ? 'self' : visit.placement,
    seats,
    bill: {
      subtotal: { amountMinorUnits: subtotal, currencyCode },
      total: { amountMinorUnits: subtotal - off, currencyCode },
    },
  };
}

function stats(
  visits: readonly VisitSpec[],
  who: Who = 'ana',
  nowMs = NOW,
  policy = ClientStatsPolicy.DEFAULT,
): ClientStats {
  if (who === 'guest') throw new Error('guests have no stats');
  const person = who === 'ana' ? PEOPLE.ana : PEOPLE.bob;
  return ClientStatsSystem.stats(person, visits.map(build), policy, nowMs);
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

const daysAgo = (days: number): number => NOW - days * DAY;
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

describe('stats — cancellations', () => {
  const cancel = (
    by: CancelledBy,
    reason: Exclude<CancellationReason, 'other'>,
    leadHours: number,
  ): OutcomeSpec => ({ kind: 'cancelled', by, reason, leadHours });

  it('counts a client cancel inside the window as late, and outside it as a cancel only', () => {
    const result = stats([
      solo('late', daysAgo(20), cancel('client', 'unspecified', 2)),
      solo('early', daysAgo(10), cancel('client', 'unspecified', 48)),
    ]);
    expect(result.lifetime.clientCancels).toBe(2);
    expect(result.lifetime.lateCancels).toBe(1);
    expect(result.last365.lateCancels.map((f) => f.appointmentId)).toEqual([
      'late',
    ]);
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
describe('stats — a cancellation keeps the window it was made under', () => {
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
      anaUnder(2, history).last365.lateCancels.map((f) => f.appointmentId),
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
          (f) => f.appointmentId,
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
  const clientCaused = ClientStatsSystem.clientCaused;

  // The two `other` rows of the legacy spec carried a note; the reason is
  // code-only now (§9 D23), so they are the same `other` by either side.
  it.each<[CancellationReason, CancelledBy, boolean]>([
    ['client_changed_plans', 'staff', true],
    ['client_unwell', 'client', true],
    ['staff_barber_absence', 'client', false],
    ['staff_shop_closure', 'staff', false],
    ['unspecified', 'client', true],
    ['unspecified', 'staff', false],
    ['other', 'client', true],
    ['other', 'staff', false],
    ['no_show_converted', 'staff', false],
  ])('%s by %s → %s', (reason, by, expected) => {
    expect(clientCaused({ by, reason: { kind: reason } })).toBe(expected);
  });

  it('takes a converted no-show’s side from the correction', () => {
    const converted = {
      by: 'staff' as const,
      reason: { kind: CancellationReason.NoShowConverted },
    };
    expect(clientCaused(converted, 'client')).toBe(true);
    expect(clientCaused(converted, 'shop')).toBe(false);
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
    expect(result.lifetime.visitsCompleted).toBe(3);
    expect(result.last365.visitsCompleted.map((f) => f.appointmentId)).toEqual([
      'year',
      'recent',
    ]);
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
      ClientStatsSystem.statWindows(result, NOW + 180 * DAY).visitsCompleted,
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
      solo('later', NOW + 20 * DAY, { kind: 'scheduled' }),
      solo('next', NOW + 5 * DAY, { kind: 'scheduled' }, { service: 'cut' }),
    ]);
    expect(result.firstVisitAtMs).toBe(daysAgo(90));
    expect(result.lastVisit?.appointmentId).toBe('last');
    expect(result.lastVisit?.serviceIds).toEqual(['cut', 'beard']);
    expect(result.lastVisit?.barberIds).toEqual(['ivan']);
    expect(result.lastVisit?.legs).toHaveLength(2);
    expect(result.lastVisit?.legs[1]?.minutes).toBe(SEAT_MINUTES);
    // The unsettled visit two days ago is not "next"; the nearest future one is.
    expect(result.nextVisit?.appointmentId).toBe('next');
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

describe('stats — preferred barber and usual services', () => {
  it('names a barber asked for by name on two of the last three visits', () => {
    const result = stats([
      solo('a', daysAgo(90), WORKED, { barber: 'petar', pref: 'specific' }),
      solo('b', daysAgo(60), WORKED, { barber: 'ivan', pref: 'specific' }),
      solo('c', daysAgo(30), WORKED, { barber: 'ivan', pref: 'specific' }),
      solo('d', daysAgo(5), WORKED, { barber: 'petar', pref: 'any' }),
    ]);
    expect(result.preferredBarberId).toBe('ivan');
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
        .preferredBarberId,
    ).toBe('niko');
  });

  // The pre-P0 commit stored an omitted preference as `specific`. The
  // backfill may learn from the audit trail that the desk placed these, but
  // it records that as an inference, which never reaches `placement` — so
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
      stats([...history, asked('d', 20), asked('e', 10)]).preferredBarberId,
    ).toBe('petar');
  });

  it('reads no placements at all as no evidence', () => {
    const history = [
      solo('a', daysAgo(60), WORKED, { barber: 'ivan', pref: 'specific' }),
      solo('b', daysAgo(30), WORKED, { barber: 'ivan', pref: 'specific' }),
    ];
    expect(
      ClientStatsSystem.stats(
        PEOPLE.ana,
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

  it('raises at three no-shows inside sixty days, on the newest one', () => {
    const result = stats(three);
    expect(result.pauseSuggestion).toEqual({
      noShows: 3,
      windowDays: 60,
      basis: ['n1', 'n2', 'n3'],
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
    const at = ClientStatsSystem.pauseSuggestionAt;
    expect(at(result.last365.noShows, NOW + 15 * DAY)).toBeNull();
    expect(
      at(result.last365.noShows, NOW, ClientStatsPolicy.DEFAULT, daysAgo(1)),
    ).toBeNull();
    expect(
      at(result.last365.noShows, NOW, ClientStatsPolicy.DEFAULT, daysAgo(10))
        ?.noShows,
    ).toBe(3);
  });
});

describe('money', () => {
  it('sums worked seats, never tips, no-shows or cancellations', () => {
    const result = ClientStatsSystem.money(PEOPLE.ana, [
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
      lifetimeSpend: { amountMinorUnits: 2500, currencyCode: 'EUR' },
    });
  });

  it('takes the person’s pro-rata share of a discount', () => {
    const result = ClientStatsSystem.money(PEOPLE.ana, [
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
    expect(result.lifetimeSpend.amountMinorUnits).toBe(2700);
  });

  it('converts a legacy leva price at the fixed rate', () => {
    const result = ClientStatsSystem.money(PEOPLE.ana, [
      build({
        ...solo('a1', daysAgo(900), WORKED, { price: 3912 }),
        currency: 'BGN',
      }),
    ]);
    expect(result.lifetimeSpend).toEqual({
      amountMinorUnits: 2000,
      currencyCode: 'EUR',
    });
  });

  it('leaves out a price in a currency with no fixed rate, and a free visit', () => {
    const result = ClientStatsSystem.money(PEOPLE.ana, [
      build({
        ...solo('a1', daysAgo(30), WORKED, { price: 5000 }),
        currency: 'USD',
      }),
      build(solo('a2', daysAgo(20), WORKED, { price: 0 })),
      build(solo('a3', daysAgo(10), WORKED, { price: 1200 })),
    ]);
    expect(result.lifetimeSpend.amountMinorUnits).toBe(1200);
  });

  it('is what compute returns beside the stats, from one read of the history', () => {
    const history = [
      build(solo('a1', daysAgo(30), WORKED, { price: 2500 })),
      build(solo('a2', daysAgo(5), NO_SHOW)),
    ];
    expect(
      ClientStatsSystem.compute(
        PEOPLE.ana,
        history,
        ClientStatsPolicy.DEFAULT,
        NOW,
      ),
    ).toEqual({
      stats: ClientStatsSystem.stats(
        PEOPLE.ana,
        history,
        ClientStatsPolicy.DEFAULT,
        NOW,
      ),
      money: ClientStatsSystem.money(PEOPLE.ana, history),
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
      expect(result.error[0]?.code).toBe(
        SchedulingErrorCode.ClientStatsPolicyInvalid,
      );
      expect(result.error[0]?.code).toBe(
        'scheduling.client_stats_policy.invalid',
      );
    }
  });

  it('draws the late line exactly where the free cancellation ends', () => {
    const policy = ClientStatsPolicy.DEFAULT;
    const start = NOW + 3 * DAY;
    const deadline = start - policy.booking.cancellationWindowHours * HOUR;
    expect(
      ClientStatsPolicy.isLateCancellation(policy, start, deadline, null),
    ).toBe(false);
    expect(
      ClientStatsPolicy.isLateCancellation(policy, start, deadline + 1, null),
    ).toBe(true);
  });

  it('draws a stamped line where THAT window ended, whatever the policy says now', () => {
    const start = NOW + 3 * DAY;
    const deadline = start - 6 * HOUR;
    for (const today of [0, 6, 24, 168]) {
      const policy = policyWithWindow(today);
      expect(
        ClientStatsPolicy.isLateCancellation(policy, start, deadline, 6),
      ).toBe(false);
      expect(
        ClientStatsPolicy.isLateCancellation(policy, start, deadline + 1, 6),
      ).toBe(true);
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
      .array(fc.constantFrom<PlacementKind | null>('self', 'staff', null), {
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
            ClientStatsSystem.money(PEOPLE.ana, shuffled.map(build)),
          ).toEqual(ClientStatsSystem.money(PEOPLE.ana, history.map(build)));
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

describe('subjectVisitOf — one appointment, one person’s story', () => {
  const party = (seats: readonly SeatSpec[]): BilledAppointment =>
    build({ id: 'appt-party', startMs: daysAgo(3), seats });

  it('is the person’s own seats, the visit’s span and their outcome', () => {
    const appointment = party([
      { who: 'ana', outcome: WORKED, service: 'fade' },
      { who: 'bob', outcome: NO_SHOW },
      { who: 'ana', outcome: WORKED, service: 'beard' },
    ]);
    const visit = ClientStatsSystem.subjectVisitOf(PEOPLE.ana, appointment);
    expect(visit?.appointment).toBe(appointment);
    expect(visit?.seats.map((seat) => seat.serviceId)).toEqual([
      'fade',
      'beard',
    ]);
    expect(visit?.atMs).toBe(appointment.timeInterval.startMs);
    expect(visit?.endMs).toBe(appointment.timeInterval.endMs);
    expect(visit?.outcome).toEqual({ kind: 'worked' });
  });

  // A companion's no-show says nothing about the booker, and the reverse.
  it('reads each person from their seats alone', () => {
    const appointment = party([
      { who: 'ana', outcome: WORKED },
      { who: 'bob', outcome: NO_SHOW },
    ]);
    expect(
      ClientStatsSystem.subjectVisitOf(PEOPLE.bob, appointment)?.outcome,
    ).toEqual({ kind: 'no_show' });
  });

  it('keeps a visit open while any of the person’s seats is', () => {
    const appointment = party([
      { who: 'ana', outcome: { kind: 'scheduled' } },
      { who: 'ana', outcome: NO_SHOW },
    ]);
    expect(
      ClientStatsSystem.subjectVisitOf(PEOPLE.ana, appointment)?.outcome.kind,
    ).toBe('open');
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
    const outcome = ClientStatsSystem.subjectVisitOf(
      PEOPLE.ana,
      appointment,
    )?.outcome;
    expect(outcome?.kind).toBe('cancelled');
    if (outcome?.kind === 'cancelled') {
      expect(outcome.decisive.by).toBe('staff');
      expect(ClientStatsSystem.clientCaused(outcome.decisive)).toBe(false);
    }
  });

  it('is null for a person with no seat on the appointment', () => {
    const appointment = party([
      { who: 'bob', outcome: WORKED },
      { who: 'guest', outcome: WORKED },
    ]);
    expect(
      ClientStatsSystem.subjectVisitOf(PEOPLE.ana, appointment),
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
          ClientStatsSystem.subjectVisitOf(PEOPLE.ana, appointment)?.outcome
            .kind,
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

/* ── The projection: client-stats-projection.spec.ts ─────────────────── */

describe('statsInputChanged — the early exit (§13 R28)', () => {
  const seat = seatFixture({ barberPref: 'specific' });
  const visit = (
    overrides: Partial<AppointmentEntity> = {},
  ): AppointmentEntity =>
    appointmentFixture({ placement: null, seats: [seat], ...overrides });
  const base = visit();
  const changed = ClientStatsSystem.statsInputChanged;

  it('ignores what no stat reads: a tip, an arrival, a contact, a revision', () => {
    expect(
      changed(
        base,
        visit({
          seats: [
            { ...seat, tip: { amountMinorUnits: 500, currencyCode: 'EUR' } },
          ],
          arrivedAtMs: base.timeInterval.startMs - 2 * 60_000,
          contact: {
            name: 'Ана',
            phone: E164.of('+359888000000'),
            email: null,
            note: null,
          },
          revision: 4,
          subjectUserIds: [UserId.of('ana')],
        }),
      ),
    ).toBe(false);
  });

  // The preferred barber counts only visits their commit stamped (§11.2 #6).
  it('wakes on a placement stamped or changed', () => {
    const placed = visit({ placement: 'self' });
    expect(changed(base, placed)).toBe(true);
    expect(changed(placed, visit({ placement: 'staff' }))).toBe(true);
    expect(changed(placed, visit({ placement: 'self' }))).toBe(false);
  });

  // The backfill's inference is no stat's input, so stamping it on a
  // pre-P0 row moves nobody's stats and wakes no recompute.
  it('sleeps through an inferred placement', () => {
    expect(changed(base, visit({ inferredPlacement: 'staff' }))).toBe(false);
  });

  it('wakes on an outcome, a subject, a time or a price', () => {
    const changes = [
      { ...seat, outcome: SeatOutcome.noShow(1) },
      {
        ...seat,
        subject: SeatSubject.account(UserId.of('bob'), SeatRelationship.Self),
      },
      { ...seat, startMs: seat.startMs + DAY },
      { ...seat, terms: { ...seat.terms, priceMinorUnits: 1800 } },
    ];
    for (const next of changes) {
      expect(changed(base, visit({ seats: [next] }))).toBe(true);
    }
  });

  it('wakes on a create and a delete', () => {
    expect(changed(null, base)).toBe(true);
    expect(changed(base, null)).toBe(true);
  });

  it('does not mistake a reordered map for a change', () => {
    const reversed = <T extends object>(value: T): T =>
      Object.fromEntries(Object.entries(value).reverse()) as T;
    const reordered: AppointmentEntity = {
      ...reversed(base),
      bookingStatus: reversed(base.bookingStatus),
      seats: base.seats.map((entry) => ({
        ...reversed(entry),
        terms: reversed(entry.terms),
      })),
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
        Date.parse('2026-09-25T09:00:00.000Z'),
        Date.parse('2026-09-25T10:00:00.000Z'),
      ),
    ).toBe(Date.parse('2026-09-25T10:00:00.000Z'));
    expect(ClientStatsSystem.projectionClock(5, null)).toBe(5);
    expect(ClientStatsSystem.projectionClock(5, Number.NaN)).toBe(5);
  });
});

describe('planWrite (planClientStatsWrite) — the revision guard', () => {
  const NOW_W = Date.parse('2026-09-25T10:00:00.000Z');
  const ANA = UserId.of('ana');
  const PATHS = {
    stats: ['clientStats', ANA],
    money: ['clientStats', ANA, 'restricted', 'money'],
  } as const;
  const content: ClientStats = {
    userId: ANA,
    lifetime: {
      visitsCompleted: 1,
      noShows: 0,
      lateCancels: 0,
      clientCancels: 0,
    },
    last365: { visitsCompleted: [], noShows: [], lateCancels: [] },
    firstVisitAtMs: null,
    lastVisit: null,
    nextVisit: null,
    avgCadenceDays: null,
    preferredBarberId: null,
    usualServiceIds: [],
    pauseSuggestion: null,
  };
  const money: ClientMoneyStats = {
    userId: ANA,
    lifetimeSpend: { amountMinorUnits: 2500, currencyCode: 'EUR' },
  };
  const meta = (version: number): ClientStatsMeta => ({
    version,
    updatedAtMs: NOW_W - 1000,
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
    stored: NOTHING,
    stats: content,
    money,
    hasHistory: true,
    nowMs: NOW_W,
    stamp: null,
    restamp: false,
    ...overrides,
  });
  const plan = (overrides: Partial<ClientStatsWriteInput> = {}) =>
    ClientStatsSystem.planWrite(input(overrides), PATHS);
  const bodyOf = (op: WriteOp | undefined) =>
    op !== undefined && op.kind === WriteKind.Set ? op.body : null;

  it('writes nothing for a person with no history and nothing stored', () => {
    expect(plan({ hasHistory: false })).toEqual({
      kind: 'unchanged',
      writes: [],
    });
  });

  it('writes both documents at version 1 the first time', () => {
    const first = plan();
    expect(first.kind).toBe('write');
    if (first.kind !== 'write') return;
    expect(first.version).toBe(1);
    const [stats, spend] = first.writes;
    expect(stats?.path).toEqual(PATHS.stats);
    expect(spend?.path).toEqual(PATHS.money);
    expect(bodyOf(stats)?.['version']).toBe(1);
    expect(bodyOf(spend)?.['version']).toBe(1);
    expect(bodyOf(stats)?.['updatedAtMs']).toBe(NOW_W);
    expect(bodyOf(stats)).not.toHaveProperty('lifetimeSpend');
  });

  it('leaves an unchanged answer alone — a redelivery bumps nothing', () => {
    expect(plan({ stored: stored(4) })).toEqual({
      kind: 'unchanged',
      writes: [],
    });
  });

  it('bumps both documents when only the spend moved', () => {
    const next = plan({
      stored: stored(4),
      money: {
        ...money,
        lifetimeSpend: { amountMinorUnits: 3000, currencyCode: 'EUR' },
      },
    });
    expect(next.kind === 'write' && next.version).toBe(5);
  });

  it('rewrites a pair whose versions disagree', () => {
    const next = plan({ stored: stored(4, 3) });
    expect(next.kind === 'write' && next.version).toBe(5);
  });

  it('empties the stats of somebody who left every visit, rather than keeping stale numbers', () => {
    const next = plan({
      stored: stored(4),
      stats: {
        ...content,
        lifetime: { ...content.lifetime, visitsCompleted: 0 },
      },
      money: {
        ...money,
        lifetimeSpend: { amountMinorUnits: 0, currencyCode: 'EUR' },
      },
      hasHistory: false,
    });
    expect(next.kind === 'write' && next.version).toBe(5);
  });

  it('never goes backwards past a stored version it could not parse', () => {
    const broken: StoredClientStats = {
      ...NOTHING,
      statsPresent: true,
      statsVersion: 9,
    };
    const next = plan({ stored: broken });
    expect(next.kind === 'write' && next.version).toBe(10);
  });

  it('carries the pass stamp on a write, and moves it alone on an unchanged answer', () => {
    const stamp = {
      generation: 'evt-a',
      changedAt: { seconds: 1_790_000_000, nanos: 0 },
    };
    const written = plan({ stamp, restamp: true });
    expect(bodyOf(written.writes[0])?.['policyPass']).toBe(stamp);
    expect(plan({ stored: stored(4), stamp, restamp: true })).toEqual({
      kind: 'unchanged',
      writes: [
        { kind: 'update', path: PATHS.stats, fields: { policyPass: stamp } },
      ],
    });
  });

  it('judges two answers by their content alone — the bookkeeping and the stamp aside (sampleDiff)', () => {
    const fresh = { stats: content, money };
    const storedPair = {
      stats: {
        ...content,
        ...meta(7),
        id: ANA,
        policyPass: null,
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
        money: {
          ...money,
          lifetimeSpend: { amountMinorUnits: 1, currencyCode: 'EUR' },
        },
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
            stats: {
              ...content,
              lifetime: { ...content.lifetime, visitsCompleted: visits },
            },
            money: {
              ...money,
              lifetimeSpend: { amountMinorUnits: spend, currencyCode: 'EUR' },
            },
          };
          const before =
            storedVersion === null ? NOTHING : stored(storedVersion);
          const first = plan({ ...fresh, stored: before });
          if (first.kind !== 'write') return;
          const after: StoredClientStats = {
            statsPresent: true,
            moneyPresent: true,
            stats: bodyOf(first.writes[0]) as ClientStats & ClientStatsMeta,
            money: bodyOf(first.writes[1]) as ClientMoneyStats &
              ClientStatsMeta,
            statsVersion: first.version,
            moneyVersion: first.version,
          };
          expect(plan({ ...fresh, stored: after }).kind).toBe('unchanged');
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
      id: row.id,
      placement: PlacementKind.parse(row.placement ?? null),
    }));

  it('names each stored placement and leaves a legacy row out', () => {
    expect([
      ...ClientStatsSystem.placementsFrom(
        rows([
          { id: 'a1', placement: 'self' },
          { id: 'a2', placement: 'staff' },
          { id: 'a3', placement: null },
          { id: 'a4' },
          { id: 'a5', placement: 'guessed' },
        ]),
      ),
    ]).toEqual([
      ['a1', 'self'],
      ['a2', 'staff'],
    ]);
  });

  // legacyPref: a pre-P0 row's seats carry the old defaulted `specific`, so
  // what the audit trail says about who placed it is no evidence of a request.
  it('never passes an inferred placement on as evidence', () => {
    expect([
      ...ClientStatsSystem.placementsFrom(
        rows([
          { id: 'p1', inferredPlacement: 'staff' },
          { id: 'p2', placement: null, inferredPlacement: 'self' },
          { id: 'n1', placement: 'staff', inferredPlacement: 'self' },
        ]),
      ),
    ]).toEqual([['n1', 'staff']]);
  });
});

describe('purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const history = deepFreeze([
      build(
        solo('a1', daysAgo(40), WORKED, { barber: 'ivan', pref: 'specific' }),
      ),
      build(
        solo('a2', daysAgo(20), WORKED, { barber: 'ivan', pref: 'specific' }),
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
    const once = ClientStatsSystem.compute(PEOPLE.ana, history, policy, NOW);
    const twice = ClientStatsSystem.compute(PEOPLE.ana, history, policy, NOW);
    expect(twice).toEqual(once);
    expect(once.stats.preferredBarberId).toBe('ivan');
    expect(ClientStatsSystem.statWindows(deepFreeze(once.stats), NOW)).toEqual(
      ClientStatsSystem.statWindows(once.stats, NOW),
    );
    const entity = deepFreeze(appointmentFixture());
    expect(ClientStatsSystem.statsInputOf(entity)).toEqual(
      ClientStatsSystem.statsInputOf(entity),
    );
  });
});
