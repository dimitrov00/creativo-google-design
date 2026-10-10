import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BookingPolicy } from '../components/booking-policy.data';
import { BookingState, BookingStatus } from '../components/booking-status.data';
import { Result } from '../components/result.data';
import {
  type SchedulingError,
  SchedulingErrorCode,
} from '../components/scheduling-errors.data';
import {
  CancellationReason,
  CancelledBy,
  SeatOutcome,
  SeatOutcomeKind,
} from '../components/seat-outcome.data';
import {
  Seat,
  SeatId,
  SeatRelationship,
  SeatSubject,
} from '../components/seat.data';
import { BarberId } from '../entities/barber.entity';
import { UserId } from '../entities/user.entity';
import type { AppointmentEntity } from '../entities/appointment.entity';
import {
  FIXTURE_NOW_MS,
  appointmentFixture,
  deepFreeze,
  seatFixture,
  unwrapErr,
  unwrapOk,
} from '../testing';
import {
  AppointmentLifecycleSystem,
  type LifecycleStep,
} from './appointment-lifecycle.system';
import {
  type CancellationRefusal,
  CancellationPolicySystem,
  CancellationRefusalCode,
} from './cancellation-policy.system';

/*
 * The cases of libs/domain/scheduling/src/lib/cancellation-window.spec.ts and
 * apps/functions/src/lib/booking/cancellation-window-stamp.spec.ts, copied
 * (the originals keep running against their shims): the window is whole
 * hours (`windowOf`), the deadline its one formula, and every path that
 * cancels a seat stamps the window in force on it — the stamp spec's
 * callables re-targeted to the lifecycle verbs they decide with.
 */

const HOUR = 3_600_000;
const MAX = CancellationPolicySystem.MAX_WINDOW_HOURS;

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
const anyStartMs = fc.integer({
  min: -4_102_444_800_000,
  max: 4_102_444_800_000,
});

/** `Date`'s range: ±8.64e15 ms around the epoch. */
const TIME_RANGE_MS = 8_640_000_000_000_000;

