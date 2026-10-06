import { Result, fail, ok } from '@creativo/domain/kernel';
import { BookingPolicy } from './booking-policy';
import type { CancellationWindow } from './cancellation-window';
import { InvalidClientStatsPolicyError } from './client-stats.errors';

/**
 * How far back `ClientStats` keeps individual instants: the longest window a
 * reader asks for (the route's 12-month counters, R35). Everything older
 * lives on only in the lifetime counts.
 */
export const CLIENT_STATS_BOUNDED_DAYS = 365;

export interface ClientStatsPolicyProps {
  /**
   * The tenant's booking policy. Its free-cancellation window decides "late"
   * only for a cancellation that carries no stamp of its own (recorded before
   * 2026-09-25) — see `isLateCancellation`.
   */
  readonly booking: BookingPolicy;
  /** No-shows inside the window that raise a pause SUGGESTION (R47: 3). */
  readonly suggestPauseNoShows: number;
  /** R47: 60. Must fit inside the bounded window, which is all a reader keeps. */
  readonly suggestPauseWindowDays: number;
}

/**
 * The numbers a client's history is judged by.
 *
 * The late-cancel line is the booking policy's own deadline formula, held
 * rather than copied: the callable that refuses a free cancellation and the
 * counter that calls one "late" must agree to the millisecond. The window it
 * is drawn at is the one stamped on the cancellation when there is one, and
 * this policy's only for a cancellation recorded before the stamp. The suggestion
 * thresholds are `settings/supportPolicy` keys once P2 ships that document;
 * until then the defaults are the policy.
 */
export class ClientStatsPolicy {
  private constructor(
    readonly booking: BookingPolicy,
    readonly suggestPauseNoShows: number,
    readonly suggestPauseWindowDays: number,
  ) {}

  static create(
    props: ClientStatsPolicyProps,
  ): Result<ClientStatsPolicy, InvalidClientStatsPolicyError[]> {
    const errors: InvalidClientStatsPolicyError[] = [];
    if (
      !Number.isInteger(props.suggestPauseNoShows) ||
      props.suggestPauseNoShows <= 0
    ) {
      errors.push(
        new InvalidClientStatsPolicyError(
          'suggestPauseNoShows',
          props.suggestPauseNoShows,
        ),
      );
    }
    // A window longer than the stored instants would ask about no-shows the
    // document no longer holds, and the suggestion would quietly undercount.
    if (
      !Number.isInteger(props.suggestPauseWindowDays) ||
      props.suggestPauseWindowDays <= 0 ||
      props.suggestPauseWindowDays > CLIENT_STATS_BOUNDED_DAYS
    ) {
      errors.push(
        new InvalidClientStatsPolicyError(
          'suggestPauseWindowDays',
          props.suggestPauseWindowDays,
        ),
      );
    }
    if (errors.length > 0) return fail(errors);
    return ok(
      new ClientStatsPolicy(
        props.booking,
        props.suggestPauseNoShows,
        props.suggestPauseWindowDays,
      ),
    );
  }

  /** The R47 thresholds over the tenant's booking policy. */
  static forBooking(booking: BookingPolicy): ClientStatsPolicy {
    const result = ClientStatsPolicy.create({
      booking,
      suggestPauseNoShows: 3,
      suggestPauseWindowDays: 60,
    });
    if (result.isFailure()) throw new Error('unreachable: defaults are valid');
    return result.value;
  }

  private static _default: ClientStatsPolicy | null = null;

  /** Memoized for the same reason `BookingPolicy.default()` is. */
  static default(): ClientStatsPolicy {
    ClientStatsPolicy._default ??= ClientStatsPolicy.forBooking(
      BookingPolicy.default(),
    );
    return ClientStatsPolicy._default;
  }

  /**
   * Called off inside the free-cancellation window — the complement of
   * `mayCancelAt` — judged by the window IN FORCE WHEN IT WAS CALLED OFF.
   *
   * `stamped` is that window as the cancel path recorded it on the seat
   * (`SeatOutcome` `cancelled`, `window`), and when it is there the
   * policy's own window plays no part: moving the window later re-judges
   * nobody. `null` is unknown — a cancellation recorded before the stamp
   * existed (2026-09-25), or one whose policy read failed; nothing says what
   * rule it was made under, so it falls back to the booking policy's
   * CURRENT window. Either way the line is `CancellationWindow`'s own
   * formula, the one the cancel callable refuses by.
   */
  isLateCancellation(
    startMs: number,
    cancelledAtMs: number,
    stamped: CancellationWindow | null,
  ): boolean {
    const judgedBy = stamped ?? this.booking.cancellationWindow;
    return !judgedBy.allowsFreeCancelAt(startMs, cancelledAtMs);
  }
}
