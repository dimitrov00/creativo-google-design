import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ArrivalVerb,
  AuditAction,
  BookingContact,
  BookingLifecycle,
  Email,
  E164,
  CancellationReason,
  CancellationReasonSet,
  SeatOutcome,
  Seat,
  SeatOccupant,
  SubjectRelationship,
  ServiceTerms,
  type ShopNow,
  type StaffVerb,
} from '@core/components';
import {
  BookingStatus,
  AttendanceState,
  Currency,
  DurationMinutes,
  AppointmentId,
  AuditResourceId,
  BarberId,
  SeatId,
  UserId,
  LocalDate,
  PriceCents,
  UtcEpochMs,
} from '@core/primitives';
import { SchedulingError, SchedulingErrorCode } from '@core/errors';
import type { Appointment } from '@core/entities';
import {
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  deepFreeze,
  hourCount,
  minute,
  unwrapErr,
  unwrapOk,
  utcMs,
  type AppointmentFixtureOverrides,
  appointmentFixture,
  seatFixture,
  customerOf,
} from '@core/testing';
import { AppointmentIndexSystem } from './appointment-index.system';
import {
  AppointmentLifecycleSystem,
  type LifecycleTransitionRequest,
} from './appointment-lifecycle.system';
import { AuditSystem } from './audit.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The lifecycle cases of the legacy scheduling `appointment.spec.ts` (deleted
 * in Phase 4b; ledger `docs/architecture/flips/phase-4b-delete.md` §11.1),
 * copied while the class spec still ran against its shim: the party's
 * invariants, the transition matrix, cancel, seat outcomes, the correction
 * edges and arrival — over plain flat entities.
 * `isSuccess(r)` → `r.ok`; the verbs' instant is a parameter, and "today" is
 * the shop's `ShopNow`. Every lifecycle move goes through the one write
 * surface, `transition` (OR-20: the parked entity verbs are deleted); a case
 * that once ran with no shop clock is a reopen on another shop day, refused.
 */

/** An instant on the fixture shop's wall clock today (Sofia, UTC+3). */
const today = (hour: number, min = 0): UtcEpochMs =>
  utcMs(
    `2026-09-28T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+03:00`,
  );
/** "Now" as the fixture shop sees `instant`. */
const nowAt = (instant: UtcEpochMs): ShopNow =>
  ZonedTimeSystem.shopNow(instant, FIXTURE_TIME_ZONE);
const plus = (base: UtcEpochMs, ms: number): UtcEpochMs =>
  UtcEpochMs.plusMs(base, ms);

/** The instant a lifecycle verb is taken. Fixed so outcomes are comparable. */
const RESOLVED_AT = today(9);
/** "Now" on the shop's next day — off every fixture visit's own day. */
const NEXT_DAY = nowAt(plus(RESOLVED_AT, 86_400_000));
/** Before the visit's day — what "now" is when a booking is made. */
const BOOKING_NOW = plus(today(0), -30 * 86_400_000);
const MINUTE = 60_000;

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
  readonly priceCents?: number;
  readonly durationMinutes?: number;
  readonly currency?: Currency;
};

function seat(overrides: SeatOverrides = {}): Seat {
  const terms = ServiceTerms.unpadded(
    unwrapOk(PriceCents.of(overrides.priceCents ?? 1500)),
    overrides.currency ?? Currency.EUR,
    unwrapOk(DurationMinutes.of(overrides.durationMinutes ?? 30)),
  );
  const userId = overrides.userId ?? nextUser();
  return seatFixture({
    seatId: nextSeatId(),
    occupant: SeatOccupant.account(
      userId,
      customerOf(userId),
      overrides.relationship === 'companion'
        ? SubjectRelationship.Companion
        : SubjectRelationship.Self,
    ),
    barberId: overrides.barberId ?? nextBarber(),
    terms: Seat.termsOf(terms, null),
    startMinutes: minute(overrides.startMinute ?? 600),
  });
}

/** `quarter` quarter-hours after 10:00, as minutes of the day. */
function quarterPast10(quarter: number): number {
  return 10 * 60 + quarter * 15;
}

function visit(
  seats: readonly Seat[],
  lifecycle: BookingLifecycle = BookingLifecycle.confirm(BOOKING_NOW),
  overrides: AppointmentFixtureOverrides = {},
): Appointment {
  return appointmentFixture({ seats, lifecycle, ...overrides });
}

function withStatus(lifecycle: BookingLifecycle): Appointment {
  return visit([seat()], lifecycle);
}

/** The visit's end as an instant today — a broken fixture without seats. */
function endInstantOf(appointment: Appointment): UtcEpochMs {
  const envelope = AppointmentIndexSystem.envelope(appointment);
  if (envelope === null) {
    throw new Error('a visit with no seats — a broken fixture');
  }
  return plus(today(0), envelope.endMinutes * MINUTE);
}

/** The id of the seat at `index` — a broken fixture when there is none. */
function seatIdAt(appointment: Appointment, index: number): SeatId {
  const at = appointment.seats.at(index);
  if (at === undefined) throw new Error(`no seat ${index} — a broken fixture`);
  return at.seatId;
}

const PENDING = BookingLifecycle.pending(BOOKING_NOW);
const CONFIRMED = BookingLifecycle.confirm(BOOKING_NOW);
const COMPLETED = BookingLifecycle.complete(BOOKING_NOW);
const NO_SHOW = BookingLifecycle.noShow(BOOKING_NOW);

function codes(errors: readonly SchedulingError[]): readonly string[] {
  return errors.map((error) => error.errorCode);
}

function party(): Appointment {
  return visit([seat(), seat({ relationship: 'companion' })]);
}

function request(
  to: BookingStatus,
  overrides: Partial<LifecycleTransitionRequest> = {},
): LifecycleTransitionRequest {
  return { to, seatId: null, reason: null, windowHours: null, ...overrides };
}

/** ONE seat called off — `reason` filed with the window in force. */
function seatCancel(
  seatId: SeatId,
  reason: CancellationReason,
  windowHours: number | null,
): LifecycleTransitionRequest {
  return request(BookingStatus.Cancelled, {
    seatId,
    reason,
    windowHours: windowHours === null ? null : hourCount(windowHours),
  });
}

/*
 * A NEW VISIT'S SEATS — the invariants the commit admits a party by
 * (`Seat.violations`, which `BookingDecisionSystem.decide` runs).
 */
