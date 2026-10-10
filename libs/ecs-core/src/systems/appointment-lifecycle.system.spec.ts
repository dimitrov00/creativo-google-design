import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AuditAction } from '../components/audit-context.data';
import type { BookingContact } from '../components/booking-contact.data';
import { E164 } from '../components/phone-number.data';
import { BookingState, BookingStatus } from '../components/booking-status.data';
import {
  SchedulingError,
  SchedulingErrorCode,
} from '../components/scheduling-errors.data';
import {
  CancellationReason,
  CancelledBy,
  SeatOutcome,
  SeatOutcomeKind,
} from '../components/seat-outcome.data';
import {
  type Seat,
  SeatId,
  SeatRelationship,
  SeatSubject,
} from '../components/seat.data';
import { ServiceTerms } from '../components/service-terms.data';
import type { TimeInterval } from '../components/time-interval.data';
import type { AppointmentEntity } from '../entities/appointment.entity';
import { BarberId } from '../entities/barber.entity';
import { UserId } from '../entities/user.entity';
import {
  appointmentFixture,
  dayTableFixture,
  deepFreeze,
  fixtureTodayAt,
  seatFixture,
  unwrapErr,
  unwrapOk,
} from '../testing';
import { AppointmentIndexSystem } from './appointment-index.system';
import {
  AppointmentLifecycleSystem,
  type LifecycleTransitionRequest,
} from './appointment-lifecycle.system';
import { AuditSystem } from './audit.system';

/*
 * The lifecycle cases of libs/domain/scheduling/src/lib/appointment.spec.ts,
 * copied (the class spec keeps running against its shim): admission and the
 * party's invariants, the transition matrix, cancel, the write-time
 * captures, seat outcomes, the correction edges and arrival — over plain
 * entities. `isSuccess(r)` → `r.ok`; the verbs' instant is a parameter.
 */

/** The instant a lifecycle verb is taken. Fixed so outcomes are comparable. */
const RESOLVED_AT_MS = fixtureTodayAt(9);
/** Before the visit's day — what "now" is when a booking is made. */
const BOOKING_NOW_MS = fixtureTodayAt(0) - 30 * 86_400_000;
const MINUTE = 60_000;
const DAYS = dayTableFixture('2026-09-27', '2026-09-30');

let seq = 0;
function nextSeatId(): SeatId {
  seq += 1;
  return SeatId.of(`seat-${seq}`);
}
function nextUser(): UserId {
  seq += 1;
  return UserId.of(`user-${seq}`);
}
function nextBarber(): BarberId {
  seq += 1;
  return BarberId.of(`barber-${seq}`);
}

type SeatOverrides = {
  readonly relationship?: 'self' | 'companion';
  readonly userId?: UserId;
  readonly barberId?: BarberId;
  /** Minutes after local midnight of the fixture day. */
  readonly startMinute?: number;
  readonly priceMinorUnits?: number;
  readonly durationMinutes?: number;
  readonly currencyCode?: string;
};

function seat(overrides: SeatOverrides = {}): Seat {
  const terms = ServiceTerms.unpadded(
    overrides.priceMinorUnits ?? 1500,
    overrides.currencyCode ?? 'EUR',
    overrides.durationMinutes ?? 30,
  );
  return seatFixture({
    id: nextSeatId(),
    subject: SeatSubject.account(
      overrides.userId ?? nextUser(),
      overrides.relationship === 'companion'
        ? SeatRelationship.Companion
        : SeatRelationship.Self,
    ),
    barberId: overrides.barberId ?? nextBarber(),
    terms: {
      ...terms,
      catalogPriceMinorUnits: null,
      catalogDurationMinutes: null,
    },
    startMs: fixtureTodayAt(0) + (overrides.startMinute ?? 600) * MINUTE,
  });
}

/** `quarter` quarter-hours after 10:00, as minutes of the day. */
function quarterPast10(quarter: number): number {
  return 10 * 60 + quarter * 15;
}

function visit(
  seats: readonly Seat[],
  status: BookingStatus = BookingStatus.confirm(BOOKING_NOW_MS),
  overrides: Partial<AppointmentEntity> = {},
): AppointmentEntity {
  return appointmentFixture({ seats, bookingStatus: status, ...overrides });
}

function withStatus(status: BookingStatus): AppointmentEntity {
  return visit([seat()], status);
}