/** The starts the bound makes its promise for: the epoch onwards, to the end of the range. */
const anyVisitStartMs = fc.oneof(
  fc.integer({ min: 0, max: 4_102_444_800_000 }),
  fc.integer({ min: 0, max: TIME_RANGE_MS }),
  fc.constantFrom(0, Date.UTC(2026, 8, 25, 10), TIME_RANGE_MS),
);

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
        expect(error.code).toBe('scheduling.cancellation_window.invalid');
        expect(error.code).toBe(SchedulingErrorCode.CancellationWindowInvalid);
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

  it('refuses a window too long for its deadline to stay a real instant', () => {
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
  it('draws it exactly `hours` before any visit’s start, as a real instant — exact, safe, and one `Date` holds (property)', () => {
    fc.assert(
      fc.property(anyValidHours, anyVisitStartMs, (hours, startMs) => {
        const deadline = CancellationPolicySystem.deadlineMs(hours, startMs);
        expect(BigInt(deadline)).toBe(
          BigInt(startMs) - BigInt(hours) * BigInt(HOUR),
        );
        expect(Number.isSafeInteger(deadline)).toBe(true);
        expect(Number.isNaN(new Date(deadline).getTime())).toBe(false);
      }),
    );
  });

  it('meets the edge of the time range exactly at the longest window, from the epoch', () => {
    const deadline = CancellationPolicySystem.deadlineMs(MAX, 0);
    expect(deadline).toBe(-TIME_RANGE_MS);
    expect(new Date(deadline).getTime()).toBe(-TIME_RANGE_MS);
    expect(Number.isNaN(new Date(deadline - 1).getTime())).toBe(true);
  });

  it('still draws a finite deadline for a start before the epoch — the bound makes no promise there', () => {
    fc.assert(
      fc.property(anyValidHours, anyStartMs, (hours, startMs) => {
        expect(
          Number.isFinite(CancellationPolicySystem.deadlineMs(hours, startMs)),
        ).toBe(true);
      }),
    );
  });

  it('is free AT the deadline and not a millisecond past it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8_760 }),
        anyStartMs,
        (hours, startMs) => {
          const deadline = CancellationPolicySystem.deadlineMs(hours, startMs);
          const free = (atMs: number) =>
            CancellationPolicySystem.allowsFreeCancelAt(hours, startMs, atMs);
          expect(free(deadline)).toBe(true);
          expect(free(deadline - 1)).toBe(true);
          expect(free(deadline + 1)).toBe(false);
          expect(
            CancellationPolicySystem.isLateCancellation(
              hours,
              startMs,
              deadline + 1,
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
        anyStartMs,
        fc.integer({ min: -8_760 * HOUR, max: 8_760 * HOUR }),
        (a, b, startMs, offsetMs) => {
          const [shorter, longer] = a <= b ? [a, b] : [b, a];
          const atMs = startMs + offsetMs;
          if (
            !CancellationPolicySystem.allowsFreeCancelAt(shorter, startMs, atMs)
          ) {
            expect(
              CancellationPolicySystem.allowsFreeCancelAt(
                longer,
                startMs,
                atMs,
              ),
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
              error.code === SchedulingErrorCode.BookingPolicyInvalid
                ? error.field
                : error.code,
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
        anyStartMs,
        (hours, startMs) => {
          const policy = policyWithWindow(hours);
          expect(policy.cancellationWindowHours).toBe(hours);
          expect(CancellationPolicySystem.stampOf(policy)).toBe(
            windowOf(hours),
          );
          expect(
            CancellationPolicySystem.deadlineMs(
              policy.cancellationWindowHours,
              startMs,
            ),
          ).toBe(CancellationPolicySystem.deadlineMs(windowOf(hours), startMs));
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

const START_MS = Date.UTC(2030, 0, 15, 8, 0);
const ANA = UserId.of('ana');
const BOB = UserId.of('bob');

/** Ana and Bob, far in the future, one of them possibly already resolved. */
function storedParty(
  second: SeatOutcome = SeatOutcome.scheduled(),
): AppointmentEntity {
  const s1 = seatFixture({
    id: SeatId.of('s1'),
    barberId: BarberId.of('ivan'),
    startMs: START_MS,
    subject: SeatSubject.account(ANA, SeatRelationship.Self),
  });
  const s2 = seatFixture({
    id: SeatId.of('s2'),
    barberId: BarberId.of('niko'),
    startMs: START_MS,
    subject: SeatSubject.account(BOB, SeatRelationship.Companion),
    outcome: second,
  });
  return appointmentFixture({
    ownerUserId: ANA,
    subjectUserIds: [ANA, BOB],
    seats: [s1, s2],
    bookingStatus: BookingStatus.confirm(FIXTURE_NOW_MS - HOUR),
  });
}

function outcomes(appointment: AppointmentEntity): readonly SeatOutcome[] {
  return appointment.seats.map((seat) => seat.outcome);
}

const NOW = FIXTURE_NOW_MS;

describe('the client’s own cancel — stamped with the window it was allowed under', () => {
  function clientCancel(
    appointment: AppointmentEntity,
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
        kind: 'cancelled',
        by: 'client',
        windowHours: 6,
      }),
      expect.objectContaining({
        kind: 'cancelled',
        by: 'client',
        windowHours: 6,
      }),
    ]);
  });

  it('writes the stamp as that window — the stored component is the reading', () => {
    const step = unwrapOk(clientCancel(storedParty(), policyWithWindow(36)));
    const first = outcomes(step.appointment)[0];
    expect(first?.kind === SeatOutcomeKind.Cancelled && first.windowHours).toBe(
      36,
    );
  });

  it('leaves a seat resolved before it — and that seat’s own stamp — alone', () => {
    const earlier = SeatOutcome.cancelled(
      1,
      CancelledBy.Staff,
      CancellationReason.ClientUnwell,
      48,
    );
    const step = unwrapOk(
      clientCancel(storedParty(earlier), policyWithWindow(24)),
    );
    expect(outcomes(step.appointment)[0]).toMatchObject({ windowHours: 24 });
    expect(outcomes(step.appointment)[1]).toEqual(earlier);
  });

  it('refuses the cancel, and decides nothing, when the policy cannot be read', () => {
    const party = deepFreeze(storedParty());
    const refusal = unwrapErr(clientCancel(party, null));
    expect(refusal).toEqual({
      code: CancellationRefusalCode.PolicyUnavailable,
    });
    expect(refusal.code).toBe('booking.cancel.policy_unavailable');
    expect(outcomes(party)).toEqual([
      SeatOutcome.scheduled(),
      SeatOutcome.scheduled(),
    ]);
    expect(party.bookingStatus.kind).toBe(BookingState.Confirmed);
  });
});

describe('the shop cancelling, often on the client’s word', () => {
  function staffCancel(
    appointment: AppointmentEntity,
    policy: BookingPolicy | null,
    reason: CancellationReason,
    seatId: SeatId | null = null,
  ) {
    return AppointmentLifecycleSystem.transition(
      appointment,
      {
        to: BookingState.Cancelled,
        seatId,
        reason,
        windowHours: CancellationPolicySystem.stampOf(policy),
      },
      NOW,
      [],
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
        kind: 'cancelled',
        by: 'staff',
        reason: { kind: 'client_changed_plans' },
        windowHours: 12,
      }),
      expect.objectContaining({ kind: 'cancelled', windowHours: 12 }),
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
        kind: 'cancelled',
        reason: { kind: 'client_unwell' },
        windowHours: 2,
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
        reason: { kind: 'staff_barber_absence' },
        windowHours: 8,
      }),
      expect.objectContaining({ windowHours: 8 }),
    ]);
  });

  it('still cancels the party when the policy cannot be read, stamping the window unknown', () => {
    const step = unwrapOk(
      staffCancel(storedParty(), null, CancellationReason.ClientChangedPlans),
    );
    expect(step.appointment.bookingStatus).toEqual({
      kind: 'cancelled',
      atMs: NOW,
      reason: 'client_changed_plans',
    });
    for (const outcome of outcomes(step.appointment)) {
      expect(outcome).toMatchObject({
        kind: 'cancelled',
        by: 'staff',
        reason: { kind: 'client_changed_plans' },
        windowHours: null,
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
      kind: 'cancelled',
      reason: { kind: 'client_unwell' },
      windowHours: null,
    });
  });

  it('stamps no window for a verb that is not a cancel', () => {
    const step = unwrapOk(
      AppointmentLifecycleSystem.transition(
        storedParty(),
        {
          to: BookingState.Completed,
          seatId: null,
          reason: null,
          windowHours: CancellationPolicySystem.stampOf(policyWithWindow(24)),
        },
        NOW,
        [],
      ),
    );
    for (const outcome of outcomes(step.appointment)) {
      expect(outcome).not.toHaveProperty('windowHours');
    }
    expect(outcomes(step.appointment).map((outcome) => outcome.kind)).toEqual([
      'worked',
      'worked',
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
    for (const status of [
      BookingStatus.complete(NOW),
      BookingStatus.noShow(NOW),
      BookingStatus.cancel(NOW, 'unspecified'),
    ]) {
      const visit = { ...storedParty(), bookingStatus: status };
      expect(
        unwrapErr(CancellationPolicySystem.mayCancel(visit, policy, NOW)),
      ).toEqual({
        code: CancellationRefusalCode.NotCancellable,
        status: status.kind,
      });
    }
  });

  it('refuses past the deadline, naming the window and the deadline', () => {
    const late = START_MS - 2 * HOUR;
    expect(
      unwrapErr(
        CancellationPolicySystem.mayCancel(storedParty(), policy, late),
      ),
    ).toEqual({
      code: CancellationRefusalCode.WindowClosed,
      windowHours: 24,
      deadlineMs: START_MS - 24 * HOUR,
    });
  });

  it('falls OPEN on a start that is not a number — nobody is trapped in a booking', () => {
    const broken = {
      ...storedParty(),
      seats: storedParty().seats.map((seat): Seat => ({
        ...seat,
        startMs: Number.NaN,
      })),
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
          const at = START_MS + offset;
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