describe('A new visit — the invariants of its seats', () => {
  it('rejects an empty seats array', () => {
    expect(codes(Seat.violations([]))).toEqual([
      SchedulingErrorCode.AppointmentEmptySeats,
    ]);
  });

  it('rejects the booker in two chairs at once — two overlapping `SELF` seats for ONE account', () => {
    const booker = nextUser();
    expect(
      codes(
        Seat.violations([seat({ userId: booker }), seat({ userId: booker })]),
      ),
    ).toContain('SCHEDULING_APPOINTMENT_MULTIPLE_SELF_SEATS');
  });

  it('seats two `SELF` accounts side by side — the person is the account, not the relationship', () => {
    expect(Seat.violations([seat(), seat()])).toEqual([]);
  });

  it('refuses overlapping `SELF` seats exactly when ONE account holds both (property)', () => {
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
                a.seat.startMinutes < b.seat.startMinutes + b.minutes &&
                b.seat.startMinutes < a.seat.startMinutes + a.minutes,
            ),
          );
          const refused = codes(
            Seat.violations(seats.map((entry) => entry.seat)),
          ).includes('SCHEDULING_APPOINTMENT_MULTIPLE_SELF_SEATS');
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
    expect(Seat.violations(seats)).toEqual([]);
    // The envelope is the LONGEST seat, not the sum — served at once.
    expect(AppointmentIndexSystem.envelope({ seats })).toEqual({
      startMinutes: 600,
      endMinutes: 645,
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
    expect(Seat.violations(seats)).toEqual([]);
    expect(AppointmentIndexSystem.envelope({ seats })?.endMinutes).toBe(675);
  });

  it('rejects one barber in two chairs at once', () => {
    expect(
      codes(
        Seat.violations([
          seat({ barberId: IVAN, startMinute: 600, durationMinutes: 45 }),
          seat({
            relationship: 'companion',
            barberId: IVAN,
            startMinute: 630,
          }),
        ]),
      ),
    ).toContain('SCHEDULING_APPOINTMENT_BARBER_DOUBLE_BOOKED');
  });

  it('names each double-booked barber once, not once per colliding pair', () => {
    const errors = Seat.violations([
      seat({ barberId: IVAN, startMinute: 600, durationMinutes: 60 }),
      seat({ relationship: 'companion', barberId: IVAN, startMinute: 610 }),
      seat({ relationship: 'companion', barberId: IVAN, startMinute: 620 }),
    ]);
    expect(errors).toEqual([
      SchedulingError.appointmentBarberDoubleBooked(IVAN),
    ]);
  });

  it('rejects seats priced in two currencies', () => {
    expect(
      Seat.violations([
        seat({ currency: Currency.EUR }),
        seat({
          relationship: 'companion',
          barberId: NIKO,
          currency: Currency.USD,
        }),
      ]),
    ).toEqual([
      SchedulingError.appointmentMixedCurrency(Currency.EUR, Currency.USD),
    ]);
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
        AppointmentLifecycleSystem.markArrived(copy, RESOLVED_AT),
      );
      expect(arrived.appointment.revision).toBe(revision);
      const cleared = unwrapOk(
        AppointmentLifecycleSystem.clearArrival(arrived.appointment),
      );
      expect(cleared.appointment.revision).toBe(revision);
      const completed = unwrapOk(
        AppointmentLifecycleSystem.transition(
          copy,
          request(BookingStatus.Completed),
          nowAt(RESOLVED_AT),
        ),
      );
      expect(completed.appointment.revision).toBe(revision);
    }
  });
});

describe('Appointment status transition matrix (goal condition item)', () => {
  const LEGAL: Record<string, readonly string[]> = {
    PENDING: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
    COMPLETED: [],
    CANCELLED: [],
    NO_SHOW: ['CONFIRMED'],
  };

  const STARTING: Record<string, BookingLifecycle> = {
    PENDING,
    CONFIRMED,
    COMPLETED,
    CANCELLED: BookingLifecycle.cancel(
      BOOKING_NOW,
      CancellationReasonSet.of([CancellationReason.Other]),
    ),
    NO_SHOW,
  };

  /*
   * The party moves through `transition` — `CONFIRMED` on a no-show is the
   * graph's correction edge; on the shop's next day a settled visit is
   * never reopened (a reopen on another shop day is refused).
   */
  const MOVES: Record<string, LifecycleTransitionRequest> = {
    CONFIRMED: request(BookingStatus.Confirmed),
    COMPLETED: request(BookingStatus.Completed),
    CANCELLED: request(BookingStatus.Cancelled, {
      reason: CancellationReason.Other,
      windowHours: hourCount(24),
    }),
    NO_SHOW: request(BookingStatus.NoShow),
  };

  const legal = new Map(Object.entries(LEGAL));
  for (const [from, lifecycle] of Object.entries(STARTING)) {
    for (const [to, move] of Object.entries(MOVES)) {
      const shouldSucceed = (legal.get(from) ?? []).includes(to);
      it(`${from} → ${to} is ${shouldSucceed ? 'legal' : 'illegal'}`, () => {
        expect(
          AppointmentLifecycleSystem.transition(
            withStatus(lifecycle),
            move,
            NEXT_DAY,
          ).ok,
        ).toBe(shouldSucceed);
      });
    }
  }
});

describe('AppointmentLifecycleSystem — cancel', () => {
  it('rejects a cancel that names no reason', () => {
    const error = unwrapErr(
      AppointmentLifecycleSystem.transition(
        withStatus(PENDING),
        request(BookingStatus.Cancelled),
        nowAt(RESOLVED_AT),
      ),
    );
    expect(error.errorCode).toBe(
      SchedulingErrorCode.AppointmentEmptyCancellationReason,
    );
  });

  it('carries the reason structurally on the cancelled lifecycle — the code', () => {
    const step = unwrapOk(
      AppointmentLifecycleSystem.transition(
        withStatus(PENDING),
        request(BookingStatus.Cancelled, {
          reason: CancellationReason.ClientChangedPlans,
          windowHours: hourCount(24),
        }),
        nowAt(RESOLVED_AT),
      ),
    );
    expect(BookingLifecycle.sliceOf(step.appointment)).toEqual(
      BookingLifecycle.cancel(
        RESOLVED_AT,
        CancellationReasonSet.of([CancellationReason.ClientChangedPlans]),
      ),
    );
    expect('pendingAtUtcMs' in step.appointment).toBe(false);
  });

  it('stamps the window in force on the seats it closes — the rule it is judged by', () => {
    const step = unwrapOk(
      AppointmentLifecycleSystem.cancelByClient(
        withStatus(CONFIRMED),
        CancellationReason.Other,
        hourCount(6),
        RESOLVED_AT,
      ),
    );
    expect(step.appointment.seats[0]).toMatchObject({
      attendanceState: 'CANCELLED',
      cancelledAtUtcMs: RESOLVED_AT,
      cancelledBy: 'CLIENT',
      cancellationReason: 'OTHER',
      cancellationWindowHours: 6,
    });
  });

  it('plans ONE root update: the new variant set, the old variant’s fields deleted', () => {
    const before = withStatus(CONFIRMED);
    const step = unwrapOk(
      AppointmentLifecycleSystem.cancelByClient(
        before,
        CancellationReason.Other,
        hourCount(6),
        RESOLVED_AT,
      ),
    );
    expect(step.writes).toHaveLength(1);
    expect(step.writes[0]).toMatchObject({
      writeAction: 'UPDATE',
      path: ['appointments', before.id],
      fields: {
        bookingStatus: 'CANCELLED',
        cancelledAtUtcMs: RESOLVED_AT,
        cancellationReason: 'OTHER',
        seats: step.appointment.seats,
        arrivedAtUtcMs: null,
      },
      deleteFields: ['confirmedAtUtcMs'],
    });
  });
});