/** The envelope of a visit that has seats — a broken fixture otherwise. */
function envelopeOf(appointment: AppointmentEntity): TimeInterval {
  const envelope = AppointmentIndexSystem.envelope(appointment);
  if (envelope === null)
    throw new Error('a visit with no seats — a broken fixture');
  return envelope;
}

/** The id of the seat at `index` — a broken fixture when there is none. */
function seatIdAt(appointment: AppointmentEntity, index: number): SeatId {
  const seat = appointment.seats.at(index);
  if (seat === undefined)
    throw new Error(`no seat ${index} — a broken fixture`);
  return seat.id;
}

const PENDING = BookingStatus.pending(BOOKING_NOW_MS);
const CONFIRMED = BookingStatus.confirm(BOOKING_NOW_MS);
const COMPLETED = BookingStatus.complete(BOOKING_NOW_MS);
const NO_SHOW = BookingStatus.noShow(BOOKING_NOW_MS);

function codes(errors: readonly SchedulingError[]): readonly string[] {
  return errors.map((error) => error.code);
}

function party(): AppointmentEntity {
  return visit([seat(), seat({ relationship: 'companion' })]);
}

function seatCancelled(
  reason: CancellationReason,
  windowHours: number | null,
): SeatOutcome {
  return SeatOutcome.cancelled(
    RESOLVED_AT_MS,
    CancelledBy.Client,
    reason,
    windowHours,
  );
}

function request(
  to: BookingState,
  overrides: Partial<LifecycleTransitionRequest> = {},
): LifecycleTransitionRequest {
  return { to, seatId: null, reason: null, windowHours: null, ...overrides };
}

describe('AppointmentLifecycleSystem.admit — a new visit', () => {
  it('admits a visit in the future', () => {
    expect(AppointmentLifecycleSystem.admit([seat()], BOOKING_NOW_MS)).toEqual(
      [],
    );
  });

  it('rejects scheduling into the past', () => {
    expect(
      codes(AppointmentLifecycleSystem.admit([seat()], fixtureTodayAt(23))),
    ).toEqual([SchedulingErrorCode.AppointmentPastStartTime]);
  });

  it('rejects an empty seats array', () => {
    expect(codes(AppointmentLifecycleSystem.admit([], BOOKING_NOW_MS))).toEqual(
      [SchedulingErrorCode.AppointmentEmptySeats],
    );
  });

  it('rejects the booker in two chairs at once — two overlapping `self` seats for ONE account', () => {
    const booker = nextUser();
    expect(
      codes(
        AppointmentLifecycleSystem.admit(
          [seat({ userId: booker }), seat({ userId: booker })],
          BOOKING_NOW_MS,
        ),
      ),
    ).toContain('scheduling.appointment.multiple_self_seats');
  });

  it('seats two `self` accounts side by side — the person is the account, not the relationship', () => {
    expect(
      AppointmentLifecycleSystem.admit([seat(), seat()], BOOKING_NOW_MS),
    ).toEqual([]);
  });

  it('refuses overlapping `self` seats exactly when ONE account holds both (property)', () => {
    const accounts = [nextUser(), nextUser(), nextUser()];
    const anySeat = fc.record({
      account: fc.nat({ max: accounts.length - 1 }),
      quarter: fc.nat({ max: 8 }),
      minutes: fc.constantFrom(15, 30, 45, 60),
    });
    fc.assert(
      fc.property(
        fc.array(anySeat, { minLength: 1, maxLength: 4 }),
        (drawn) => {
          const seats = drawn.map((entry) => ({
            ...entry,
            seat: seat({
              userId: accounts.at(entry.account),
              startMinute: quarterPast10(entry.quarter),
              durationMinutes: entry.minutes,
            }),
          }));
          const onePersonTwoChairs = seats.some((a, i) =>
            seats.some(
              (b, j) =>
                j > i &&
                a.account === b.account &&
                a.seat.startMs < b.seat.startMs + b.minutes * MINUTE &&
                b.seat.startMs < a.seat.startMs + a.minutes * MINUTE,
            ),
          );
          const refused = codes(
            AppointmentLifecycleSystem.admit(
              seats.map((entry) => entry.seat),
              BOOKING_NOW_MS,
            ),
          ).includes('scheduling.appointment.multiple_self_seats');
          expect(refused).toBe(onePersonTwoChairs);
        },
      ),
    );
  });
});

