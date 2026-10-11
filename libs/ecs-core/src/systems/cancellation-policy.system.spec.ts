import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BookingLifecycle,
  BookingPolicy,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  SeatOutcome,
  Seat,
  SeatOccupant,
  SubjectRelationship,
} from '@core/components';
import {
  BookingStatus,
  type Result,
  type SchedulingError,
  SchedulingErrorCode,
  AttendanceState,
  BarberId,
  SeatId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import type { Appointment } from '@core/entities';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  deepFreeze,
  endMinute,
  localDate,
  minute,
  unwrapErr,
  unwrapOk,
  utcMs,
  appointmentFixture,
  seatFixture,
} from '@core/testing';
import {
  AppointmentLifecycleSystem,
  type LifecycleStep,
} from './appointment-lifecycle.system';
import {
  type CancellationRefusal,
  CancellationPolicySystem,
  CancellationRefusalCode,
} from './cancellation-policy.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The cases of libs/domain/scheduling/src/lib/cancellation-window.spec.ts and
 * apps/functions/src/lib/booking/cancellation-window-stamp.spec.ts, copied
 * (the originals keep running against their shims): the window is whole
 * hours (`windowOf`), the deadline its one formula on `UtcEpochMs` (a T2
 * lifecycle comparison), and every path that cancels a seat stamps the
 * window in force on it — the stamp spec's callables re-targeted to the
 * lifecycle verbs they decide with.
 */

const HOUR = 3_600_000;
const MAX = CancellationPolicySystem.MAX_WINDOW_HOURS;

/** The instants `UtcEpochMs` holds: the years 0001–9999 (UTC). */
const MIN_UTC_EPOCH_MS = -62_135_596_800_000;
const MAX_UTC_EPOCH_MS = 253_402_300_800_000 - 1;

const instant = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));
const plus = (base: UtcEpochMs, ms: number): UtcEpochMs =>
  UtcEpochMs.plusMs(base, ms);

function windowOf(hours: number): number {
  return unwrapOk(CancellationPolicySystem.windowOf(hours));
}

function policyWithWindow(cancellationWindowHours: number): BookingPolicy {
  return unwrapOk(
    BookingPolicy.create({
      ...BookingPolicy.DEFAULT,
      cancellationWindowHours,
    }),
  );
}

/** Any whole number of hours the type holds, edges weighted in. */
const anyValidHours = fc.oneof(
  fc.integer({ min: 0, max: 8_760 }),
  fc.integer({ min: 0, max: MAX }),
  fc.constantFrom(0, 1, MAX),
);

/** Every kind of number a caller or a stored document could hand over. */
const anyNumber = fc.oneof(
  fc.integer({ min: -1_000, max: 1_000 }),
  fc.double(),
  fc.constantFrom(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0,
    0.5,
    1.5,
    -1,
    MAX,
    MAX + 1,
    Number.MAX_SAFE_INTEGER,
    1e300,
  ),
);

/** The instants a visit may start at — around now, either side of 1970 too. */
const anyStart = fc
  .integer({ min: -4_102_444_800_000, max: 4_102_444_800_000 })
  .map(instant);

/** `Date`'s old range: ±8.64e15 ms around the epoch — the bound's arithmetic edge. */
const TIME_RANGE_MS = 8_640_000_000_000_000;

/** The starts the bound makes its promise for: the epoch onwards, to the last instant `UtcEpochMs` holds. */
const anyVisitStart = fc
  .oneof(
    fc.integer({ min: 0, max: 4_102_444_800_000 }),
    fc.integer({ min: 0, max: MAX_UTC_EPOCH_MS }),
    fc.constantFrom(0, 1_790_330_400_000, MAX_UTC_EPOCH_MS),
  )
  .map(instant);