describe('AppointmentLifecycleSystem — seat outcomes', () => {
  it('starts every seat scheduled', () => {
    expect(
      party().seats.every(
        (s) => s.attendanceState === AttendanceState.Scheduled,
      ),
    ).toBe(true);
  });

  it('keeps the root unchanged while any seat is still open', () => {
    const appointment = party();
    const marked = unwrapOk(
      AppointmentLifecycleSystem.transition(
        appointment,
        request(BookingStatus.Completed, { seatId: seatIdAt(appointment, 0) }),
        nowAt(RESOLVED_AT),
      ),
    ).appointment;
    expect(marked.bookingStatus).toBe('CONFIRMED');
    expect(
      marked.seats.map((s) => s.attendanceState === AttendanceState.Scheduled),
    ).toEqual([false, true]);
  });

  it('summarises a mixed party as completed while keeping the no-show visible', () => {
    const appointment = party();
    const first = unwrapOk(
      AppointmentLifecycleSystem.transition(
        appointment,
        request(BookingStatus.Completed, { seatId: seatIdAt(appointment, 0) }),
        nowAt(RESOLVED_AT),
      ),
    ).appointment;
    const second = unwrapOk(
      AppointmentLifecycleSystem.transition(
        first,
        request(BookingStatus.NoShow, { seatId: seatIdAt(first, 1) }),
        nowAt(RESOLVED_AT),
      ),
    ).appointment;
    expect(second.bookingStatus).toBe('COMPLETED');
    expect(second.seats[0]?.attendanceState).toBe('WORKED');
    expect(second.seats[1]?.attendanceState).toBe('NO_SHOW');
  });

  it('summarises an all-cancelled party as cancelled, with groupable codes', () => {
    const appointment = party();
    const first = unwrapOk(
      AppointmentLifecycleSystem.transition(
        appointment,
        seatCancel(
          seatIdAt(appointment, 0),
          CancellationReason.ClientUnwell,
          24,
        ),
        nowAt(RESOLVED_AT),
      ),
    ).appointment;
    const second = unwrapOk(
      AppointmentLifecycleSystem.transition(
        first,
        seatCancel(
          seatIdAt(first, 1),
          CancellationReason.ClientChangedPlans,
          24,
        ),
        nowAt(RESOLVED_AT),
      ),
    ).appointment;
    expect(BookingLifecycle.sliceOf(second)).toEqual(
      BookingLifecycle.cancel(
        RESOLVED_AT,
        CancellationReasonSet.of([
          CancellationReason.ClientChangedPlans,
          CancellationReason.ClientUnwell,
        ]),
      ),
    );
  });

  it('refuses a seat it does not hold', () => {
    const error = unwrapErr(
      AppointmentLifecycleSystem.transition(
        party(),
        request(BookingStatus.Completed, { seatId: SeatId.of('nobody') }),
        nowAt(RESOLVED_AT),
      ),
    );
    expect(error).toEqual(
      SchedulingError.appointmentUnknownSeat(SeatId.of('nobody')),
    );
  });

  it('refuses to re-resolve a seat', () => {
    const appointment = party();
    const first = unwrapOk(
      AppointmentLifecycleSystem.transition(
        appointment,
        request(BookingStatus.Completed, { seatId: seatIdAt(appointment, 0) }),
        nowAt(RESOLVED_AT),
      ),
    ).appointment;
    const again = AppointmentLifecycleSystem.transition(
      first,
      request(BookingStatus.NoShow, { seatId: seatIdAt(first, 0) }),
      nowAt(RESOLVED_AT),
    );
    expect(unwrapErr(again)).toEqual(
      SchedulingError.appointmentSeatAlreadyResolved(
        seatIdAt(first, 0),
        AttendanceState.Worked,
      ),
    );
  });

  it('a party cancel stamps only the seats it closes; one called off earlier keeps its own window', () => {
    const appointment = party();
    const first = unwrapOk(
      AppointmentLifecycleSystem.transition(
        appointment,
        seatCancel(
          seatIdAt(appointment, 0),
          CancellationReason.ClientUnwell,
          48,
        ),
        nowAt(RESOLVED_AT),
      ),
    ).appointment;
    const done = unwrapOk(
      AppointmentLifecycleSystem.transition(
        first,
        request(BookingStatus.Cancelled, {
          reason: CancellationReason.StaffShopClosure,
          windowHours: hourCount(24),
        }),
        nowAt(plus(RESOLVED_AT, 1)),
      ),
    );
    expect(
      done.appointment.seats.map((s) =>
        s.attendanceState === AttendanceState.Cancelled
          ? s.cancellationWindowHours
          : undefined,
      ),
    ).toEqual([48, 24]);
  });

  it('refuses to resolve a seat on a terminal appointment', () => {
    const done = unwrapOk(
      AppointmentLifecycleSystem.transition(
        party(),
        request(BookingStatus.Cancelled, {
          reason: CancellationReason.StaffShopClosure,
          windowHours: hourCount(24),
        }),
        nowAt(RESOLVED_AT),
      ),
    );
    const terminal: Appointment = {
      ...done.appointment,
      seats: done.appointment.seats.map((s) =>
        Seat.withOutcome(s, SeatOutcome.scheduled()),
      ),
    };
    const error = unwrapErr(
      AppointmentLifecycleSystem.transition(
        terminal,
        request(BookingStatus.Completed, { seatId: seatIdAt(terminal, 0) }),
        nowAt(RESOLVED_AT),
      ),
    );
    expect(error).toEqual(
      SchedulingError.appointmentInvalidTransition(
        BookingStatus.Cancelled,
        BookingStatus.Completed,
      ),
    );
  });

  it('fans a party-level complete out to every open seat', () => {
    const step = unwrapOk(
      AppointmentLifecycleSystem.transition(
        party(),
        request(BookingStatus.Completed),
        nowAt(RESOLVED_AT),
      ),
    );
    expect(
      step.appointment.seats.every((s) => s.attendanceState === 'WORKED'),
    ).toBe(true);
  });

  it('leaves an already-resolved seat alone when the party completes', () => {
    const appointment = party();
    const first = unwrapOk(
      AppointmentLifecycleSystem.transition(
        appointment,
        request(BookingStatus.NoShow, { seatId: seatIdAt(appointment, 0) }),
        nowAt(RESOLVED_AT),
      ),
    ).appointment;
    const done = unwrapOk(
      AppointmentLifecycleSystem.transition(
        first,
        request(BookingStatus.Completed),
        nowAt(plus(RESOLVED_AT, MINUTE)),
      ),
    );
    expect(done.appointment.seats[0]?.attendanceState).toBe('NO_SHOW');
    expect(done.appointment.seats[1]?.attendanceState).toBe('WORKED');
  });

  it('reopens a no-show and lifts the stamp off the seats it wrote', () => {
    const marked = unwrapOk(
      AppointmentLifecycleSystem.transition(
        withStatus(CONFIRMED),
        request(BookingStatus.NoShow),
        nowAt(RESOLVED_AT),
      ),
    );
    expect(marked.appointment.seats[0]?.attendanceState).toBe('NO_SHOW');
    const reopened = unwrapOk(
      AppointmentLifecycleSystem.transition(
        marked.appointment,
        request(BookingStatus.Confirmed),
        nowAt(RESOLVED_AT),
      ),
    ).appointment;
    expect(reopened.bookingStatus).toBe('CONFIRMED');
    for (const s of reopened.seats) expect(s.attendanceState).toBe('SCHEDULED');
  });

  it('reopening leaves a seat that was resolved on its own alone', () => {
    const base = party();
    const withSeatCancelled = unwrapOk(
      AppointmentLifecycleSystem.transition(
        base,
        seatCancel(seatIdAt(base, 0), CancellationReason.ClientUnwell, 24),
        nowAt(RESOLVED_AT),
      ),
    ).appointment;
    const marked = unwrapOk(
      AppointmentLifecycleSystem.transition(
        withSeatCancelled,
        request(BookingStatus.NoShow),
        nowAt(plus(RESOLVED_AT, 1_000)),
      ),
    );
    const reopened = unwrapOk(
      AppointmentLifecycleSystem.transition(
        marked.appointment,
        request(BookingStatus.Confirmed),
        nowAt(RESOLVED_AT),
      ),
    ).appointment;
    expect(reopened.seats[0]?.attendanceState).toBe('CANCELLED');
    expect(reopened.seats[1]?.attendanceState).toBe('SCHEDULED');
  });

  it('refuses to reopen anything that is not a no-show', () => {
    // Only a NO_SHOW takes the stamp-lifting edge: a pending visit's
    // CONFIRMED is its accept, filed as one; a confirmed visit has nothing
    // to reopen; a completed one is refused on another shop day.
    const accepted = unwrapOk(
      AppointmentLifecycleSystem.transition(
        withStatus(PENDING),
        request(BookingStatus.Confirmed),
        NEXT_DAY,
      ),
    );
    expect(accepted.auditFacts[0]?.context.auditAction).toBe(
      AuditAction.BookingStaffConfirmed,
    );
    for (const lifecycle of [CONFIRMED, COMPLETED]) {
      expect(
        AppointmentLifecycleSystem.transition(
          withStatus(lifecycle),
          request(BookingStatus.Confirmed),
          NEXT_DAY,
        ).ok,
      ).toBe(false);
    }
  });

  it('reopens a completed visit on its own day, every seat back to scheduled', () => {
    const confirmed = unwrapOk(
      AppointmentLifecycleSystem.transition(
        withStatus(PENDING),
        request(BookingStatus.Confirmed),
        nowAt(RESOLVED_AT),
      ),
    );
    const completed = unwrapOk(
      AppointmentLifecycleSystem.transition(
        confirmed.appointment,
        request(BookingStatus.Completed),
        nowAt(RESOLVED_AT),
      ),
    );
    expect(completed.appointment.seats[0]?.attendanceState).toBe('WORKED');
    const end = endInstantOf(completed.appointment);
    const reopened = unwrapOk(
      AppointmentLifecycleSystem.transition(
        completed.appointment,
        request(BookingStatus.Confirmed),
        nowAt(end),
      ),
    ).appointment;
    expect(reopened.bookingStatus).toBe('CONFIRMED');
    expect(reopened.seats[0]?.attendanceState).toBe('SCHEDULED');
  });

  it('reinstates a cancelled visit on its own day', () => {
    const cancelled = unwrapOk(
      AppointmentLifecycleSystem.transition(
        withStatus(CONFIRMED),
        request(BookingStatus.Cancelled, {
          reason: CancellationReason.Other,
          windowHours: hourCount(24),
        }),
        nowAt(RESOLVED_AT),
      ),
    );
    const end = endInstantOf(cancelled.appointment);
    const back = unwrapOk(
      AppointmentLifecycleSystem.transition(
        cancelled.appointment,
        request(BookingStatus.Confirmed),
        nowAt(end),
      ),
    ).appointment;
    expect(back.bookingStatus).toBe('CONFIRMED');
    expect(back.seats[0]?.attendanceState).toBe('SCHEDULED');
  });

  it('refuses to reopen a settled visit the next day, or a live one at all', () => {
    const completed = withStatus(COMPLETED);
    const end = endInstantOf(completed);
    const late = AppointmentLifecycleSystem.transition(
      completed,
      request(BookingStatus.Confirmed),
      nowAt(plus(end, 24 * 60 * MINUTE)),
    );
    expect(unwrapErr(late).errorCode).toBe(
      'SCHEDULING_APPOINTMENT_REOPEN_WINDOW_CLOSED',
    );
    const live = withStatus(CONFIRMED);
    expect(
      AppointmentLifecycleSystem.transition(
        live,
        request(BookingStatus.Confirmed),
        nowAt(endInstantOf(live)),
      ).ok,
    ).toBe(false);
  });

  it('takes an arrival stamp back, and only while the visit is live', () => {
    const live = withStatus(CONFIRMED);
    const arrived = unwrapOk(
      AppointmentLifecycleSystem.markArrived(live, live.utcEpochMs),
    );
    expect(arrived.appointment.arrivedAtUtcMs).not.toBeNull();
    const cleared = unwrapOk(
      AppointmentLifecycleSystem.clearArrival(arrived.appointment),
    );
    expect(cleared.appointment.arrivedAtUtcMs).toBeNull();
    // Idempotent: clearing what was never set is a no-op.
    expect(AppointmentLifecycleSystem.clearArrival(live).ok).toBe(true);
    expect(
      AppointmentLifecycleSystem.clearArrival(withStatus(COMPLETED)).ok,
    ).toBe(false);
  });

  it('confirming resolves nothing — it is about the booking, not the work', () => {
    const step = unwrapOk(
      AppointmentLifecycleSystem.transition(
        withStatus(PENDING),
        request(BookingStatus.Confirmed),
        nowAt(RESOLVED_AT),
      ),
    );
    expect(step.appointment.seats[0]?.attendanceState).toBe('SCHEDULED');
  });

  it('keeps the contact snapshot across a transition', () => {
    const contact: BookingContact = {
      contactName: 'Ivan Petrov',
      contactPhone: E164.of('+359888123456'),
      contactEmail: Email.parse('ivan@example.com'),
      contactNote: null,
    };
    const step = unwrapOk(
      AppointmentLifecycleSystem.transition(
        visit([seat()], PENDING, contact),
        request(BookingStatus.Confirmed),
        nowAt(RESOLVED_AT),
      ),
    );
    expect(BookingContact.of(step.appointment)).toEqual(contact);
  });
});

