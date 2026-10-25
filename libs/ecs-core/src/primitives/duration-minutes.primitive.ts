import { Result } from './result.data';
import type { Brand } from './brand';
import type { EndMinute, MinuteOfDay } from './minute-of-day.primitive';
import { PrimitiveError, PrimitiveErrorCode } from './primitive.error';

/**
 * A positive whole number of minutes — the length of a service, a slot step
 * or a TTL. Never zero, never an instant.
 */
export type DurationMinutes = Brand<number, 'DurationMinutes'>;

/**
 * A non-negative whole number of minutes — padding, turnaround, free time, a
 * lead floor. Zero is a legal amount.
 */
export type MinuteCount = Brand<number, 'MinuteCount'>;

/**
 * A signed whole number of minutes — a shift, a lateness, an offset between
 * two wall-clock points.
 */
export type MinuteDelta = Brand<number, 'MinuteDelta'>;

export const DurationMinutes = {
  /** The smart constructor: an integer `> 0`. */
  of(raw: number): Result<DurationMinutes, PrimitiveError> {
    return Number.isSafeInteger(raw) && raw > 0
      ? Result.ok(raw as DurationMinutes)
      : Result.err(
          PrimitiveError.of(
            PrimitiveErrorCode.DurationNotPositive,
            raw,
            'DurationMinutes',
          ),
        );
  },

  /** `end − start` — refused when the span is empty or inverted. */
  between(
    start: MinuteOfDay,
    end: EndMinute,
  ): Result<DurationMinutes, PrimitiveError> {
    return DurationMinutes.of(end - start);
  },

  /** The sum of two positive durations is positive. */
  sum(a: DurationMinutes, b: DurationMinutes): DurationMinutes {
    return (a + b) as DurationMinutes;
  },
} as const;

export const MinuteCount = {
  /** The smart constructor: an integer `≥ 0`. */
  of(raw: number): Result<MinuteCount, PrimitiveError> {
    return Number.isSafeInteger(raw) && raw >= 0
      ? Result.ok((raw + 0) as MinuteCount)
      : Result.err(
          PrimitiveError.of(
            PrimitiveErrorCode.MinuteCountNegative,
            raw,
            'MinuteCount',
          ),
        );
  },

  /** No minutes — the identity of {@link add}. */
  ZERO: 0 as MinuteCount,

  add(a: MinuteCount, b: MinuteCount): MinuteCount {
    return (a + b) as MinuteCount;
  },

  /** The minutes from `start` to `end` on one day's clock; `0` when empty or inverted. */
  span(start: MinuteOfDay, end: EndMinute): MinuteCount {
    return (end > start ? end - start : 0) as MinuteCount;
  },

  /** A positive duration is a non-negative count. */
  fromDuration(d: DurationMinutes): MinuteCount {
    return d as number as MinuteCount;
  },

  /**
   * A signed delta's non-negative part, `max(0, d)` — the minutes beyond
   * (a drafted length past the catalogue's), `0` when short; never `-0`.
   */
  fromDelta(d: MinuteDelta): MinuteCount {
    return (d > 0 ? d : 0) as MinuteCount;
  },
} as const;

export const MinuteDelta = {
  /** The smart constructor: any safe integer, signed. */
  of(raw: number): Result<MinuteDelta, PrimitiveError> {
    return Number.isSafeInteger(raw)
      ? Result.ok((raw + 0) as MinuteDelta)
      : Result.err(
          PrimitiveError.of(
            PrimitiveErrorCode.MinuteDeltaNotInteger,
            raw,
            'MinuteDelta',
          ),
        );
  },

  /**
   * `to − from` on one day's wall clock — negative when `to` comes first.
   * Either side may be a start (`MinuteOfDay`) or an exclusive end
   * (`EndMinute`, up to the closing midnight 1440): the distance from a
   * visit's start to its own end is as total as the distance between two
   * starts.
   */
  between(
    from: MinuteOfDay | EndMinute,
    to: MinuteOfDay | EndMinute,
  ): MinuteDelta {
    return (to - from) as MinuteDelta;
  },

  /** A positive duration as a signed delta — total: every `DurationMinutes` is a `MinuteDelta`. */
  fromDuration(d: DurationMinutes): MinuteDelta {
    return d as number as MinuteDelta;
  },
} as const;
