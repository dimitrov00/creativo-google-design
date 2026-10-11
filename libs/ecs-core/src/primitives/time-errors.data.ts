import type { LocalDate } from './local-date.primitive';
import type { MinuteOfDay } from './minute-of-day.primitive';
import type { TimeZone } from './time-zone.primitive';

/**
 * What turning raw time input into an instant can refuse — raised only at the
 * ingestion boundary, by `ZonedTimeSystem` (a raw zone, an ISO string without
 * an offset, a shop wall clock a spring-forward erased). Past the boundary
 * every system works on `LocalDate` + `MinuteOfDay`, where nothing can fail.
 *
 * Flat, zero-prototype, serialisable structs discriminated by `errorCode`
 * (Law 7.5); every other field is an i18n parameter (`errors.<errorCode>`).
 * A fall-back repeat is NOT an error: it resolves to the earlier offset
 * (owner-locked 2026-10-10).
 */

/** Error codes — the ONLY source of these strings (flatten-spec §2.1). */
export const TimeErrorCode = {
  /** A wall-clock time inside the spring-forward gap — the owner-locked code (no `TIME_` prefix). */
  DstGap: 'DST_GAP_INVALID_TIME',
  InvalidDateTime: 'TIME_INVALID_DATE_TIME',
  InvalidTimeZone: 'TIME_INVALID_TIME_ZONE',
} as const;
export type TimeErrorCode = (typeof TimeErrorCode)[keyof typeof TimeErrorCode];

/** Why a date/time was refused before any zone was consulted — the field `dateTimeInvalidReason`. */
export const DateTimeInvalidReason = {
  /** Not a recognised form (an offset-less string where an instant is required, a typo). */
  Unparsable: 'UNPARSABLE',
  /** Well-formed but not a real date or clock time (`2026-02-30`, `24:30`), or outside 0001–9999. */
  OutOfRange: 'OUT_OF_RANGE',
} as const;
export type DateTimeInvalidReason =
  (typeof DateTimeInvalidReason)[keyof typeof DateTimeInvalidReason];

export type TimeError =
  TimeError.DstGap | TimeError.InvalidDateTime | TimeError.InvalidTimeZone;

export const TimeError = {
  /**
   * A wall-clock time a spring-forward skipped — `2026-03-29 03:30` is never
   * on the clock in Europe/Sofia. Refused, never shifted: accepting it
   * silently books a barber an hour after the roster said.
   */
  dstGap(
    localDate: LocalDate,
    minute: MinuteOfDay,
    timeZone: TimeZone,
  ): TimeError.DstGap {
    return { errorCode: TimeErrorCode.DstGap, localDate, minute, timeZone };
  },

  invalidDateTime(
    rawValue: string,
    dateTimeInvalidReason: DateTimeInvalidReason,
  ): TimeError.InvalidDateTime {
    return {
      errorCode: TimeErrorCode.InvalidDateTime,
      rawValue,
      dateTimeInvalidReason,
    };
  },

  invalidTimeZone(rawZone: string): TimeError.InvalidTimeZone {
    return { errorCode: TimeErrorCode.InvalidTimeZone, rawZone };
  },

  is<C extends TimeErrorCode>(
    error: TimeError,
    errorCode: C,
  ): error is Extract<TimeError, { readonly errorCode: C }> {
    return error.errorCode === errorCode;
  },
} as const;

export namespace TimeError {
  export type DstGap = {
    readonly errorCode: typeof TimeErrorCode.DstGap;
    readonly localDate: LocalDate;
    readonly minute: MinuteOfDay;
    readonly timeZone: TimeZone;
  };
  export type InvalidDateTime = {
    readonly errorCode: typeof TimeErrorCode.InvalidDateTime;
    /** The input as received — the copied i18n text interpolates `{{rawValue}}`. */
    readonly rawValue: string;
    readonly dateTimeInvalidReason: DateTimeInvalidReason;
  };
  export type InvalidTimeZone = {
    readonly errorCode: typeof TimeErrorCode.InvalidTimeZone;
    readonly rawZone: string;
  };
}