describe('AppointmentLifecycleSystem — arrival', () => {
  it('stamps the first arrival and audits it once; a second tap changes nothing', () => {
    const live = withStatus(CONFIRMED);
    const first = unwrapOk(
      AppointmentLifecycleSystem.markArrived(live, RESOLVED_AT),
    );
    expect(first.appointment.arrivedAtUtcMs).toBe(RESOLVED_AT);
    expect(first.auditFacts).toEqual([
      expect.objectContaining({
        context: { auditAction: AuditAction.BookingStaffArrived },
        changeKey: `arrived:${RESOLVED_AT}`,
      }),
    ]);
    expect(first.writes[0]).toMatchObject({
      fields: { arrivedAtUtcMs: RESOLVED_AT },
      deleteFields: [],
    });
    const again = unwrapOk(
      AppointmentLifecycleSystem.markArrived(
        first.appointment,
        plus(RESOLVED_AT, MINUTE),
      ),
    );
    expect(again.appointment.arrivedAtUtcMs).toBe(RESOLVED_AT);
    expect(again.auditFacts).toEqual([]);
    expect(again.writes).toEqual([]);
  });

  it('refuses an arrival on a settled visit — a mis-tap, not a fact', () => {
    expect(
      unwrapErr(
        AppointmentLifecycleSystem.markArrived(
          withStatus(COMPLETED),
          RESOLVED_AT,
        ),
      ),
    ).toEqual(SchedulingError.appointmentNotArrivable(BookingStatus.Completed));
  });

  it('keys an undo by the stamp it cleared', () => {
    const arrived = visit([seat()], CONFIRMED, {
      arrivedAtUtcMs: unwrapOk(UtcEpochMs.of(123)),
    });
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
        request(BookingStatus.Cancelled, {
          seatId,
          reason: CancellationReason.ClientUnwell,
          windowHours: hourCount(24),
        }),
        nowAt(RESOLVED_AT),
      ),
    );
    expect(step.auditFacts).toEqual([
      {
        resourceId: AuditResourceId.forAppointment(appointment.id),
        subjects: AuditSystem.subjectsOfSeats(appointment.seats, seatId),
        changeKey: `transition:${seatId}:${RESOLVED_AT}`,
        context: {
          auditAction: AuditAction.BookingStaffCancelled,
          transitionReason: 'CLIENT_UNWELL',
          transitionSeatId: seatId,
        },
      },
    ]);
  });

  it('files a correction under its own action — reopen a no-show, reopen completed, reinstate', () => {
    const cases: readonly [BookingLifecycle, string][] = [
      [NO_SHOW, AuditAction.BookingStaffReopenNoShow],
      [COMPLETED, AuditAction.BookingStaffReopenCompleted],
      [
        BookingLifecycle.cancel(
          BOOKING_NOW,
          CancellationReasonSet.of([CancellationReason.Unspecified]),
        ),
        AuditAction.BookingStaffReinstate,
      ],
    ];
    for (const [lifecycle, action] of cases) {
      const appointment = withStatus(lifecycle);
      const step = unwrapOk(
        AppointmentLifecycleSystem.transition(
          appointment,
          request(BookingStatus.Confirmed),
          nowAt(endInstantOf(appointment)),
        ),
      );
      expect(step.auditFacts[0]?.context.auditAction).toBe(action);
      expect(step.auditFacts[0]?.changeKey).toMatch(/^transition:party:/);
    }
  });

  it('refuses a per-seat confirm — confirming says nothing about the work', () => {
    const appointment = party();
    expect(
      AppointmentLifecycleSystem.transition(
        appointment,
        request(BookingStatus.Confirmed, { seatId: seatIdAt(appointment, 0) }),
        nowAt(RESOLVED_AT),
      ).ok,
    ).toBe(false);
  });

  it('refuses a seat it does not hold, and a target no staff verb names', () => {
    expect(
      unwrapErr(
        AppointmentLifecycleSystem.transition(
          party(),
          request(BookingStatus.Completed, { seatId: SeatId.of('nobody') }),
          nowAt(RESOLVED_AT),
        ),
      ).errorCode,
    ).toBe(SchedulingErrorCode.AppointmentUnknownSeat);
    expect(
      AppointmentLifecycleSystem.transition(
        party(),
        request(BookingStatus.Pending),
        nowAt(RESOLVED_AT),
      ).ok,
    ).toBe(false);
  });
});