describe('AppointmentLifecycleSystem — the arrangements a party may take', () => {
  const IVAN = BarberId.of('ivan');
  const NIKO = BarberId.of('niko');

  it('accepts a PARALLEL party — same start, different barbers', () => {
    const seats = [
      seat({ barberId: IVAN, startMinute: 600, durationMinutes: 45 }),
      seat({ relationship: 'companion', barberId: NIKO, startMinute: 600 }),
    ];
    expect(AppointmentLifecycleSystem.admit(seats, BOOKING_NOW_MS)).toEqual([]);
    // The envelope is the LONGEST seat, not the sum — served at once.
    expect(AppointmentIndexSystem.envelope({ seats })).toEqual({
      startMs: fixtureTodayAt(10),
      endMs: fixtureTodayAt(10, 45),
    });
  });

  it('accepts a SEQUENTIAL party with ONE barber — father and son, back to back', () => {
    const seats = [
      seat({ barberId: IVAN, durationMinutes: 45, startMinute: 600 }),
      seat({
        relationship: 'companion',
        barberId: IVAN,
        durationMinutes: 30,
        startMinute: 645,
      }),
    ];
    expect(AppointmentLifecycleSystem.admit(seats, BOOKING_NOW_MS)).toEqual([]);
    expect(AppointmentIndexSystem.envelope({ seats })?.endMs).toBe(
      fixtureTodayAt(11, 15),
    );
  });

  it('rejects one barber in two chairs at once', () => {
    expect(
      codes(
        AppointmentLifecycleSystem.admit(
          [
            seat({ barberId: IVAN, startMinute: 600, durationMinutes: 45 }),
            seat({
              relationship: 'companion',
              barberId: IVAN,
              startMinute: 630,
            }),
          ],
          BOOKING_NOW_MS,
        ),
      ),
    ).toContain('scheduling.appointment.barber_double_booked');
  });

  it('names each double-booked barber once, not once per colliding pair', () => {
    const errors = AppointmentLifecycleSystem.admit(
      [
        seat({ barberId: IVAN, startMinute: 600, durationMinutes: 60 }),
        seat({ relationship: 'companion', barberId: IVAN, startMinute: 610 }),
        seat({ relationship: 'companion', barberId: IVAN, startMinute: 620 }),
      ],
      BOOKING_NOW_MS,
    );
    expect(errors).toEqual([
      SchedulingError.appointmentBarberDoubleBooked(IVAN),
    ]);
  });

  it('takes the future-start check from the EARLIEST seat', () => {
    const errors = AppointmentLifecycleSystem.admit(
      [
        seat({ startMinute: 600, durationMinutes: 30 }),
        seat({ relationship: 'companion', startMinute: 840 }),
      ],
      fixtureTodayAt(12),
    );
    expect(codes(errors)).toEqual([
      SchedulingErrorCode.AppointmentPastStartTime,
    ]);
  });

  it('rejects seats priced in two currencies', () => {
    expect(
      AppointmentLifecycleSystem.seatViolations([
        seat({ currencyCode: 'EUR' }),
        seat({
          relationship: 'companion',
          barberId: NIKO,
          currencyCode: 'USD',
        }),
      ]),
    ).toEqual([SchedulingError.appointmentMixedCurrency('EUR', 'USD')]);
  });
});

/*
 * THE REVISION A COPY WAS READ AT: a fact about the copy, carried unchanged
 * through every in-memory verb — none of them is a write.
 */
describe('AppointmentLifecycleSystem — the revision survives every verb', () => {
  it('keeps what the reader found, zero included, through every transition', () => {
    for (const revision of [7, 0]) {
      const copy = visit([seat()], CONFIRMED, { revision });
      const arrived = unwrapOk(
        AppointmentLifecycleSystem.markArrived(copy, RESOLVED_AT_MS),
      );
      expect(arrived.appointment.revision).toBe(revision);
      const cleared = unwrapOk(
        AppointmentLifecycleSystem.clearArrival(arrived.appointment),
      );
      expect(cleared.appointment.revision).toBe(revision);
      const completed = unwrapOk(
        AppointmentLifecycleSystem.complete(copy, RESOLVED_AT_MS),
      );
      expect(completed.appointment.revision).toBe(revision);
    }
  });
});

