import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  type BookingPolicy as EcsBookingPolicy,
  ClientStatsPolicy as EcsClientStatsPolicy,
  DurationMinutes,
  MinuteCount,
  type SchedulingError,
  SchedulingErrorCode,
  UtcEpochMs,
  defect,
} from '@creativo/ecs-core';
import { BookingPolicy } from './booking-policy';
import type { CancellationWindow } from './cancellation-window';
import { InvalidClientStatsPolicyError } from './client-stats.errors';

/*
 * Phase 2 shim: the policy and its rules are `ClientStatsPolicy` in
 * `@creativo/ecs-core` (a component: the validation, the late line). This
 * class keeps the legacy shape for its callers — its `booking` is the
 * `BookingPolicy` class — and converts at the edge (`toStruct`): minutes to
 * their brands, epoch ms to `UtcEpochMs`.
 */

/**
 * How far back `ClientStats` keeps individual instants: the longest window a
 * reader asks for (the route's 12-month counters, R35). Everything older
 * lives on only in the lifetime counts.
 */
export const CLIENT_STATS_BOUNDED_DAYS: typeof EcsClientStatsPolicy.BOUNDED_DAYS = 365;

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
    // A window longer than the stored instants would ask about no-shows the
    // document no longer holds, and the suggestion would quietly undercount.
    const result = EcsClientStatsPolicy.create({
      booking: bookingStruct(props.booking),
      suggestPauseNoShows: props.suggestPauseNoShows,
      suggestPauseWindowDays: props.suggestPauseWindowDays,
    });
    if (!result.ok) return fail(result.error.map(toLegacyError));
    return ok(
      new ClientStatsPolicy(
        props.booking,
        result.value.suggestPauseNoShows,
        result.value.suggestPauseWindowDays,
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
    if (result.isFailure()) defect('unreachable: defaults are valid');
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
    const start = UtcEpochMs.of(startMs);
    const cancelledAt = UtcEpochMs.of(cancelledAtMs);
    // Not an instant: no free cancellation can be proven, as the legacy
    // arithmetic over a `NaN` answered.
    if (!start.ok || !cancelledAt.ok) return true;
    return EcsClientStatsPolicy.isLateCancellation(
      this.toStruct(),
      start.value,
      cancelledAt.value,
      stamped === null ? null : stamped.hours,
    );
  }

  /**
   * Phase 2 bridge: this policy as the `@creativo/ecs-core` struct the
   * systems take (`ClientStatsSystem`'s `policy`). Deleted with the class.
   */
  toStruct(): EcsClientStatsPolicy {
    return {
      booking: bookingStruct(this.booking),
      suggestPauseNoShows: this.suggestPauseNoShows,
      suggestPauseWindowDays: this.suggestPauseWindowDays,
    };
  }
}

/**
 * The booking policy class as the plain struct. The class's own guard
 * already holds the slot step positive and the lead non-negative, so their
 * brands cannot refuse.
 */
function bookingStruct(booking: BookingPolicy): EcsBookingPolicy {
  const slotStep = DurationMinutes.of(booking.slotStepMinutes);
  const minLead = MinuteCount.of(booking.minLeadMinutes);
  if (!slotStep.ok || !minLead.ok) {
    defect('unreachable: a BookingPolicy its own guard let through');
  }
  return {
    maxPartySize: booking.maxPartySize,
    slotStepMinutes: slotStep.value,
    minLeadMinutes: minLead.value,
    horizonMonths: booking.horizonMonths,
    cancellationWindowHours: booking.cancellationWindowHours,
    maxFlexibleDays: booking.maxFlexibleDays,
    autoConfirm: booking.autoConfirm,
  };
}

/** A refused field as the legacy error class (`scheduling.client_stats_policy.invalid`). */
function toLegacyError(error: SchedulingError): InvalidClientStatsPolicyError {
  // `create` refuses with this one code only; the guard narrows the union.
  return error.errorCode === SchedulingErrorCode.ClientStatsPolicyInvalid
    ? new InvalidClientStatsPolicyError(error.field, error.rawValue)
    : new InvalidClientStatsPolicyError(error.errorCode, Number.NaN);
}