describe('AppointmentLifecycleSystem.takenSince — a reinstated chair given away', () => {
  it('finds a live seat of another visit on the same barber, overlapping', () => {
    const IVAN = BarberId.of('ivan');
    const mine = visit([seat({ barberId: IVAN, startMinute: 600 })]);
    const theirsSeats = [seat({ barberId: IVAN, startMinute: 615 })];
    const other = AppointmentId.of('other');
    const theirs = visit(theirsSeats, CONFIRMED, { id: other });
    expect(AppointmentLifecycleSystem.takenSince(mine, [theirs])).toBe(true);
    expect(
      AppointmentLifecycleSystem.takenSince(mine, [
        visit(theirsSeats, COMPLETED, { id: other }),
      ]),
    ).toBe(false);
    expect(AppointmentLifecycleSystem.takenSince(mine, [mine])).toBe(false);
    const resolved = {
      ...theirs,
      seats: theirs.seats.map((s) =>
        Seat.withOutcome(s, SeatOutcome.worked(RESOLVED_AT)),
      ),
    };
    expect(AppointmentLifecycleSystem.takenSince(mine, [resolved])).toBe(false);
    // The same minutes on ANOTHER day are no collision.
    const tomorrow = visit(theirsSeats, CONFIRMED, {
      id: other,
      localDate: LocalDate.addDays(FIXTURE_TODAY, 1),
    });
    expect(AppointmentLifecycleSystem.takenSince(mine, [tomorrow])).toBe(false);
  });
});

/*
 * READ-ONLY LEGALITY (pass C) — what a staff surface may OFFER, ported from
 * the staff dashboard (`OFFERED` + the same-day edge, `primaryVerb`,
 * `seatScopeOf`, `offerUndo`) and the visit sheet (`exits`). The cases the
 * dashboard and editor specs pin, restated as values and tags.
 */
const CANCELLED = BookingLifecycle.cancel(
  BOOKING_NOW,
  CancellationReasonSet.of([CancellationReason.Other]),
);
const LIFECYCLES: readonly BookingLifecycle[] = [
  PENDING,
  CONFIRMED,
  COMPLETED,
  NO_SHOW,
  CANCELLED,
];
const YESTERDAY = LocalDate.addDays(FIXTURE_TODAY, -1);
const TOMORROW = LocalDate.addDays(FIXTURE_TODAY, 1);
const S = BookingStatus;