describe('CancellationPolicySystem.windowOf — the window as whole hours', () => {
  it('accepts every whole, non-negative number of hours, as given', () => {
    fc.assert(
      fc.property(anyValidHours, (hours) => {
        const result = CancellationPolicySystem.windowOf(hours);
        expect(result.ok).toBe(true);
        expect(result.ok && result.value).toBe(hours);
      }),
    );
  });

  it('refuses a negative window with its stable code', () => {
    fc.assert(
      fc.property(fc.integer({ max: -1 }), (hours) => {
        const error = unwrapErr(CancellationPolicySystem.windowOf(hours));
        expect(error.errorCode).toBe('SCHEDULING_CANCELLATION_WINDOW_INVALID');
        expect(error.errorCode).toBe(
          SchedulingErrorCode.CancellationWindowInvalid,
        );
        expect(error.rawValue).toBe(hours);
      }),
    );
  });

  it('refuses anything that is not a whole number — fractions, NaN, infinities', () => {
    fc.assert(
      fc.property(
        fc.double().filter((value) => !Number.isInteger(value)),
        (hours) => {
          expect(CancellationPolicySystem.windowOf(hours).ok).toBe(false);
        },
      ),
    );
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0.5,
      23.999,
    ]) {
      expect(CancellationPolicySystem.windowOf(bad).ok).toBe(false);
    }
  });

  it('refuses a window too long for its deadline to stay a safe integer', () => {
    expect(MAX).toBe(2_400_000_000);
    expect(CancellationPolicySystem.windowOf(MAX).ok).toBe(true);
    for (const tooLong of [
      MAX + 1,
      Math.floor(Number.MAX_SAFE_INTEGER / HOUR),
      Number.MAX_SAFE_INTEGER,
      1e300,
    ]) {
      expect(CancellationPolicySystem.windowOf(tooLong).ok).toBe(false);
    }
  });

  it('accepts exactly the numbers it keeps: success ⇔ whole, ≥ 0, within the bound', () => {
    fc.assert(
      fc.property(anyNumber, (hours) => {
        const expected = Number.isInteger(hours) && hours >= 0 && hours <= MAX;
        expect(CancellationPolicySystem.windowOf(hours).ok).toBe(expected);
      }),
    );
  });

  it('stores negative zero as the zero every reader compares against', () => {
    expect(Object.is(windowOf(-0), 0)).toBe(true);
    expect(windowOf(-0) === windowOf(0)).toBe(true);
  });

  it('is equal by its hours, and only by them', () => {
    fc.assert(
      fc.property(anyValidHours, anyValidHours, (a, b) => {
        expect(windowOf(a) === windowOf(b)).toBe(a === b);
      }),
    );
  });
});

describe('CancellationPolicySystem — the deadline', () => {
  it('draws it exactly `hours` before any visit’s start — exact and safe (property)', () => {
    fc.assert(
      fc.property(anyValidHours, anyVisitStart, (hours, start) => {
        const deadline = CancellationPolicySystem.deadlineUtcMs(hours, start);
        expect(BigInt(deadline)).toBe(
          BigInt(start) - BigInt(hours) * BigInt(HOUR),
        );
        expect(Number.isSafeInteger(deadline)).toBe(true);
      }),
    );
  });

  it('meets the edge of the time range exactly at the longest window, from the epoch', () => {
    const deadline = CancellationPolicySystem.deadlineUtcMs(MAX, instant(0));
    expect(deadline).toBe(-TIME_RANGE_MS);
    expect(Number.isSafeInteger(deadline)).toBe(true);
    expect(MIN_UTC_EPOCH_MS).toBeGreaterThan(-TIME_RANGE_MS);
  });

  it('still draws a finite deadline for a start before the epoch — the bound makes no promise there', () => {
    fc.assert(
      fc.property(anyValidHours, anyStart, (hours, start) => {
        expect(
          Number.isFinite(CancellationPolicySystem.deadlineUtcMs(hours, start)),
        ).toBe(true);
      }),
    );
  });

  it('is free AT the deadline and not a millisecond past it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8_760 }),
        anyStart,
        (hours, start) => {
          const deadline = CancellationPolicySystem.deadlineUtcMs(hours, start);
          const free = (at: UtcEpochMs) =>
            CancellationPolicySystem.allowsFreeCancelAt(hours, start, at);
          expect(free(deadline)).toBe(true);
          expect(free(plus(deadline, -1))).toBe(true);
          expect(free(plus(deadline, 1))).toBe(false);
          expect(
            CancellationPolicySystem.isLateCancellation(
              hours,
              start,
              plus(deadline, 1),
            ),
          ).toBe(true);
        },
      ),
    );
  });

  it('a longer window never frees a cancel a shorter one refused', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8_760 }),
        fc.integer({ min: 0, max: 8_760 }),
        anyStart,
        fc.integer({ min: -8_760 * HOUR, max: 8_760 * HOUR }),
        (a, b, start, offsetMs) => {
          const [shorter, longer] = a <= b ? [a, b] : [b, a];
          const at = plus(start, offsetMs);
          if (
            !CancellationPolicySystem.allowsFreeCancelAt(shorter, start, at)
          ) {
            expect(
              CancellationPolicySystem.allowsFreeCancelAt(longer, start, at),
            ).toBe(false);
          }
        },
      ),
    );
  });
});