describe('Appointment status transition matrix (goal condition item)', () => {
  const LEGAL: Record<string, readonly string[]> = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['completed', 'cancelled', 'no_show'],
    completed: [],
    cancelled: [],
    no_show: ['confirmed'],
  };

  const STARTING: Record<string, BookingStatus> = {
    pending: PENDING,
    confirmed: CONFIRMED,
    completed: COMPLETED,
    cancelled: BookingStatus.cancel(BOOKING_NOW_MS, 'customer request'),
    no_show: NO_SHOW,
  };

  /*
   * The class's own verbs — `confirm` on a no-show is the graph's correction
   * edge, decided by `partyVerb` exactly as the class's `confirm()` did.
   */
  const VERBS: Record<
    string,
    (appointment: AppointmentEntity) => { readonly ok: boolean }
  > = {
    confirmed: (a) =>
      AppointmentLifecycleSystem.partyVerb(
        { status: a.bookingStatus, outcomes: a.seats.map((s) => s.outcome) },
        BookingState.Confirmed,
        null,
        RESOLVED_AT_MS,
        '',
      ),
    completed: (a) => AppointmentLifecycleSystem.complete(a, RESOLVED_AT_MS),
    cancelled: (a) =>
      AppointmentLifecycleSystem.cancel(
        a,
        CancellationReason.Other,
        24,
        RESOLVED_AT_MS,
      ),
    no_show: (a) => AppointmentLifecycleSystem.markNoShow(a, RESOLVED_AT_MS),
  };

  const legal = new Map(Object.entries(LEGAL));
  for (const [from, status] of Object.entries(STARTING)) {
    for (const [to, verb] of Object.entries(VERBS)) {
      const shouldSucceed = (legal.get(from) ?? []).includes(to);
      it(`${from} → ${to} is ${shouldSucceed ? 'legal' : 'illegal'}`, () => {
        expect(verb(withStatus(status)).ok).toBe(shouldSucceed);
      });
    }
  }
});

describe('AppointmentLifecycleSystem.cancel', () => {
  it('rejects a cancel that names no reason', () => {
    const error = unwrapErr(
      AppointmentLifecycleSystem.transition(
        withStatus(PENDING),
        request(BookingState.Cancelled),
        RESOLVED_AT_MS,
        DAYS,
      ),
    );
    expect(error.code).toBe(
      SchedulingErrorCode.AppointmentEmptyCancellationReason,
    );
  });

  it('carries the reason structurally on the cancelled status — the code', () => {
    const step = unwrapOk(
      AppointmentLifecycleSystem.cancel(
        withStatus(PENDING),
        CancellationReason.ClientChangedPlans,
        24,
        RESOLVED_AT_MS,
      ),
    );
    expect(step.appointment.bookingStatus).toEqual(
      BookingStatus.cancel(RESOLVED_AT_MS, 'client_changed_plans'),
    );
  });

  it('stamps the window in force on the seats it closes — the rule it is judged by', () => {
    const step = unwrapOk(
      AppointmentLifecycleSystem.cancelByClient(
        withStatus(CONFIRMED),
        CancellationReason.Other,
        6,
        RESOLVED_AT_MS,
      ),
    );
    expect(step.appointment.seats[0]?.outcome).toEqual({
      kind: 'cancelled',
      atMs: RESOLVED_AT_MS,
      by: 'client',
      reason: { kind: 'other' },
      windowHours: 6,
    });
  });
});

describe('AppointmentLifecycleSystem — the write-time captures', () => {
  it('reports booking lead time in minutes', () => {
    const one = visit([seat({ startMinute: 600 })], PENDING, {
      bookedAtMs: fixtureTodayAt(9),
    });
    expect(AppointmentLifecycleSystem.bookingLeadTimeMinutes(one)).toBe(60);
  });

  it('has no lead time for an appointment written before bookedAt existed', () => {
    expect(
      AppointmentLifecycleSystem.bookingLeadTimeMinutes(
        visit([seat()], PENDING, { bookedAtMs: null }),
      ),
    ).toBeNull();
  });

  it('measures lateness from the start — negative when early, null before arrival', () => {
    const one = visit([seat({ startMinute: 600 })], CONFIRMED, {
      arrivedAtMs: fixtureTodayAt(10, 7),
    });
    expect(AppointmentLifecycleSystem.latenessMinutes(one)).toBe(7);
    expect(
      AppointmentLifecycleSystem.latenessMinutes({
        ...one,
        arrivedAtMs: fixtureTodayAt(9, 55),
      }),
    ).toBe(-5);
    expect(
      AppointmentLifecycleSystem.latenessMinutes({ ...one, arrivedAtMs: null }),
    ).toBeNull();
  });
});