describe('AppointmentLifecycleSystem.reopenable — the same-day edge’s one guard', () => {
  it('lets a completed or cancelled root back on the visit’s own day', () => {
    for (const status of [S.Completed, S.Cancelled]) {
      expect(
        AppointmentLifecycleSystem.reopenable(
          status,
          FIXTURE_TODAY,
          FIXTURE_TODAY,
        ),
      ).toBe(true);
    }
  });

  it('closes on any other day, and on a day nobody could resolve', () => {
    for (const status of [S.Completed, S.Cancelled]) {
      const reopenable = (
        visitDay: LocalDate | null,
        today: LocalDate | null,
      ) => AppointmentLifecycleSystem.reopenable(status, visitDay, today);
      expect(reopenable(FIXTURE_TODAY, TOMORROW)).toBe(false);
      expect(reopenable(FIXTURE_TODAY, YESTERDAY)).toBe(false);
      expect(reopenable(null, FIXTURE_TODAY)).toBe(false);
      expect(reopenable(FIXTURE_TODAY, null)).toBe(false);
      expect(reopenable(null, null)).toBe(false);
    }
  });

  it('never opens a live root or a no-show — those are not this edge', () => {
    for (const status of [S.Pending, S.Confirmed, S.NoShow]) {
      expect(
        AppointmentLifecycleSystem.reopenable(
          status,
          FIXTURE_TODAY,
          FIXTURE_TODAY,
        ),
      ).toBe(false);
    }
  });

  it('is the guard the reopen writes through — transition reopens exactly where reopenable holds', () => {
    // A party CONFIRMED from every root: the settled reopen (filed as a
    // reopen-completed or a reinstate) lands exactly where the guard holds;
    // a live root is an accept or an invalid move, a no-show its own edge,
    // and a settled one on another day a closed window.
    const reopens: readonly string[] = [
      AuditAction.BookingStaffReopenCompleted,
      AuditAction.BookingStaffReinstate,
    ];
    for (const lifecycle of LIFECYCLES) {
      const appointment = withStatus(lifecycle);
      for (const instant of [today(12), plus(today(12), 86_400_000)]) {
        const now = nowAt(instant);
        const step = AppointmentLifecycleSystem.transition(
          appointment,
          request(S.Confirmed),
          now,
        );
        expect(
          step.ok &&
            reopens.includes(
              step.value.auditFacts[0]?.context.auditAction ?? '',
            ),
        ).toBe(
          AppointmentLifecycleSystem.reopenable(
            lifecycle.bookingStatus,
            appointment.localDate,
            now.localDate,
          ),
        );
      }
    }
  });
});

describe('AppointmentLifecycleSystem.offeredVerbs — what a chair’s sheet offers', () => {
  const offered = (
    chair: BookingLifecycle,
    root: BookingStatus,
    today: LocalDate | null,
  ) =>
    AppointmentLifecycleSystem.offeredVerbs(
      chair,
      { bookingStatus: root },
      FIXTURE_TODAY,
      today,
    );

  it('offers the graph’s moves from a live or no-showed chair, in the order a shop reaches for them', () => {
    for (const today of [FIXTURE_TODAY, TOMORROW, null]) {
      expect(offered(PENDING, S.Pending, today)).toEqual([
        S.Confirmed,
        S.Cancelled,
      ]);
      expect(offered(CONFIRMED, S.Confirmed, today)).toEqual([
        S.Completed,
        S.NoShow,
        S.Cancelled,
      ]);
      expect(offered(NO_SHOW, S.NoShow, today)).toEqual([S.Confirmed]);
    }
  });

  it('adds the same-day way back to a settled chair whose root settled the same way', () => {
    expect(offered(COMPLETED, S.Completed, FIXTURE_TODAY)).toEqual([
      S.Confirmed,
    ]);
    expect(offered(CANCELLED, S.Cancelled, FIXTURE_TODAY)).toEqual([
      S.Confirmed,
    ]);
  });

  it('offers a settled chair nothing off its day, or with no day', () => {
    for (const today of [TOMORROW, YESTERDAY, null]) {
      expect(offered(COMPLETED, S.Completed, today)).toEqual([]);
      expect(offered(CANCELLED, S.Cancelled, today)).toEqual([]);
    }
  });

  it('offers no way back to a chair resolved inside a party that is still live, or settled otherwise', () => {
    // The callable reopens the whole appointment or nothing.
    for (const root of [S.Pending, S.Confirmed, S.NoShow]) {
      expect(offered(CANCELLED, root, FIXTURE_TODAY)).toEqual([]);
      expect(offered(COMPLETED, root, FIXTURE_TODAY)).toEqual([]);
    }
    expect(offered(COMPLETED, S.Cancelled, FIXTURE_TODAY)).toEqual([]);
    expect(offered(CANCELLED, S.Completed, FIXTURE_TODAY)).toEqual([]);
  });

  it('every chair × root × day: the graph’s moves, plus CONFIRMED exactly where reopenable holds for a matching root', () => {
    for (const chair of LIFECYCLES) {
      for (const root of Object.values(S)) {
        for (const today of [FIXTURE_TODAY, TOMORROW, null]) {
          const graph = [
            S.Confirmed,
            S.Completed,
            S.NoShow,
            S.Cancelled,
          ].filter((to) => BookingLifecycle.canTransition(chair, to));
          const edge =
            root === chair.bookingStatus &&
            AppointmentLifecycleSystem.reopenable(root, FIXTURE_TODAY, today);
          expect(offered(chair, root, today)).toEqual(
            edge ? [...graph, S.Confirmed] : graph,
          );
        }
      }
    }
  });
});

