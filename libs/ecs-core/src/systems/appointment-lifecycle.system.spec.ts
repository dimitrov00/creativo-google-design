import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AuditAction,
  BookingContact,
  BookingLifecycle,
  Email,
  E164,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  SeatOutcome,
  Seat,
  SeatOccupant,
  SubjectRelationship,
  ServiceTerms,
  type ShopNow,
} from '@core/components';
import {
  BookingStatus,
  SchedulingError,
  SchedulingErrorCode,
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
import type { Appointment } from '@core/entities';
import {
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  deepFreeze,
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
 * The lifecycle cases of libs/domain/scheduling/src/lib/appointment.spec.ts,
 * copied (the class spec keeps running against its shim): admission and the
 * party's invariants, the transition matrix, cancel, the write-time
 * captures, seat outcomes, the correction edges and arrival — over plain
 * flat entities. `isSuccess(r)` → `r.ok`; the verbs' instant is a
 * parameter, and "today" is the shop's `ShopNow`.
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

function admit(seats: readonly Seat[], instant: UtcEpochMs) {
  return AppointmentLifecycleSystem.admit(
    { localDate: FIXTURE_TODAY, seats },
    nowAt(instant),
  );
}

function party(): Appointment {
  return visit([seat(), seat({ relationship: 'companion' })]);
}

function seatCancelled(
  reason: CancellationReason,
  windowHours: number | null,
): SeatOutcome {
  return SeatOutcome.cancelled(
    RESOLVED_AT,
    CancelledBy.Client,
    reason,
    windowHours,
  );
}

function request(
  to: BookingStatus,
  overrides: Partial<LifecycleTransitionRequest> = {},
): LifecycleTransitionRequest {
  return { to, seatId: null, reason: null, windowHours: null, ...overrides };
}

describe('AppointmentLifecycleSystem.admit — a new visit', () => {
  it('admits a visit in the future', () => {
    expect(admit([seat()], BOOKING_NOW)).toEqual([]);
  });

  it('rejects scheduling into the past', () => {
    expect(codes(admit([seat()], today(23)))).toEqual([
      SchedulingErrorCode.AppointmentPastStartTime,
    ]);
  });

  it('judges the past on the shop’s wall clock — an earlier day is past whatever its minute', () => {
    const tomorrowMorning = nowAt(plus(today(8), 86_400_000));
    expect(
      codes(
        AppointmentLifecycleSystem.admit(
          { localDate: FIXTURE_TODAY, seats: [seat({ startMinute: 1380 })] },
          tomorrowMorning,
        ),
      ),
    ).toEqual([SchedulingErrorCode.AppointmentPastStartTime]);
    expect(
      AppointmentLifecycleSystem.admit(
        {
          localDate: LocalDate.addDays(FIXTURE_TODAY, 2),
          seats: [seat({ startMinute: 60 })],
        },
        tomorrowMorning,
      ),
    ).toEqual([]);
  });

  it('rejects an empty seats array', () => {
    expect(codes(admit([], BOOKING_NOW))).toEqual([
      SchedulingErrorCode.AppointmentEmptySeats,
    ]);
  });

  it('rejects the booker in two chairs at once — two overlapping `SELF` seats for ONE account', () => {
    const booker = nextUser();
    expect(
      codes(
        admit(
          [seat({ userId: booker }), seat({ userId: booker })],
          BOOKING_NOW,
        ),
      ),
    ).toContain('SCHEDULING_APPOINTMENT_MULTIPLE_SELF_SEATS');
  });

  it('seats two `SELF` accounts side by side — the person is the account, not the relationship', () => {
    expect(admit([seat(), seat()], BOOKING_NOW)).toEqual([]);
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
            admit(
              seats.map((entry) => entry.seat),
              BOOKING_NOW,
            ),
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
    expect(admit(seats, BOOKING_NOW)).toEqual([]);
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
    expect(admit(seats, BOOKING_NOW)).toEqual([]);
    expect(AppointmentIndexSystem.envelope({ seats })?.endMinutes).toBe(675);
  });

  it('rejects one barber in two chairs at once', () => {
    expect(
      codes(
        admit(
          [
            seat({ barberId: IVAN, startMinute: 600, durationMinutes: 45 }),
            seat({
              relationship: 'companion',
              barberId: IVAN,
              startMinute: 630,
            }),
          ],
          BOOKING_NOW,
        ),
      ),
    ).toContain('SCHEDULING_APPOINTMENT_BARBER_DOUBLE_BOOKED');
  });

  it('names each double-booked barber once, not once per colliding pair', () => {
    const errors = admit(
      [
        seat({ barberId: IVAN, startMinute: 600, durationMinutes: 60 }),
        seat({ relationship: 'companion', barberId: IVAN, startMinute: 610 }),
        seat({ relationship: 'companion', barberId: IVAN, startMinute: 620 }),
      ],
      BOOKING_NOW,
    );
    expect(errors).toEqual([
      SchedulingError.appointmentBarberDoubleBooked(IVAN),
    ]);
  });

  it('takes the future-start check from the EARLIEST seat', () => {
    const errors = admit(
      [
        seat({ startMinute: 600, durationMinutes: 30 }),
        seat({ relationship: 'companion', startMinute: 840 }),
      ],
      today(12),
    );
    expect(codes(errors)).toEqual([
      SchedulingErrorCode.AppointmentPastStartTime,
    ]);
  });

  it('rejects seats priced in two currencies', () => {
    expect(
      AppointmentLifecycleSystem.seatViolations([
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
        AppointmentLifecycleSystem.complete(copy, RESOLVED_AT),
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
      CancellationReasonSet.fromStored('customer request'),
    ),
    NO_SHOW,
  };

  /*
   * The class's own verbs — `confirm` on a no-show is the graph's correction
   * edge, decided by `partyVerb` exactly as the class's `confirm()` did.
   */
  const VERBS: Record<
    string,
    (appointment: Appointment) => { readonly ok: boolean }
  > = {
    CONFIRMED: (a) =>
      AppointmentLifecycleSystem.partyVerb(
        { lifecycle: a, outcomes: a.seats },
        BookingStatus.Confirmed,
        null,
        RESOLVED_AT,
        CancellationReasonSet.of([]),
      ),
    COMPLETED: (a) => AppointmentLifecycleSystem.complete(a, RESOLVED_AT),
    CANCELLED: (a) =>
      AppointmentLifecycleSystem.cancel(
        a,
        CancellationReason.Other,
        24,
        RESOLVED_AT,
      ),
    NO_SHOW: (a) => AppointmentLifecycleSystem.markNoShow(a, RESOLVED_AT),
  };

  const legal = new Map(Object.entries(LEGAL));
  for (const [from, lifecycle] of Object.entries(STARTING)) {
    for (const [to, verb] of Object.entries(VERBS)) {
      const shouldSucceed = (legal.get(from) ?? []).includes(to);
      it(`${from} → ${to} is ${shouldSucceed ? 'legal' : 'illegal'}`, () => {
        expect(verb(withStatus(lifecycle)).ok).toBe(shouldSucceed);
      });
    }
  }
});

describe('AppointmentLifecycleSystem.cancel', () => {
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
      AppointmentLifecycleSystem.cancel(
        withStatus(PENDING),
        CancellationReason.ClientChangedPlans,
        24,
        RESOLVED_AT,
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
        6,
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
        6,
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

describe('AppointmentLifecycleSystem — the write-time captures', () => {
  it('reports booking lead time in minutes', () => {
    const one = visit([seat({ startMinute: 600 })], PENDING, {
      bookedAtUtcMs: today(9),
    });
    expect(AppointmentLifecycleSystem.bookingLeadTimeMinutes(one)).toBe(60);
  });

  it('has no lead time for an appointment written before bookedAt existed', () => {
    expect(
      AppointmentLifecycleSystem.bookingLeadTimeMinutes(
        visit([seat()], PENDING, { bookedAtUtcMs: null }),
      ),
    ).toBeNull();
  });

  it('measures lateness from the start — negative when early, null before arrival', () => {
    const one = visit([seat({ startMinute: 600 })], CONFIRMED, {
      arrivedAtUtcMs: today(10, 7),
    });
    expect(AppointmentLifecycleSystem.latenessMinutes(one)).toBe(7);
    expect(
      AppointmentLifecycleSystem.latenessMinutes({
        ...one,
        arrivedAtUtcMs: today(9, 55),
      }),
    ).toBe(-5);
    expect(
      AppointmentLifecycleSystem.latenessMinutes({
        ...one,
        arrivedAtUtcMs: null,
      }),
    ).toBeNull();
  });
});

describe('AppointmentLifecycleSystem — seat outcomes', () => {
  it('starts every seat scheduled', () => {
    expect(
      party().seats.every(
        (s) => s.attendanceState === AttendanceState.Scheduled,
      ),
    ).toBe(true);
    expect(AppointmentLifecycleSystem.openSeats(party())).toHaveLength(2);
  });

  it('keeps the root unchanged while any seat is still open', () => {
    const appointment = party();
    const marked = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        appointment,
        seatIdAt(appointment, 0),
        SeatOutcome.worked(RESOLVED_AT),
        RESOLVED_AT,
      ),
    );
    expect(marked.bookingStatus).toBe('CONFIRMED');
    expect(AppointmentLifecycleSystem.openSeats(marked)).toHaveLength(1);
  });

  it('summarises a mixed party as completed while keeping the no-show visible', () => {
    const appointment = party();
    const first = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        appointment,
        seatIdAt(appointment, 0),
        SeatOutcome.worked(RESOLVED_AT),
        RESOLVED_AT,
      ),
    );
    const second = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        first,
        seatIdAt(first, 1),
        SeatOutcome.noShow(RESOLVED_AT),
        RESOLVED_AT,
      ),
    );
    expect(second.bookingStatus).toBe('COMPLETED');
    expect(second.seats[0]?.attendanceState).toBe('WORKED');
    expect(second.seats[1]?.attendanceState).toBe('NO_SHOW');
  });

  it('summarises an all-cancelled party as cancelled, with groupable codes', () => {
    const appointment = party();
    const first = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        appointment,
        seatIdAt(appointment, 0),
        seatCancelled(CancellationReason.ClientUnwell, 24),
        RESOLVED_AT,
      ),
    );
    const second = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        first,
        seatIdAt(first, 1),
        seatCancelled(CancellationReason.ClientChangedPlans, 24),
        RESOLVED_AT,
      ),
    );
    expect(BookingLifecycle.sliceOf(second)).toEqual(
      BookingLifecycle.cancel(
        RESOLVED_AT,
        CancellationReasonSet.fromStored('CLIENT_CHANGED_PLANS+CLIENT_UNWELL'),
      ),
    );
  });

  it('refuses a seat it does not hold', () => {
    const error = unwrapErr(
      AppointmentLifecycleSystem.markSeatOutcome(
        party(),
        SeatId.of('nobody'),
        SeatOutcome.worked(RESOLVED_AT),
        RESOLVED_AT,
      ),
    );
    expect(error).toEqual(
      SchedulingError.appointmentUnknownSeat(SeatId.of('nobody')),
    );
  });

  it('refuses to re-resolve a seat', () => {
    const appointment = party();
    const first = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        appointment,
        seatIdAt(appointment, 0),
        SeatOutcome.worked(RESOLVED_AT),
        RESOLVED_AT,
      ),
    );
    const again = AppointmentLifecycleSystem.markSeatOutcome(
      first,
      seatIdAt(first, 0),
      SeatOutcome.noShow(RESOLVED_AT),
      RESOLVED_AT,
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
      AppointmentLifecycleSystem.markSeatOutcome(
        appointment,
        seatIdAt(appointment, 0),
        seatCancelled(CancellationReason.ClientUnwell, 48),
        RESOLVED_AT,
      ),
    );
    const done = unwrapOk(
      AppointmentLifecycleSystem.cancel(
        first,
        CancellationReason.StaffShopClosure,
        24,
        plus(RESOLVED_AT, 1),
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
      AppointmentLifecycleSystem.cancel(
        party(),
        CancellationReason.StaffShopClosure,
        24,
        RESOLVED_AT,
      ),
    );
    const terminal: Appointment = {
      ...done.appointment,
      seats: done.appointment.seats.map((s) =>
        Seat.withOutcome(s, SeatOutcome.scheduled()),
      ),
    };
    const error = unwrapErr(
      AppointmentLifecycleSystem.markSeatOutcome(
        terminal,
        seatIdAt(terminal, 0),
        SeatOutcome.worked(RESOLVED_AT),
        RESOLVED_AT,
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
      AppointmentLifecycleSystem.complete(party(), RESOLVED_AT),
    );
    expect(
      step.appointment.seats.every((s) => s.attendanceState === 'WORKED'),
    ).toBe(true);
  });

  it('leaves an already-resolved seat alone when the party completes', () => {
    const appointment = party();
    const first = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        appointment,
        seatIdAt(appointment, 0),
        SeatOutcome.noShow(RESOLVED_AT),
        RESOLVED_AT,
      ),
    );
    const done = unwrapOk(
      AppointmentLifecycleSystem.complete(first, plus(RESOLVED_AT, MINUTE)),
    );
    expect(done.appointment.seats[0]?.attendanceState).toBe('NO_SHOW');
    expect(done.appointment.seats[1]?.attendanceState).toBe('WORKED');
  });

  it('reopens a no-show and lifts the stamp off the seats it wrote', () => {
    const marked = unwrapOk(
      AppointmentLifecycleSystem.markNoShow(withStatus(CONFIRMED), RESOLVED_AT),
    );
    expect(marked.appointment.seats[0]?.attendanceState).toBe('NO_SHOW');
    const reopened = unwrapOk(
      AppointmentLifecycleSystem.reopenNoShow(marked.appointment, RESOLVED_AT),
    );
    expect(reopened.bookingStatus).toBe('CONFIRMED');
    for (const s of reopened.seats) expect(s.attendanceState).toBe('SCHEDULED');
  });

  it('reopening leaves a seat that was resolved on its own alone', () => {
    const base = party();
    const withSeatCancelled = unwrapOk(
      AppointmentLifecycleSystem.markSeatOutcome(
        base,
        seatIdAt(base, 0),
        seatCancelled(CancellationReason.ClientUnwell, 24),
        RESOLVED_AT,
      ),
    );
    const marked = unwrapOk(
      AppointmentLifecycleSystem.markNoShow(
        withSeatCancelled,
        plus(RESOLVED_AT, 1_000),
      ),
    );
    const reopened = unwrapOk(
      AppointmentLifecycleSystem.reopenNoShow(marked.appointment, RESOLVED_AT),
    );
    expect(reopened.seats[0]?.attendanceState).toBe('CANCELLED');
    expect(reopened.seats[1]?.attendanceState).toBe('SCHEDULED');
  });

  it('refuses to reopen anything that is not a no-show', () => {
    for (const lifecycle of [PENDING, CONFIRMED, COMPLETED]) {
      expect(
        AppointmentLifecycleSystem.reopenNoShow(
          withStatus(lifecycle),
          RESOLVED_AT,
        ).ok,
      ).toBe(false);
    }
  });

  it('reopens a completed visit on its own day, every seat back to scheduled', () => {
    const confirmed = unwrapOk(
      AppointmentLifecycleSystem.confirm(withStatus(PENDING), RESOLVED_AT),
    );
    const completed = unwrapOk(
      AppointmentLifecycleSystem.complete(confirmed.appointment, RESOLVED_AT),
    );
    expect(completed.appointment.seats[0]?.attendanceState).toBe('WORKED');
    const end = endInstantOf(completed.appointment);
    const reopened = unwrapOk(
      AppointmentLifecycleSystem.reopenSettled(
        completed.appointment,
        nowAt(end),
      ),
    );
    expect(reopened.bookingStatus).toBe('CONFIRMED');
    expect(reopened.seats[0]?.attendanceState).toBe('SCHEDULED');
  });

  it('reinstates a cancelled visit on its own day', () => {
    const cancelled = unwrapOk(
      AppointmentLifecycleSystem.cancel(
        withStatus(CONFIRMED),
        CancellationReason.Other,
        24,
        RESOLVED_AT,
      ),
    );
    const end = endInstantOf(cancelled.appointment);
    const back = unwrapOk(
      AppointmentLifecycleSystem.reopenSettled(
        cancelled.appointment,
        nowAt(end),
      ),
    );
    expect(back.bookingStatus).toBe('CONFIRMED');
    expect(back.seats[0]?.attendanceState).toBe('SCHEDULED');
  });

  it('refuses to reopen a settled visit the next day, or a live one at all', () => {
    const completed = withStatus(COMPLETED);
    const end = endInstantOf(completed);
    const late = AppointmentLifecycleSystem.reopenSettled(
      completed,
      nowAt(plus(end, 24 * 60 * MINUTE)),
    );
    expect(unwrapErr(late).errorCode).toBe(
      'SCHEDULING_APPOINTMENT_REOPEN_WINDOW_CLOSED',
    );
    const live = withStatus(CONFIRMED);
    expect(
      AppointmentLifecycleSystem.reopenSettled(live, nowAt(endInstantOf(live)))
        .ok,
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
      AppointmentLifecycleSystem.confirm(withStatus(PENDING), RESOLVED_AT),
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
      AppointmentLifecycleSystem.confirm(
        visit([seat()], PENDING, contact),
        RESOLVED_AT,
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
          windowHours: 24,
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

describe('AppointmentLifecycleSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const appointment = deepFreeze(party());
    const req = deepFreeze(
      request(BookingStatus.Cancelled, {
        reason: CancellationReason.ClientUnwell,
        windowHours: 24,
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