describe('AppointmentLifecycleSystem — seat outcomes', () => {
  it('starts every seat scheduled', () => {
    expect(
      party().seats.every((s) => s.outcome.kind === SeatOutcomeKind.Scheduled),
    ).toBe(true);
    expect(AppointmentLifecycleSystem.openSeats(party())).toHaveLength(2);
  });

  it('keeps the root unchanged while any seat is still open', () => {
    const appointment = party();
    const marked = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        appointment,
        seatIdAt(appointment, 0),
        SeatOutcome.worked(RESOLVED_AT_MS),
        RESOLVED_AT_MS,
      ),
    );
    expect(marked.bookingStatus.kind).toBe('confirmed');
    expect(AppointmentLifecycleSystem.openSeats(marked)).toHaveLength(1);
  });

  it('summarises a mixed party as completed while keeping the no-show visible', () => {
    const appointment = party();
    const first = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        appointment,
        seatIdAt(appointment, 0),
        SeatOutcome.worked(RESOLVED_AT_MS),
        RESOLVED_AT_MS,
      ),
    );
    const second = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        first,
        seatIdAt(first, 1),
        SeatOutcome.noShow(RESOLVED_AT_MS),
        RESOLVED_AT_MS,
      ),
    );
    expect(second.bookingStatus.kind).toBe('completed');
    expect(second.seats[0]?.outcome.kind).toBe('worked');
    expect(second.seats[1]?.outcome.kind).toBe('no_show');
  });

  it('summarises an all-cancelled party as cancelled, with groupable codes', () => {
    const appointment = party();
    const first = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        appointment,
        seatIdAt(appointment, 0),
        seatCancelled(CancellationReason.ClientUnwell, 24),
        RESOLVED_AT_MS,
      ),
    );
    const second = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        first,
        seatIdAt(first, 1),
        seatCancelled(CancellationReason.ClientChangedPlans, 24),
        RESOLVED_AT_MS,
      ),
    );
    expect(second.bookingStatus).toEqual(
      BookingStatus.cancel(
        RESOLVED_AT_MS,
        'client_changed_plans+client_unwell',
      ),
    );
  });

  it('refuses a seat it does not hold', () => {
    const error = unwrapErr(
      AppointmentLifecycleSystem.markSeatOutcome(
        party(),
        SeatId.of('nobody'),
        SeatOutcome.worked(RESOLVED_AT_MS),
        RESOLVED_AT_MS,
      ),
    );
    expect(error).toEqual(SchedulingError.appointmentUnknownSeat('nobody'));
  });

  it('refuses to re-resolve a seat', () => {
    const appointment = party();
    const first = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        appointment,
        seatIdAt(appointment, 0),
        SeatOutcome.worked(RESOLVED_AT_MS),
        RESOLVED_AT_MS,
      ),
    );
    const again = AppointmentLifecycleSystem.markSeatOutcome(
      first,
      seatIdAt(first, 0),
      SeatOutcome.noShow(RESOLVED_AT_MS),
      RESOLVED_AT_MS,
    );
    expect(unwrapErr(again)).toEqual(
      SchedulingError.appointmentSeatAlreadyResolved(
        seatIdAt(first, 0),
        SeatOutcomeKind.Worked,
      ),
    );
  });

  it('a party cancel stamps only the seats it closes; one called off earlier keeps its own window', () => {
    const appointment = party();
    const first = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        appointment,
        seatIdAt(appointment, 0),
        seatCancelled(CancellationReason.ClientUnwell, 48),
        RESOLVED_AT_MS,
      ),
    );
    const done = unwrapOk(
      AppointmentLifecycleSystem.cancel(
        first,
        CancellationReason.StaffShopClosure,
        24,
        RESOLVED_AT_MS + 1,
      ),
    );
    expect(
      done.appointment.seats.map((s) =>
        s.outcome.kind === SeatOutcomeKind.Cancelled
          ? s.outcome.windowHours
          : undefined,
      ),
    ).toEqual([48, 24]);
  });

  it('refuses to resolve a seat on a terminal appointment', () => {
    const done = unwrapOk(
      AppointmentLifecycleSystem.cancel(
        party(),
        CancellationReason.StaffShopClosure,
        24,
        RESOLVED_AT_MS,
      ),
    );
    const terminal = {
      ...done.appointment,
      seats: done.appointment.seats.map((s) => ({
        ...s,
        outcome: SeatOutcome.scheduled(),
      })),
    };
    const error = unwrapErr(
      AppointmentLifecycleSystem.markSeatOutcome(
        terminal,
        seatIdAt(terminal, 0),
        SeatOutcome.worked(RESOLVED_AT_MS),
        RESOLVED_AT_MS,
      ),
    );
    expect(error).toEqual(
      SchedulingError.appointmentInvalidTransition(
        BookingState.Cancelled,
        BookingState.Completed,
      ),
    );
  });

  it('fans a party-level complete out to every open seat', () => {
    const step = unwrapOk(
      AppointmentLifecycleSystem.complete(party(), RESOLVED_AT_MS),
    );
    expect(
      step.appointment.seats.every((s) => s.outcome.kind === 'worked'),
    ).toBe(true);
  });

  it('leaves an already-resolved seat alone when the party completes', () => {
    const appointment = party();
    const first = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        appointment,
        seatIdAt(appointment, 0),
        SeatOutcome.noShow(RESOLVED_AT_MS),
        RESOLVED_AT_MS,
      ),
    );
    const done = unwrapOk(
      AppointmentLifecycleSystem.complete(first, RESOLVED_AT_MS + MINUTE),
    );
    expect(done.appointment.seats[0]?.outcome.kind).toBe('no_show');
    expect(done.appointment.seats[1]?.outcome.kind).toBe('worked');
  });

  it('reopens a no-show and lifts the stamp off the seats it wrote', () => {
    const marked = unwrapOk(
      AppointmentLifecycleSystem.markNoShow(
        withStatus(CONFIRMED),
        RESOLVED_AT_MS,
      ),
    );
    expect(marked.appointment.seats[0]?.outcome.kind).toBe('no_show');
    const reopened = unwrapOk(
      AppointmentLifecycleSystem.reopenNoShow(
        marked.appointment,
        RESOLVED_AT_MS,
      ),
    );
    expect(reopened.bookingStatus.kind).toBe('confirmed');
    for (const s of reopened.seats) expect(s.outcome.kind).toBe('scheduled');
  });

  it('reopening leaves a seat that was resolved on its own alone', () => {
    const base = party();
    const withSeatCancelled = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        base,
        seatIdAt(base, 0),
        seatCancelled(CancellationReason.ClientUnwell, 24),
        RESOLVED_AT_MS,
      ),
    );
    const marked = unwrapOk(
      AppointmentLifecycleSystem.markNoShow(
        withSeatCancelled,
        RESOLVED_AT_MS + 1_000,
      ),
    );
    const reopened = unwrapOk(
      AppointmentLifecycleSystem.reopenNoShow(
        marked.appointment,
        RESOLVED_AT_MS,
      ),
    );
    expect(reopened.seats[0]?.outcome.kind).toBe('cancelled');
    expect(reopened.seats[1]?.outcome.kind).toBe('scheduled');
  });

  it('refuses to reopen anything that is not a no-show', () => {
    for (const status of [PENDING, CONFIRMED, COMPLETED]) {
      expect(
        AppointmentLifecycleSystem.reopenNoShow(
          withStatus(status),
          RESOLVED_AT_MS,
        ).ok,
      ).toBe(false);
    }
  });

  it('reopens a completed visit on its own day, every seat back to scheduled', () => {
    const confirmed = unwrapOk(
      AppointmentLifecycleSystem.confirm(withStatus(PENDING), RESOLVED_AT_MS),
    );
    const completed = unwrapOk(
      AppointmentLifecycleSystem.complete(
        confirmed.appointment,
        RESOLVED_AT_MS,
      ),
    );
    expect(completed.appointment.seats[0]?.outcome.kind).toBe('worked');
    const end = envelopeOf(completed.appointment).endMs;
    const reopened = unwrapOk(
      AppointmentLifecycleSystem.reopenSettled(
        completed.appointment,
        end,
        DAYS,
      ),
    );
    expect(reopened.bookingStatus.kind).toBe('confirmed');
    expect(reopened.seats[0]?.outcome.kind).toBe('scheduled');
  });

  it('reinstates a cancelled visit on its own day', () => {
    const cancelled = unwrapOk(
      AppointmentLifecycleSystem.cancel(
        withStatus(CONFIRMED),
        CancellationReason.Other,
        24,
        RESOLVED_AT_MS,
      ),
    );
    const end = envelopeOf(cancelled.appointment).endMs;
    const back = unwrapOk(
      AppointmentLifecycleSystem.reopenSettled(
        cancelled.appointment,
        end,
        DAYS,
      ),
    );
    expect(back.bookingStatus.kind).toBe('confirmed');
    expect(back.seats[0]?.outcome.kind).toBe('scheduled');
  });

  it('refuses to reopen a settled visit the next day, or a live one at all', () => {
    const completed = withStatus(COMPLETED);
    const end = envelopeOf(completed).endMs;
    const late = AppointmentLifecycleSystem.reopenSettled(
      completed,
      end + 24 * 60 * MINUTE,
      DAYS,
    );
    expect(unwrapErr(late).code).toBe(
      'scheduling.appointment.reopen_window_closed',
    );
    const live = withStatus(CONFIRMED);
    expect(
      AppointmentLifecycleSystem.reopenSettled(
        live,
        envelopeOf(live).endMs,
        DAYS,
      ).ok,
    ).toBe(false);
  });

  it('takes an arrival stamp back, and only while the visit is live', () => {
    const live = withStatus(CONFIRMED);
    const start = envelopeOf(live).startMs;
    const arrived = unwrapOk(
      AppointmentLifecycleSystem.markArrived(live, start),
    );
    expect(arrived.appointment.arrivedAtMs).not.toBeNull();
    const cleared = unwrapOk(
      AppointmentLifecycleSystem.clearArrival(arrived.appointment),
    );
    expect(cleared.appointment.arrivedAtMs).toBeNull();
    // Idempotent: clearing what was never set is a no-op.
    expect(AppointmentLifecycleSystem.clearArrival(live).ok).toBe(true);
    expect(
      AppointmentLifecycleSystem.clearArrival(withStatus(COMPLETED)).ok,
    ).toBe(false);
  });

  it('confirming resolves nothing — it is about the booking, not the work', () => {
    const step = unwrapOk(
      AppointmentLifecycleSystem.confirm(withStatus(PENDING), RESOLVED_AT_MS),
    );
    expect(step.appointment.seats[0]?.outcome.kind).toBe('scheduled');
  });

  it('keeps the contact snapshot across a transition', () => {
    const contact: BookingContact = {
      name: 'Ivan Petrov',
      phone: E164.of('+359888123456'),
      email: null,
      note: null,
    };
    const step = unwrapOk(
      AppointmentLifecycleSystem.confirm(
        visit([seat()], PENDING, { contact }),
        RESOLVED_AT_MS,
      ),
    );
    expect(step.appointment.contact).toBe(contact);
  });
});

