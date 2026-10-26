import { type HourCount, type UtcEpochMs, Result } from '@core/primitives';
import { SchedulingError } from '@core/errors';
import { BookingPolicy } from './booking-policy.data';

/**
 * How far back `ClientStats` keeps individual instants: the longest window a
 * reader asks for (the route's 12-month counters, R35). Older visits live on
 * only in the lifetime counts.
 */
const BOUNDED_DAYS = 365;

/**
 * The numbers a client's history is judged by — ClientStatsSystem's `policy`
 * input (`client-stats-policy.ts`, blueprint §2.1).
 *
 * The late-cancel line is the booking policy's own deadline formula, HELD
 * rather than copied: the callable that refuses a free cancellation and the
 * counter that calls one "late" agree to the millisecond. The suggestion
 * thresholds are R47's defaults until a `settings/supportPolicy` document
 * ships.
 */
export type ClientStatsPolicy = {
  /**
   * The tenant's booking policy. Its free-cancellation window decides "late"
   * only for a cancellation that carries no stamp of its own (recorded
   * before 2026-09-25) — see `isLateCancellation`.
   */
  readonly booking: BookingPolicy;
  /** No-shows inside the window that raise a pause SUGGESTION (R47: 3). */
  readonly suggestPauseNoShows: number;
  /** R47: 60. Must fit inside `BOUNDED_DAYS`, which is all a reader keeps. */
  readonly suggestPauseWindowDays: number;
};

/** R47's thresholds over a booking policy. */
function forBooking(booking: BookingPolicy): ClientStatsPolicy {
  return { booking, suggestPauseNoShows: 3, suggestPauseWindowDays: 60 };
}

export const ClientStatsPolicy = {
  BOUNDED_DAYS,

  /** R47's thresholds over the default booking policy — one constant value. */
  DEFAULT: forBooking(BookingPolicy.DEFAULT),

  /** R47's thresholds over the tenant's booking policy (what the recompute loads). */
  forBooking,

  /**
   * The edge guard, every invalid field at once (one
   * `SCHEDULING_CLIENT_STATS_POLICY_INVALID` per field): a positive integer
   * of no-shows, and a positive window that fits inside `BOUNDED_DAYS` — a
   * longer one would ask about no-shows the document no longer holds, and
   * the suggestion would quietly undercount.
   */
  create(
    props: ClientStatsPolicy,
  ): Result<ClientStatsPolicy, readonly SchedulingError[]> {
    const errors: SchedulingError[] = [];
    if (
      !Number.isInteger(props.suggestPauseNoShows) ||
      props.suggestPauseNoShows <= 0
    ) {
      errors.push(
        SchedulingError.clientStatsPolicyInvalid(
          'suggestPauseNoShows',
          props.suggestPauseNoShows,
        ),
      );
    }
    if (
      !Number.isInteger(props.suggestPauseWindowDays) ||
      props.suggestPauseWindowDays <= 0 ||
      props.suggestPauseWindowDays > BOUNDED_DAYS
    ) {
      errors.push(
        SchedulingError.clientStatsPolicyInvalid(
          'suggestPauseWindowDays',
          props.suggestPauseWindowDays,
        ),
      );
    }
    if (errors.length > 0) return Result.err(errors);
    return Result.ok({
      booking: props.booking,
      suggestPauseNoShows: props.suggestPauseNoShows,
      suggestPauseWindowDays: props.suggestPauseWindowDays,
    });
  },

  /**
   * Called off inside the free-cancellation window — the complement of
   * `BookingPolicy.mayCancelAt` — judged by the window IN FORCE WHEN IT WAS
   * CALLED OFF. `stampedWindowHours` is that window as the cancel path
   * recorded it on the seat (`SeatOutcome` `cancelled.windowHours`); when it
   * is there the policy's own window plays no part, so moving the window
   * later re-judges nobody. `null` is unknown (a cancellation recorded before
   * the stamp, or one whose policy read failed) and falls back to the
   * booking policy's CURRENT window. Either way the line is
   * `BookingPolicy.allowsFreeCancelAt`, the formula the cancel callable
   * refuses by — a lifecycle comparison of two instants (flatten-spec T2,
   * gated by G-1).
   */
  isLateCancellation(
    policy: ClientStatsPolicy,
    startUtcMs: UtcEpochMs,
    cancelledAtUtcMs: UtcEpochMs,
    stampedWindowHours: HourCount | null,
  ): boolean {
    const windowHours =
      stampedWindowHours ?? policy.booking.cancellationWindowHours;
    return !BookingPolicy.allowsFreeCancelAt(
      windowHours,
      startUtcMs,
      cancelledAtUtcMs,
    );
  },
} as const;
