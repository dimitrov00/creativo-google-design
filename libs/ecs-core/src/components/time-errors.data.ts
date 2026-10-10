/**
 * What turning raw time input into an instant can refuse — raised only at the
 * `ZonedTimeSystem` edge (a raw ISO string, a raw zone, a wall clock a DST
 * transition erased or repeated). Past the edge every system works on epoch
 * ms and the zone table, where nothing can fail.
 *
 * Every field besides `code` is an i18n parameter: stable scalars only.
 */

/** Error codes — the ONLY source of these strings; the UI translates them. */
export const TimeErrorCode = {
  InvalidDateTime: 'time.invalid_date_time',
  InvalidTimeZone: 'time.invalid_time_zone',
  NonexistentLocalTime: 'time.nonexistent_local_time',
  AmbiguousLocalTime: 'time.ambiguous_local_time',
} as const;
export type TimeErrorCode = (typeof TimeErrorCode)[keyof typeof TimeErrorCode];

/** Why a date/time was refused before any zone was consulted. */
export const DateTimeInvalidReason = {
  /** Not in a recognised `YYYY-MM-DD[THH:mm[:ss[.SSS]]][Z|±HH:mm]` form. */
  Unparsable: 'unparsable',
  /** Well-formed but not a real date or clock time (`2026-02-30`, `24:30`). */
  OutOfRange: 'out_of_range',
} as const;
export type DateTimeInvalidReason =
  (typeof DateTimeInvalidReason)[keyof typeof DateTimeInvalidReason];

export type TimeError =
  | TimeError.InvalidDateTime
  | TimeError.InvalidTimeZone
  | TimeError.NonexistentLocalTime
  | TimeError.AmbiguousLocalTime;

export const TimeError = {
  invalidDateTime(
    rawValue: string,
    reason: DateTimeInvalidReason,
  ): TimeError.InvalidDateTime {
    return { code: TimeErrorCode.InvalidDateTime, rawValue, reason };
  },

  invalidTimeZone(rawZone: string): TimeError.InvalidTimeZone {
    return { code: TimeErrorCode.InvalidTimeZone, rawZone };
  },

  /**
   * A wall-clock time a spring-forward skipped — `2026-03-29 03:30` is never
   * on the clock in Europe/Sofia. Refused by default: accepting it silently
   * books a barber an hour after the roster said, once a year, and the only
   * symptom is a client arriving an hour late.
   */
  nonexistentLocalTime(
    rawValue: string,
    zone: string,
  ): TimeError.NonexistentLocalTime {
    return { code: TimeErrorCode.NonexistentLocalTime, rawValue, zone };
  },

  /**
   * A wall-clock time a fall-back repeated — `2026-10-25 03:30` happens at
   * both `+03:00` and `+02:00` in Europe/Sofia. Which one a booking means is a
   * decision, not a default.
   */
  ambiguousLocalTime(
    rawValue: string,
    zone: string,
  ): TimeError.AmbiguousLocalTime {
    return { code: TimeErrorCode.AmbiguousLocalTime, rawValue, zone };
  },

  is<C extends TimeErrorCode>(
    error: TimeError,
    code: C,
  ): error is Extract<TimeError, { readonly code: C }> {
    return error.code === code;
  },
} as const;

export namespace TimeError {
  export type InvalidDateTime = {
    readonly code: typeof TimeErrorCode.InvalidDateTime;
    readonly rawValue: string;
    readonly reason: DateTimeInvalidReason;
  };
  export type InvalidTimeZone = {
    readonly code: typeof TimeErrorCode.InvalidTimeZone;
    readonly rawZone: string;
  };
  export type NonexistentLocalTime = {
    readonly code: typeof TimeErrorCode.NonexistentLocalTime;
    readonly rawValue: string;
    readonly zone: string;
  };
  export type AmbiguousLocalTime = {
    readonly code: typeof TimeErrorCode.AmbiguousLocalTime;
    readonly rawValue: string;
    readonly zone: string;
  };
}