describe('AppointmentLifecycleSystem — arrival', () => {
  it('stamps the first arrival and audits it once; a second tap changes nothing', () => {
    const live = withStatus(CONFIRMED);
    const first = unwrapOk(
      AppointmentLifecycleSystem.markArrived(live, RESOLVED_AT_MS),
    );
    expect(first.appointment.arrivedAtMs).toBe(RESOLVED_AT_MS);
    expect(first.auditFacts).toEqual([
      expect.objectContaining({
        action: AuditAction.BookingStaffArrived,
        changeKey: `arrived:${RESOLVED_AT_MS}`,
      }),
    ]);
    const again = unwrapOk(
      AppointmentLifecycleSystem.markArrived(
        first.appointment,
        RESOLVED_AT_MS + MINUTE,
      ),
    );
    expect(again.appointment.arrivedAtMs).toBe(RESOLVED_AT_MS);
    expect(again.auditFacts).toEqual([]);
  });

  it('refuses an arrival on a settled visit — a mis-tap, not a fact', () => {
    expect(
      unwrapErr(
        AppointmentLifecycleSystem.markArrived(
          withStatus(COMPLETED),
          RESOLVED_AT_MS,
        ),
      ),
    ).toEqual(SchedulingError.appointmentNotArrivable(BookingState.Completed));
  });

  it('keys an undo by the stamp it cleared', () => {
    const arrived = visit([seat()], CONFIRMED, { arrivedAtMs: 123 });
    const cleared = unwrapOk(AppointmentLifecycleSystem.clearArrival(arrived));
    expect(cleared.auditFacts[0]?.changeKey).toBe('unarrived:123');
  });
});