describe('CancellationPolicySystem — the booking policy’s own rule', () => {
  it('a policy accepts a window exactly when the window guard does', () => {
    fc.assert(
      fc.property(anyNumber, (hours) => {
        const policy = BookingPolicy.create({
          ...BookingPolicy.DEFAULT,
          cancellationWindowHours: hours,
        });
        expect(policy.ok).toBe(CancellationPolicySystem.windowOf(hours).ok);
        if (!policy.ok) {
          expect(
            policy.error.map((error) =>
              error.errorCode === SchedulingErrorCode.BookingPolicyInvalid
                ? error.field
                : error.errorCode,
            ),
          ).toEqual(['cancellationWindowHours']);
        }
      }),
    );
  });

  it('carries the window it was given, and draws the same deadline', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8_760 }),
        anyStart,
        (hours, start) => {
          const policy = policyWithWindow(hours);
          expect(policy.cancellationWindowHours).toBe(hours);
          expect(CancellationPolicySystem.stampOf(policy)).toBe(
            windowOf(hours),
          );
          expect(
            CancellationPolicySystem.deadlineUtcMs(
              policy.cancellationWindowHours,
              start,
            ),
          ).toBe(
            CancellationPolicySystem.deadlineUtcMs(windowOf(hours), start),
          );
        },
      ),
    );
  });
});

/*
 * ── THE RULE IN FORCE (2026-09-25) ─────────────────────────────────────
 * The stamp spec's callables, re-targeted to the verbs they decide with:
 * `cancelAppointment` → `mayCancel` + `cancelByClient`;
 * `transitionAppointment` → `AppointmentLifecycleSystem.transition`.
 */

/** 10:00 in Sofia on 2030-01-15 (EET, UTC+2). */
const START = utcMs('2030-01-15T08:00:00Z');
const ANA = UserId.of('ana');
const BOB = UserId.of('bob');
const NOW = FIXTURE_NOW_UTC_MS;

/** Ana and Bob, far in the future, one of them possibly already resolved. */
function storedParty(
  second: SeatOutcome = SeatOutcome.scheduled(),
  lifecycle: BookingLifecycle = BookingLifecycle.confirm(plus(NOW, -HOUR)),
): Appointment {
  const s1 = seatFixture({
    seatId: SeatId.of('s1'),
    barberId: BarberId.of('ivan'),
    startMinutes: minute(600),
    occupant: SeatOccupant.account(ANA, SubjectRelationship.Self),
  });
  const s2 = seatFixture({
    seatId: SeatId.of('s2'),
    barberId: BarberId.of('niko'),
    startMinutes: minute(600),
    occupant: SeatOccupant.account(BOB, SubjectRelationship.Companion),
    outcome: second,
  });
  return appointmentFixture({
    ownerUserId: ANA,
    subjectUserIds: [ANA, BOB],
    seats: [s1, s2],
    localDate: localDate('2030-01-15'),
    startMinutes: minute(600),
    endMinutes: endMinute(630),
    utcEpochMs: START,
    lifecycle,
  });
}

function outcomes(appointment: Appointment): readonly SeatOutcome[] {
  return appointment.seats.map(Seat.outcomeOf);
}

