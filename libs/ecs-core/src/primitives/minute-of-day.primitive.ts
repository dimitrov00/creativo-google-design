import { Result } from './result.data';
import type { Brand } from './brand';
import { defect } from './defect';
import type {
  DurationMinutes,
  MinuteCount,
} from './duration-minutes.primitive';
import { PrimitiveError, PrimitiveErrorCode } from './primitive-errors.data';

/** Minutes in a shop day on the wall clock — the exclusive end of the last minute. */
const MINUTES_PER_DAY = 1440;

/**
 * Minutes from the shop's local midnight on its wall clock — an integer in
 * `[0, 1440)`; a point, never an instant, never carries a zone. All
 * collision, packing and availability math runs on it, which keeps that math
 * immune to DST.
 */
export type MinuteOfDay = Brand<number, 'MinuteOfDay'>;

/**
 * An exclusive end on the shop's wall clock — an integer in `(0, 1440]`;
 * `1440` is the midnight that closes the day (decision F-1: a shift, a day
 * window or an exception may run to midnight, which `MinuteOfDay`'s locked
 * `[0, 1440)` cannot hold).
 */
export type EndMinute = Brand<number, 'EndMinute'>;

function outOfRange(raw: number, brand: string): Result.Err<PrimitiveError> {
  return Result.err(
    PrimitiveError.of(PrimitiveErrorCode.MinuteOutOfRange, raw, brand),
  );
}

export const MinuteOfDay = {
  /** The smart constructor — the ONLY way foreign input becomes a MinuteOfDay. */
  of(raw: number): Result<MinuteOfDay, PrimitiveError> {
    return Number.isInteger(raw) && raw >= 0 && raw < MINUTES_PER_DAY
      ? Result.ok(raw as MinuteOfDay)
      : outOfRange(raw, 'MinuteOfDay');
  },

  /**
   * A minute the CALLER's own arithmetic already holds in `[0, 1440)` — the
   * non-allocating door for hot loops (no `Result`): a value out of range is
   * a broken invariant ({@link defect}), never foreign input, which goes
   * through {@link of}.
   */
  ofProven(raw: number): MinuteOfDay {
    return Number.isInteger(raw) && raw >= 0 && raw < MINUTES_PER_DAY
      ? (raw as MinuteOfDay)
      : defect(`minute ${raw} is off the clock`);
  },

  /** `m + d`, clamped to the day's last minute (1439); never re-validates. */
  addClamped(m: MinuteOfDay, d: MinuteCount): MinuteOfDay {
    return Math.min(m + d, MINUTES_PER_DAY - 1) as MinuteOfDay;
  },

  /** `m − d`, clamped to the day's first minute (0); never re-validates. */
  minusClamped(m: MinuteOfDay, d: MinuteCount): MinuteOfDay {
    return Math.max(m - d, 0) as MinuteOfDay;
  },

  /**
   * An exclusive end that lies BEFORE another end read as the next span's
   * start — total: every `EndMinute` below the closing midnight is a
   * `MinuteOfDay`. Reaching 1440 here is a broken invariant ({@link defect});
   * foreign or unproven input goes through {@link fromEnd}.
   */
  ofOpenEnd(e: EndMinute): MinuteOfDay {
    return e < MINUTES_PER_DAY
      ? (e as number as MinuteOfDay)
      : defect(`end ${e} has no next minute on its day`);
  },

  /** An exclusive end read as the next span's start — refused at 1440 (the next day). */
  fromEnd(e: EndMinute): Result<MinuteOfDay, PrimitiveError> {
    return e < MINUTES_PER_DAY
      ? Result.ok(e as number as MinuteOfDay)
      : outOfRange(e, 'MinuteOfDay');
  },
} as const;

export const EndMinute = {
  /** The smart constructor — the ONLY way foreign input becomes an EndMinute. */
  of(raw: number): Result<EndMinute, PrimitiveError> {
    return Number.isInteger(raw) && raw > 0 && raw <= MINUTES_PER_DAY
      ? Result.ok(raw as EndMinute)
      : outOfRange(raw, 'EndMinute');
  },

  /**
   * An exclusive end the CALLER's own arithmetic already holds in
   * `(0, 1440]` — the non-allocating door for hot loops (no `Result`); out
   * of range is a broken invariant ({@link defect}).
   */
  ofProven(raw: number): EndMinute {
    return Number.isInteger(raw) && raw > 0 && raw <= MINUTES_PER_DAY
      ? (raw as EndMinute)
      : defect(`end ${raw} is off the clock`);
  },

  /** The end of a span of `d` minutes starting at `start` — refused past midnight. */
  after(
    start: MinuteOfDay,
    d: DurationMinutes,
  ): Result<EndMinute, PrimitiveError> {
    const end = start + d;
    return end <= MINUTES_PER_DAY
      ? Result.ok(end as EndMinute)
      : outOfRange(end, 'EndMinute');
  },

  /**
   * A start that lies AFTER another minute of the day read as an exclusive
   * end — total: every `MinuteOfDay` above the opening midnight is an
   * `EndMinute`. A `0` here is a broken invariant ({@link defect}).
   */
  ofLaterStart(m: MinuteOfDay): EndMinute {
    return m > 0
      ? (m as number as EndMinute)
      : defect('no span ends at the opening midnight');
  },

  /** `e + d`, clamped to the closing midnight (1440); never re-validates. */
  plusClamped(e: EndMinute, d: MinuteCount): EndMinute {
    return Math.min(e + d, MINUTES_PER_DAY) as EndMinute;
  },

  /** An exclusive end as the next span's start ({@link MinuteOfDay.fromEnd}). */
  toStart(e: EndMinute): Result<MinuteOfDay, PrimitiveError> {
    return MinuteOfDay.fromEnd(e);
  },
} as const;
