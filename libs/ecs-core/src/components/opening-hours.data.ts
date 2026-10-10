import { CatalogError } from './catalog-errors.data';
import { Result } from './result.data';
import type { Weekday } from './weekday.data';

/** The stored day tags — the ONLY source of these strings. */
export const DayHoursKind = {
  Closed: 'closed',
  Open: 'open',
} as const;
export type DayHoursKind = (typeof DayHoursKind)[keyof typeof DayHoursKind];

/** Minutes in a day — a valid minute of the day is `0 … 1439` (00:00–23:59). */
const MINUTES_PER_DAY = 1440;

/** `HH:mm`, 00:00–23:59 — the legacy `TIME_REGEX` (`location.ts:62`). */
const CLOCK_SHAPE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * One weekday of a shop's opening hours (`location.ts:27-40`), in
 * minutes-of-day: `closed`, or `open` from `openMinutes` to `closeMinutes`
 * (half-open, `openMinutes < closeMinutes`, both within 00:00–23:59).
 *
 * A location stores exactly seven, Monday first — index `weekday − 1` with
 * `weekday` the ISO `Weekday` — and keeps the closed day as an entry, so a
 * shop's closed Sunday is "the door is locked", never "no hours published"
 * (the distinction `shopDayHours` rests on, `roster-window.ts:24-35`).
 * Minutes, not `'HH:mm'`: the roster clamps windows against these numbers,
 * and a minute of the day survives a DST switch because it has no date.
 * Weekday labels are presentation (`Intl.DateTimeFormat`), never data here.
 */
export type DayHours = DayHours.Closed | DayHours.Open;

/** An open day as authored in clock text — the legacy stored shape. */
export type ClockDayHours =
  | DayHours.Closed
  | {
      readonly kind: typeof DayHoursKind.Open;
      readonly opens: string;
      readonly closes: string;
    };

export const DayHours = {
  closed(): DayHours.Closed {
    return { kind: DayHoursKind.Closed };
  },

  /** Trusted minutes; validate untrusted input with {@link parseWeek}. */
  open(openMinutes: number, closeMinutes: number): DayHours.Open {
    return { kind: DayHoursKind.Open, openMinutes, closeMinutes };
  },

  /**
   * The day of a seven-entry week for an ISO `weekday` (index `weekday − 1`),
   * or `null` when the week has no such entry.
   */
  forWeekday(week: readonly DayHours[], weekday: Weekday): DayHours | null {
    return week[weekday - 1] ?? null;
  },

  /**
   * The shop is open at `minute` (minutes-of-day) on `weekday`: that day is
   * open and `openMinutes ≤ minute < closeMinutes` — the closing minute
   * itself is already closed. A closed or missing day is never open.
   */
  isOpenAt(
    week: readonly DayHours[],
    weekday: Weekday,
    minute: number,
  ): boolean {
    const day = week[weekday - 1];
    return (
      day !== undefined &&
      day.kind === DayHoursKind.Open &&
      day.openMinutes <= minute &&
      minute < day.closeMinutes
    );
  },

  /**
   * `'HH:mm'` (00:00–23:59, zero-padded) → minutes of the day, or
   * `catalog.location.invalid_time_of_day` carrying the text.
   */
  parseClock(
    raw: string,
  ): Result<number, CatalogError.LocationInvalidTimeOfDay> {
    const match = CLOCK_SHAPE.exec(raw);
    if (match === null) {
      return Result.err(CatalogError.locationInvalidTimeOfDay(raw));
    }
    return Result.ok(Number(match[1]) * 60 + Number(match[2]));
  },

  /**
   * The edge guard for a week in minutes (an admin write, a stored
   * document): exactly seven entries, Monday first
   * (`catalog.location.invalid_hours_length`, reported alone); on each open
   * day both figures a minute of the day (`catalog.location.invalid_time_of_day`
   * with the figure as text — the opening figure is checked first and the
   * day stops at its first bad figure) and `openMinutes < closeMinutes`
   * (`catalog.location.invalid_hours_range` with the day's index). Every day's
   * violation is reported. Each entry comes back as a fresh struct holding
   * only its own keys.
   */
  parseWeek(
    raw: readonly DayHours[],
  ): Result<readonly DayHours[], readonly CatalogError[]> {
    if (raw.length !== 7) {
      return Result.err([CatalogError.locationInvalidHoursLength(raw.length)]);
    }
    const errors: CatalogError[] = [];
    const week: DayHours[] = [];
    for (let i = 0; i < raw.length; i++) {
      const day = raw[i] as DayHours;
      if (day.kind === DayHoursKind.Closed) {
        week.push(DayHours.closed());
        continue;
      }
      if (!isMinuteOfDay(day.openMinutes)) {
        errors.push(
          CatalogError.locationInvalidTimeOfDay(String(day.openMinutes)),
        );
        continue;
      }
      if (!isMinuteOfDay(day.closeMinutes)) {
        errors.push(
          CatalogError.locationInvalidTimeOfDay(String(day.closeMinutes)),
        );
        continue;
      }
      if (day.openMinutes >= day.closeMinutes) {
        errors.push(CatalogError.locationInvalidHoursRange(i));
        continue;
      }
      week.push(DayHours.open(day.openMinutes, day.closeMinutes));
    }
    return errors.length > 0 ? Result.err(errors) : Result.ok(week);
  },

  /**
   * The legacy `validateHours` (`location.ts:251-292`) on the clock-text
   * shape every location stores today (`hours: [{ kind: 'open', opens:
   * '09:00', closes: '20:00' }, …]`), converting to minutes: the same codes,
   * in the same order, as {@link parseWeek} — the one guard the
   * `hours` → `openingHours` reshaping and the seed run their seven days
   * through.
   */
  parseClockWeek(
    raw: readonly ClockDayHours[],
  ): Result<readonly DayHours[], readonly CatalogError[]> {
    if (raw.length !== 7) {
      return Result.err([CatalogError.locationInvalidHoursLength(raw.length)]);
    }
    const errors: CatalogError[] = [];
    const week: DayHours[] = [];
    for (let i = 0; i < raw.length; i++) {
      const day = raw[i] as ClockDayHours;
      if (day.kind === DayHoursKind.Closed) {
        week.push(DayHours.closed());
        continue;
      }
      const opens = DayHours.parseClock(day.opens);
      if (!opens.ok) {
        errors.push(opens.error);
        continue;
      }
      const closes = DayHours.parseClock(day.closes);
      if (!closes.ok) {
        errors.push(closes.error);
        continue;
      }
      if (opens.value >= closes.value) {
        errors.push(CatalogError.locationInvalidHoursRange(i));
        continue;
      }
      week.push(DayHours.open(opens.value, closes.value));
    }
    return errors.length > 0 ? Result.err(errors) : Result.ok(week);
  },
} as const;

export namespace DayHours {
  export type Closed = {
    readonly kind: typeof DayHoursKind.Closed;
  };
  export type Open = {
    readonly kind: typeof DayHoursKind.Open;
    /** First open minute of the day, `0 … 1439`. */
    readonly openMinutes: number;
    /** The minute the door closes (exclusive), after `openMinutes`. */
    readonly closeMinutes: number;
  };
}

function isMinuteOfDay(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= 0 && minutes < MINUTES_PER_DAY;
}
