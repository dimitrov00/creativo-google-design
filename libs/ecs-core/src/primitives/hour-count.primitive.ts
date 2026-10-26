import { Result } from './result.data';
import type { Brand } from './brand';
import { PrimitiveError, PrimitiveErrorCode } from './primitive.error';

const MS_PER_HOUR = 3_600_000;

/**
 * The ECMAScript time range's half-width in ms: a `Date` held instants up to
 * 8.64e15 ms either side of the epoch — the bound {@link HourCount.MAX}
 * keeps.
 */
const TIME_RANGE_MS = 8_640_000_000_000_000;

/**
 * A whole number of hours, zero or more — the free-cancellation window
 * (`BookingPolicy.cancellationWindowHours`, the stamp a cancelled seat
 * carries, the window a policy-recompute pass draws its late line at).
 * Elapsed time (a T2 row of flatten-spec §2.3), never a wall-clock span:
 * it is subtracted from an instant (`UtcEpochMs.minusHours`), never from a
 * `MinuteOfDay`. OR-45: one rule for every window, set or stamped.
 */
export type HourCount = Brand<number, 'HourCount'>;

export const HourCount = {
  /** No hours — a window that closes at the start itself. */
  ZERO: 0 as HourCount,

  /**
   * The longest count: 2,400,000,000 hours, the time range's half-width —
   * so for any instant at or after the epoch, `t − hours·1 h` is an exact,
   * safe-integer instant. An arithmetic bound, not a product one.
   */
  MAX: (TIME_RANGE_MS / MS_PER_HOUR) as HourCount,

  /** The smart constructor: an integer in `[0, MAX]`. */
  of(raw: number): Result<HourCount, PrimitiveError> {
    // `+ 0` folds a negative zero: store the zero every reader compares against.
    return HourCount.is(raw)
      ? Result.ok((raw + 0) as HourCount)
      : Result.err(
          PrimitiveError.of(
            PrimitiveErrorCode.HourCountOutOfRange,
            raw,
            'HourCount',
          ),
        );
  },

  /**
   * The read-time door (edge hardening D-1) and the ONE home of the rule —
   * an integer in `[0, MAX]` — which {@link of} answers through; `false` for
   * every other value. No `Result`, no allocation. (A stored `-0` passes, as
   * `of` accepts it; `of` folds it to `0`, the door narrows it as stored.)
   */
  is(raw: unknown): raw is HourCount {
    return (
      typeof raw === 'number' &&
      Number.isInteger(raw) &&
      raw >= 0 &&
      raw <= HourCount.MAX
    );
  },
} as const;
