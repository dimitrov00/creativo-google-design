import { Result } from './result.data';
import type { Brand } from './brand';
import { defect } from './defect';
import {
  type DurationMinutes,
  MinuteCount,
} from './duration-minutes.primitive';
import { PrimitiveError, PrimitiveErrorCode } from './primitive.error';

/** Minutes in a shop day on the wall clock — the exclusive end of the last minute. */
const MINUTES_PER_DAY = 1440;
/** Minutes in an hour — the clock text's two fields. */
const MINUTES_PER_HOUR = 60;
/** The last hour a clock text may name (23) and its last minute (59). */
const LAST_HOUR = 23;
const LAST_MINUTE_OF_HOUR = 59;

/**
 * Typed clock text, AFTER the trim: one or two hour digits, a colon, two
 * minute digits, nothing around them (`9:05`, `09:05`, `23:59`). Anchored at
 * both ends — `10:30:00` and `10:30x` are not a clock (DEP-22).
 */
const CLOCK_TEXT = /^(\d{1,2}):(\d{2})$/;

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

function outOfRange(
  raw: string | number,
  brand: string,
): Result.Err<PrimitiveError> {
  return Result.err(
    PrimitiveError.of(PrimitiveErrorCode.MinuteOutOfRange, raw, brand),
  );
}

