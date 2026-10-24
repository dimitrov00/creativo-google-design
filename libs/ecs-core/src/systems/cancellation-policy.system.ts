import {
  TimeCoordinate,
  type ChairGeometry,
  BookingLifecycle,
  BookingPolicy,
} from '@core/components';
import { BookingStatus, Result, type UtcEpochMs } from '@core/primitives';
import { CancellationRefusal } from '@core/errors';
import type { Appointment } from '@core/entities';
import { AppointmentIndexSystem } from './appointment-index.system';

/** A free cancel (or move): the window it was allowed under — the stamp its seats carry. */
export type CancellationAllowance = { readonly windowHours: number };

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
 * lifecycle comparison on `UtcEpochMs`, G-1), `BookingPolicy`'s
 * `cancellationDeadlineUtcMs` / `allowsFreeCancelAt`: the callable that
 * refuses a late client cancel (here), the page that names the deadline and
 * the counter that calls a past cancellation late
 * (`ClientStatsPolicy.isLateCancellation`) all draw it there, so they agree
 * to the millisecond. Free AT the deadline, not a millisecond past.
 */
export const CancellationPolicySystem = {
  /**
   * The stamp a cancellation carries: the window in force, or `null` —
   * UNKNOWN — when the policy could not be read (a shop cancel still lands;
   * the stats then judge it by the current policy).
   */
  stampOf(policy: BookingPolicy | null): number | null {
    return policy === null ? null : policy.cancellationWindowHours;
  },

  /** The visit's start instant — the earliest seat's, else the envelope's. */
  startUtcMsOf,

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
      !BookingPolicy.allowsFreeCancelAt(windowHours, startUtcMs, nowUtcMs)
    ) {
      return Result.err(
        CancellationRefusal.windowClosed(
          windowHours,
          BookingPolicy.cancellationDeadlineUtcMs(windowHours, startUtcMs),
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
