import { Result } from './result.data';
import type { Weekday } from './weekday.data';
import type { Brand } from './brand';
import { CapacityMonthId } from './ids.primitive';
import { PrimitiveError, PrimitiveErrorCode } from './primitive.error';

/**
 * The shop's wall-clock day, `YYYY-MM-DD` on the proleptic Gregorian
 * calendar — never an instant, never carries a zone. Sortable: string order
 * is day order, so `<`/`>` and a binary search compare days directly. Any
 * four-digit year (0000–9999): year 0000 is a real proleptic day, refused —
 * where it is refused — by a domain window (an age), never as text.
 */
export type LocalDate = Brand<string, 'LocalDate'>;

const SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const BRAND = 'LocalDate';

/** Days from 0000-03-01 to 1970-01-01 in the proleptic Gregorian calendar. */
const UNIX_EPOCH_OFFSET_DAYS = 719_468;
const DAYS_PER_ERA = 146_097;

/** `MM-DD` of 29 February, and the day its anniversary falls on in a common year. */
const LEAP_DAY = '02-29';
const LAST_OF_COMMON_FEBRUARY = '02-28';

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function refuse(raw: string | number): Result.Err<PrimitiveError> {
  return Result.err(
    PrimitiveError.of(PrimitiveErrorCode.LocalDateInvalid, raw, BRAND),
  );
}

/** The decimal digit at `index` of `text`, or `NaN` for anything else. */
function digitAt(text: string, index: number): number {
  const digit = text.charCodeAt(index) - 48;
  return digit >= 0 && digit <= 9 ? digit : Number.NaN;
}

/** The text length of a day — `YYYY-MM-DD`. */
const DAY_LENGTH = 10;
/** `-`, the separator at offsets 4 and 7 of a day. */
const HYPHEN = 45;

