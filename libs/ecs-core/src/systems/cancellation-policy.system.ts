import { BookingPolicy } from '../components/booking-policy.data';
import { BookingState, BookingStatus } from '../components/booking-status.data';
import { Result } from '../components/result.data';
import { SchedulingError } from '../components/scheduling-errors.data';
import type { AppointmentEntity } from '../entities/appointment.entity';
import { AppointmentIndexSystem } from './appointment-index.system';

const MS_PER_HOUR = 3_600_000;

/**
 * Why a client may not cancel (or move) a visit for free — the stable codes
 * of the cancel callable (`cancel-appointment.ts`), the ONLY source of these
 * strings. A move is refused on the same rule as a cancel
 * (`reschedule-booking.use-case.ts:280-292`), so it shares them.
 */
export const CancellationRefusalCode = {
  /** The policy could not be read: nobody can say whether it is still free. */
  PolicyUnavailable: 'booking.cancel.policy_unavailable',
  /** Completed, no-showed or already cancelled — the graph refuses. */
  NotCancellable: 'booking.cancel.not_cancellable',
  /** Past the free-cancellation deadline — call the shop instead. */
  WindowClosed: 'booking.cancel.window_closed',
} as const;
export type CancellationRefusalCode =
  (typeof CancellationRefusalCode)[keyof typeof CancellationRefusalCode];

export type CancellationRefusal =
  | { readonly code: typeof CancellationRefusalCode.PolicyUnavailable }
  | {
      readonly code: typeof CancellationRefusalCode.NotCancellable;
      readonly status: BookingState;
    }
  | {
      readonly code: typeof CancellationRefusalCode.WindowClosed;
      readonly windowHours: number;
      readonly deadlineMs: number;
    };

/** A free cancel (or move): the window it was allowed under — the stamp its seats carry. */
export type CancellationAllowance = { readonly windowHours: number };

function deadlineMs(windowHours: number, appointmentStartMs: number): number {
  return appointmentStartMs - windowHours * MS_PER_HOUR;
}

function allowsFreeCancelAt(
  windowHours: number,
  appointmentStartMs: number,
  atMs: number,
): boolean {
  return atMs <= deadlineMs(windowHours, appointmentStartMs);
}

/** The visit's start — the earliest seat, the truth; the mirror when it holds none. */
function startOf(appointment: AppointmentEntity): number {
  const envelope = AppointmentIndexSystem.envelope(appointment);
  return envelope === null
    ? appointment.timeInterval.startMs
    : envelope.startMs;
}

/**
 * The free-cancellation window — `cancellation-window.ts` as arithmetic over
 * whole hours (one rule for the number: `BookingPolicy.isValidCancellationWindowHours`,
 * which the setting and every stamp on a cancelled seat accept alike).
 *
 * ONE formula for the deadline (`start − hours × 1 h`): the callable that
 * refuses a late client cancel, the page that names the deadline and the
 * counter that calls a past cancellation late all draw it here, so they
 * agree to the millisecond. Free AT the deadline, not a millisecond past.
 */
export const CancellationPolicySystem = {
  /**
   * The longest window a policy may hold — 2,400,000,000 hours, the time
   * range's half-width, so the deadline of any visit at or after the epoch
   * is an exact, `Date`-representable instant. An arithmetic bound.
   */
  MAX_WINDOW_HOURS: BookingPolicy.CANCELLATION_WINDOW_MAX_HOURS,

  /**
   * The edge guard for a window: whole hours, zero or more, within the
   * bound — refused with `scheduling.cancellation_window.invalid` and the raw
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

  deadlineMs,

  allowsFreeCancelAt,

  /**
   * A cancellation recorded at `cancelledAtMs` was LATE under the window it
   * is judged by (its own stamp, else the current policy's).
   */
  isLateCancellation(
    windowHours: number,
    appointmentStartMs: number,
    cancelledAtMs: number,
  ): boolean {
    return !allowsFreeCancelAt(windowHours, appointmentStartMs, cancelledAtMs);
  },

  /**
   * May the CLIENT cancel this visit now (`cancel-appointment.ts:101-170`)?
   * The window is the rule this path enforces, so an unread policy refuses
   * (`policy_unavailable`); the lifecycle graph refuses a visit that cannot
   * be cancelled at all; the deadline refuses a late one. A start that is
   * not a number falls OPEN: refusing over a malformed instant would trap
   * someone in a booking forever.
   */
  mayCancel(
    appointment: AppointmentEntity,
    policy: BookingPolicy | null,
    nowMs: number,
  ): Result<CancellationAllowance, CancellationRefusal> {
    if (policy === null) {
      return Result.err({ code: CancellationRefusalCode.PolicyUnavailable });
    }
    if (
      !BookingStatus.canTransition(
        appointment.bookingStatus,
        BookingState.Cancelled,
      )
    ) {
      return Result.err({
        code: CancellationRefusalCode.NotCancellable,
        status: appointment.bookingStatus.kind,
      });
    }
    const windowHours = policy.cancellationWindowHours;
    const startMs = startOf(appointment);
    if (
      Number.isFinite(startMs) &&
      !allowsFreeCancelAt(windowHours, startMs, nowMs)
    ) {
      return Result.err({
        code: CancellationRefusalCode.WindowClosed,
        windowHours,
        deadlineMs: deadlineMs(windowHours, startMs),
      });
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
    appointment: AppointmentEntity,
    policy: BookingPolicy | null,
    nowMs: number,
  ): Result<CancellationAllowance, CancellationRefusal> {
    return CancellationPolicySystem.mayCancel(appointment, policy, nowMs);
  },
} as const;
