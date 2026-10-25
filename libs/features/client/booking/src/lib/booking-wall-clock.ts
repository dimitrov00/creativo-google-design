import { type EndMinute, LocalDate, type MinuteOfDay } from '@core/primitives';
import { formatWallClock } from '@creativo/ui/wall-clock';

/*
 * THE BOOKING STEPS' CLOCK FACES — the one place the flow says a day or a
 * time. Every reading is the SHOP's wall clock (`localDate` + minutes, Law
 * 7.3), formatted as it is by `formatWallClock` (no zone consulted, no
 * device clock read), so «14:00» is the minute the shop's chair is booked at
 * wherever the reader is. One copy of the options, so the schedule step,
 * the time sheet, the review and the receipts can never print a time apart.
 */

/** «14:00» — 24-hour in every locale, as the booking steps have always shown it. */
const TIME_OF_DAY: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

/** «понеделник, 3 август» — the day a person re-reads. */
const LONG_DAY: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
};

/**
 * A minute of the shop day `localDate` — a start, or an exclusive end:
 * `1440` (an end at the next midnight) reads as that midnight.
 */
export function formatBookingTime(
  localDate: LocalDate,
  minute: MinuteOfDay | EndMinute,
  locale: string,
): string {
  return formatWallClock(localDate, minute, locale, TIME_OF_DAY);
}

/** The shop day itself, spelled out. */
export function formatBookingDay(localDate: LocalDate, locale: string): string {
  return formatWallClock(localDate, null, locale, LONG_DAY);
}

/** A month heading — «август». */
const MONTH: Intl.DateTimeFormatOptions = { month: 'long' };

/** A month heading outside this year — «август 2027 г.». */
const MONTH_WITH_YEAR: Intl.DateTimeFormatOptions = {
  month: 'long',
  year: 'numeric',
};

/**
 * The month `localDate` falls in, as a heading — «Август», «Януари 2027 г.»
 * — with its year only when `withYear` (the caller's "not this year").
 *
 * Capitalized deliberately: Bulgarian orthography writes month names in
 * lower case in running prose, and `Intl` is right to return «август», but
 * a heading that titles a block takes the typographic convention (owner
 * ruling 2026-08-01). Done on the string rather than with
 * `text-transform: capitalize`, which would also capitalize the
 * year-bearing second word and cannot be told which locales to leave alone.
 */
export function formatBookingMonth(
  localDate: LocalDate,
  withYear: boolean,
  locale: string,
): string {
  const label = formatWallClock(
    LocalDate.startOfMonth(localDate),
    null,
    locale,
    withYear ? MONTH_WITH_YEAR : MONTH,
  );
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
}