export const LocalDate = {
  /**
   * The smart constructor — the ONLY way foreign input becomes a LocalDate:
   * the `YYYY-MM-DD` shape AND a real calendar day, checked by round trip
   * through the epoch-day algorithm (`2026-02-30` is refused, never rolled
   * into March; `2026-9-28` and a full ISO stamp are refused too).
   */
  parse(raw: string): Result<LocalDate, PrimitiveError> {
    if (!SHAPE.test(raw)) return refuse(raw);
    const epochDay = LocalDate.epochDayOf(
      Number(raw.slice(0, 4)),
      Number(raw.slice(5, 7)),
      Number(raw.slice(8, 10)),
    );
    return LocalDate.fromEpochDay(epochDay) === raw
      ? Result.ok(raw as LocalDate)
      : refuse(raw);
  },

  /**
   * The read-time door (edge hardening D-1): `raw` is a string {@link parse}
   * accepts — exactly ten characters that {@link isAt} reads as a real day
   * — and `false` for every other value, non-strings included. Allocates
   * nothing (no `Result`, no slice, no regular-expression match), so a
   * stored-document guard runs it per document on every snapshot.
   */
  is(raw: unknown): raw is LocalDate {
    return (
      typeof raw === 'string' &&
      raw.length === DAY_LENGTH &&
      LocalDate.isAt(raw, 0)
    );
  },

  /**
   * The ten characters of `text` from `start` spell a real day —
   * `YYYY-MM-DD`, ASCII digits, the month `01`–`12`, the day of month
   * within that month by the proleptic Gregorian leap rule — read in place
   * by character code (no slice). What a `BusyKey`'s tail is checked with.
   * `false` when fewer than ten characters remain.
   */
  isAt(text: string, start: number): boolean {
    if (start < 0 || text.length - start < DAY_LENGTH) return false;
    if (
      text.charCodeAt(start + 4) !== HYPHEN ||
      text.charCodeAt(start + 7) !== HYPHEN
    ) {
      return false;
    }
    const year =
      digitAt(text, start) * 1000 +
      digitAt(text, start + 1) * 100 +
      digitAt(text, start + 2) * 10 +
      digitAt(text, start + 3);
    const month = digitAt(text, start + 5) * 10 + digitAt(text, start + 6);
    const day = digitAt(text, start + 8) * 10 + digitAt(text, start + 9);
    // A non-digit reads as NaN, which fails every comparison below.
    return (
      year >= 0 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= LocalDate.daysInMonth(year, month)
    );
  },

  /** A day from numeric parts (`month` 1..12, `day` 1..31) — refused unless real. */
  fromParts(
    year: number,
    month: number,
    day: number,
  ): Result<LocalDate, PrimitiveError> {
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day)
    ) {
      return refuse(`${year}-${month}-${day}`);
    }
    return LocalDate.parse(
      `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`,
    );
  },

  /** The numeric parts of a day — a plain struct, no allocation beyond it. */
  parts(d: LocalDate): LocalDate.Parts {
    return {
      year: Number(d.slice(0, 4)),
      month: Number(d.slice(5, 7)),
      day: Number(d.slice(8, 10)),
    };
  },

  /**
   * Days since 1970-01-01 — Howard Hinnant's `days_from_civil`, pure integer
   * arithmetic over the proleptic Gregorian calendar (no `Date`, no `Intl`).
   */
  toEpochDay(d: LocalDate): number {
    // Read by character code, allocating nothing: it runs per element in
    // hot loops (streak folds, capacity days, lead floors). A non-digit
    // reads as NaN, as `Number` of its slice did.
    return LocalDate.epochDayOf(
      digitAt(d, 0) * 1000 +
        digitAt(d, 1) * 100 +
        digitAt(d, 2) * 10 +
        digitAt(d, 3),
      digitAt(d, 5) * 10 + digitAt(d, 6),
      digitAt(d, 8) * 10 + digitAt(d, 9),
    );
  },

  /**
   * {@link toEpochDay} from numeric parts (`month` 1..12, `day` 1..31). An
   * out-of-range month or day rolls over, which is how {@link parse}
   * detects it by round trip.
   */
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

  /** The day of an epoch day (`0` = 1970-01-01) — Hinnant's `civil_from_days`. */
  fromEpochDay(epochDay: number): LocalDate {
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
    return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}` as LocalDate;
  },

  /** Day order: `-1` when `a` is earlier, `0` on the same day, `1` after. */
  compare(a: LocalDate, b: LocalDate): -1 | 0 | 1 {
    return a < b ? -1 : a > b ? 1 : 0;
  },

  /**
   * The later of two days — either one on the same day (string order is day
   * order). The max of days the rhythm's publish reads: the first day a
   * change may start against the day chosen, a floor against the earliest.
   */
  later(a: LocalDate, b: LocalDate): LocalDate {
    return a > b ? a : b;
  },

  /** `n` days away (negative moves back) — civil arithmetic, one step per day. */
  addDays(d: LocalDate, n: number): LocalDate {
    return LocalDate.fromEpochDay(LocalDate.toEpochDay(d) + n);
  },

  /** Whole calendar days from `from` to `to`, negative when `to` comes first. */
  daysBetween(from: LocalDate, to: LocalDate): number {
    return LocalDate.toEpochDay(to) - LocalDate.toEpochDay(from);
  },

  /**
   * The ISO weekday, `1` = Monday … `7` = Sunday — `((epochDay + 3) mod 7) + 1`
   * (1970-01-01 was a Thursday); correct for negative epoch days too.
   */
  weekday(d: LocalDate): Weekday {
    const epochDay = LocalDate.toEpochDay(d);
    return (((((epochDay + 3) % 7) + 7) % 7) + 1) as Weekday;
  },

  /**
   * `n` calendar months away, the day clamped to the target month's length
   * (`2026-01-31` + 1 month → `2026-02-28`); negative moves back.
   */
  addMonths(d: LocalDate, n: number): LocalDate {
    const totalMonths =
      Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1 + n;
    const year = Math.floor(totalMonths / 12);
    const month = totalMonths - year * 12 + 1;
    const day = Math.min(
      Number(d.slice(8, 10)),
      LocalDate.daysInMonth(year, month),
    );
    return LocalDate.fromEpochDay(LocalDate.epochDayOf(year, month, day));
  },

  /** The 1st of the day's month. */
  startOfMonth(d: LocalDate): LocalDate {
    return `${d.slice(0, 8)}01` as LocalDate;
  },

  /** The day's month as `YYYY-MM` — the `capacity/{YYYY-MM}` document id. */
  monthKey(d: LocalDate): CapacityMonthId {
    return CapacityMonthId.of(d.slice(0, 7));
  },

  /** The Monday of the day's ISO week. */
  startOfWeek(d: LocalDate): LocalDate {
    return LocalDate.addDays(d, 1 - LocalDate.weekday(d));
  },

  /** Every day `from … to`, both ends included; empty when inverted. */
  range(from: LocalDate, to: LocalDate): readonly LocalDate[] {
    const days: LocalDate[] = [];
    const last = LocalDate.toEpochDay(to);
    for (let day = LocalDate.toEpochDay(from); day <= last; day++) {
      days.push(LocalDate.fromEpochDay(day));
    }
    return days;
  },

  /**
   * Whole calendar years from `from` to `to`, counting a year only once its
   * anniversary has come round — an age from a birth date. A 29 February
   * anniversary falls on 28 February in a common year (the legacy
   * `ZonedDateTime.yearsUntil` rule, and a Bulgarian civil year-term: ZZD
   * art. 72(2)). Negative (truncated toward zero) when `to` comes first.
   */
  wholeYearsBetween(from: LocalDate, to: LocalDate): number {
    if (to < from) return -LocalDate.wholeYearsBetween(to, from);
    const toYear = Number(to.slice(0, 4));
    const years = toYear - Number(from.slice(0, 4));
    const anniversary =
      from.slice(5) === LEAP_DAY && !LocalDate.isLeapYear(toYear)
        ? LAST_OF_COMMON_FEBRUARY
        : from.slice(5);
    return to.slice(5) < anniversary ? years - 1 : years;
  },

  /**
   * The Gregorian leap rule over the proleptic calendar: every fourth year,
   * except a century not divisible by 400 (1900 is common, 2000 is leap).
   */
  isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  },

  /** Days in a civil month (`month` 1..12) — 28–31, by the leap rule. */
  daysInMonth(year: number, month: number): number {
    if (month === 2) return LocalDate.isLeapYear(year) ? 29 : 28;
    return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
  },
} as const;

export namespace LocalDate {
  /** The numeric parts of a day ({@link LocalDate.parts}). */
  export type Parts = {
    readonly year: number;
    readonly month: number;
    readonly day: number;
  };
}