describe('AppointmentLifecycleSystem.leadVerb — which verb a row leads with', () => {
  const legalOf = (chair: BookingLifecycle) =>
    AppointmentLifecycleSystem.offeredVerbs(
      chair,
      chair,
      FIXTURE_TODAY,
      FIXTURE_TODAY,
    );
  const lead = (chair: BookingLifecycle, arrived: boolean) =>
    AppointmentLifecycleSystem.leadVerb(chair, legalOf(chair), arrived);

  it('arm 1 — a pending chair is accepted first', () => {
    expect(lead(PENDING, false)).toBe(S.Confirmed);
    expect(lead(PENDING, true)).toBe(S.Confirmed);
  });

  it('arm 2 — a live chair nobody has stamped leads with the arrival', () => {
    expect(lead(CONFIRMED, false)).toBe(ArrivalVerb.Arrived);
    // A pending chair whose accept is not on offer still leads with it.
    expect(AppointmentLifecycleSystem.leadVerb(PENDING, [], false)).toBe(
      ArrivalVerb.Arrived,
    );
  });

  it('arm 3 — arrival, not the clock, gates finishing', () => {
    expect(lead(CONFIRMED, true)).toBe(S.Completed);
  });

  it('arm 4 — a no-show leads with its correction', () => {
    expect(lead(NO_SHOW, false)).toBe(S.Confirmed);
    expect(lead(NO_SHOW, true)).toBe(S.Confirmed);
  });

  it('arm 5 — a settled chair leads with the same-day way back', () => {
    expect(lead(COMPLETED, false)).toBe(S.Confirmed);
    expect(lead(CANCELLED, true)).toBe(S.Confirmed);
  });

  it('leads with nothing once nothing applies — never wider than the legal set', () => {
    expect(AppointmentLifecycleSystem.leadVerb(COMPLETED, [], false)).toBe(
      null,
    );
    expect(AppointmentLifecycleSystem.leadVerb(CANCELLED, [], true)).toBe(null);
    expect(AppointmentLifecycleSystem.leadVerb(NO_SHOW, [], false)).toBe(null);
    // Arrived on a confirmed chair whose completion is not on offer.
    expect(
      AppointmentLifecycleSystem.leadVerb(CONFIRMED, [S.Cancelled], true),
    ).toBe(null);
  });

  it('reads the status alone — a bare `{ bookingStatus }` leads as the lifecycle does', () => {
    for (const chair of LIFECYCLES) {
      for (const arrived of [false, true]) {
        expect(
          AppointmentLifecycleSystem.leadVerb(
            { bookingStatus: chair.bookingStatus },
            legalOf(chair),
            arrived,
          ),
        ).toBe(lead(chair, arrived));
      }
    }
  });
});

describe('AppointmentLifecycleSystem.transitionSeats — party or seats', () => {
  const ids = [SeatId.of('s-1'), SeatId.of('s-2')];

  it('addresses the root for CONFIRMED and PENDING, whatever the chair holds', () => {
    for (const to of [S.Confirmed, S.Pending]) {
      expect(AppointmentLifecycleSystem.transitionSeats(to, ids, 3)).toEqual(
        [],
      );
      expect(AppointmentLifecycleSystem.transitionSeats(to, ids, 2)).toEqual(
        [],
      );
    }
  });

  it('addresses the root when the chair holds the whole party', () => {
    for (const to of [S.Completed, S.NoShow, S.Cancelled]) {
      expect(AppointmentLifecycleSystem.transitionSeats(to, ids, 2)).toEqual(
        [],
      );
      expect(
        AppointmentLifecycleSystem.transitionSeats(to, [SeatId.of('s-1')], 1),
      ).toEqual([]);
    }
  });

  it('addresses the chair’s own seats when it holds a share of the party', () => {
    for (const to of [S.Completed, S.NoShow, S.Cancelled]) {
      expect(AppointmentLifecycleSystem.transitionSeats(to, ids, 3)).toEqual(
        ids,
      );
      expect(
        AppointmentLifecycleSystem.transitionSeats(to, [SeatId.of('s-2')], 2),
      ).toEqual([SeatId.of('s-2')]);
    }
  });
});

describe('AppointmentLifecycleSystem.inverseOf — the undo an act offers', () => {
  it('takes the arrival back whatever the scope — arriving is the party’s', () => {
    expect(
      AppointmentLifecycleSystem.inverseOf(ArrivalVerb.Arrived, true),
    ).toBe(ArrivalVerb.Unarrived);
    expect(
      AppointmentLifecycleSystem.inverseOf(ArrivalVerb.Arrived, false),
    ).toBe(ArrivalVerb.Unarrived);
  });

  it('confirms a whole-party completion, no-show or cancellation back', () => {
    for (const did of [S.Completed, S.NoShow, S.Cancelled]) {
      expect(AppointmentLifecycleSystem.inverseOf(did, true)).toBe(S.Confirmed);
    }
  });

  it('offers none for a share of a party — the callable has no per-seat inverse', () => {
    for (const did of [S.Completed, S.NoShow, S.Cancelled]) {
      expect(AppointmentLifecycleSystem.inverseOf(did, false)).toBeNull();
    }
  });

  it('offers none for a correction, an un-arrival or an accept', () => {
    const none: readonly StaffVerb[] = [
      S.Confirmed,
      S.Pending,
      ArrivalVerb.Unarrived,
    ];
    for (const did of none) {
      expect(AppointmentLifecycleSystem.inverseOf(did, true)).toBeNull();
      expect(AppointmentLifecycleSystem.inverseOf(did, false)).toBeNull();
    }
  });

  it('carries no day guard — the undo is offered whatever day it is', () => {
    // Unlike the reopen `transition` makes: the server still refuses it off
    // the visit's day.
    expect(AppointmentLifecycleSystem.inverseOf(S.Cancelled, true)).toBe(
      S.Confirmed,
    );
  });
});

describe('AppointmentLifecycleSystem.exitVerbs — the visit sheet’s exits', () => {
  const offeredFor = (chair: BookingLifecycle, arrived: boolean) => {
    const legal = AppointmentLifecycleSystem.offeredVerbs(
      chair,
      chair,
      FIXTURE_TODAY,
      FIXTURE_TODAY,
    );
    const primary = AppointmentLifecycleSystem.leadVerb(chair, legal, arrived);
    const rest = legal.filter((verb) => verb !== primary);
    return primary === null ? rest : [primary, ...rest];
  };
  const exits = (chair: BookingLifecycle, started: boolean, arrived = false) =>
    AppointmentLifecycleSystem.exitVerbs(
      chair.bookingStatus,
      offeredFor(chair, arrived),
      started,
    );

  it('a pending chair: its accept is the head’s, never an exit; cancel flagged, not listed', () => {
    for (const started of [false, true]) {
      expect(exits(PENDING, started)).toEqual({
        verbs: [],
        rebook: false,
        cancel: true,
      });
    }
  });

  it('a confirmed chair: no-show only once started; the stamps never; cancel flagged', () => {
    expect(exits(CONFIRMED, false)).toEqual({
      verbs: [],
      rebook: false,
      cancel: true,
    });
    expect(exits(CONFIRMED, true)).toEqual({
      verbs: [S.NoShow],
      rebook: false,
      cancel: true,
    });
    // Arrived: COMPLETED leads, and is still no exit.
    expect(exits(CONFIRMED, true, true)).toEqual({
      verbs: [S.NoShow],
      rebook: false,
      cancel: true,
    });
  });

  it('a no-show: the way back, whatever the clock; gone, so no rebook here', () => {
    for (const started of [false, true]) {
      expect(exits(NO_SHOW, started)).toEqual({
        verbs: [S.Confirmed],
        rebook: false,
        cancel: false,
      });
    }
  });

  it('a completed chair on its day: the way back and the next visit', () => {
    for (const started of [false, true]) {
      expect(exits(COMPLETED, started)).toEqual({
        verbs: [S.Confirmed],
        rebook: true,
        cancel: false,
      });
    }
  });

  it('a cancelled chair on its day: the way back; gone, so the rebook is the dock’s', () => {
    expect(exits(CANCELLED, true)).toEqual({
      verbs: [S.Confirmed],
      rebook: false,
      cancel: false,
    });
  });

  it('rebook exactly on a settled chair that is not gone — COMPLETED; offered order kept; any other verb passes through', () => {
    for (const chairStatus of Object.values(S)) {
      expect(
        AppointmentLifecycleSystem.exitVerbs(chairStatus, [], false).rebook,
      ).toBe(chairStatus === S.Completed);
    }
    for (const chairStatus of [S.Cancelled, S.NoShow, S.Confirmed, S.Pending]) {
      expect(
        AppointmentLifecycleSystem.exitVerbs(chairStatus, [], true).rebook,
      ).toBe(false);
    }
    expect(
      AppointmentLifecycleSystem.exitVerbs(
        S.Confirmed,
        [
          S.Cancelled,
          ArrivalVerb.Unarrived,
          S.NoShow,
          S.Completed,
          ArrivalVerb.Arrived,
          S.Confirmed,
        ],
        true,
      ),
    ).toEqual({
      verbs: [ArrivalVerb.Unarrived, S.NoShow, S.Confirmed],
      rebook: false,
      cancel: true,
    });
  });

  it('every chair status × started: the four rules, nothing else', () => {
    const all: readonly StaffVerb[] = [
      ArrivalVerb.Arrived,
      S.Confirmed,
      S.Completed,
      S.NoShow,
      S.Cancelled,
    ];
    for (const chairStatus of Object.values(S)) {
      for (const started of [false, true]) {
        const out = AppointmentLifecycleSystem.exitVerbs(
          chairStatus,
          all,
          started,
        );
        const expected: StaffVerb[] = [];
        if (chairStatus !== S.Pending) expected.push(S.Confirmed);
        if (started) expected.push(S.NoShow);
        expect(out).toEqual({
          verbs: expected,
          rebook: chairStatus === S.Completed,
          cancel: true,
        });
      }
    }
  });
});