describe('the client’s own cancel — stamped with the window it was allowed under', () => {
  function clientCancel(
    appointment: Appointment,
    policy: BookingPolicy | null,
  ): Result<LifecycleStep, SchedulingError | CancellationRefusal> {
    const allowed = CancellationPolicySystem.mayCancel(
      appointment,
      policy,
      NOW,
    );
    if (!allowed.ok) return allowed;
    return AppointmentLifecycleSystem.cancelByClient(
      appointment,
      CancellationReason.Unspecified,
      allowed.value.windowHours,
      NOW,
    );
  }

  it('stamps the window it was allowed under on every seat it closes', () => {
    const step = unwrapOk(clientCancel(storedParty(), policyWithWindow(6)));
    expect(outcomes(step.appointment)).toEqual([
      expect.objectContaining({
        attendanceState: 'CANCELLED',
        cancelledBy: 'CLIENT',
        cancellationWindowHours: 6,
      }),
      expect.objectContaining({
        attendanceState: 'CANCELLED',
        cancelledBy: 'CLIENT',
        cancellationWindowHours: 6,
      }),
    ]);
  });

  it('writes the stamp as that window — the stored component is the reading', () => {
    const step = unwrapOk(clientCancel(storedParty(), policyWithWindow(36)));
    const first = outcomes(step.appointment)[0];
    expect(
      first?.attendanceState === AttendanceState.Cancelled &&
        first.cancellationWindowHours,
    ).toBe(36);
  });

  it('leaves a seat resolved before it — and that seat’s own stamp — alone', () => {
    const earlier = SeatOutcome.cancelled(
      instant(1),
      CancelledBy.Staff,
      CancellationReason.ClientUnwell,
      48,
    );
    const step = unwrapOk(
      clientCancel(storedParty(earlier), policyWithWindow(24)),
    );
    expect(outcomes(step.appointment)[0]).toMatchObject({
      cancellationWindowHours: 24,
    });
    expect(outcomes(step.appointment)[1]).toEqual(earlier);
  });

  it('refuses the cancel, and decides nothing, when the policy cannot be read', () => {
    const party = deepFreeze(storedParty());
    const refusal = unwrapErr(clientCancel(party, null));
    expect(refusal).toEqual({
      errorCode: CancellationRefusalCode.PolicyUnavailable,
    });
    expect(refusal.errorCode).toBe('BOOKING_CANCEL_POLICY_UNAVAILABLE');
    expect(outcomes(party)).toEqual([
      SeatOutcome.scheduled(),
      SeatOutcome.scheduled(),
    ]);
    expect(party.bookingStatus).toBe(BookingStatus.Confirmed);
  });
});

describe('the shop cancelling, often on the client’s word', () => {
  const now = ZonedTimeSystem.shopNow(NOW, FIXTURE_TIME_ZONE);

  function staffCancel(
    appointment: Appointment,
    policy: BookingPolicy | null,
    reason: CancellationReason,
    seatId: SeatId | null = null,
  ) {
    return AppointmentLifecycleSystem.transition(
      appointment,
      {
        to: BookingStatus.Cancelled,
        seatId,
        reason,
        windowHours: CancellationPolicySystem.stampOf(policy),
      },
      now,
    );
  }

  it('stamps the window in force on a party cancel', () => {
    const step = unwrapOk(
      staffCancel(
        storedParty(),
        policyWithWindow(12),
        CancellationReason.ClientChangedPlans,
      ),
    );
    expect(outcomes(step.appointment)).toEqual([
      expect.objectContaining({
        attendanceState: 'CANCELLED',
        cancelledBy: 'STAFF',
        cancellationReason: 'CLIENT_CHANGED_PLANS',
        cancellationWindowHours: 12,
      }),
      expect.objectContaining({
        attendanceState: 'CANCELLED',
        cancellationWindowHours: 12,
      }),
    ]);
  });

  it('stamps the window in force on one person’s seat', () => {
    const step = unwrapOk(
      staffCancel(
        storedParty(),
        policyWithWindow(2),
        CancellationReason.ClientUnwell,
        SeatId.of('s2'),
      ),
    );
    expect(outcomes(step.appointment)).toEqual([
      SeatOutcome.scheduled(),
      expect.objectContaining({
        attendanceState: 'CANCELLED',
        cancellationReason: 'CLIENT_UNWELL',
        cancellationWindowHours: 2,
      }),
    ]);
  });

  it('stamps a shop-side cancel too — every cancellation carries its window', () => {
    const step = unwrapOk(
      staffCancel(
        storedParty(),
        policyWithWindow(8),
        CancellationReason.StaffBarberAbsence,
      ),
    );
    expect(outcomes(step.appointment)).toEqual([
      expect.objectContaining({
        cancellationReason: 'STAFF_BARBER_ABSENCE',
        cancellationWindowHours: 8,
      }),
      expect.objectContaining({ cancellationWindowHours: 8 }),
    ]);
  });

  it('still cancels the party when the policy cannot be read, stamping the window unknown', () => {
    const step = unwrapOk(
      staffCancel(storedParty(), null, CancellationReason.ClientChangedPlans),
    );
    expect(BookingLifecycle.sliceOf(step.appointment)).toEqual({
      bookingStatus: 'CANCELLED',
      cancelledAtUtcMs: NOW,
      cancellationReason: CancellationReasonSet.of([
        CancellationReason.ClientChangedPlans,
      ]),
    });
    for (const outcome of outcomes(step.appointment)) {
      expect(outcome).toMatchObject({
        attendanceState: 'CANCELLED',
        cancelledBy: 'STAFF',
        cancellationReason: 'CLIENT_CHANGED_PLANS',
        cancellationWindowHours: null,
      });
    }
  });

  it('still cancels one person’s seat when the policy cannot be read', () => {
    const step = unwrapOk(
      staffCancel(
        storedParty(),
        null,
        CancellationReason.ClientUnwell,
        SeatId.of('s2'),
      ),
    );
    const [first, second] = outcomes(step.appointment);
    expect(first).toEqual(SeatOutcome.scheduled());
    expect(second).toMatchObject({
      attendanceState: 'CANCELLED',
      cancellationReason: 'CLIENT_UNWELL',
      cancellationWindowHours: null,
    });
  });

  it('stamps no window for a verb that is not a cancel', () => {
    const step = unwrapOk(
      AppointmentLifecycleSystem.transition(
        storedParty(),
        {
          to: BookingStatus.Completed,
          seatId: null,
          reason: null,
          windowHours: CancellationPolicySystem.stampOf(policyWithWindow(24)),
        },
        now,
      ),
    );
    for (const seat of step.appointment.seats) {
      expect(seat).not.toHaveProperty('cancellationWindowHours');
    }
    expect(step.appointment.seats.map((seat) => seat.attendanceState)).toEqual([
      'WORKED',
      'WORKED',
    ]);
  });
});

