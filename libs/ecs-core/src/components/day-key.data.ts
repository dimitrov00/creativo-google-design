/**
 * A civil calendar day, `'YYYY-MM-DD'` — the unit availability, busy days and
 * loyalty dates are stored, queried and reported by. Sortable: string order
 * is day order, so `<`/`>` and a binary search over a sorted array compare
 * days directly.
 *
 * Whose day it is lives beside it (a `zone` field, or the zone table a
 * system was handed): the same key names different instants in different
 * zones, and a key turns into an instant only through
 * `ZonedTimeSystem.dayTable`.
 */
export type DayKey = string & { readonly __brand: unique symbol };

const DAY_KEY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** Days from 0000-03-01 to 1970-01-01 in the proleptic Gregorian calendar. */
const UNIX_EPOCH_OFFSET_DAYS = 719_468;
const DAYS_PER_ERA = 146_097;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export const DayKey = {
  /** The only cast site. Validate the raw string at the edge with {@link isValid}. */
  of(raw: string): DayKey {
    return raw as DayKey;
  },

  /**
   * A real calendar day in `YYYY-MM-DD` form — `2026-02-30` is refused, not
   * rolled into March, and `2026-9-28` or a full ISO stamp is refused too.
   * The edge guard every untrusted day key passes before {@link of}.
   */
  isValid(raw: unknown): raw is string {
    return (
      typeof raw === 'string' &&
      DAY_KEY_SHAPE.test(raw) &&
      DayKey.fromEpochDay(DayKey.toEpochDay(DayKey.of(raw))) === raw
    );
  },

  /** Day order: negative when `a` is earlier, `0` on the same day. */
  compare(a: DayKey, b: DayKey): number {
    return a < b ? -1 : a > b ? 1 : 0;
  },

  /**
   * The Gregorian leap rule over the proleptic calendar: every fourth year,
   * except a century not divisible by 400 (1900 is common, 2000 is leap).
   */
  isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  },

  /**
   * Days in a civil month (`month` 1..12) by the leap rule — 28–31, no
   * `Date`, no zone. The ONE month-length table of the lib: booking
   * horizons, birth dates, recurrence and month arithmetic all read it.
   */
  daysInMonth(year: number, month: number): number {
    if (month === 2) return DayKey.isLeapYear(year) ? 29 : 28;
    return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
  },

  /**
   * Days since 1970-01-01 — Howard Hinnant's `days_from_civil`, pure integer
   * arithmetic over the proleptic Gregorian calendar (no `Date`, no zone).
   * An out-of-range month or day rolls over, which is how {@link isValid}
   * detects it by round trip.
   */
  toEpochDay(key: DayKey): number {
    return DayKey.epochDayOf(
      Number(key.slice(0, 4)),
      Number(key.slice(5, 7)),
      Number(key.slice(8, 10)),
    );
  },

  /** {@link toEpochDay} from numeric parts (`month` 1..12, `day` 1..31). */
  epochDayOf(year: number, month: number, day: number): number {
    const marchYear = year - (month <= 2 ? 1 : 0);
    const era = Math.floor(marchYear / 400);
    const yearOfEra = marchYear - era * 400;
    const shiftedMonth = (month + 9) % 12; // March = 0 … February = 11
    const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
    const dayOfEra =
      yearOfEra * 365 +
      Math.floor(yearOfEra / 4) -
      Math.floor(yearOfEra / 100) +
      dayOfYear;
    return era * DAYS_PER_ERA + dayOfEra - UNIX_EPOCH_OFFSET_DAYS;
  },

  /** The day key of an epoch day — Hinnant's `civil_from_days`. */
  fromEpochDay(epochDay: number): DayKey {
    const shifted = epochDay + UNIX_EPOCH_OFFSET_DAYS;
    const era = Math.floor(shifted / DAYS_PER_ERA);
    const dayOfEra = shifted - era * DAYS_PER_ERA;
    const yearOfEra = Math.floor(
      (dayOfEra -
        Math.floor(dayOfEra / 1460) +
        Math.floor(dayOfEra / 36_524) -
        Math.floor(dayOfEra / 146_096)) /
        365,
    );
    const dayOfYear =
      dayOfEra -
      (365 * yearOfEra +
        Math.floor(yearOfEra / 4) -
        Math.floor(yearOfEra / 100));
    const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
    const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
    const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
    const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
    return DayKey.of(
      `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`,
    );
  },
} as const;

/**
 * An inclusive span of days, `fromDayKey … toDayKey` — the shape a month view
 * and a materialisation horizon are both expressed in. Valid when
 * `fromDayKey ≤ toDayKey`; its days are `ZonedTimeSystem.rangeKeys`.
 */
export type DateRange = {
  readonly fromDayKey: DayKey;
  readonly toDayKey: DayKey;
};

export const DateRange = {
  of(fromDayKey: DayKey, toDayKey: DayKey): DateRange {
    return { fromDayKey, toDayKey };
  },

  /** The end does not precede the start. */
  isValid(range: DateRange): boolean {
    return range.fromDayKey <= range.toDayKey;
  },

  /** Both ends included. */
  contains(range: DateRange, dayKey: DayKey): boolean {
    return range.fromDayKey <= dayKey && dayKey <= range.toDayKey;
  },
} as const;