describe('AppointmentLifecycleSystem — the transition callable’s three predicates', () => {
  const move = (to: BookingStatus, seatId: SeatId | null = null) => ({
    to,
    seatId,
  });

  it('isReinstatement: a whole-party CONFIRMED of a cancelled visit, nothing else', () => {
    for (const status of Object.values(S)) {
      for (const to of Object.values(S)) {
        for (const seatId of [null, SeatId.of('s-1')]) {
          expect(
            AppointmentLifecycleSystem.isReinstatement(
              { bookingStatus: status },
              move(to, seatId),
            ),
          ).toBe(
            seatId === null && to === S.Confirmed && status === S.Cancelled,
          );
        }
      }
    }
  });

  it('readsShopToday: a whole-party CONFIRMED of a completed or cancelled visit, nothing else', () => {
    for (const status of Object.values(S)) {
      for (const to of Object.values(S)) {
        for (const seatId of [null, SeatId.of('s-1')]) {
          expect(
            AppointmentLifecycleSystem.readsShopToday(
              { bookingStatus: status },
              move(to, seatId),
            ),
          ).toBe(
            seatId === null &&
              to === S.Confirmed &&
              (status === S.Completed || status === S.Cancelled),
          );
        }
      }
    }
  });

  it('accepts the request and the appointment as they are', () => {
    const cancelled = withStatus(CANCELLED);
    const req = request(S.Confirmed);
    expect(AppointmentLifecycleSystem.isReinstatement(cancelled, req)).toBe(
      true,
    );
    expect(AppointmentLifecycleSystem.readsShopToday(cancelled, req)).toBe(
      true,
    );
  });

  it('endsLive: live after, and not before — the busy projection’s predicate (pass E, DEP-5)', () => {
    const live = (status: BookingStatus) =>
      status === S.Pending || status === S.Confirmed;
    for (const before of Object.values(S)) {
      for (const after of Object.values(S)) {
        expect(
          AppointmentLifecycleSystem.endsLive(
            { bookingStatus: before },
            { bookingStatus: after },
          ),
        ).toBe(!live(before) && live(after));
      }
    }
    // The three reopens the graph allows, and a confirm that was live already.
    for (const before of [S.Cancelled, S.NoShow, S.Completed]) {
      expect(
        AppointmentLifecycleSystem.endsLive(
          { bookingStatus: before },
          { bookingStatus: S.Confirmed },
        ),
      ).toBe(true);
    }
    expect(
      AppointmentLifecycleSystem.endsLive(
        { bookingStatus: S.Pending },
        { bookingStatus: S.Confirmed },
      ),
    ).toBe(false);
  });
});

describe('AppointmentLifecycleSystem — the read-only legality is pure', () => {
  it('same input → same output, inputs untouched', () => {
    const chair = deepFreeze({ ...COMPLETED });
    const root = deepFreeze({ bookingStatus: S.Completed });
    const legal = deepFreeze([S.Confirmed]);
    const ids = deepFreeze([SeatId.of('s-1'), SeatId.of('s-2')]);
    const offered = deepFreeze([ArrivalVerb.Arrived, S.NoShow, S.Cancelled]);
    const calls = () => ({
      offered: AppointmentLifecycleSystem.offeredVerbs(
        chair,
        root,
        FIXTURE_TODAY,
        FIXTURE_TODAY,
      ),
      lead: AppointmentLifecycleSystem.leadVerb(chair, legal, false),
      seats: AppointmentLifecycleSystem.transitionSeats(S.Cancelled, ids, 3),
      inverse: AppointmentLifecycleSystem.inverseOf(S.Cancelled, true),
      exits: AppointmentLifecycleSystem.exitVerbs(S.Confirmed, offered, true),
      reopenable: AppointmentLifecycleSystem.reopenable(
        S.Completed,
        FIXTURE_TODAY,
        FIXTURE_TODAY,
      ),
      reinstates: AppointmentLifecycleSystem.isReinstatement(
        root,
        deepFreeze({ to: S.Confirmed, seatId: null }),
      ),
      live: AppointmentLifecycleSystem.endsLive(root, root),
    });
    const once = calls();
    expect(calls()).toEqual(once);
    expect(chair).toEqual(COMPLETED);
    expect(ids).toEqual([SeatId.of('s-1'), SeatId.of('s-2')]);
    expect(offered).toEqual([ArrivalVerb.Arrived, S.NoShow, S.Cancelled]);
  });
});

describe('AppointmentLifecycleSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const appointment = deepFreeze(party());
    const req = deepFreeze(
      request(BookingStatus.Cancelled, {
        reason: CancellationReason.ClientUnwell,
        windowHours: hourCount(24),
      }),
    );
    const once = AppointmentLifecycleSystem.transition(
      appointment,
      req,
      nowAt(RESOLVED_AT),
    );
    const twice = AppointmentLifecycleSystem.transition(
      appointment,
      req,
      nowAt(RESOLVED_AT),
    );
    expect(twice).toEqual(once);
    expect(appointment.seats.map((s) => s.attendanceState)).toEqual([
      'SCHEDULED',
      'SCHEDULED',
    ]);
  });
});
