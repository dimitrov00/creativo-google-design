import { Result } from './result.data';
import type { Brand } from './brand';
import type { MinuteDelta } from './duration-minutes.primitive';
import type { HourCount } from './hour-count.primitive';
import { PrimitiveError, PrimitiveErrorCode } from './primitive.error';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * The instants of the years 0001–9999 UTC (the four-digit `LocalDate`s):
 * 0001-01-01T00:00Z … 9999-12-31T23:59:59.999Z.
 */
const MIN_UTC_EPOCH_MS = -62_135_596_800_000;
const MAX_UTC_EPOCH_MS = 253_402_300_800_000 - 1;

/**
 * An absolute instant in epoch milliseconds — for lifecycle stamps, Firestore
 * range indexes, crons, `.ics` and the elapsed-time rules on stamps (expiries,
 * the cancellation window, cooldowns, budgets — Law 7.3 as amended
 * 2026-10-11); never for placement math. Computed
 * once, at the ingestion boundary, by `ZonedTimeSystem` from the location's
 * `timeZone`; collision, packing and availability run on `LocalDate` +
 * `MinuteOfDay` instead.
 */
export type UtcEpochMs = Brand<number, 'UtcEpochMs'>;

export const UtcEpochMs = {
  /**
   * The Unix epoch, 1970-01-01T00:00:00Z (`0`) — inside the window
   * {@link UtcEpochMs.of} accepts, so the brand is proven. The floor an
   * instant counts from (the retention rules' civil-day origin) and the
   * "no tick yet" seed of a clock signal.
   */
  EPOCH: 0 as UtcEpochMs,

  /**
   * The last instant {@link UtcEpochMs.of} accepts — 9999-12-31T23:59:59.999Z
   * (`253402300799999`). The numeric bound of a newest-first history's first
   * page (`utcEpochMs <= MAX`): Firestore's range filters match numbers
   * only, so the bound keeps a non-numeric stored instant out of the read
   * (edge hardening D-3).
   */
  MAX: MAX_UTC_EPOCH_MS as UtcEpochMs,

  /**
   * The smart constructor: a safe integer inside the years 0001–9999 (UTC) —
   * the window `ZonedTimeSystem` reads.
   */
  of(raw: number): Result<UtcEpochMs, PrimitiveError> {
    // `+ 0` folds a negative zero, so `-0` never reaches a document.
    return UtcEpochMs.is(raw)
      ? Result.ok((raw + 0) as UtcEpochMs)
      : Result.err(
          PrimitiveError.of(
            PrimitiveErrorCode.UtcEpochMsInvalid,
            raw,
            'UtcEpochMs',
          ),
        );
  },

  /**
   * The read-time door (edge hardening D-1) and the ONE home of the window
   * rule — a safe integer inside the years 0001–9999 — which {@link of}
   * answers through; `false` for every other value. No `Result`, no
   * allocation. (A stored `-0` passes, as `of` accepts it; `of` folds it to
   * `0`, the door narrows it as stored.)
   */
  is(raw: unknown): raw is UtcEpochMs {
    return (
      typeof raw === 'number' &&
      Number.isSafeInteger(raw) &&
      raw >= MIN_UTC_EPOCH_MS &&
      raw <= MAX_UTC_EPOCH_MS
    );
  },

  /** Instant order: `-1` when `a` is earlier, `0` when equal, `1` after. */
  compare(a: UtcEpochMs, b: UtcEpochMs): -1 | 0 | 1 {
    return a < b ? -1 : a > b ? 1 : 0;
  },

  /*
   * Exact elapsed arithmetic — GATED by G-1 (flatten-spec §0.2, §2.3 T2):
   * only the T2 exception list (TTLs, the cancellation window, lead-time and
   * lateness statistics, staleness, cooldowns, stamp ordering) may add to an
   * instant; never placement math. Under ruling (b) the follow-up commit
   * deletes these four and `elapsedMs`.
   */

  /**
   * The real time elapsed from `from` to `to`, in milliseconds (negative
   * when `to` is earlier) — a DURATION (N5), not an instant. The one place a
   * T2 difference of instants is taken (an age, a lateness, a lead time, a
   * day's length), so every such reading greps here.
   */
  elapsedMs(from: UtcEpochMs, to: UtcEpochMs): number {
    return to - from;
  },

  /** `t + ms` — `ms` is a duration in milliseconds (N5), not an instant. */
  plusMs(t: UtcEpochMs, ms: number): UtcEpochMs {
    return (t + ms) as UtcEpochMs;
  },

  /** `t + m` minutes of real elapsed time (T2/T9 only). */
  plusMinutes(t: UtcEpochMs, m: MinuteDelta): UtcEpochMs {
    return (t + m * MS_PER_MINUTE) as UtcEpochMs;
  },

  /** `t + hours` of real elapsed time (T2 only — e.g. a cancellation window). */
  plusHours(t: UtcEpochMs, hours: number): UtcEpochMs {
    return (t + hours * MS_PER_HOUR) as UtcEpochMs;
  },

  /**
   * `t − h` whole hours of real elapsed time (T2 only — the free-cancellation
   * deadline, `start − window`, OR-45). `HourCount.MAX` keeps the result an
   * exact, safe integer for any `t` at or after the epoch.
   */
  minusHours(t: UtcEpochMs, h: HourCount): UtcEpochMs {
    return (t - h * MS_PER_HOUR) as UtcEpochMs;
  },

  /** `t + days × 24 h` of real elapsed time (T2 only — a TTL, never a calendar day). */
  plusDays(t: UtcEpochMs, days: number): UtcEpochMs {
    return (t + days * MS_PER_DAY) as UtcEpochMs;
  },
} as const;