describe('AppointmentLifecycleSystem.transition — the staff verbs and their facts', () => {
  it('names the verb, the reason CODE and the seat, keyed by the seat and the instant', () => {
    const appointment = party();
    const seatId = seatIdAt(appointment, 1);
    const step = unwrapOk(
      AppointmentLifecycleSystem.transition(
        appointment,
        request(BookingState.Cancelled, {
          seatId,
          reason: CancellationReason.ClientUnwell,
          windowHours: 24,
        }),
        RESOLVED_AT_MS,
        DAYS,
      ),
    );
    expect(step.auditFacts).toEqual([
      {
        action: AuditAction.BookingStaffCancelled,
        resourceId: appointment.id,
        subjects: AuditSystem.subjectsOfSeats(appointment.seats, seatId),
        changeKey: `transition:${seatId}:${RESOLVED_AT_MS}`,
        context: {
          kind: AuditAction.BookingStaffCancelled,
          reason: 'client_unwell',
          seatId,
        },
      },
    ]);
  });

  it('files a correction under its own action — reopen a no-show, reopen completed, reinstate', () => {
    const cases: readonly [BookingStatus, string][] = [
      [NO_SHOW, AuditAction.BookingStaffReopenNoShow],
      [COMPLETED, AuditAction.BookingStaffReopenCompleted],
      [
        BookingStatus.cancel(BOOKING_NOW_MS, 'unspecified'),
        AuditAction.BookingStaffReinstate,
      ],
    ];
    for (const [status, action] of cases) {
      const appointment = withStatus(status);
      const step = unwrapOk(
        AppointmentLifecycleSystem.transition(
          appointment,
          request(BookingState.Confirmed),
          envelopeOf(appointment).endMs,
          DAYS,
        ),
      );
      expect(step.auditFacts[0]?.action).toBe(action);
      expect(step.auditFacts[0]?.changeKey).toMatch(/^transition:party:/);
    }
  });

  it('refuses a per-seat confirm — confirming says nothing about the work', () => {
    const appointment = party();
    expect(
      AppointmentLifecycleSystem.transition(
        appointment,
        request(BookingState.Confirmed, { seatId: seatIdAt(appointment, 0) }),
        RESOLVED_AT_MS,
        DAYS,
      ).ok,
    ).toBe(false);
  });

  it('refuses a seat it does not hold, and a target no staff verb names', () => {
    expect(
      unwrapErr(
        AppointmentLifecycleSystem.transition(
          party(),
          request(BookingState.Completed, { seatId: SeatId.of('nobody') }),
          RESOLVED_AT_MS,
          DAYS,
        ),
      ).code,
    ).toBe(SchedulingErrorCode.AppointmentUnknownSeat);
    expect(
      AppointmentLifecycleSystem.transition(
        party(),
        request(BookingState.Pending),
        RESOLVED_AT_MS,
        DAYS,
      ).ok,
    ).toBe(false);
  });
});