describe('CancellationPolicySystem.mayCancel / mayMove — the client’s gate', () => {
  const policy = policyWithWindow(24);

  it('allows a cancel before the deadline, naming the window it was allowed under', () => {
    expect(
      CancellationPolicySystem.mayCancel(storedParty(), policy, NOW),
    ).toEqual({ ok: true, value: { windowHours: 24 } });
  });

  it('refuses a visit the graph will not let go — completed, no-showed, already cancelled', () => {
    for (const lifecycle of [
      BookingLifecycle.complete(NOW),
      BookingLifecycle.noShow(NOW),
      BookingLifecycle.cancel(
        NOW,
        CancellationReasonSet.of([CancellationReason.Unspecified]),
      ),
    ]) {
      const visit = storedParty(SeatOutcome.scheduled(), lifecycle);
      expect(
        unwrapErr(CancellationPolicySystem.mayCancel(visit, policy, NOW)),
      ).toEqual({
        errorCode: CancellationRefusalCode.NotCancellable,
        bookingStatus: lifecycle.bookingStatus,
      });
    }
  });

  it('refuses past the deadline, naming the window and the deadline', () => {
    const late = plus(START, -2 * HOUR);
    expect(
      unwrapErr(
        CancellationPolicySystem.mayCancel(storedParty(), policy, late),
      ),
    ).toEqual({
      errorCode: CancellationRefusalCode.WindowClosed,
      windowHours: 24,
      deadlineUtcMs: plus(START, -24 * HOUR),
    });
  });

  it('judges the window from the EARLIEST seat’s instant — the truth, not the stored envelope', () => {
    const party = storedParty();
    const later = {
      ...party,
      seats: party.seats.map((seat) => ({
        ...seat,
        startMinutes: minute(660),
      })),
    };
    // Both seats start at 11:00 — an hour after the stored envelope says.
    expect(CancellationPolicySystem.startUtcMsOf(later)).toBe(
      plus(START, HOUR),
    );
  });

  it('falls OPEN on a start that is not a number — nobody is trapped in a booking', () => {
    const broken = {
      ...storedParty(),
      utcEpochMs: Number.NaN as UtcEpochMs,
    };
    expect(CancellationPolicySystem.mayCancel(broken, policy, NOW).ok).toBe(
      true,
    );
  });

  it('judges a move by the same graph and the same window, off the CURRENT start', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 72 }),
        fc.integer({ min: -100 * HOUR, max: 100 * HOUR }),
        (hours, offset) => {
          const at = plus(START, offset);
          expect(
            CancellationPolicySystem.mayMove(
              storedParty(),
              policyWithWindow(hours),
              at,
            ),
          ).toEqual(
            CancellationPolicySystem.mayCancel(
              storedParty(),
              policyWithWindow(hours),
              at,
            ),
          );
        },
      ),
    );
  });

  it('stamps unknown when the policy could not be read', () => {
    expect(CancellationPolicySystem.stampOf(null)).toBeNull();
  });
});

describe('CancellationPolicySystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const party = deepFreeze(storedParty());
    const policy = deepFreeze(policyWithWindow(24));
    const once = CancellationPolicySystem.mayCancel(party, policy, NOW);
    const twice = CancellationPolicySystem.mayCancel(party, policy, NOW);
    expect(twice).toEqual(once);
    expect(CancellationPolicySystem.windowOf(-0)).toEqual(
      CancellationPolicySystem.windowOf(-0),
    );
  });
});
