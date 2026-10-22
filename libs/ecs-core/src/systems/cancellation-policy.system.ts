import {
  TimeCoordinate,
  type ChairGeometry,
  BookingLifecycle,
  BookingPolicy,
} from '@core/components';
import {
  BookingStatus,
  CancellationRefusal,
  Result,
  SchedulingError,
  UtcEpochMs,
} from '@core/primitives';
import type { Appointment } from '@core/entities';
import { AppointmentIndexSystem } from './appointment-index.system';

/** A free cancel (or move): the window it was allowed under — the stamp its seats carry. */
export type CancellationAllowance = { readonly windowHours: number };

/** The free-cancellation deadline: `windowHours` of ELAPSED time before the start (T2). */
function deadlineUtcMs(
  windowHours: number,
  startUtcMs: UtcEpochMs,
): UtcEpochMs {
  return UtcEpochMs.plusHours(startUtcMs, -windowHours);
}

function allowsFreeCancelAt(
  windowHours: number,
  startUtcMs: UtcEpochMs,
  atUtcMs: UtcEpochMs,
): boolean {
  return (
    UtcEpochMs.compare(atUtcMs, deadlineUtcMs(windowHours, startUtcMs)) <= 0
  );
}

/**
 * The visit's start as an instant — the earliest seat, the truth, placed on
 * the absolute timeline by its distance from the envelope
 * (`TimeCoordinate.seatStartUtcMs`, T9); the envelope's own instant when the
 * visit holds no seat.
 */
function startUtcMsOf(
  appointment: TimeCoordinate & { readonly seats: readonly ChairGeometry[] },
): UtcEpochMs {
  const envelope = AppointmentIndexSystem.envelope(appointment);
  return envelope === null
    ? appointment.utcEpochMs
    : TimeCoordinate.seatStartUtcMs(appointment, envelope);
}

/**
 * The free-cancellation window — `cancellation-window.ts` as arithmetic over
 * whole hours (one rule for the number: `BookingPolicy.isValidCancellationWindowHours`,
 * which the setting and every stamp on a cancelled seat accept alike).
 *
 * ONE formula for the deadline (`start − hours × 1 h` of elapsed time — a T2
 * lifecycle comparison on `UtcEpochMs`, G-1): the callable that refuses a
 * late client cancel, the page that names the deadline and the counter that
 * calls a past cancellation late all draw it here, so they agree to the
 * millisecond. Free AT the deadline, not a millisecond past.
 */
export const CancellationPolicySystem = {
  /**
   * The longest window a policy may hold — 2,400,000,000 hours, the time
   * range's half-width, so the deadline of any visit at or after the epoch
   * stays an exact, safe integer. An arithmetic bound.
   */
  MAX_WINDOW_HOURS: BookingPolicy.CANCELLATION_WINDOW_MAX_HOURS,

  /**
   * The edge guard for a window: whole hours, zero or more, within the
   * bound — refused with `SCHEDULING_CANCELLATION_WINDOW_INVALID` and the raw
   * value otherwise. A negative zero is stored as the zero every reader
   * compares against.
   */
  windowOf(
    hours: number,
  ): Result<number, SchedulingError.CancellationWindowInvalid> {
    if (!BookingPolicy.isValidCancellationWindowHours(hours)) {
      return Result.err(SchedulingError.cancellationWindowInvalid(hours));
    }
    return Result.ok(hours + 0);
  },

  /**
   * The stamp a cancellation carries: the window in force, or `null` —
   * UNKNOWN — when the policy could not be read (a shop cancel still lands;
   * the stats then judge it by the current policy).
   */
  stampOf(policy: BookingPolicy | null): number | null {
    return policy === null ? null : policy.cancellationWindowHours;
  },

  /** The deadline of a visit starting at `startUtcMs` (was `deadlineMs`). */
  deadlineUtcMs,

  allowsFreeCancelAt,

  /** The visit's start instant — the earliest seat's, else the envelope's. */
  startUtcMsOf,

  /**
   * A cancellation recorded at `cancelledAtUtcMs` was LATE under the window
   * it is judged by (its own stamp, else the current policy's), against the
   * start of the seat it called off (`TimeCoordinate.seatStartUtcMs`).
   */
  isLateCancellation(
    windowHours: number,
    seatStartUtcMs: UtcEpochMs,
    cancelledAtUtcMs: UtcEpochMs,
  ): boolean {
    return !allowsFreeCancelAt(windowHours, seatStartUtcMs, cancelledAtUtcMs);
  },

  /**
   * May the CLIENT cancel this visit now (`cancel-appointment.ts:101-170`)?
   * The window is the rule this path enforces, so an unread policy refuses
   * (`POLICY_UNAVAILABLE`); the lifecycle graph refuses a visit that cannot
   * be cancelled at all; the deadline refuses a late one. A start that is
   * not a number falls OPEN: refusing over a malformed instant would trap
   * someone in a booking forever.
   */
  mayCancel(
    appointment: Appointment,
    policy: BookingPolicy | null,
    nowUtcMs: UtcEpochMs,
  ): Result<CancellationAllowance, CancellationRefusal> {
    if (policy === null) {
      return Result.err(CancellationRefusal.policyUnavailable());
    }
    if (!BookingLifecycle.canTransition(appointment, BookingStatus.Cancelled)) {
      return Result.err(
        CancellationRefusal.notCancellable(appointment.bookingStatus),
      );
    }
    const windowHours = policy.cancellationWindowHours;
    const startUtcMs = startUtcMsOf(appointment);
    if (
      Number.isFinite(startUtcMs) &&
      !allowsFreeCancelAt(windowHours, startUtcMs, nowUtcMs)
    ) {
      return Result.err(
        CancellationRefusal.windowClosed(
          windowHours,
          deadlineUtcMs(windowHours, startUtcMs),
        ),
      );
    }
    return Result.ok({ windowHours });
  },

  /**
   * May the client MOVE this visit now? A move gives up the current slot
   * exactly as a cancel does, so it is judged by the same graph and the same
   * window, read off the CURRENT start — the commitment the shop planned
   * around (`reschedule-booking.use-case.ts:446,651-664`).
   */
  mayMove(
    appointment: Appointment,
    policy: BookingPolicy | null,
    nowUtcMs: UtcEpochMs,
  ): Result<CancellationAllowance, CancellationRefusal> {
    return CancellationPolicySystem.mayCancel(appointment, policy, nowUtcMs);
  },
} as const;
