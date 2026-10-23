import {
  EndMinute,
  MinuteOfDay,
  CatalogError,
  Result,
  type Weekday,
} from '@core/primitives';

/**
 * The day tags — the ONLY source of these strings, named after the field they
 * type (`openingState`, Law 1/N15; was `DayHoursKind` / `kind`).
 */
export const OpeningState = {
  Closed: 'CLOSED',
  Open: 'OPEN',
} as const;
export type OpeningState = (typeof OpeningState)[keyof typeof OpeningState];

/** `HH:mm`, 00:00–23:59 — the legacy `TIME_REGEX` (`location.ts:62`). */
const CLOCK_SHAPE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * One weekday of a shop's opening hours (`location.ts:27-40`), on the shop's
 * wall clock: `CLOSED`, or `OPEN` from `openMinutes` to `closeMinutes`
 * (half-open, `openMinutes < closeMinutes`, both authored within
 * 00:00–23:59). An element of `ShopLocation.openingHours` — a flat struct
 * with a domain-prefixed tag (Law 6).
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

/** A week day in minutes as authored or stored, before its edge guard. */
export type DayHoursInput =
  | DayHours.Closed
  | {
      readonly openingState: typeof OpeningState.Open;
      readonly openMinutes: number;
      readonly closeMinutes: number;
    };

/** An open day as authored in clock text — the legacy stored shape, re-tagged. */
export type ClockDayHours =
  | DayHours.Closed
  | {
      readonly openingState: typeof OpeningState.Open;
      readonly opens: string;
      readonly closes: string;
    };

const CLOSED: DayHours.Closed = { openingState: OpeningState.Closed };

export const DayHours = {
  closed(): DayHours.Closed {
    return CLOSED;
  },

  /** Trusted minutes; validate untrusted input with {@link parseWeek}. */
  open(openMinutes: MinuteOfDay, closeMinutes: EndMinute): DayHours.Open {
    return { openingState: OpeningState.Open, openMinutes, closeMinutes };
  },

  /**
   * The day of a seven-entry week for an ISO `weekday` (index `weekday − 1`),
   * or `null` when the week has no such entry.
   */
  forWeekday(week: readonly DayHours[], weekday: Weekday): DayHours | null {
    return week[weekday - 1] ?? null;
  },

  /**
   * The shop is open at `minute` on `weekday`: that day is open and
   * `openMinutes ≤ minute < closeMinutes` — the closing minute itself is
   * already closed. A closed or missing day is never open.
   */
  isOpenAt(
    week: readonly DayHours[],
    weekday: Weekday,
    minute: MinuteOfDay,
  ): boolean {
    const day = week[weekday - 1];
    return (
      day !== undefined &&
      day.openingState === OpeningState.Open &&
      day.openMinutes <= minute &&
      minute < day.closeMinutes
    );
  },

  /**
   * `'HH:mm'` (00:00–23:59, zero-padded) → a minute of the day, or
   * `CATALOG_LOCATION_INVALID_TIME_OF_DAY` carrying the text.
   */
  parseClock(
    raw: string,
  ): Result<MinuteOfDay, CatalogError.LocationInvalidTimeOfDay> {
    const match = CLOCK_SHAPE.exec(raw);
    const minute =
      match === null
        ? null
        : MinuteOfDay.of(Number(match[1]) * 60 + Number(match[2]));
    return minute !== null && minute.ok
      ? Result.ok(minute.value)
      : Result.err(CatalogError.locationInvalidTimeOfDay(raw));
  },

  /**
   * The edge guard for a week in minutes (an admin write, a stored
   * document): exactly seven entries, Monday first
   * (`CATALOG_LOCATION_INVALID_HOURS_LENGTH`, reported alone); on each open
   * day both figures a minute of the day (`CATALOG_LOCATION_INVALID_TIME_OF_DAY`
   * with the figure as text — the opening figure is checked first and the
   * day stops at its first bad figure) and `openMinutes < closeMinutes`
   * (`CATALOG_LOCATION_INVALID_HOURS_RANGE` with the day's index). Every
   * day's violation is reported. Each entry comes back as a fresh struct
   * holding only its own keys.
   */
  parseWeek(
    raw: readonly DayHoursInput[],
  ): Result<readonly DayHours[], readonly CatalogError[]> {
    if (raw.length !== 7) {
      return Result.err([CatalogError.locationInvalidHoursLength(raw.length)]);
    }
    const errors: CatalogError[] = [];
    const week: DayHours[] = [];
    for (let i = 0; i < raw.length; i++) {
      const day = raw[i] as DayHoursInput;
      if (day.openingState === OpeningState.Closed) {
        week.push(DayHours.closed());
        continue;
      }
      const opens = MinuteOfDay.of(day.openMinutes);
      if (!opens.ok) {
        errors.push(
          CatalogError.locationInvalidTimeOfDay(String(day.openMinutes)),
        );
        continue;
      }
      // An authored closing figure is a minute of the day too (00:00–23:59).
      const closes = MinuteOfDay.of(day.closeMinutes);
      if (!closes.ok) {
        errors.push(
          CatalogError.locationInvalidTimeOfDay(String(day.closeMinutes)),
        );
        continue;
      }
      const opened = openDay(i, opens.value, closes.value);
      if (opened.ok) week.push(opened.value);
      else errors.push(opened.error);
    }
    return errors.length > 0 ? Result.err(errors) : Result.ok(week);
  },

  /**
   * The legacy `validateHours` (`location.ts:251-292`) on the clock-text
   * shape locations stored before the booking-core flip (`hours: [{ kind:
   * 'open', opens: '09:00', closes: '20:00' }, …]`, which the legacy shim
   * re-tagged), converting to minutes: the same codes, in the same order, as
   * {@link parseWeek} — the one guard the `hours` → `openingHours` reshaping
   * and the seed ran their seven days through.
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
      if (day.openingState === OpeningState.Closed) {
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
      const opened = openDay(i, opens.value, closes.value);
      if (opened.ok) week.push(opened.value);
      else errors.push(opened.error);
    }
    return errors.length > 0 ? Result.err(errors) : Result.ok(week);
  },
} as const;

/**
 * An open day from two minutes of the day: `opens < closes`, or
 * `CATALOG_LOCATION_INVALID_HOURS_RANGE` with the day's index. The closing
 * minute, strictly after an opening one, is a valid exclusive end.
 */
function openDay(
  dayIndex: number,
  opens: MinuteOfDay,
  closes: MinuteOfDay,
): Result<DayHours.Open, CatalogError.LocationInvalidHoursRange> {
  const end = EndMinute.of(closes);
  return opens < closes && end.ok
    ? Result.ok(DayHours.open(opens, end.value))
    : Result.err(CatalogError.locationInvalidHoursRange(dayIndex));
}

export namespace DayHours {
  export type Closed = {
    readonly openingState: typeof OpeningState.Closed;
  };
  export type Open = {
    readonly openingState: typeof OpeningState.Open;
    /** First open minute of the day. */
    readonly openMinutes: MinuteOfDay;
    /** The minute the door closes (exclusive), after `openMinutes`. */
    readonly closeMinutes: EndMinute;
  };
}
