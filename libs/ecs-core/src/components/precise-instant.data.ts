import {
  type Result,
  defect,
  EpochSeconds,
  SubsecondNanos,
  type PrimitiveError,
  UtcEpochMs,
} from '@core/primitives';

/*
 * Split out of `client-stats.data.ts` (pass D, S-21; one name per file,
 * L-1). NOT the primitives' `precise-instant.primitive.ts`, which holds the
 * two halves' brands (`EpochSeconds`, `SubsecondNanos`).
 */

const NANOS_PER_MS = 1_000_000;
const NANOS_PER_SECOND = 1_000_000_000;
const MS_PER_SECOND = 1000;

/** A brand the arithmetic above already proved — a broken one is a defect. */
function proven<T>(result: Result<T, PrimitiveError>, what: string): T {
  return result.ok
    ? result.value
    : defect(`${what}: ${result.error.errorCode}`);
}

/**
 * An instant at FULL precision — whole epoch seconds plus the nanoseconds
 * inside that second, the representation §9 D17 picks for both sides of the
 * policy-pass comparison (`PolicyRecomputeJob.changedAtSeconds/Nanos` and
 * `PolicyPass.changedAt`). A Firestore event's time is stamped in
 * microseconds and a document's `updateTime` in nanoseconds, so two settings
 * writes inside one millisecond must not compare as simultaneous: epoch ms
 * alone would break the ordering, and an RFC 3339 string would need a
 * parser in a system. Integer compare, no parser. A VALUE type for system
 * I/O (flatten-spec §3.4): a stored occurrence flattens to `<x>Seconds` +
 * `<x>Nanos`.
 */
export type PreciseInstant = {
  readonly seconds: EpochSeconds;
  readonly nanos: SubsecondNanos;
};

/**
 * The D17 bound — the latest instant a {@link PreciseInstant} holds (the
 * largest safe whole second, its last nanosecond). Proven by construction:
 * both halves are in their brands' ranges.
 */
const LATEST: PreciseInstant = {
  seconds: proven(
    EpochSeconds.of(Number.MAX_SAFE_INTEGER),
    'PreciseInstant.LATEST seconds',
  ),
  nanos: proven(
    SubsecondNanos.of(NANOS_PER_SECOND - 1),
    'PreciseInstant.LATEST nanos',
  ),
};

export const PreciseInstant = {
  /**
   * The latest instant one can hold — what an edge reads an unreadable
   * change time as, so a system's conservative answer (restart, judge) is
   * the one taken, never a skip.
   */
  LATEST,

  /**
   * The edge guard: integral seconds and nanos in `[0, 1e9)`, or `null` —
   * an adapter builds one from a Timestamp's `{ seconds, nanoseconds }`.
   */
  of(seconds: number, nanos: number): PreciseInstant | null {
    const wholeSeconds = EpochSeconds.of(seconds);
    const subsecond = SubsecondNanos.of(nanos);
    return wholeSeconds.ok && subsecond.ok
      ? { seconds: wholeSeconds.value, nanos: subsecond.value }
      : null;
  },

  /**
   * An RFC 3339 time read whole — its whole-second instant (an epoch ms on
   * a second's boundary, as `ZonedTimeSystem.parseOffsetIso` reads the time
   * through its offset with the fraction cut off) plus the nanoseconds its
   * fraction spells — or `null` when `nanos` is not in `[0, 1e9)`. The
   * seconds are the floored quotient, exactly as {@link of} would be handed
   * them.
   */
  fromWholeSecond(
    wholeSecondMs: UtcEpochMs,
    nanos: number,
  ): PreciseInstant | null {
    return PreciseInstant.of(Math.floor(wholeSecondMs / MS_PER_SECOND), nanos);
  },

  /** An epoch-ms instant at millisecond precision (floored seconds, so pre-1970 stays ordered). */
  fromEpochMs(utcEpochMs: UtcEpochMs): PreciseInstant {
    const seconds = Math.floor(utcEpochMs / MS_PER_SECOND);
    return {
      seconds: proven(EpochSeconds.of(seconds), 'PreciseInstant seconds'),
      nanos: proven(
        SubsecondNanos.of(
          (utcEpochMs - seconds * MS_PER_SECOND) * NANOS_PER_MS,
        ),
        'PreciseInstant nanos',
      ),
    };
  },

  /**
   * Truncated to the millisecond — for display and coarse arithmetic, never
   * for ordering; `null` past the window a `UtcEpochMs` holds.
   */
  toEpochMs(instant: PreciseInstant): UtcEpochMs | null {
    const ms = UtcEpochMs.of(
      instant.seconds * MS_PER_SECOND +
        Math.floor(instant.nanos / NANOS_PER_MS),
    );
    return ms.ok ? ms.value : null;
  },

  /** `-1`, `0` or `1` as `a` is before, at or after `b` — to the nanosecond. */
  compare(a: PreciseInstant, b: PreciseInstant): -1 | 0 | 1 {
    if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1;
    if (a.nanos !== b.nanos) return a.nanos < b.nanos ? -1 : 1;
    return 0;
  },

  equals(a: PreciseInstant, b: PreciseInstant): boolean {
    return a.seconds === b.seconds && a.nanos === b.nanos;
  },
} as const;