describe('AppointmentLifecycleSystem.takenSince — a reinstated chair given away', () => {
  it('finds a live seat of another visit on the same barber, overlapping', () => {
    const IVAN = BarberId.of('ivan');
    const mine = visit([seat({ barberId: IVAN, startMinute: 600 })]);
    const theirs = {
      ...visit([seat({ barberId: IVAN, startMinute: 615 })]),
      id: 'other' as AppointmentEntity['id'],
    };
    expect(AppointmentLifecycleSystem.takenSince(mine, [theirs])).toBe(true);
    expect(
      AppointmentLifecycleSystem.takenSince(mine, [
        { ...theirs, bookingStatus: COMPLETED },
      ]),
    ).toBe(false);
    expect(AppointmentLifecycleSystem.takenSince(mine, [mine])).toBe(false);
    const resolved = {
      ...theirs,
      seats: theirs.seats.map((s) => ({
        ...s,
        outcome: SeatOutcome.worked(RESOLVED_AT_MS),
      })),
    };
    expect(AppointmentLifecycleSystem.takenSince(mine, [resolved])).toBe(false);
  });
});

describe('AppointmentLifecycleSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const appointment = deepFreeze(party());
    const req = deepFreeze(
      request(BookingState.Cancelled, {
        reason: CancellationReason.ClientUnwell,
        windowHours: 24,
      }),
    );
    const once = AppointmentLifecycleSystem.transition(
      appointment,
      req,
      RESOLVED_AT_MS,
      DAYS,
    );
    const twice = AppointmentLifecycleSystem.transition(
      appointment,
      req,
      RESOLVED_AT_MS,
      DAYS,
    );
    expect(twice).toEqual(once);
    expect(appointment.seats.map((s) => s.outcome.kind)).toEqual([
      'scheduled',
      'scheduled',
    ]);
  });
});