export const MinuteOfDay = {
  /** The day's last minute (1439, `MINUTES_PER_DAY − 1`): where a clamp stops, and a day read at its close. */
  LAST: (MINUTES_PER_DAY - 1) as MinuteOfDay,

  /** The smart constructor — the ONLY way foreign input becomes a MinuteOfDay. */
  of(raw: number): Result<MinuteOfDay, PrimitiveError> {
    return MinuteOfDay.is(raw)
      ? Result.ok(raw)
      : outOfRange(raw, 'MinuteOfDay');
  },

  /**
   * The read-time door (edge hardening D-1) and the ONE home of the range
   * rule — an integer in `[0, 1440)` — which {@link of} and
   * {@link ofProven} answer through; `false` for every other value,
   * non-numbers included. No `Result`, no allocation.
   */
  is(raw: unknown): raw is MinuteOfDay {
    return (
      typeof raw === 'number' &&
      Number.isInteger(raw) &&
      raw >= 0 &&
      raw < MINUTES_PER_DAY
    );
  },

  /**
   * A minute the CALLER's own arithmetic already holds in `[0, 1440)` — the
   * non-allocating door for hot loops (no `Result`): a value out of range is
   * a broken invariant ({@link defect}), never foreign input, which goes
   * through {@link of}.
   */
  ofProven(raw: number): MinuteOfDay {
    return MinuteOfDay.is(raw) ? raw : defect(`minute ${raw} is off the clock`);
  },

  /**
   * Typed clock text (`HH:MM`, 24-hour) as the minute it names — an EDGE
   * smart constructor: the text is TRIMMED first (as both editors' fields
   * always trimmed theirs, so `' 10:30 '` is 10:30), then read strictly
   * (`^(\d{1,2}):(\d{2})$`, hours ≤ 23, minutes ≤ 59) into `[0, 1440)`.
   * Anything else — `24:00`, `10:30:00`, `10:30x`, `9:75`, `7`, `''` —
   * answers the minute's own refusal, `PRIMITIVE_MINUTE_OUT_OF_RANGE` with
   * `raw` the text as received (the family's one generic word; no new code,
   * D-5). The 24-hour FACE of a minute is the UI's (`formatClock` in
   * `@creativo/ui/wall-clock`, Law 5); `parseClock` reads every minute it
   * prints with `WRAP` back to itself.
   */
  parseClock(raw: string): Result<MinuteOfDay, PrimitiveError> {
    const match = CLOCK_TEXT.exec(raw.trim());
    if (match === null) return outOfRange(raw, 'MinuteOfDay');
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours <= LAST_HOUR && minutes <= LAST_MINUTE_OF_HOUR
      ? Result.ok((hours * MINUTES_PER_HOUR + minutes) as MinuteOfDay)
      : outOfRange(raw, 'MinuteOfDay');
  },

  /** `m + d`, clamped to the day's last minute ({@link MinuteOfDay.LAST}); never re-validates. */
  addClamped(m: MinuteOfDay, d: MinuteCount): MinuteOfDay {
    return Math.min(m + d, MinuteOfDay.LAST) as MinuteOfDay;
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
    return EndMinute.is(raw) ? Result.ok(raw) : outOfRange(raw, 'EndMinute');
  },

  /**
   * The read-time door (edge hardening D-1) and the ONE home of the range
   * rule — an integer in `(0, 1440]` — which {@link of} and
   * {@link ofProven} answer through; `false` for every other value. No
   * `Result`, no allocation.
   */
  is(raw: unknown): raw is EndMinute {
    return (
      typeof raw === 'number' &&
      Number.isInteger(raw) &&
      raw > 0 &&
      raw <= MINUTES_PER_DAY
    );
  },

  /**
   * An exclusive end the CALLER's own arithmetic already holds in
   * `(0, 1440]` — the non-allocating door for hot loops (no `Result`); out
   * of range is a broken invariant ({@link defect}).
   */
  ofProven(raw: number): EndMinute {
    return EndMinute.is(raw) ? raw : defect(`end ${raw} is off the clock`);
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

/**
 * A minute on a frame's anchored TRACK axis, counted from the shop day's
 * midnight — a non-negative integer with NO upper bound: a wall-clock start,
 * a wall-clock end, or an anchored minute past the closing midnight (a late
 * cut 23:25–00:15 is 1405–1455; the axis grows rather than wraps). What the
 * staff sheets' draft and the time grid carry (`VisitDraft`, `GridEvent`,
 * `TrackSpan`, the drag axis) before a commit reads it back onto the stored
 * wall clock. A `MinuteOfDay` and an `EndMinute` ARE track minutes as they
 * are; the way back is {@link TrackMinute.toStart}/{@link TrackMinute.toEnd},
 * which refuse a minute the day's clock cannot hold. Never an instant, never
 * a zone. Its 24-hour face is the UI's (`formatClock`, Law 5).
 */
export type TrackMinute =
  MinuteOfDay | EndMinute | Brand<number, 'TrackMinute'>;

/** A non-negative safe integer — every minute the track axis holds. */
function onTrack(raw: number): boolean {
  return Number.isSafeInteger(raw) && raw >= 0;
}

export const TrackMinute = {
  /**
   * The smart constructor: any non-negative safe integer (a negative zero
   * folds to `0`). No upper bound — 1440, 1455 and 2880 are minutes of an
   * anchored axis, so no value a sheet accepts today refuses here.
   */
  of(raw: number): Result<TrackMinute, PrimitiveError> {
    return onTrack(raw)
      ? Result.ok((raw + 0) as TrackMinute)
      : outOfRange(raw, 'TrackMinute');
  },

  /**
   * A track minute the CALLER's own arithmetic already holds non-negative
   * and whole — the non-allocating door (no `Result`); anything else is a
   * broken invariant ({@link defect}), never foreign input.
   */
  ofProven(raw: number): TrackMinute {
    return onTrack(raw)
      ? ((raw + 0) as TrackMinute)
      : defect(`minute ${raw} is off the track`);
  },

  /** `t + d` further along the axis — total: a track minute plus a count stays on the track. */
  plus(t: TrackMinute, d: MinuteCount | DurationMinutes): TrackMinute {
    return (t + d) as TrackMinute;
  },

  /** The minutes from `from` to `to` on the axis; `0` when empty or inverted. */
  span(from: TrackMinute, to: TrackMinute): MinuteCount {
    const span = MinuteCount.of(to > from ? to - from : 0);
    // Two non-negative safe integers: their clamped difference is one too.
    return span.ok ? span.value : defect(`no span from ${from} to ${to}`);
  },

  /** The axis minute as a start on the day's clock — refused at 1440 and past it. */
  toStart(t: TrackMinute): Result<MinuteOfDay, PrimitiveError> {
    return MinuteOfDay.of(t);
  },

  /** The axis minute as an exclusive end on the day's clock — refused at 0 and past 1440. */
  toEnd(t: TrackMinute): Result<EndMinute, PrimitiveError> {
    return EndMinute.of(t);
  },
} as const;
